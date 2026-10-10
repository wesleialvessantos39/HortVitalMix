import type { z } from "zod";
import {
  SyncCommandSchema,
  ReconcileResponseSchema,
  canonicalSyncJson,
  type SyncCommand,
  type SyncResult,
} from "../../shared/contracts/offlineSync";
import { api, type ApiFailure } from "./api";
import type { ShellSession } from "../hooks/useSession";
import { pwaTransitionHeld, waitForPwaTransition } from "./pwaTransition";

const NAME = "hvm-rural-v1",
  TTL = 24 * 60 * 60 * 1000;
export type PendingCommand = {
  commandId: string;
  userId: string;
  command: SyncCommand;
  sequence: number;
  createdAt: number;
  result?: SyncResult;
};
type Snapshot = {
  key: string;
  userId: string;
  savedAt: number;
  value: unknown;
};
let connection: Promise<IDBDatabase> | null = null;
let snapshotRevision = 0;
let pendingWrites = 0;
export function hasPendingOfflineWrites() {
  return pendingWrites > 0 || flights.size > 0;
}
const changed = () => window.dispatchEvent(new Event("hvm:offline-changed"));
function open(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB)
    return Promise.reject(new Error("OFFLINE_STORAGE_UNAVAILABLE"));
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    const timer = setTimeout(() => {
      connection = null;
      reject(new Error("OFFLINE_STORAGE_UNAVAILABLE"));
    }, 4000);
    request.onupgradeneeded = () => {
      const db = request.result;
      const queue = db.createObjectStore("pending_commands", {
        keyPath: "commandId",
      });
      queue.createIndex("user", "userId");
      const snapshots = db.createObjectStore("snapshots", { keyPath: "key" });
      snapshots.createIndex("user", "userId");
      db.createObjectStore("meta");
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        connection = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      clearTimeout(timer);
      connection = null;
      reject(new Error("OFFLINE_STORAGE_UNAVAILABLE"));
    };
  });
  return connection;
}
async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, finish: (value: T) => void) => void,
): Promise<T> {
  if (mode === "readwrite" && pwaTransitionHeld()) await waitForPwaTransition();
  if (mode === "readwrite") pendingWrites++;
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () =>
        reject(new Error("OFFLINE_STORAGE_UNAVAILABLE"));
      try {
        work(tx, (v) => {
          value = v;
        });
      } catch (e) {
        tx.abort();
        reject(e);
      }
    });
  } finally {
    if (mode === "readwrite") {
      pendingWrites--;
      changed();
    }
  }
}
/** Read only counts, across local accounts; never exposes another user's data. */
export async function hasOfflineWork() {
  if (hasPendingOfflineWrites()) return true;
  return transaction<boolean>(
    ["pending_commands"],
    "readonly",
    (tx, finish) => {
      const request = tx.objectStore("pending_commands").count();
      request.onsuccess = () =>
        finish(request.result > 0 || hasPendingOfflineWrites());
    },
  );
}
export async function deviceFingerprint() {
  return transaction<string>(["meta"], "readwrite", (tx, finish) => {
    const store = tx.objectStore("meta"),
      r = store.get("device");
    r.onsuccess = () => {
      const id = typeof r.result === "string" ? r.result : crypto.randomUUID();
      store.put(id, "device");
      finish(id);
    };
  });
}
export async function listPending(userId: string) {
  return transaction<PendingCommand[]>(
    ["pending_commands"],
    "readonly",
    (tx, finish) => {
      const r = tx.objectStore("pending_commands").index("user").getAll(userId);
      r.onsuccess = () =>
        finish(
          (r.result as PendingCommand[]).sort(
            (a, b) => a.sequence - b.sequence,
          ),
        );
    },
  );
}
export async function enqueueCommand(userId: string, input: SyncCommand) {
  const command = SyncCommandSchema.parse(input);
  await transaction<void>(
    ["pending_commands", "meta"],
    "readwrite",
    (tx, finish) => {
      const store = tx.objectStore("pending_commands"),
        prior = store.get(command.commandId);
      prior.onsuccess = () => {
        if (prior.result) {
          const row = prior.result as PendingCommand;
          if (
            row.userId !== userId ||
            canonicalSyncJson(row.command) !== canonicalSyncJson(command)
          ) {
            tx.abort();
            return;
          }
          finish();
          return;
        }
        const count = store.index("user").count(userId);
        count.onsuccess = () => {
          if (count.result >= 500) {
            tx.abort();
            return;
          }
          const meta = tx.objectStore("meta"),
            seq = meta.get("sequence");
          seq.onsuccess = () => {
            const n = Number(seq.result ?? 0) + 1;
            meta.put(n, "sequence");
            store.add({
              commandId: command.commandId,
              userId,
              command,
              sequence: n,
              createdAt: Date.now(),
            } satisfies PendingCommand);
            finish();
          };
        };
      };
    },
  );
  changed();
}
export async function dismissCommand(userId: string, commandId: string) {
  // Only resolved conflict/rejection may be dismissed; pending actions cannot be
  // silently discarded or overwritten by a UI refresh or account switch.
  await transaction<void>(["pending_commands"], "readwrite", (tx, finish) => {
    const store = tx.objectStore("pending_commands"),
      r = store.get(commandId);
    r.onsuccess = () => {
      if (r.result?.userId === userId && r.result?.result)
        store.delete(commandId);
      finish();
    };
  });
  changed();
}
async function acceptResults(userId: string, results: SyncResult[]) {
  await transaction<void>(["pending_commands"], "readwrite", (tx, finish) => {
    const store = tx.objectStore("pending_commands");
    for (const result of results) {
      const r = store.get(result.commandId);
      r.onsuccess = () => {
        if (r.result?.userId !== userId) return;
        if (result.status === "confirmed") store.delete(result.commandId);
        else store.put({ ...r.result, result });
      };
    }
    finish();
  });
  changed();
}
const flights = new Map<string, Promise<void>>();
export function synchronize(
  userId: string,
  signal?: AbortSignal,
): Promise<void> {
  const prior = flights.get(userId);
  if (prior) return prior;
  const flight = (async () => {
    if (!navigator.onLine) throw new Error("OFFLINE");
    const device = await deviceFingerprint();
    // One bounded batch per request. Commands stay durable until their response
    // is validated and IndexedDB commits; retries reuse exactly the same IDs.
    for (let round = 0; round < 500; round++) {
      if (signal?.aborted) throw new Error("OFFLINE_SYNC_STOPPED");
      const candidates = (await listPending(userId))
        .filter((v) => !v.result)
        .slice(0, 50);
      const pending: PendingCommand[] = [];
      for (const candidate of candidates) {
        if (
          new TextEncoder().encode(
            JSON.stringify([...pending, candidate].map((v) => v.command)),
          ).length > 24000
        )
          break;
        pending.push(candidate);
      }
      if (!pending.length) return;
      const response = ReconcileResponseSchema.parse(
        await api("/v1/producer/sync", {
          method: "POST",
          body: JSON.stringify({
            deviceFingerprint: device,
            commands: pending.map((v) => v.command),
          }),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
            : undefined,
          timeoutMs: 60000,
        }),
      );
      const requested = new Set(pending.map((v) => v.commandId));
      if (
        response.results.length !== pending.length ||
        new Set(response.results.map((v) => v.commandId)).size !==
          pending.length ||
        response.results.some((v) => !requested.has(v.commandId))
      )
        throw new Error("INVALID_API_RESPONSE");
      await acceptResults(userId, response.results);
      window.dispatchEvent(new Event("hvm:offline-synchronized"));
    }
  })().finally(() => flights.delete(userId));
  flights.set(userId, flight);
  return flight;
}
export function offlineTransport(error: unknown) {
  return (
    !(error as ApiFailure)?.status &&
    ["NETWORK_UNAVAILABLE", "REQUEST_TIMEOUT"].includes(
      (error as Error)?.message,
    )
  );
}
export async function cacheSnapshot(
  userId: string,
  path: string,
  value: unknown,
) {
  const revision = snapshotRevision;
  await transaction<void>(["snapshots"], "readwrite", (tx, finish) => {
    if (revision !== snapshotRevision) {
      finish();
      return;
    }
    const store = tx.objectStore("snapshots");
    store.put({
      key: userId + ":" + path,
      userId,
      savedAt: Date.now(),
      value,
    } satisfies Snapshot);
    const r = store.index("user").getAll(userId);
    r.onsuccess = () => {
      const entries = (r.result as Snapshot[]).sort(
        (a, b) => b.savedAt - a.savedAt,
      );
      for (const row of entries.slice(40)) store.delete(row.key);
      finish();
    };
  });
}
async function cachedSnapshot(userId: string, path: string) {
  return transaction<unknown>(["snapshots"], "readonly", (tx, finish) => {
    const r = tx.objectStore("snapshots").get(userId + ":" + path);
    r.onsuccess = () => {
      const s = r.result as Snapshot | undefined;
      finish(
        s && s.userId === userId && Date.now() - s.savedAt < TTL
          ? s.value
          : null,
      );
    };
  });
}
export async function producerRead<T>(
  userId: string,
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const revision = snapshotRevision;
  if (
    !/^\/v1\/producer\/(?:products(?:\/[^/]+\/lots)?|orders)(?:\?|$)/.test(path)
  )
    throw new Error("OFFLINE_READ_UNSUPPORTED");
  if (navigator.onLine) {
    try {
      const value = schema.parse(await api(path, { signal }));
      if (revision !== snapshotRevision) throw new Error("SESSION_CHANGED");
      if (!signal?.aborted)
        await cacheSnapshot(userId, path, value).catch(() => {});
      return value;
    } catch (e) {
      if (signal?.aborted || !offlineTransport(e)) throw e;
    }
  }
  const value = await cachedSnapshot(userId, path);
  if (revision !== snapshotRevision) throw new Error("SESSION_CHANGED");
  if (value === null) throw new Error("OFFLINE_SNAPSHOT_MISSING");
  return schema.parse(value);
}
export async function saveProducerSession(session: ShellSession | null) {
  const revision = snapshotRevision;
  await transaction<void>(["meta"], "readwrite", (tx, finish) => {
    if (revision !== snapshotRevision) {
      finish();
      return;
    }
    const store = tx.objectStore("meta");
    if (
      session?.activeRole === "producer" &&
      session.roles.includes("producer")
    )
      store.put(
        {
          session: {
            userId: session.userId,
            email: session.email,
            fullName: session.fullName,
            activeRole: "producer",
            roles: ["producer"],
            portalKind: "public",
          },
          savedAt: Date.now(),
        },
        "producerSession",
      );
    else store.delete("producerSession");
    finish();
  });
}
export async function readProducerSession(): Promise<ShellSession | null> {
  return transaction(["meta"], "readonly", (tx, finish) => {
    const r = tx.objectStore("meta").get("producerSession");
    r.onsuccess = () =>
      finish(
        r.result && Date.now() - r.result.savedAt < TTL
          ? r.result.session
          : null,
      );
  });
}
export async function clearProducerSnapshots() {
  snapshotRevision++;
  await transaction<void>(["meta", "snapshots"], "readwrite", (tx, finish) => {
    tx.objectStore("meta").delete("producerSession");
    tx.objectStore("snapshots").clear();
    finish();
  });
}

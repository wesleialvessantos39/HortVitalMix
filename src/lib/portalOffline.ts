import type { ShellSession } from "../hooks/useSession";
import { offlineTransaction, offlineTransport } from "./offlineDb";
import { api, type ApiFailure } from "./api";
import {
  containsOfflineSecret,
  offlineMutationMode,
  offlineReadAllowed,
  offlineScope,
} from "../../shared/offlinePolicy";
import { canonicalSyncJson } from "../../shared/contracts/offlineSync";
import {
  acknowledgeSubmittedDraft,
  captureSubmittedDraft,
  type DraftField,
} from "./offlineDrafts";

const TTL = 7 * 86400000;
export type OfflineIdentity = {
  userId: string;
  role: string;
  scope: string;
  generation: number;
};
export type PortalRequest = {
  key: string;
  scope: string;
  path: string;
  method: string;
  body: string | Blob;
  headers: Record<string, string>;
  createdAt: number;
  sequence: number;
  attempts: number;
  nextAttemptAt: number;
  state: "pending" | "authentication" | "conflict" | "rejected" | "review";
  code?: string;
  currentRevision?: number;
  sourcePath: string;
  draftKey?: string;
  draftFields?: DraftField[];
};
type CachedRead = {
  key: string;
  scope: string;
  path: string;
  value: unknown;
  savedAt: number;
};
let identity: OfflineIdentity | null = null,
  generation = 0,
  writes = 0;
let channel: BroadcastChannel | null = null;
export const currentOfflineIdentity = () => identity;
export function setOfflineIdentity(session: ShellSession | null) {
  const scope =
    session?.activeRole && session.roles.includes(session.activeRole)
      ? offlineScope(session.userId, session.activeRole)
      : null;
  if (scope === identity?.scope) return;
  generation++;
  identity =
    scope && session?.activeRole
      ? { scope, userId: session.userId, role: session.activeRole, generation }
      : null;
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("hvm:offline-identity"));
}
export function assertOfflineIdentity(expected: OfflineIdentity) {
  if (
    identity?.scope !== expected.scope ||
    identity.generation !== expected.generation
  )
    throw Error("SESSION_CHANGED");
}
export const hasPortalOfflineWrites = () => writes > 0 || flights.size > 0;
function changed(broadcast = true, queued = false) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("hvm:offline-changed"));
  window.dispatchEvent(
    new CustomEvent("hvm:offline-work", { detail: { queued } }),
  );
  if (broadcast) {
    try {
      channel?.postMessage({ type: "changed", queued });
    } catch {
      /* Local events remain. */
    }
  }
}
if (typeof window !== "undefined") {
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel("hvm-offline-portals");
      channel.onmessage = (event) =>
        changed(false, event.data?.queued === true);
    } catch {
      /* Storage remains available. */
    }
  }
  for (const name of ["hvm:session-ending", "hvm:session-cleared"])
    window.addEventListener(name, () => setOfflineIdentity(null));
}
export function offlineSavedMessage(error: unknown) {
  const code = (error as Error)?.message;
  return code === "OFFLINE_ACTION_SAVED"
    ? "Ação salva neste aparelho. Será enviada automaticamente quando a conexão voltar."
    : code === "OFFLINE_REVIEW_SAVED"
      ? "Ação salva neste aparelho. Ao conectar, revise e confirme esta operação."
      : code === "OFFLINE_STORAGE_UNAVAILABLE"
        ? "O aparelho não conseguiu salvar esta ação. Mantenha os dados na tela e libere espaço antes de tentar novamente."
        : null;
}
export function queuedError(row: PortalRequest): ApiFailure {
  const error = Object.assign(
    Error(
      row.state === "review" ? "OFFLINE_REVIEW_SAVED" : "OFFLINE_ACTION_SAVED",
    ),
    {
      status: 202,
      userMessage:
        "Ação salva neste aparelho; aguardando confirmação do servidor.",
    },
  );
  window.dispatchEvent(
    new CustomEvent("hvm:offline-saved", { detail: { key: row.key } }),
  );
  return error;
}
export async function portalRequests(scope: string) {
  return offlineTransaction<PortalRequest[]>(
    ["portal_requests"],
    "readonly",
    (tx, finish) => {
      const r = tx.objectStore("portal_requests").index("scope").getAll(scope);
      r.onsuccess = () =>
        finish(
          (r.result as PortalRequest[]).sort((a, b) => a.sequence - b.sequence),
        );
    },
  );
}
export async function resetPortalBackoff(scope: string) {
  const rows = await portalRequests(scope);
  for (const row of rows)
    if (row.state === "pending" && row.nextAttemptAt)
      await updatePortalRequest(row, { nextAttemptAt: 0 });
}
export async function savePortalRequest(
  path: string,
  options: RequestInit,
  expected: OfflineIdentity,
): Promise<PortalRequest | null> {
  assertOfflineIdentity(expected);
  if (options.signal?.aborted) throw Error("REQUEST_ABORTED");
  const method = (options.method ?? "GET").toUpperCase();
  const draft = captureSubmittedDraft(expected);
  const headers = new Headers(options.headers),
    body = options.body;
  if (
    !["POST", "PUT", "PATCH", "DELETE"].includes(method) ||
    !(typeof body === "string" || body instanceof Blob)
  )
    return null;
  if (
    Array.from(new URL(path, location.origin).searchParams.keys()).some((key) =>
      /token|password|secret|otp/i.test(key),
    )
  )
    return null;
  if (typeof body === "string") {
    if (new TextEncoder().encode(body).length > 3 * 1024 * 1024)
      throw Error("OFFLINE_PAYLOAD_TOO_LARGE");
    try {
      if (containsOfflineSecret(JSON.parse(body))) return null;
    } catch {
      return null;
    }
  } else if (body.size > 15 * 1024 * 1024)
    throw Error("OFFLINE_PAYLOAD_TOO_LARGE");
  const mode = offlineMutationMode(path, expected.role);
  // Authentication requests contain one-use secrets, and never enter storage.
  if (
    /^\/v1\/(?:auth|admin\/auth|admin\/invites\/(?:accept|validate)|admin\/bootstrap)(?:\/|$)/.test(
      path,
    ) ||
    /\/sync(?:\?|$)/.test(path)
  )
    return null;
  const safeHeaders: Record<string, string> = {};
  for (const name of ["Content-Type", "X-Command-Id"]) {
    const value = headers.get(name);
    if (value) safeHeaders[name] = value;
  }
  const signature = canonicalSyncJson({
    path,
    method,
    headers: safeHeaders,
    body:
      typeof body === "string"
        ? JSON.parse(body)
        : {
            type: body.type,
            size: body.size,
            hash: Array.from(
              new Uint8Array(
                await crypto.subtle.digest("SHA-256", await body.arrayBuffer()),
              ),
              (v) => v.toString(16).padStart(2, "0"),
            ).join(""),
          },
  });
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(signature),
      ),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  writes++;
  try {
    const row = await offlineTransaction<PortalRequest>(
      ["portal_requests", "meta"],
      "readwrite",
      (tx, finish) => {
        assertOfflineIdentity(expected);
        const store = tx.objectStore("portal_requests"),
          r = store.index("scope").getAll(expected.scope);
        r.onsuccess = () => {
          const entries = r.result as (PortalRequest & { digest?: string })[];
          const prior = entries.find(
            (v) =>
              v.digest === digest &&
              !["conflict", "rejected"].includes(v.state),
          );
          if (prior) {
            finish(prior);
            return;
          }
          const bytes = entries.reduce(
            (sum, v) =>
              sum +
              (typeof v.body === "string" ? v.body.length * 2 : v.body.size),
            0,
          );
          if (
            entries.length >= 500 ||
            bytes + (typeof body === "string" ? body.length * 2 : body.size) >
              64 * 1024 * 1024
          ) {
            tx.abort();
            return;
          }
          const meta = tx.objectStore("meta"),
            seq = meta.get("portalSequence");
          seq.onsuccess = () => {
            const sequence = Number(seq.result ?? 0) + 1;
            meta.put(sequence, "portalSequence");
            const row = {
              key: crypto.randomUUID(),
              scope: expected.scope,
              path,
              method,
              body,
              headers: safeHeaders,
              createdAt: Date.now(),
              sequence,
              attempts: 0,
              nextAttemptAt: 0,
              state: mode === "online" ? "review" : "pending",
              digest,
              sourcePath: location.pathname + location.search,
              ...draft,
            } satisfies PortalRequest & { digest: string };
            store.add(row);
            finish(row);
          };
        };
      },
    );
    changed(true, true);
    return row;
  } finally {
    writes--;
  }
}
export async function updatePortalRequest(
  row: PortalRequest,
  patch: Partial<PortalRequest> | "confirmed" | "dismissed",
) {
  await offlineTransaction<void>(
    ["portal_requests"],
    "readwrite",
    (tx, finish) => {
      const store = tx.objectStore("portal_requests"),
        r = store.get(row.key);
      r.onsuccess = () => {
        if (r.result?.scope === row.scope) {
          if (patch === "confirmed" || patch === "dismissed")
            store.delete(row.key);
          else store.put({ ...r.result, ...patch });
        }
        finish();
      };
    },
  );
  if (patch === "confirmed")
    await acknowledgeSubmittedDraft(row).catch(() =>
      window.dispatchEvent(new Event("hvm:offline-storage-error")),
    );
  changed();
}
export async function dismissPortalRequest(row: PortalRequest) {
  if (row.state === "pending") throw Error("OFFLINE_PENDING_PROTECTED");
  await updatePortalRequest(row, "dismissed");
}
export async function cachePortalRead(
  path: string,
  value: unknown,
  expected: OfflineIdentity | null,
) {
  const scope = expected?.scope ?? "guest";
  if (!offlineReadAllowed(path, expected?.role)) return;
  if (expected) assertOfflineIdentity(expected);
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length > 512000 || containsOfflineSecret(value))
    return;
  await offlineTransaction<void>(
    ["portal_cache"],
    "readwrite",
    (tx, finish) => {
      if (expected) assertOfflineIdentity(expected);
      const store = tx.objectStore("portal_cache");
      store.put({
        key: `${scope}:${path}`,
        scope,
        path,
        value,
        savedAt: Date.now(),
      } satisfies CachedRead);
      const r = store.index("scope").getAll(scope);
      r.onsuccess = () => {
        const rows = (r.result as CachedRead[]).sort(
          (a, b) => b.savedAt - a.savedAt,
        );
        let bytes = 0;
        rows.forEach((row, index) => {
          bytes += JSON.stringify(row.value).length * 2;
          if (
            index >= 250 ||
            bytes > 12 * 1024 * 1024 ||
            Date.now() - row.savedAt > TTL
          )
            store.delete(row.key);
        });
        finish();
      };
    },
  );
}
export async function readPortalCache<T>(
  path: string,
  expected: OfflineIdentity | null,
): Promise<T> {
  if (!offlineReadAllowed(path, expected?.role))
    throw Error("OFFLINE_READ_UNSUPPORTED");
  const scope = expected?.scope ?? "guest";
  const row = await offlineTransaction<CachedRead | undefined>(
    ["portal_cache"],
    "readonly",
    (tx, finish) => {
      const r = tx.objectStore("portal_cache").get(`${scope}:${path}`);
      r.onsuccess = () => finish(r.result);
    },
  );
  if (expected) assertOfflineIdentity(expected);
  else if (identity) throw Error("SESSION_CHANGED");
  if (!row || row.scope !== scope || Date.now() - row.savedAt > TTL)
    throw Error("OFFLINE_SNAPSHOT_MISSING");
  return row.value as T;
}
export async function invalidatePortalCache(
  path: string,
  expected: OfflineIdentity | null,
) {
  await offlineTransaction<void>(
    ["portal_cache"],
    "readwrite",
    (tx, finish) => {
      tx.objectStore("portal_cache").delete(
        `${expected?.scope ?? "guest"}:${path}`,
      );
      finish();
    },
  );
}
const flights = new Map<string, Promise<void>>();
export function synchronizePortalRequests(
  expected: OfflineIdentity,
  signal?: AbortSignal,
) {
  const previous = flights.get(expected.scope);
  if (previous) return previous;
  const run = async () => {
    if (!navigator.onLine) throw Error("OFFLINE");
    let transient = false;
    for (const row of await portalRequests(expected.scope)) {
      assertOfflineIdentity(expected);
      if (signal?.aborted || !navigator.onLine)
        throw Error("OFFLINE_SYNC_STOPPED");
      if (
        !["pending", "authentication"].includes(row.state) ||
        offlineMutationMode(row.path, expected.role) === "online"
      )
        continue;
      if (row.nextAttemptAt > Date.now()) break;
      try {
        const result = await api(row.path, {
          method: row.method,
          body: row.body,
          headers: {
            ...row.headers,
            "X-HVM-Offline-Scope": expected.scope,
            "X-HVM-Offline-Id": row.key,
          },
          signal,
          offlineBypass: true,
        });
        assertOfflineIdentity(expected);
        await updatePortalRequest(row, "confirmed");
        window.dispatchEvent(
          new CustomEvent("hvm:offline-confirmed", {
            detail: {
              scope: expected.scope,
              path: row.path,
              sourcePath: row.sourcePath,
              result,
            },
          }),
        );
      } catch (error) {
        if (signal?.aborted || identity?.scope !== expected.scope) throw error;
        const failure = error as ApiFailure;
        if (
          ["OFFLINE_SCOPE_CHANGED", "SESSION_CHANGED"].includes(failure.message)
        )
          throw Error("SESSION_CHANGED");
        if (
          offlineTransport(error) ||
          !failure.status ||
          failure.status >= 500 ||
          failure.status === 429
        ) {
          const attempts = row.attempts + 1;
          await updatePortalRequest(row, {
            attempts,
            nextAttemptAt:
              Date.now() +
              Math.max(
                (failure.retryAfterSeconds ?? 0) * 1000,
                Math.min(60000, 1000 * 2 ** Math.min(attempts - 1, 6)),
              ),
          });
          transient = true;
          break;
        }
        if (failure.status === 401) {
          await updatePortalRequest(row, {
            state: "authentication",
            code: failure.message,
          });
          break;
        }
        await updatePortalRequest(row, {
          state: failure.status === 409 ? "conflict" : "rejected",
          code: failure.message,
          currentRevision: failure.currentRevision,
        });
      }
    }
    if (transient) throw Error("NETWORK_UNAVAILABLE");
  };
  const task = (
    navigator.locks
      ? navigator.locks.request(
          `hvm-offline-${expected.scope}`,
          { signal },
          run,
        )
      : run()
  ).finally(() => {
    flights.delete(expected.scope);
  });
  flights.set(expected.scope, task);
  return task;
}
export async function refreshPortalCache(
  expected: OfflineIdentity,
  signal?: AbortSignal,
) {
  const rows = await offlineTransaction<CachedRead[]>(
    ["portal_cache"],
    "readonly",
    (tx, finish) => {
      const r = tx
        .objectStore("portal_cache")
        .index("scope")
        .getAll(expected.scope);
      r.onsuccess = () => finish(r.result);
    },
  );
  const paths = rows
    .filter(
      (row) =>
        Date.now() - row.savedAt < TTL &&
        offlineReadAllowed(row.path, expected.role),
    )
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, 100)
    .map((row) => row.path);
  let cursor = 0,
    failed = false,
    updated = false;
  await Promise.all(
    Array.from({ length: Math.min(4, paths.length) }, async () => {
      while (cursor < paths.length) {
        assertOfflineIdentity(expected);
        if (signal?.aborted) return;
        const path = paths[cursor++];
        try {
          const value = await api(path, { signal, offlineBypass: true });
          if (
            canonicalSyncJson(value) !==
            canonicalSyncJson(rows.find((row) => row.path === path)?.value)
          )
            updated = true;
          await cachePortalRead(path, value, expected);
        } catch (error) {
          if ([401, 403, 404].includes((error as ApiFailure).status ?? 0))
            await offlineTransaction<void>(
              ["portal_cache"],
              "readwrite",
              (tx, finish) => {
                tx.objectStore("portal_cache").delete(
                  `${expected.scope}:${path}`,
                );
                finish();
              },
            );
          else failed = true;
        }
      }
    }),
  );
  assertOfflineIdentity(expected);
  if (failed) throw Error("NETWORK_UNAVAILABLE");
  if (updated) window.dispatchEvent(new Event("hvm:data-synchronized"));
}

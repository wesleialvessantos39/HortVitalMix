import { api, type ApiFailure } from "./api";
import { offlineTransaction, offlineTransport } from "./offlineDb";
import {
  assertOfflineIdentity,
  currentOfflineIdentity,
  offlineSavedMessage,
  type OfflineIdentity,
} from "./portalOffline";

export type OfflineDocument = {
  key: string;
  scope: string;
  base: string;
  payload: Record<string, unknown>;
  file: Blob;
  fileName: string;
  confirmId: string;
  createdAt: number;
  state: "pending" | "authentication" | "rejected";
  code?: string;
  sourcePath: string;
};
const changed = (queued: boolean) => {
  window.dispatchEvent(new Event("hvm:offline-changed"));
  window.dispatchEvent(
    new CustomEvent("hvm:offline-work", { detail: { queued } }),
  );
};
export async function documentUploads(scope: string) {
  return offlineTransaction<OfflineDocument[]>(
    ["portal_uploads"],
    "readonly",
    (tx, finish) => {
      const r = tx.objectStore("portal_uploads").index("scope").getAll(scope);
      r.onsuccess = () =>
        finish(
          (r.result as OfflineDocument[]).sort(
            (a, b) => a.createdAt - b.createdAt,
          ),
        );
    },
  );
}
async function write(row: OfflineDocument, remove = false, queued = false) {
  await offlineTransaction<void>(
    ["portal_uploads"],
    "readwrite",
    (tx, finish) => {
      const store = tx.objectStore("portal_uploads");
      if (remove) store.delete(row.key);
      else store.put(row);
      finish();
    },
  );
  changed(queued);
}
async function perform(
  row: OfflineDocument,
  owner: OfflineIdentity,
  signal?: AbortSignal,
) {
  assertOfflineIdentity(owner);
  const signed = await api<{
    documentId: string;
    signedUrl: string | null;
    status: string;
  }>(`${row.base}/upload-url`, {
    method: "POST",
    body: JSON.stringify(row.payload),
    signal,
    offlineBypass: true,
  });
  assertOfflineIdentity(owner);
  if (signed.signedUrl) {
    const form = new FormData();
    form.append("cacheControl", "0");
    form.append("", row.file, row.fileName);
    let response: Response;
    try {
      response = await fetch(signed.signedUrl, {
        method: "PUT",
        body: form,
        credentials: "omit",
        signal: signal ?? AbortSignal.timeout(60000),
      });
    } catch {
      throw Error("NETWORK_UNAVAILABLE");
    }
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      if (
        !["Duplicate", "409"].includes(String(failure.error)) &&
        String(failure.statusCode) !== "409"
      )
        throw Error("UPLOAD_FAILED");
    }
  }
  assertOfflineIdentity(owner);
  const confirmed = await api<{ status: string }>(
    `${row.base}/${signed.documentId}/confirm`,
    {
      method: "POST",
      body: JSON.stringify({ commandId: row.confirmId }),
      signal,
      offlineBypass: true,
    },
  );
  assertOfflineIdentity(owner);
  await write(row, true);
  window.dispatchEvent(new Event("hvm:documents-synchronized"));
  return { ...confirmed, documentId: signed.documentId };
}
export async function uploadDocumentDurably(
  base: string,
  payload: Record<string, unknown>,
  file: File,
) {
  const owner = currentOfflineIdentity();
  if (!owner) throw Error("AUTH_REQUIRED");
  if (
    !/^\/v1\/(?:producer|admin)\/documents$/.test(base) ||
    file.size < 1024 ||
    file.size > 15728640 ||
    !["application/pdf", "image/jpeg", "image/png"].includes(file.type)
  )
    throw Error("DOCUMENT_INVALID");
  const existing = await documentUploads(owner.scope);
  let row = existing.find((v) => v.payload.commandId === payload.commandId);
  if (!row) {
    if (
      existing.length >= 30 ||
      existing.reduce((sum, v) => sum + v.file.size, file.size) >
        64 * 1024 * 1024
    )
      throw Error("OFFLINE_STORAGE_UNAVAILABLE");
    row = {
      key: crypto.randomUUID(),
      scope: owner.scope,
      base,
      payload,
      file,
      fileName: file.name,
      confirmId: crypto.randomUUID(),
      createdAt: Date.now(),
      state: "pending",
      sourcePath: location.pathname + location.search,
    };
    await write(row, false, true);
  }
  if (!navigator.onLine)
    throw Object.assign(Error("OFFLINE_ACTION_SAVED"), { status: 202 });
  try {
    return await perform(row, owner);
  } catch (error) {
    if (
      offlineTransport(error) ||
      !(error as ApiFailure).status ||
      (error as ApiFailure).status! >= 500
    )
      throw Object.assign(Error("OFFLINE_ACTION_SAVED"), { status: 202 });
    await write({
      ...row,
      state:
        (error as ApiFailure).status === 401 ? "authentication" : "rejected",
      code: (error as Error).message,
    });
    throw error;
  }
}
export async function synchronizeDocumentUploads(
  owner: OfflineIdentity,
  signal?: AbortSignal,
) {
  for (const row of await documentUploads(owner.scope)) {
    if (row.state === "rejected") continue;
    if (signal?.aborted || !navigator.onLine)
      throw Error("OFFLINE_SYNC_STOPPED");
    try {
      await perform(row, owner, signal);
    } catch (error) {
      if (
        signal?.aborted ||
        offlineSavedMessage(error) ||
        !(error as ApiFailure).status ||
        (error as ApiFailure).status! >= 500
      )
        throw error;
      await write({
        ...row,
        state:
          (error as ApiFailure).status === 401 ? "authentication" : "rejected",
        code: (error as Error).message,
      });
      if ((error as ApiFailure).status === 401) break;
    }
  }
}

import { it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  sign: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../server/db/pool.ts", () => ({
  dbPool: { query: mocks.query, connect: mocks.connect },
}));
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        createSignedUrl: mocks.sign,
        download: mocks.download,
        remove: mocks.remove,
      }),
    },
  },
}));
import {
  DocumentStorageService,
  getDocument,
  processPropertyDocumentStorageCleanup,
} from "../../server/services/DocumentStorageService";
import { GeminiDocumentProcessor } from "../../server/services/GeminiDocumentProcessor";
const a = {
  userId: "owner",
  role: "producer",
  auditor: false,
  requestId: "request",
  ipHash: "a".repeat(64),
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({
    query: mocks.query,
    release: mocks.release,
  });
});
it("ownership predicate uses authenticated actor, never input owner", async () => {
  mocks.query.mockResolvedValue({ rows: [] });
  await expect(getDocument(a, "doc")).rejects.toThrow("DOCUMENT_NOT_FOUND");
  expect(mocks.query.mock.calls[0][1]).toEqual(["doc", false, "owner"]);
});
it.each(["quarantine", "rejected", "archived"])(
  "does not sign %s",
  async (status) => {
    mocks.query.mockImplementation(async (sql) => ({
      rows: sql.includes("SELECT d.*") ? [{ status }] : [],
    }));
    await expect(DocumentStorageService.download(a, "doc")).rejects.toThrow(
      "DOCUMENT_NOT_AVAILABLE",
    );
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
  },
);
it("producer list hides archived documents and auditor still sees them", async () => {
  mocks.query.mockImplementation(async (sql) => ({
    rows: sql.includes("SELECT p.id") ? [{ id: "prop" }] : [],
  }));
  await DocumentStorageService.list(a, "prop");
  expect(
    mocks.query.mock.calls.find(([sql]) => String(sql).includes("status<>'archived'"))?.[1],
  ).toEqual(["prop", false]);
  mocks.query.mockClear();
  mocks.query.mockImplementation(async (sql) => ({
    rows: sql.includes("SELECT p.id") ? [{ id: "prop" }] : [],
  }));
  await DocumentStorageService.list({ ...a, auditor: true }, "prop");
  expect(
    mocks.query.mock.calls.find(([sql]) => String(sql).includes("status<>'archived'"))?.[1],
  ).toEqual(["prop", true]);
});
it("retries queued private-file deletion through a grace period", async () => {
  let firstRemovedAt: Date | null = null;
  mocks.query.mockImplementation(async (sql) => {
    if (sql.includes("SELECT storage_path"))
      return { rows: [{ storage_path: "properties/property/document.pdf", first_removed_at: firstRemovedAt }] };
    if (sql.startsWith("UPDATE public.app_property_document_storage_cleanup") && firstRemovedAt === null)
      firstRemovedAt = new Date();
    return { rows: [] };
  });
  mocks.remove.mockResolvedValue({ error: null });
  await processPropertyDocumentStorageCleanup();
  expect(mocks.remove).toHaveBeenCalledWith(["properties/property/document.pdf"]);
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      String(sql).startsWith("UPDATE public.app_property_document_storage_cleanup"),
    ),
  ).toBe(true);
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      String(sql).startsWith("DELETE FROM public.app_property_document_storage_cleanup"),
    ),
  ).toBe(true);

  firstRemovedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
  mocks.query.mockClear();
  await processPropertyDocumentStorageCleanup();
  expect(mocks.remove).toHaveBeenCalledTimes(2);
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      String(sql).startsWith("DELETE FROM public.app_property_document_storage_cleanup"),
    ),
  ).toBe(true);
});
it("retains failed private-file cleanup jobs for a later retry", async () => {
  mocks.query.mockImplementation(async (sql) => ({
    rows: sql.includes("SELECT storage_path")
      ? [{ storage_path: "properties/property/document.pdf" }]
      : [],
  }));
  mocks.remove.mockResolvedValue({ error: new Error("storage unavailable") });
  await processPropertyDocumentStorageCleanup();
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      String(sql).startsWith("UPDATE public.app_property_document_storage_cleanup"),
    ),
  ).toBe(true);
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      String(sql).startsWith("DELETE FROM public.app_property_document_storage_cleanup"),
    ),
  ).toBe(false);
});
it("clean file is returned inline and audited", async () => {
  const bytes = Buffer.from("%PDF-1.7");
  mocks.query.mockImplementation(async (sql) => ({
    rows: sql.includes("SELECT d.*")
      ? [
          {
            status: "clean",
            storage_path: "properties/p/d.pdf",
            mime_type: "application/pdf",
            file_name: "car.pdf",
          },
        ]
      : [],
  }));
  mocks.download.mockResolvedValue({
    data: { size: bytes.length, arrayBuffer: async () => bytes },
    error: null,
  });
  const file = await DocumentStorageService.file(a, "doc");
  expect(file.mimeType).toBe("application/pdf");
  expect(Buffer.from(file.bytes).equals(bytes)).toBe(true);
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      String(sql).includes("document.previewed"),
    ),
  ).toBe(true);
  expect(mocks.sign).not.toHaveBeenCalled();
});
it("clean download audited with fixed 900 second TTL", async () => {
  mocks.query.mockImplementation(async (sql) => ({
    rows: sql.includes("SELECT d.*")
      ? [
          {
            status: "clean",
            storage_path: "private/path",
            mime_type: "application/pdf",
          },
        ]
      : [],
  }));
  mocks.sign.mockResolvedValue({
    data: { signedUrl: "https://signed" },
    error: null,
  });
  expect(
    (await DocumentStorageService.download(a, "doc")).expiresInSeconds,
  ).toBe(900);
  expect(mocks.sign).toHaveBeenCalledWith("private/path", 900);
  expect(
    mocks.query.mock.calls.some(([sql]) => sql.includes("app_audit_events")),
  ).toBe(true);
});
it("quarantine cannot reach Gemini", async () => {
  mocks.query.mockResolvedValue({ rows: [{ status: "quarantine" }] });
  await expect(
    GeminiDocumentProcessor.process(a, "doc", "command"),
  ).rejects.toThrow("DOCUMENT_NOT_AVAILABLE");
  expect(mocks.download).not.toHaveBeenCalled();
});
it("existing extraction is reused without external call", async () => {
  mocks.query.mockImplementation(async (sql) => ({
    rows: sql.includes("SELECT d.*")
      ? [{ status: "clean", document_type: "car_sicar" }]
      : [{ id: "existing" }],
  }));
  expect(await GeminiDocumentProcessor.process(a, "doc", "command")).toEqual({
    extraction: { id: "existing" },
  });
  expect(mocks.download).not.toHaveBeenCalled();
});
it("archive repeated is idempotent and never deletes storage", async () => {
  mocks.query.mockImplementation(async (sql) => ({
    rows: sql.includes("SELECT d.*") ? [{ status: "archived" }] : [],
  }));
  expect(await DocumentStorageService.archive(a, "doc", "command")).toEqual({
    status: "archived",
  });
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE "))).toBe(
    false,
  );
});

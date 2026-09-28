import { it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  sign: vi.fn(),
  download: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../server/db/pool.ts", () => ({
  dbPool: { query: mocks.query, connect: mocks.connect },
}));
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({ createSignedUrl: mocks.sign, download: mocks.download }),
    },
  },
}));
import {
  DocumentStorageService,
  getDocument,
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

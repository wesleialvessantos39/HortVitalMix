import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  stableMediaUrl,
  invalidateMediaUrl,
} from "../../src/lib/mediaCache.ts";
const origin =
  "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/";
const url = (path: string, nonce: string, exp = Date.now() / 1000 + 900) =>
  origin +
  path +
  "?token=header." +
  Buffer.from(JSON.stringify({ exp, nonce })).toString("base64url") +
  ".signature";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());
describe("Fotos: reaproveitamento seguro de URLs", () => {
  it("uma foto mantém URL entre vitrine, produto e cesta mesmo com outra assinatura", () => {
    const first = url("product-media/reuse.webp", "a"),
      second = url("product-media/reuse.webp", "b");
    expect(stableMediaUrl(first)).toBe(first);
    expect(stableMediaUrl(second)).toBe(first);
    invalidateMediaUrl(first);
  });
  it("renova antes da expiração e permite recuperar uma imagem que falhou", () => {
    const first = url("product-media/renew.webp", "a", Date.now() / 1000 + 90);
    stableMediaUrl(first);
    vi.advanceTimersByTime(31000);
    const next = url("product-media/renew.webp", "b");
    expect(stableMediaUrl(next)).toBe(next);
    invalidateMediaUrl(next);
    const retry = url("product-media/renew.webp", "c");
    expect(stableMediaUrl(retry)).toBe(retry);
    invalidateMediaUrl(retry);
  });
  it("não mistura buckets e não guarda documentos, tokens opacos ou expirados", () => {
    const a = url("product-media/separate.webp", "a"),
      b = url("store-media/separate.webp", "b");
    expect(stableMediaUrl(a)).toBe(a);
    expect(stableMediaUrl(b)).toBe(b);
    const document = url("rural-documents/private.pdf", "a");
    expect(stableMediaUrl(document)).toBe(document);
    const invalid = origin + "product-media/invalid.webp?token=opaque";
    expect(stableMediaUrl(invalid)).toBe(invalid);
    const expired = url("product-media/expired.webp", "a", 0),
      fresh = url("product-media/expired.webp", "b");
    expect(stableMediaUrl(expired)).toBe(expired);
    expect(stableMediaUrl(fresh)).toBe(fresh);
    [a, b, fresh].forEach(invalidateMediaUrl);
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
const storage = new Map<string, string>();
const photo = (nonce: string) =>
  `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/product-media/persist.webp?token=header.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 900, nonce })).toString("base64url")}.sig`;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  storage.clear();
});
describe("Fotos em recarga da página", () => {
  it("reutiliza assinatura válida e remove o cache ao sair", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.resetModules();
    let cache = await import("../../src/lib/mediaCache.ts");
    const first = photo("first");
    expect(cache.stableMediaUrl(first)).toBe(first);
    await Promise.resolve();
    vi.resetModules();
    cache = await import("../../src/lib/mediaCache.ts");
    expect(cache.stableMediaUrl(photo("new-server-signature"))).toBe(first);
    cache.clearMediaUrlCache();
    expect(cache.stableMediaUrl(photo("after-logout"))).not.toBe(first);
  });
  it("ignora assinaturas inválidas ou entradas alteradas no armazenamento", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () =>
        JSON.stringify([
          [
            "https://example.test/x",
            { url: "https://example.test/x", until: Date.now() + 999999999 },
          ],
        ]),
      setItem: () => {},
      removeItem: () => {},
    });
    vi.resetModules();
    const cache = await import("../../src/lib/mediaCache.ts");
    expect(cache.stableMediaUrl("https://example.test/x")).toBe(
      "https://example.test/x",
    );
  });
});

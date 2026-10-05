import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ sign: vi.fn(), calls: 0 }));
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: (paths: string[], ttl: number) =>
          storage.sign(bucket, paths, ttl),
      }),
    },
  },
}));
beforeEach(() => {
  vi.resetModules();
  storage.calls = 0;
  storage.sign.mockReset();
  storage.sign.mockImplementation(async (bucket: string, paths: string[]) => ({
    error: null,
    data: paths.map((path) => ({
      signedUrl: `https://example.test/${bucket}/${path}?token=${++storage.calls}`,
      error: null,
    })),
  }));
});
afterEach(() => vi.useRealTimers());
describe("Assinaturas de fotos privadas", () => {
  it("agrupa fotos únicas e compartilha chamadas simultâneas e posteriores", async () => {
    const { signedMediaUrls } =
      await import("../../server/storage/signedMedia.ts");
    const [a, b] = await Promise.all([
      signedMediaUrls("product-media", ["a", "b", "a"]),
      signedMediaUrls("product-media", ["b"]),
    ]);
    expect(storage.sign).toHaveBeenCalledTimes(1);
    expect(storage.sign).toHaveBeenCalledWith("product-media", ["a", "b"], 900);
    expect(a.get("b")).toBe(b.get("b"));
    expect((await signedMediaUrls("product-media", ["a"])).get("a")).toBe(
      a.get("a"),
    );
    expect(storage.sign).toHaveBeenCalledTimes(1);
  });
  it("renova antes de expirar e mantém buckets separados", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    const { signedMediaUrls } =
      await import("../../server/storage/signedMedia.ts");
    const old = await signedMediaUrls("store-media", ["a"]);
    await signedMediaUrls("product-media", ["a"]);
    expect(storage.sign).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date("2026-10-05T00:10:01Z"));
    expect((await signedMediaUrls("store-media", ["a"])).get("a")).not.toBe(
      old.get("a"),
    );
    expect(storage.sign).toHaveBeenCalledTimes(3);
  });
  it("falhas não entram no cache e uma nova tentativa recupera", async () => {
    const { signedMediaUrls } =
      await import("../../server/storage/signedMedia.ts");
    storage.sign.mockResolvedValueOnce({
      error: { message: "offline" },
      data: null,
    });
    await expect(signedMediaUrls("store-media", ["a"])).rejects.toThrow(
      "MEDIA_UNAVAILABLE",
    );
    expect((await signedMediaUrls("store-media", ["a"])).get("a")).toContain(
      "token=",
    );
    expect(storage.sign).toHaveBeenCalledTimes(2);
  });
});

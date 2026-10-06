import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class TestImage {
  static instances: TestImage[] = [];
  src = "";
  decoding = "";
  fetchPriority = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decode = vi.fn().mockResolvedValue(undefined);
  constructor() {
    TestImage.instances.push(this);
  }
}
const photo = (path: string, nonce = "a", exp = Date.now() / 1000 + 900) =>
  `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/${path}?token=header.${Buffer.from(JSON.stringify({ exp, nonce })).toString("base64url")}.signature`;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  TestImage.instances = [];
  vi.stubGlobal("Image", TestImage);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Fotos preparadas em paralelo", () => {
  it("inicia fotos diferentes juntas e espera todas serem decodificadas", async () => {
    const { prepareMediaUrls } = await import("../../src/lib/prepareMedia.ts");
    let complete = false;
    const task = prepareMediaUrls([
      photo("product-media/one.webp"),
      photo("store-media/two.webp"),
    ]).then(() => {
      complete = true;
    });
    expect(TestImage.instances).toHaveLength(2);
    TestImage.instances[0].onload!();
    await Promise.resolve();
    expect(complete).toBe(false);
    TestImage.instances[1].onload!();
    await task;
    expect(complete).toBe(true);
    expect(
      TestImage.instances.every(
        (image) => image.decode.mock.calls.length === 1,
      ),
    ).toBe(true);
  });
  it("deduplica foto, assinatura e preparo simultâneo entre destaque e loja", async () => {
    const { prepareMediaUrls } = await import("../../src/lib/prepareMedia.ts");
    const first = photo("store-media/shared.webp");
    const one = prepareMediaUrls([first, first, null], { priority: "low" });
    const two = prepareMediaUrls([photo("store-media/shared.webp", "b")]);
    expect(TestImage.instances).toHaveLength(1);
    expect(TestImage.instances[0].fetchPriority).toBe("high");
    TestImage.instances[0].onload!();
    await Promise.all([one, two]);
    await prepareMediaUrls([first]);
    expect(TestImage.instances).toHaveLength(1);
  });
  it("uma falha libera a seção e permite nova tentativa com assinatura atual", async () => {
    const { prepareMediaUrls } = await import("../../src/lib/prepareMedia.ts");
    const first = prepareMediaUrls([photo("product-media/retry.webp")]);
    TestImage.instances[0].onerror!();
    await first;
    const current = photo("product-media/retry.webp", "fresh");
    const retry = prepareMediaUrls([current]);
    expect(TestImage.instances).toHaveLength(2);
    expect(TestImage.instances[1].src).toBe(current);
    TestImage.instances[1].onload!();
    await retry;
  });
  it("foto que não responde libera a página após oito segundos", async () => {
    const { prepareMediaUrls } = await import("../../src/lib/prepareMedia.ts");
    let complete = false;
    const task = prepareMediaUrls([photo("product-media/stalled.webp")]).then(
      () => {
        complete = true;
      },
    );
    await vi.advanceTimersByTimeAsync(7999);
    expect(complete).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await task;
    expect(complete).toBe(true);
    expect(TestImage.instances[0].onload).toBeNull();
  });
  it("cancelar uma página não cancela a foto compartilhada de outra", async () => {
    const { prepareMediaUrls } = await import("../../src/lib/prepareMedia.ts");
    const controller = new AbortController();
    const value = photo("product-media/shared-abort.webp");
    const first = prepareMediaUrls([value], { signal: controller.signal });
    let secondComplete = false;
    const second = prepareMediaUrls([value]).then(() => {
      secondComplete = true;
    });
    controller.abort();
    await first;
    expect(secondComplete).toBe(false);
    expect(TestImage.instances).toHaveLength(1);
    TestImage.instances[0].onload!();
    await second;
    expect(secondComplete).toBe(true);
  });
  it("não conserva uma assinatura além da margem de expiração", async () => {
    const { prepareMediaUrls } = await import("../../src/lib/prepareMedia.ts");
    const first = prepareMediaUrls([
      photo("product-media/renew.webp", "a", Date.now() / 1000 + 61),
    ]);
    TestImage.instances[0].onload!();
    await first;
    await vi.advanceTimersByTimeAsync(1001);
    const fresh = photo("product-media/renew.webp", "b");
    const next = prepareMediaUrls([fresh]);
    expect(TestImage.instances).toHaveLength(2);
    expect(TestImage.instances[1].src).toBe(fresh);
    TestImage.instances[1].onload!();
    await next;
  });
  it("não inicia downloads de uma página já cancelada", async () => {
    const { prepareMediaUrls } = await import("../../src/lib/prepareMedia.ts");
    await prepareMediaUrls([photo("store-media/ignored.webp")], {
      signal: AbortSignal.abort(),
    });
    expect(TestImage.instances).toHaveLength(0);
  });
  it("não persiste URLs de documentos privados ou assinaturas opacas", async () => {
    const { mediaUrlCacheUntil } = await import("../../src/lib/mediaCache.ts");
    expect(mediaUrlCacheUntil(photo("documents_private/private.pdf"))).toBe(0);
    expect(
      mediaUrlCacheUntil(
        "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/product-media/one.webp?token=opaque",
      ),
    ).toBe(0);
  });
});

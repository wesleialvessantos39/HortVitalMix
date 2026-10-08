import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const state = vi.hoisted(() => ({
  visible: true,
  query: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: {
    storage: { from: () => ({ download: state.download }) },
  },
}));
vi.mock("../../server/services/CommerceSupport.ts", async (load) => {
  const actual =
    await load<typeof import("../../server/services/CommerceSupport.ts")>();
  return {
    CommerceError: actual.CommerceError,
    commerceTransaction: (callback: (client: unknown) => unknown) =>
      callback({ query: state.query }),
  };
});

const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.resetModules();
  state.visible = true;
  state.query.mockReset();
  state.download.mockReset();
  state.query.mockImplementation(async () => ({
    rows: state.visible
      ? [
          {
            media_url: `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/product-media/${id}/${id}/${id}-${"a".repeat(64)}.png`,
          },
        ]
      : [],
  }));
});

describe("Preparação de variantes públicas", () => {
  it("compartilha original entre larguras e verifica publicação mesmo em cache", async () => {
    const original = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "green" },
    })
      .png()
      .toBuffer();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.download.mockImplementation(async () => {
      await wait;
      return { data: new Blob([new Uint8Array(original)]), error: null };
    });
    const { PublicMediaService } =
      await import("../../server/services/PublicMediaService.ts");
    const small = PublicMediaService.image("product", id, 320);
    const medium = PublicMediaService.image("product", id, 640);
    await vi.waitFor(() => expect(state.download).toHaveBeenCalledTimes(1));
    release();
    const [a, b] = await Promise.all([small, medium]);
    expect((await sharp(a.bytes).metadata()).width).toBe(320);
    expect((await sharp(b.bytes).metadata()).width).toBe(640);
    expect(state.download).toHaveBeenCalledTimes(1);
    await expect(
      PublicMediaService.image("product", id, 320),
    ).resolves.toMatchObject({ etag: a.etag });
    expect(state.download).toHaveBeenCalledTimes(1);
    state.visible = false;
    await expect(
      PublicMediaService.image("product", id, 320),
    ).rejects.toMatchObject({ status: 404 });
    expect(state.query).toHaveBeenCalledTimes(4);
    expect(state.download).toHaveBeenCalledTimes(1);
  });

  it("falha do original libera o pedido e permite tentar novamente", async () => {
    state.download.mockResolvedValueOnce({
      data: null,
      error: { message: "offline" },
    });
    const { PublicMediaService } =
      await import("../../server/services/PublicMediaService.ts");
    await expect(
      PublicMediaService.image("product", id, 320),
    ).rejects.toMatchObject({ status: 404 });
    const original = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "green" },
    })
      .png()
      .toBuffer();
    state.download.mockResolvedValue({
      data: new Blob([new Uint8Array(original)]),
      error: null,
    });
    await expect(
      PublicMediaService.image("product", id, 320),
    ).resolves.toHaveProperty("bytes");
    expect(state.download).toHaveBeenCalledTimes(2);
  });
});

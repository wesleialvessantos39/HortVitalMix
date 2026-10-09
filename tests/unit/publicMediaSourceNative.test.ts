import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ native: true }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mocks.native, getPlatform: () => mocks.native ? "ios" : "web" },
  CapacitorHttp: { request: vi.fn() },
}));
import { publicMediaSource } from "../../src/lib/publicMediaSource";
import { mediaPreview } from "../../src/lib/mediaPreview";

const id = "11111111-1111-4111-8111-111111111111";
const origin = "https://hortvitalmix.vercel.app";
const signed = "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/product-media/" + id + "/" + id + "-" + "a".repeat(64) + ".jpg?token=opaque";
beforeEach(() => { mocks.native = true; vi.stubEnv("VITE_HVM_NATIVE_BACKEND_ORIGIN", ""); });
afterEach(() => vi.unstubAllEnvs());

describe("native public photo source boundaries", () => {
  it.each(["product", "store"])("maps relative %s images to the compiled API, not Capacitor localhost", (kind) => {
    expect(publicMediaSource(`/api/v1/public-media/${kind}/${id}?width=320`)).toBe(`${origin}/api/v1/public-media/${kind}/${id}?width=320`);
    expect(publicMediaSource(`/_hvm_api/v1/public-media/${kind}/${id}`)).toBe(`${origin}/api/v1/public-media/${kind}/${id}`);
  });

  it("maps public photos to an approved future compiled backend", () => {
    vi.stubEnv("VITE_HVM_NATIVE_BACKEND_ORIGIN", "https://owned.example");
    expect(publicMediaSource(`/api/v1/public-media/product/${id}`)).toBe(`https://owned.example/api/v1/public-media/product/${id}`);
  });

  it("preserves a managed Supabase signature byte for byte", () => {
    expect(publicMediaSource(signed)).toBe(signed);
    expect(mediaPreview(signed, 640)).toBe(`${origin}/api/v1/public-media/product/${id}?width=640`);
  });

  it.each(["/favicon.svg", "/assets/product-placeholder.webp", "/app-icons/icon-192.png", "blob:capacitor://localhost/test-local", "data:image/png;base64,aGVsbG8="])(
    "preserves bundled/local image %s", (source) => expect(publicMediaSource(source)).toBe(source),
  );

  it.each([
    `/api/v1/admin/documents/${id}/file`, `/api/v1/producer/documents/${id}/file`, "/api/v1/auth/session",
    `/api/v1/public-media/product/${id}?token=private`, `/api/v1/public-media/product/${id}?width=500`,
    `/api/v1/public-media/product/${id}?width=320&width=640`,
    `https://attacker.example/api/v1/public-media/product/${id}`,
    `http://hortvitalmix.vercel.app/api/v1/public-media/product/${id}`,
    `https://name:password@hortvitalmix.vercel.app/api/v1/public-media/product/${id}`,
    "/assets/%2e%2e/api/v1/auth/session", "/api/v1/public-media/product/%2e%2e/admin", "data:image/svg+xml,<svg/>",
    "https://another.supabase.co/storage/v1/object/sign/product-media/photo.webp?token=opaque",
    "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/private-documents/photo.webp?token=opaque",
  ])("rejects private/unknown photo source %s without treating it as public", (source) => expect(publicMediaSource(source)).toBeNull());

  it("does not change existing web sources on any owned domain", () => {
    mocks.native = false;
    for (const source of [signed, `/api/v1/public-media/product/${id}`, "https://legacy-cdn.example/logo.png", "/favicon.svg"])
      expect(publicMediaSource(source)).toBe(source);
  });
});

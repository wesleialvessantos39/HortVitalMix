import { describe, expect, it } from "vitest";
import { mediaPreview } from "../../src/lib/mediaPreview.ts";
const id = "00000000-0000-4000-8000-000000000022",
  signed = (bucket: string) =>
    `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/${bucket}/${id}/${id}-${"a".repeat(64)}.jpg?token=old`;
describe("Fotos rápidas com identidade estável", () => {
  it("token renovado reutiliza a mesma URL de variante", () => {
    expect(mediaPreview(signed("store-media"))).toBe(
      `/api/v1/public-media/store/${id}?width=640`,
    );
    expect(
      mediaPreview(signed("product-media").replace("old", "new"), 320),
    ).toBe(`/api/v1/public-media/product/${id}?width=320`);
  });
  it.each(["documents_private", "commerce-evidence", "private", "avatars"])(
    "não deriva prévia de bucket privado %s",
    (bucket) => expect(mediaPreview(signed(bucket))).toBeNull(),
  );
  it("não aceita origem forjada ou nome fora do padrão imutável", () => {
    expect(
      mediaPreview(
        signed("product-media").replace(
          "xipbsazvymkqqfmfegwu.supabase.co",
          "attacker.invalid",
        ),
      ),
    ).toBeNull();
    expect(
      mediaPreview(signed("product-media").replace("a".repeat(64), "photo")),
    ).toBeNull();
  });
});

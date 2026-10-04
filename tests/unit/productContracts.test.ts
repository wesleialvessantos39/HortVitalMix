import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreateProductSchema,
  UpdateProductPriceSchema,
  productPriceToCents,
  ProductQuerySchema,
} from "../../shared/contracts/product.ts";
import { productImageExtension } from "../../server/services/ProductService.ts";
const fields = () => ({
  categoryId: randomUUID(),
  title: "Couve picada",
  description: "Couve fresca picada e higienizada.",
  packagingType: "pote_higienizado",
  netWeightGrams: 250,
  unitType: "pote",
  priceCents: 1290,
  commandId: randomUUID(),
});
describe("T14 contratos e valores financeiros", () => {
  it("aplica validade/conservação padrão sem aceitar preço na tabela de produto", () => {
    expect(CreateProductSchema.parse(fields())).toMatchObject({
      shelfLifeDays: 5,
      conservationNotes: "Manter refrigerado entre 2°C e 6°C",
    });
    for (const extra of [
      { storeId: randomUUID() },
      { producerPersonId: randomUUID() },
      { isPublished: true },
      { revision: 2 },
      { availableQuantity: 1 },
    ])
      expect(
        CreateProductSchema.safeParse({ ...fields(), ...extra }).success,
      ).toBe(false);
  });
  it.each([0, -1, 0.5, 50001, NaN, Infinity])(
    "recusa peso %s antes do banco",
    (weight) =>
      expect(
        CreateProductSchema.safeParse({ ...fields(), netWeightGrams: weight })
          .success,
      ).toBe(false),
  );
  it.each([0, -1, 12.9, 2147483648, NaN])(
    "recusa preço %s antes do banco",
    (price) => {
      expect(
        CreateProductSchema.safeParse({ ...fields(), priceCents: price })
          .success,
      ).toBe(false);
      expect(
        UpdateProductPriceSchema.safeParse({
          expectedRevision: 1,
          commandId: randomUUID(),
          newPriceCents: price,
        }).success,
      ).toBe(false);
    },
  );
  it.each([
    { title: "ab" },
    { description: "curta" },
    { categoryId: "1" },
    { packagingType: "saco" },
    { unitType: "litro" },
    { shelfLifeDays: 0 },
    { conservationNotes: " " },
  ])("valida informação alimentar %#", (patch) =>
    expect(
      CreateProductSchema.safeParse({ ...fields(), ...patch }).success,
    ).toBe(false),
  );
  it.each([
    ["0,01", 1],
    ["12,90", 1290],
    ["12.9", 1290],
    [" R$ 12,99 ", 1299],
    ["21474836,47", 2147483647],
  ])("converte %s exatamente em centavos", (value, cents) =>
    expect(productPriceToCents(String(value))).toBe(cents),
  );
  it.each([
    "0",
    "-1",
    "1,001",
    "1.234,56",
    "1e3",
    "NaN",
    "Infinity",
    "21474836,48",
    "",
  ])('recusa moeda ambígua "%s"', (value) =>
    expect(productPriceToCents(value)).toBeNull(),
  );
  it("não aceita filtros que exponham rascunhos/titulares", () => {
    expect(ProductQuerySchema.safeParse({ isPublished: false }).success).toBe(
      false,
    );
    expect(
      ProductQuerySchema.safeParse({ storeId: randomUUID() }).success,
    ).toBe(false);
  });
  it("recusa SVG/disfarce e aceita assinaturas de JPEG/PNG/WebP", () => {
    expect(() =>
      productImageExtension(
        Buffer.from('<svg onload="alert(1)"/>'),
        "image/png",
      ),
    ).toThrow("PRODUCT_IMAGE_INVALID");
    expect(() =>
      productImageExtension(Buffer.from([255, 216, 255]), "image/svg+xml"),
    ).toThrow("PRODUCT_IMAGE_INVALID");
    expect(
      productImageExtension(Buffer.from([255, 216, 255, 0]), "image/jpeg"),
    ).toBe("jpg");
    expect(
      productImageExtension(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
        "image/png",
      ),
    ).toBe("png");
    expect(
      productImageExtension(Buffer.from("RIFF1234WEBP"), "image/webp"),
    ).toBe("webp");
  });
});

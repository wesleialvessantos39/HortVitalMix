import { z } from "zod";

export const PackagingTypeEnum = z.enum([
  "pote_higienizado",
  "bandeja_selada",
  "maco_lavado",
  "porcao_embalada",
]);
export const UnitTypeEnum = z.enum(["un", "pote", "bandeja", "kg", "maco"]);
export const PRODUCT_MEDIA_BUCKET = "product-media";
export const PRODUCT_MEDIA_ORIGIN = "https://xipbsazvymkqqfmfegwu.supabase.co";
export const PRODUCT_MEDIA_MAX_BYTES = 2 * 1024 * 1024;
const positiveInt = z.number().int().positive().max(2147483647);
const fields = {
  categoryId: z.uuid(),
  title: z.string().trim().min(3).max(255),
  description: z.string().trim().min(10).max(2000),
  packagingType: PackagingTypeEnum,
  netWeightGrams: positiveInt.max(50000),
  unitType: UnitTypeEnum,
  shelfLifeDays: positiveInt.default(5),
  conservationNotes: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .default("Manter refrigerado entre 2°C e 6°C"),
};
export const ProductCommandSchema = z
  .object({
    expectedRevision: positiveInt,
    commandId: z.uuid(),
  })
  .strict();
export const CreateProductSchema = z
  .object({
    ...fields,
    priceCents: positiveInt,
    commandId: z.uuid(),
  })
  .strict();
export const UpdateProductSchema = ProductCommandSchema.extend(fields).strict();
export const UpdateProductPriceSchema = ProductCommandSchema.extend({
  newPriceCents: positiveInt,
}).strict();
export const ToggleProductPublishSchema = ProductCommandSchema.extend({
  isPublished: z.boolean(),
}).strict();
export const ProductMediaCommandSchema = ProductCommandSchema.extend({
  mediaId: z.uuid(),
}).strict();
export const ProductUploadQuerySchema = z
  .object({
    commandId: z.uuid(),
    expectedRevision: z
      .string()
      .regex(/^[1-9]\d{0,9}$/)
      .transform(Number)
      .pipe(positiveInt),
  })
  .strict();
export const ProductQuerySchema = z
  .object({
    categoryId: z.uuid().optional(),
    storeSlug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,126}[a-z0-9]$/)
      .optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();
const imageUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.origin === PRODUCT_MEDIA_ORIGIN &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith("/storage/v1/object/sign/product-media/")
    );
  }, "Imagem deve vir do Storage canônico.");
export const ProductMediaSchema = z
  .object({
    id: z.uuid(),
    url: imageUrl,
    displayOrder: z.number().int().nonnegative(),
    isPrimary: z.boolean(),
  })
  .strict();
export const ProductPriceSchema = z
  .object({
    id: z.uuid(),
    priceCents: positiveInt,
    validFrom: z.iso.datetime(),
  })
  .strict();
export const ProductResponseSchema = z
  .object({
    ...fields,
    id: z.uuid(),
    storeId: z.uuid(),
    categoryName: z.string(),
    isPublished: z.boolean(),
    revision: positiveInt,
    currentPrice: ProductPriceSchema,
    media: z.array(ProductMediaSchema),
  })
  .strict();
export const ProductMutationResponseSchema = z
  .object({ product: ProductResponseSchema })
  .strict();
export const ProducerCatalogResponseSchema = z
  .object({
    products: z.array(ProductResponseSchema),
    store: z
      .object({
        id: z.uuid(),
        name: z.string(),
        slug: z.string(),
        status: z.string(),
      })
      .strict()
      .nullable(),
    canCreate: z.boolean(),
  })
  .strict();
export const PublicProductSchema = ProductResponseSchema.omit({
  storeId: true,
  revision: true,
  isPublished: true,
})
  .extend({ storeSlug: z.string(), storeName: z.string() })
  .strict();
export const PublicProductsResponseSchema = z
  .object({ products: z.array(PublicProductSchema) })
  .strict();
export type Product = z.infer<typeof ProductResponseSchema>;
export type PublicProduct = z.infer<typeof PublicProductSchema>;
export type ProducerCatalog = z.infer<typeof ProducerCatalogResponseSchema>;
export type CreateProduct = z.infer<typeof CreateProductSchema>;
export type UpdateProduct = z.infer<typeof UpdateProductSchema>;
export type ProductCommand = z.infer<typeof ProductCommandSchema>;
export type ProductPriceCommand = z.infer<typeof UpdateProductPriceSchema>;
export type ProductPublishCommand = z.infer<typeof ToggleProductPublishSchema>;
export type ProductMediaCommand = z.infer<typeof ProductMediaCommandSchema>;

export const PACKAGING_LABELS: Record<
  z.infer<typeof PackagingTypeEnum>,
  string
> = {
  pote_higienizado: "Pote higienizado",
  bandeja_selada: "Bandeja selada",
  maco_lavado: "Maço lavado",
  porcao_embalada: "Porção embalada",
};
export const UNIT_LABELS: Record<z.infer<typeof UnitTypeEnum>, string> = {
  un: "unidade",
  pote: "pote",
  bandeja: "bandeja",
  kg: "kg",
  maco: "maço",
};
// Decimal text → integer cents without floating-point multiplication or rounding.
export function productPriceToCents(value: string): number | null {
  const normalized = value
    .trim()
    .replace(/^R\$\s*/, "")
    .replace(/\s/g, "");
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(/[,.]/);
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 2147483647
    ? cents
    : null;
}
export function formatProductPrice(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

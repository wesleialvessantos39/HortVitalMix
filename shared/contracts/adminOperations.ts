import { z } from "zod";

const dateTime = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const page = z.coerce.number().int().min(1).max(2000).default(1);
const pageSize = z.coerce.number().int().min(10).max(50).default(20);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(value + "T00:00:00Z");
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Data inválida");
export const FinancePaymentStatusSchema = z.enum([
  "pending",
  "approved",
  "failed",
  "refunded",
]);
export const FinanceHoldStateSchema = z.enum([
  "held",
  "disputed",
  "refund_pending",
  "partially_refunded",
  "refunded",
  "released",
]);
export const CatalogStoreStatusSchema = z.enum([
  "draft",
  "pending_review",
  "active",
  "paused",
  "closed",
]);

export const AdminFinanceQuerySchema = z
  .object({
    view: z.enum(["payments", "orders"]).default("payments"),
    from: date.optional(),
    to: date.optional(),
    page,
    pageSize,
    paymentStatus: FinancePaymentStatusSchema.or(z.literal("all")).default(
      "all",
    ),
    holdState: FinanceHoldStateSchema.or(z.literal("all")).default("all"),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.from && input.to && input.from > input.to)
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "O fim deve ser posterior ao início",
      });
    if (
      input.from &&
      input.to &&
      Date.parse(input.to) - Date.parse(input.from) > 365 * 86400000
    )
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Consulte até 366 dias por período",
      });
  });

export const AdminCatalogQuerySchema = z
  .object({
    view: z.enum(["products", "stores", "categories"]).default("products"),
    publication: z
      .enum(["all", "published", "draft", "unavailable"])
      .default("all"),
    storeStatus: CatalogStoreStatusSchema.or(z.literal("all")).default("all"),
    search: z.string().trim().max(80).default(""),
    page,
    pageSize,
  })
  .strict();

const pagination = z
  .object({ page: count.positive(), pageSize: count.positive(), total: count })
  .strict();
export const AdminFinancePaymentSchema = z
  .object({
    id: z.uuid(),
    method: z.enum(["pix", "credit_card", "debit_card"]),
    status: FinancePaymentStatusSchema,
    source: z.enum(["online", "pos", "subscription"]),
    amountCents: count,
    createdAt: dateTime,
    expiresAt: dateTime,
    orderCount: count,
  })
  .strict();
export const AdminFinanceOrderSchema = z
  .object({
    id: z.uuid(),
    orderNumber: z.string().regex(/^\d+$/),
    storeName: z.string(),
    status: z.enum(["confirmed", "received", "refunded"]),
    totalCents: count,
    holdState: FinanceHoldStateSchema.nullable(),
    retainedCents: count,
    refundedCents: count,
    createdAt: dateTime,
    releaseAfter: dateTime.nullable(),
  })
  .strict();
export const AdminFinanceResponseSchema = z
  .object({
    generatedAt: dateTime,
    view: z.enum(["payments", "orders"]),
    period: z.object({ from: date, to: date }).strict(),
    pagination,
    metrics: z
      .object({
        approvedPayments: count,
        approvedAmountCents: count,
        heldAmountCents: count,
        releasedAmountCents: count,
      })
      .strict(),
    payments: z.array(AdminFinancePaymentSchema).max(50),
    orders: z.array(AdminFinanceOrderSchema).max(50),
  })
  .strict();

export const AdminCatalogProductSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    storeName: z.string(),
    categoryName: z.string(),
    isPublished: z.boolean(),
    isVisible: z.boolean(),
    storeStatus: CatalogStoreStatusSchema,
    categoryActive: z.boolean(),
    revision: count.positive().default(1),
    adminHidden: z.boolean().default(false),
    priceCents: count.nullable(),
    updatedAt: dateTime,
  })
  .strict();
export const AdminCatalogStoreSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    status: CatalogStoreStatusSchema,
    isVisible: z.boolean(),
    productCount: count,
    publishedProductCount: count,
    updatedAt: dateTime,
    revision: count.positive().default(1),
    adminHidden: z.boolean().default(false),
  })
  .strict();
export const AdminCatalogCategorySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    isActive: z.boolean(),
    productCount: count,
    publishedProductCount: count,
  })
  .strict();
export const AdminCatalogResponseSchema = z
  .object({
    generatedAt: dateTime,
    view: z.enum(["products", "stores", "categories"]),
    pagination,
    metrics: z
      .object({
        publishedProducts: count,
        draftProducts: count,
        visibleProducts: count,
        activeStores: count,
        activeCategories: count,
      })
      .strict(),
    products: z.array(AdminCatalogProductSchema).max(50),
    stores: z.array(AdminCatalogStoreSchema).max(50),
    categories: z.array(AdminCatalogCategorySchema).max(50),
  })
  .strict();

export type AdminFinanceQuery = z.infer<typeof AdminFinanceQuerySchema>;
export type AdminCatalogQuery = z.infer<typeof AdminCatalogQuerySchema>;
export type AdminFinanceResponse = z.infer<typeof AdminFinanceResponseSchema>;
export type AdminCatalogResponse = z.infer<typeof AdminCatalogResponseSchema>;

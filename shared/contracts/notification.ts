import { z } from "zod";
export const NotificationCategorySchema = z.enum([
  "purchases",
  "sales",
  "orders",
  "refunds",
  "complaints",
  "reviews",
  "subscriptions",
  "properties",
  "documents",
  "account",
  "catalog",
  "inventory",
  "delivery",
  "administration",
]);
export const NOTIFICATION_LABELS: Record<
  z.infer<typeof NotificationCategorySchema>,
  string
> = {
  purchases: "Compras",
  sales: "Vendas",
  orders: "Pedidos",
  refunds: "Reembolsos",
  complaints: "Denúncias",
  reviews: "Avaliações",
  subscriptions: "Assinaturas",
  properties: "Imóveis",
  documents: "Documentos",
  account: "Conta",
  catalog: "Catálogo",
  inventory: "Estoque",
  delivery: "Entrega",
  administration: "Administração",
};
export const NotificationListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    filter: z.enum(["all", "unread"]).default("all"),
    category: NotificationCategorySchema.optional(),
  })
  .strict();
export const NotificationSchema = z
  .object({
    id: z.uuid(),
    category: NotificationCategorySchema,
    title: z.string().max(160),
    message: z.string().max(500),
    actionPath: z
      .string()
      .max(512)
      .regex(/^\/[a-zA-Z0-9/_?=&%#.-]+$/)
      .refine((v) => !v.startsWith("//")),
    createdAt: z.iso.datetime(),
    readAt: z.iso.datetime().nullable(),
  })
  .strict();
export const NotificationListSchema = z
  .object({
    notifications: z.array(NotificationSchema),
    unreadCount: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pages: z.number().int().positive(),
    asOf: z.iso.datetime(),
  })
  .strict();
export const ReadNotificationsSchema = z
  .object({ through: z.iso.datetime() })
  .strict();
export type Notification = z.infer<typeof NotificationSchema>;
export type NotificationList = z.infer<typeof NotificationListSchema>;

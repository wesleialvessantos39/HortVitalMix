import { z } from "zod";
import { CheckoutCommandIdSchema, PaymentMethodEnum } from "./checkout.ts";
import type { OrderStatus } from "./order.ts";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const note = z.string().trim().min(10).max(4000);
const cents = z.number().int().positive().max(2147483647);
export const CommercePolicySchema = z
  .object({
    version: z.number().int().positive(),
    onlineWithdrawalDays: z.number().int().min(7).max(60),
    inPersonReturnDays: z.number().int().min(0).max(60),
    holdingDays: z.number().int().min(7).max(90),
    additionalTerms: z.string().trim().max(4000),
  })
  .strict();
export type CommercePolicy = z.infer<typeof CommercePolicySchema>;
export const GatewayPreparationSchema = z
  .object({
    provider: z.enum(["unselected", "mercado_pago", "efi", "other"]),
    accountLabel: z.string().trim().max(128),
    merchantReference: z.string().trim().max(128),
    platformPixKey: z.string().trim().max(255),
    terminalReference: z.string().trim().max(128),
  })
  .strict();
export const UpdateCommerceSettingsSchema = z
  .object({
    commandId: CheckoutCommandIdSchema,
    expectedRevision: z.number().int().positive(),
    policy: CommercePolicySchema.omit({ version: true }),
    gateway: GatewayPreparationSchema,
  })
  .strict();
export const CreatePosSaleSchema = z
  .object({
    commandId: CheckoutCommandIdSchema,
    paymentMethod: PaymentMethodEnum,
    paymentChannel: z.enum(["system_pix", "terminal"]),
    items: z
      .array(
        z
          .object({
            productId: uuid,
            quantity: z.number().int().min(1).max(99),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.paymentMethod === "pix") !==
      (value.paymentChannel === "system_pix")
    )
      context.addIssue({
        code: "custom",
        message: "Pix pelo sistema; cartão pela maquininha vinculada.",
        path: ["paymentChannel"],
      });
    if (
      new Set(value.items.map((item) => item.productId)).size !==
      value.items.length
    )
      context.addIssue({
        code: "custom",
        message: "Produtos repetidos.",
        path: ["items"],
      });
  });
export const AcceptPosSaleSchema = z
  .object({
    commandId: CheckoutCommandIdSchema,
    policyVersion: z.number().int().positive(),
  })
  .strict();
export const RefundReasonSchema = z.enum([
  "withdrawal",
  "quality",
  "missing_items",
  "not_delivered",
  "wrong_product",
  "other",
]);
export const CreateRefundSchema = z
  .object({
    commandId: CheckoutCommandIdSchema,
    orderId: uuid,
    reason: RefundReasonSchema,
    description: note,
    requestedAmountCents: cents,
  })
  .strict();
export const RefundDecisionSchema = z
  .object({
    commandId: CheckoutCommandIdSchema,
    expectedRevision: z.number().int().positive(),
    decision: z.enum(["review", "approve", "reject"]),
    notes: note,
    approvedAmountCents: cents.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "approve" && !value.approvedAmountCents)
      context.addIssue({
        code: "custom",
        message: "Informe o valor aprovado.",
        path: ["approvedAmountCents"],
      });
    if (value.decision !== "approve" && value.approvedAmountCents !== undefined)
      context.addIssue({
        code: "custom",
        message: "Valor permitido somente na aprovação.",
        path: ["approvedAmountCents"],
      });
  });
export const ComplaintTargetSchema = z.enum([
  "store",
  "producer",
  "product",
  "customer",
]);
export const CreateComplaintSchema = z
  .object({
    commandId: CheckoutCommandIdSchema,
    targetType: ComplaintTargetSchema,
    targetId: uuid,
    orderId: uuid.nullable(),
    reason: z.enum([
      "fraud",
      "unsafe_food",
      "harassment",
      "misleading_information",
      "payment_issue",
      "other",
    ]),
    description: note,
  })
  .strict();
export const ComplaintDecisionSchema = z
  .object({
    commandId: CheckoutCommandIdSchema,
    expectedRevision: z.number().int().positive(),
    decision: z.enum(["review", "request_information", "resolve", "dismiss"]),
    notes: note,
  })
  .strict();
export const CaseMessageSchema = z
  .object({ commandId: CheckoutCommandIdSchema, message: note })
  .strict();
export const CaseEvidenceSchema = z
  .object({
    commandId: CheckoutCommandIdSchema,
    caseType: z.enum(["refund", "complaint"]),
    caseId: uuid,
    fileName: z.string().trim().min(1).max(120),
    mimeType: z.enum([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ]),
    base64: z
      .string()
      .min(4)
      .max(2800000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export type PosItem = {
  productId: string;
  title: string;
  quantity: number;
  unitType: string;
  unitPriceCents: number;
  totalPriceCents: number;
  priceVersionId: string;
};
export type PosSale = {
  id: string;
  code: string;
  storeName: string;
  totalCents: number;
  items: PosItem[];
  paymentMethod: z.infer<typeof PaymentMethodEnum>;
  paymentChannel: "system_pix" | "terminal";
  status: "draft" | "accepted" | "cancelled" | "paid";
  expiresAt: string;
  policy: CommercePolicy;
  customerAccepted: boolean;
};
export type OrderView = {
  id: string;
  orderNumber: string;
  storeName: string;
  source: "online" | "pos";
  status: "confirmed" | "received" | "refunded";
  fulfillmentStatus?: OrderStatus;
  totalCents: number;
  items: PosItem[];
  createdAt: string;
  receivedAt: string | null;
  withdrawalDeadline: string | null;
  problemDeadline: string | null;
  policy: CommercePolicy;
  holdState: string;
  producerUserId?: string;
  customerUserId?: string;
};
export type PaymentView = {
  id: string;
  method: z.infer<typeof PaymentMethodEnum>;
  status: "pending" | "approved" | "failed" | "refunded";
  amountCents: number;
  expiresAt: string;
  gatewayAvailable: boolean;
  pixCopyPaste: string | null;
  pixQrCodeBase64: string | null;
  orderIds: string[];
  policy: CommercePolicy;
};
export type CaseView = {
  id: string;
  kind: "refund" | "complaint";
  status: string;
  revision: number;
  reason: string;
  description: string;
  orderId: string | null;
  targetType?: string;
  targetId?: string;
  requestedAmountCents?: number;
  approvedAmountCents?: number | null;
  createdAt: string;
  subjectUserId?: string | null;
  messages: Array<{
    id: string;
    message: string;
    createdAt: string;
    author: "customer" | "producer" | "admin";
  }>;
  history: Array<{ status: string; notes: string; createdAt: string }>;
  evidence: Array<{ id: string; fileName: string }>;
};

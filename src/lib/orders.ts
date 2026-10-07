import { z } from "zod";
import {
  OrderIdSchema,
  OrderResponseSchema,
  TransitionOrderSchema,
} from "../../shared/contracts/order";
import { api, type ApiFailure } from "./api";
const PendingSchema = z
  .object({
    commandId: z.uuid(),
    orderId: OrderIdSchema,
    input: TransitionOrderSchema,
  })
  .strict();
export type PendingTransition = z.infer<typeof PendingSchema>;
const key = (userId: string) => "hvm:order-transition:" + userId;
export function readPendingTransition(
  userId: string,
): PendingTransition | null {
  try {
    return PendingSchema.parse(
      JSON.parse(sessionStorage.getItem(key(userId)) ?? "null"),
    );
  } catch {
    return null;
  }
}
export function prepareTransition(
  userId: string,
  orderId: string,
  input: unknown,
): PendingTransition {
  const pending = PendingSchema.parse({
    commandId: crypto.randomUUID(),
    orderId,
    input,
  });
  try {
    sessionStorage.setItem(key(userId), JSON.stringify(pending));
  } catch {
    /* Server enforces uniqueness. */
  }
  return pending;
}
export function clearPendingTransition(userId: string) {
  try {
    sessionStorage.removeItem(key(userId));
  } catch {
    /* Private browsing. */
  }
}
export async function sendOrderTransition(
  userId: string,
  pending: PendingTransition,
) {
  const value = await api<unknown>(
    `/v1/producer/orders/${pending.orderId}/transitions`,
    {
      method: "POST",
      headers: { "X-Command-Id": pending.commandId },
      body: JSON.stringify(pending.input),
    },
  );
  const result = OrderResponseSchema.parse(value);
  clearPendingTransition(userId);
  return result;
}
export function orderMessage(error: unknown) {
  const messages: Record<string, string> = {
    AUTH_REQUIRED:
      "Sua sessão terminou. Entre novamente para consultar os pedidos.",
    PRODUCER_REQUIRED:
      "Entre como produtor para gerenciar os pedidos da sua loja.",
    ORDER_NOT_FOUND: "Este pedido não está disponível para sua conta.",
    REVISION_CONFLICT:
      "O pedido foi atualizado em outra sessão. Confira a etapa atual antes de continuar.",
    ILLEGAL_TRANSITION:
      "Essa mudança não é permitida na etapa atual do pedido.",
    ORDER_ALREADY_RECEIVED:
      "O cliente já confirmou o recebimento. Use o fluxo de reembolso para tratar um problema.",
    ORDER_REFUNDED:
      "Esta compra já foi reembolsada e não pode avançar no preparo.",
    ORDER_REFUND_IN_PROGRESS:
      "Já existe um reembolso parcial em análise. Aguarde a resolução antes de cancelar o pedido.",
    ORDER_FINANCIAL_STATE_CONFLICT:
      "A retenção desta compra precisa ser analisada antes do cancelamento.",
    VALIDATION_ERROR:
      "Confira os dados e informe o motivo do cancelamento com pelo menos 10 caracteres.",
    COMMAND_REUSED:
      "Essa atualização já foi usada para outra ação. Atualize a lista antes de continuar.",
  };
  return (
    messages[(error as ApiFailure)?.message] ??
    "Não foi possível atualizar os pedidos agora. Tente novamente."
  );
}

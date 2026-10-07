import { api } from "./api";
import {
  CheckoutCommandIdSchema,
  CheckoutConfirmationSchema,
  CheckoutContextSchema,
  CheckoutQuoteResponseSchema,
  ConfirmCheckoutSchema,
  type ConfirmCheckout,
} from "../../shared/contracts/checkout";
import { z } from "zod";

export const PendingCheckoutSchema = z
  .object({
    commandId: CheckoutCommandIdSchema,
    payload: ConfirmCheckoutSchema,
  })
  .strict();
export type PendingCheckout = z.infer<typeof PendingCheckoutSchema>;
const memory = new Map<string, PendingCheckout>();
const key = (userId: string) => "hvm:checkout:" + userId;
export function readPendingCheckout(userId: string): PendingCheckout | null {
  try {
    const raw = sessionStorage.getItem(key(userId));
    if (raw) {
      const parsed = PendingCheckoutSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
      sessionStorage.removeItem(key(userId));
    }
  } catch {
    /* Storage may be disabled; server ownership/quote uniqueness still apply. */
  }
  return memory.get(userId) ?? null;
}
export function savePendingCheckout(userId: string, command: PendingCheckout) {
  const value = PendingCheckoutSchema.parse(command);
  memory.set(userId, value);
  try {
    sessionStorage.setItem(key(userId), JSON.stringify(value));
  } catch {
    /* Keep the same key in memory. */
  }
}
export function clearPendingCheckout(userId: string) {
  memory.delete(userId);
  try {
    sessionStorage.removeItem(key(userId));
  } catch {
    /* Storage disabled. */
  }
}
export async function checkoutContext(signal?: AbortSignal) {
  return CheckoutContextSchema.parse(
    await api("/v1/checkout/context", { signal }),
  );
}
export async function checkoutQuote(id: string, signal?: AbortSignal) {
  return CheckoutQuoteResponseSchema.parse(
    await api("/v1/checkout/quotes/" + encodeURIComponent(id), { signal }),
  );
}
export async function createCheckoutQuote(
  cartId: string,
  deliveryAddressId: string,
) {
  return CheckoutQuoteResponseSchema.parse(
    await api("/v1/checkout/quotes", {
      method: "POST",
      body: JSON.stringify({ cartId, deliveryAddressId }),
    }),
  );
}
export async function checkoutConfirmation(id: string, signal?: AbortSignal) {
  return CheckoutConfirmationSchema.parse(
    await api("/v1/checkout/confirmations/" + encodeURIComponent(id), {
      signal,
    }),
  );
}
export async function confirmCheckout(command: PendingCheckout) {
  return CheckoutConfirmationSchema.parse(
    await api("/v1/checkout/confirm", {
      method: "POST",
      headers: { "X-Command-Id": command.commandId },
      body: JSON.stringify(command.payload),
    }),
  );
}
export const checkoutErrorMessage = (error: unknown) => {
  const code = (error as Error)?.message;
  return (
    (
      {
        CONSUMER_REQUIRED: "Cadastre-se e entre como consumidor para comprar.",
    AUTH_REQUIRED:
          "Sua sessão expirou. Entre novamente para recuperar esta confirmação.",
        CHECKOUT_OWNER_REQUIRED:
          "Entre com uma conta de consumidor ou produtor para revisar sua seleção.",
        CHECKOUT_CART_EMPTY:
          "Sua cesta está vazia. Escolha alimentos antes de revisar.",
        CHECKOUT_PRODUCT_UNAVAILABLE:
          "Um alimento deixou de estar disponível. Atualize sua cesta.",
        CHECKOUT_INSUFFICIENT_STOCK:
          "Uma das porções não tem estoque suficiente. Revise as quantidades na cesta.",
        CHECKOUT_MINIMUM_NOT_MET:
          "O pedido mínimo precisa ser atingido em cada loja. Revise sua cesta.",
        CHECKOUT_ALREADY_PENDING:
          "Esta seleção já possui uma confirmação com pagamento pendente. Atualize para recuperá-la.",
        DELIVERY_ADDRESS_NOT_FOUND:
          "O endereço selecionado não está disponível. Escolha um endereço ativo da sua conta.",
        DELIVERY_ADDRESS_GPS_REQUIRED:
          "Ajuste o ponto de entrega deste endereço no mapa antes de calcular o frete.",
        CHECKOUT_DELIVERY_OUTSIDE_AREA:
          "Uma das lojas não entrega neste endereço. Escolha outro endereço ou revise sua cesta.",
        DELIVERY_UNAVAILABLE:
          "Uma das lojas está sem entrega disponível. Revise sua cesta antes de confirmar.",
        LOCALITY_DISABLED:
          "Este município não está disponível para entrega no momento.",
        CHECKOUT_TOTAL_TOO_LARGE:
          "O valor desta seleção ultrapassa o limite permitido. Reduza sua cesta.",
      } as Record<string, string>
    )[code] ??
    "Não foi possível concluir agora. Tente novamente para recuperar o resultado."
  );
};
export function newCheckoutCommand(payload: ConfirmCheckout): PendingCheckout {
  return PendingCheckoutSchema.parse({
    commandId: crypto.randomUUID(),
    payload,
  });
}

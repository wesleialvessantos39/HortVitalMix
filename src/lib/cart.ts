import { useRef, useState } from "react";
import { api, type ApiFailure } from "./api";
import { CartResponseSchema, type Cart } from "../../shared/contracts/cart";

let sessionReady = false;
let queue: Promise<void> = Promise.resolve();
function serialize<T>(run: () => Promise<T>) {
  const result = queue.then(run, run);
  queue = result.then(
    () => {},
    () => {},
  );
  return result;
}
if (typeof window !== "undefined") {
  const reset = () => {
    sessionReady = false;
  };
  window.addEventListener("hvm:session-changed", reset);
  window.addEventListener("hvm:session-cleared", reset);
}

export const cartErrorMessage = (failure: unknown) => {
  const code = (failure as Error)?.message;
  return (
    (
      {
        CART_PRODUCT_UNAVAILABLE:
          "Este produto não está mais disponível. Atualize o catálogo.",
        CART_ITEM_NOT_FOUND: "Este item já foi removido. Atualize a cesta.",
        CART_FULL:
          "Sua cesta chegou ao limite de opções. Remova uma opção para incluir outra.",
        CART_OWNER_REQUIRED:
          "Cadastre-se e entre como consumidor para usar a cesta.",
        CONSUMER_REQUIRED: "Cadastre-se e entre como consumidor para comprar.",
        AUTH_REQUIRED: "Entre novamente para carregar sua cesta salva.",
        CART_COMMAND_CONFLICT:
          "Não foi possível confirmar esta alteração. Atualize a cesta.",
        VALIDATION_ERROR: "Confira os itens e use uma quantidade de 1 a 99.",
      } as Record<string, string>
    )[code] ??
    "Não foi possível confirmar a alteração. Tente novamente para recuperar o resultado."
  );
};
export function notifyCart(cart: Cart) {
  window.dispatchEvent(
    new CustomEvent("hvm:cart-updated", { detail: cart.itemCount }),
  );
}
export async function loadCart(signal?: AbortSignal) {
  const cart = CartResponseSchema.parse(await api("/v1/cart", { signal }));
  if (!signal?.aborted) {
    sessionReady = true;
    notifyCart(cart);
  }
  return cart;
}
export function useCartMutation(onSaved?: (cart: Cart) => void) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false);
  const flight = useRef(false),
    pending = useRef<{ path: string; body: object; method: string } | null>(
      null,
    ),
    saved = useRef(onSaved);
  saved.current = onSaved;
  async function retry() {
    if (flight.current || !pending.current) return null;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const request = pending.current;
      const cart = await serialize(async () => {
        // Concurrent first clicks on different product cards must share ONE
        // server-issued HttpOnly cookie before either mutates the guest basket.
        if (!sessionReady) await loadCart();
        return CartResponseSchema.parse(
          await api(request.path, {
            method: request.method,
            body: JSON.stringify(request.body),
          }),
        );
      });
      pending.current = null;
      setUncertain(false);
      notifyCart(cart);
      saved.current?.(cart);
      return cart;
    } catch (failure) {
      const status = (failure as ApiFailure).status;
      const retryable = status === undefined || status >= 500;
      setUncertain(retryable);
      if (!retryable) pending.current = null;
      setError(cartErrorMessage(failure));
      return null;
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function send(path: string, body: object, method = "POST") {
    if (flight.current || pending.current) return null;
    pending.current = { path, body, method };
    return retry();
  }
  return { busy, error, uncertain, send, retry };
}

import { useState } from "react";
import { ShoppingCart } from "lucide-react";
import { useCartMutation } from "../../lib/cart";
export function ProductCartActions({
  productId,
  available,
}: {
  productId: string;
  available: boolean;
}) {
  const command = useCartMutation(),
    [added, setAdded] = useState(false);
  return (
    <div className="hvm-product-cart-actions">
      <button
        type="button"
        className="primary"
        disabled={!available || command.busy || command.uncertain}
        onClick={async () => {
          setAdded(false);
          if (
            await command.send("/v1/cart/items", {
              productId,
              quantity: 1,
              commandId: crypto.randomUUID(),
            })
          )
            setAdded(true);
        }}
      >
        <ShoppingCart size={17} aria-hidden="true" />
        {command.busy ? "Adicionando…" : "Adicionar à cesta"}
      </button>
      {added && <p role="status">Adicionado à cesta.</p>}
      {command.error && <p role="alert">{command.error}</p>}
      {command.uncertain && (
        <button
          type="button"
          className="secondary"
          disabled={command.busy}
          onClick={async () => {
            if (await command.retry()) setAdded(true);
          }}
        >
          Confirmar alteração
        </button>
      )}
    </div>
  );
}

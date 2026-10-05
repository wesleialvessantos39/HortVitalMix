import { useState } from "react";
import { Plus, Salad, Trash2 } from "lucide-react";
import {
  CutTypeEnum,
  CUT_TYPE_LABELS,
  type AddCartItem,
} from "../../../shared/contracts/cart";
import {
  formatProductPrice,
  type PublicProduct,
} from "../../../shared/contracts/product";
import { useCartMutation } from "../../lib/cart";
import "./hortiMix.css";

export function HortiMixBuilder({
  products,
  onNavigate,
}: {
  products: PublicProduct[];
  onNavigate: (path: string) => void;
}) {
  const [productId, setProductId] = useState(""),
    [cutType, setCutType] =
      useState<NonNullable<AddCartItem["cutType"]>>("rodelas"),
    [quantity, setQuantity] = useState("1"),
    [items, setItems] = useState<Array<AddCartItem & { key: string }>>([]),
    [message, setMessage] = useState("");
  const command = useCartMutation(() => {
    setItems([]);
    setMessage("Seu HortiMix foi adicionado à cesta.");
  });
  const available = products.filter((p) => p.inStock),
    selected = available.find((p) => p.id === productId);
  const total = items.reduce(
    (sum, item) =>
      sum +
      (products.find((p) => p.id === item.productId)?.currentPrice.priceCents ??
        0) *
        item.quantity,
    0,
  );
  const locked = command.busy || command.uncertain;
  function addPortion() {
    const n = Number(quantity);
    if (!selected || !Number.isInteger(n) || n < 1 || n > 99) {
      setMessage("Escolha um alimento e informe de 1 a 99 porções.");
      return;
    }
    const existing = items.find(
      (i) => i.productId === selected.id && i.cutType === cutType,
    );
    if ((existing?.quantity ?? 0) + n > 99) {
      setMessage("Cada alimento e corte pode ter até 99 porções.");
      return;
    }
    if (!existing && items.length >= 30) {
      setMessage("Monte até 30 opções por HortiMix.");
      return;
    }
    setItems((current) =>
      existing
        ? current.map((i) =>
            i.key === existing.key ? { ...i, quantity: i.quantity + n } : i,
          )
        : [
            ...current,
            {
              key: crypto.randomUUID(),
              productId: selected.id,
              quantity: n,
              cutType,
            },
          ],
    );
    setMessage("");
  }
  return (
    <details className="hvm-mix">
      <summary>
        <Salad size={22} aria-hidden="true" /> Monte seu HortiMix
      </summary>
      <div className="hvm-mix-content">
        <p>
          Combine as porções do catálogo e escolha como prefere os cortes. Cada
          porção mantém o peso e o preço informado pelo produtor.
        </p>
        {!available.length ? (
          <p>Nenhuma porção disponível neste catálogo agora.</p>
        ) : (
          <>
            <fieldset disabled={locked}>
              <label>
                Alimento
                <select
                  aria-label="Alimento"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                >
                  <option value="">Escolha uma porção</option>
                  {available.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} · {p.netWeightGrams} g · {p.storeName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Corte
                <select
                  aria-label="Corte"
                  value={cutType}
                  onChange={(e) =>
                    setCutType(CutTypeEnum.parse(e.target.value))
                  }
                >
                  {CutTypeEnum.options.map((c) => (
                    <option key={c} value={c}>
                      {CUT_TYPE_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Porções
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={99}
                  step={1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </label>
              <button type="button" className="secondary" onClick={addPortion}>
                <Plus size={17} /> Incluir no mix
              </button>
            </fieldset>
            {selected && (
              <p>
                {selected.netWeightGrams} g por porção ·{" "}
                {formatProductPrice(selected.currentPrice.priceCents)}
              </p>
            )}
            {items.length > 0 && (
              <>
                <ul>
                  {items.map((item) => {
                    const product = products.find(
                      (p) => p.id === item.productId,
                    );
                    return (
                      <li key={item.key}>
                        <span>
                          <strong>{product?.title}</strong> ·{" "}
                          {CUT_TYPE_LABELS[item.cutType!]}
                          <br />
                          {item.quantity} porção(ões) ·{" "}
                          {(product?.netWeightGrams ?? 0) * item.quantity} g
                        </span>
                        <button
                          type="button"
                          className="text-button"
                          aria-label={`Retirar ${product?.title} em ${CUT_TYPE_LABELS[item.cutType!]}`}
                          disabled={locked}
                          onClick={() =>
                            setItems((current) =>
                              current.filter((i) => i.key !== item.key),
                            )
                          }
                        >
                          <Trash2 size={18} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="hvm-mix-footer">
                  <strong>
                    Total dos alimentos: {formatProductPrice(total)}
                  </strong>
                  <button
                    type="button"
                    className="primary"
                    disabled={locked}
                    onClick={() =>
                      void command.send("/v1/cart/mix", {
                        items: items.map(({ key: _key, ...item }) => item),
                        commandId: crypto.randomUUID(),
                      })
                    }
                  >
                    {command.busy
                      ? "Adicionando…"
                      : "Adicionar HortiMix à cesta"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {message && <p role="status">{message}</p>}
        {command.error && <p role="alert">{command.error}</p>}
        {command.uncertain && (
          <button
            type="button"
            className="secondary"
            disabled={command.busy}
            onClick={() => void command.retry()}
          >
            Confirmar alteração
          </button>
        )}
        <button
          type="button"
          className="text-button"
          onClick={() => onNavigate("/carrinho")}
        >
          Ver minha cesta
        </button>
      </div>
    </details>
  );
}

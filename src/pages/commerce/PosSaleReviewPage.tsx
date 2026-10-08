import { PageLoading } from "../../components/PageLoading";
import { useEffect, useRef, useState } from "react";
import type { PosSale } from "../../../shared/contracts/commerce";
import { api } from "../../lib/api";
import {
  commerceMessage,
  commerceMutation,
  money,
  date,
  statusLabels,
} from "../../lib/commerce";
import { RefundPolicy } from "../../components/commerce/RefundPolicy";
import "./commerce.css";
export default function PosSaleReviewPage({
  code,
  userId,
  onNavigate,
}: {
  code: string;
  userId: string | null;
  onNavigate: (path: string) => void;
}) {
  const [sale, setSale] = useState<PosSale | null>(null),
    [agree, setAgree] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const flight = useRef(false);
  useEffect(() => {
    if (!userId) {
      try {
        sessionStorage.setItem("hvm:pos-review", code);
      } catch {}
      return;
    }
    const controller = new AbortController();
    void api<PosSale>("/v1/commerce/pos/" + code, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setSale(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(commerceMessage(e));
      });
    return () => controller.abort();
  }, [code, userId]);
  async function accept() {
    if (!sale || !userId || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      await commerceMutation(
        "/v1/commerce/pos/" + code + "/accept",
        { policyVersion: sale.policy.version },
        userId,
      );
      setSale(await api<PosSale>("/v1/commerce/pos/" + code));
      setNotice(
        "Revisão e termos registrados. O pagamento estará disponível após a ativação da conta.",
      );
      try {
        sessionStorage.removeItem("hvm:pos-review");
      } catch {}
    } catch (e) {
      setError(commerceMessage(e));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="hvm-commerce">
      <h1>Revise sua compra presencial</h1>
      {error && (
        <p role="alert" className="commerce-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="commerce-success">
          {notice}
        </p>
      )}
      {!userId ? (
        <article className="commerce-card">
          <p>
            Entre para conferir os produtos, os valores e os termos da venda.
            Você poderá retomar a revisão em Minhas compras.
          </p>
          <button
            className="primary"
            onClick={() => onNavigate("/entrar/consumidor")}
          >
            Entrar para revisar
          </button>
        </article>
      ) : !sale && !error ? (
        <PageLoading label="Carregando a venda…" />
      ) : (
        sale && (
          <div className="commerce-grid">
            <article className="commerce-card">
              <h2>{sale.storeName}</h2>
              <span className="commerce-tag">{statusLabels[sale.status]}</span>
              <ul className="commerce-items">
                {sale.items.map((item) => (
                  <li key={item.productId}>
                    <span>
                      {item.quantity} × {item.title}
                      <small>
                        {money(item.unitPriceCents)} / {item.unitType}
                      </small>
                    </span>
                    <strong>{money(item.totalPriceCents)}</strong>
                  </li>
                ))}
              </ul>
              <h2>Total {money(sale.totalCents)}</h2>
              <p>
                Recebimento:{" "}
                {sale.paymentMethod === "pix"
                  ? "Pix do sistema"
                  : sale.paymentMethod === "credit_card"
                    ? "Cartão de crédito na maquininha"
                    : "Cartão de débito na maquininha"}
                .
              </p>
              <p>Revisão válida até {date(sale.expiresAt)}.</p>
              <p className="commerce-note">
                A conta de recebimento está em preparação. Este comprovante de
                revisão não confirma pagamento.
              </p>
              <label className="commerce-checkbox">
                <input
                  type="checkbox"
                  checked={agree || sale.customerAccepted}
                  disabled={sale.customerAccepted}
                  onChange={(e) => setAgree(e.target.checked)}
                />
                <span>
                  Conferi os produtos, os valores e a política da compra
                  presencial.
                </span>
              </label>
              <button
                className="primary"
                disabled={
                  !agree ||
                  busy ||
                  sale.status !== "draft" ||
                  Date.parse(sale.expiresAt) <= Date.now()
                }
                onClick={() => void accept()}
              >
                {sale.customerAccepted
                  ? "Revisão registrada"
                  : busy
                    ? "Registrando…"
                    : "Confirmar revisão e termos"}
              </button>
              <button
                className="text-button"
                onClick={() => onNavigate("/compras")}
              >
                Minhas compras
              </button>
            </article>
            <RefundPolicy policy={sale.policy} onNavigate={onNavigate} />
          </div>
        )
      )}
    </section>
  );
}

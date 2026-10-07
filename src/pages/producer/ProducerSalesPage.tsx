import { useState } from "react";
import { ProducerSalesSchema } from "../../../shared/contracts/producerSales";
import { ORDER_STATUS_LABELS } from "../../../shared/contracts/order";
import { useOrderQuery } from "../../hooks/useOrderQuery";
import { money, date } from "../../lib/commerce";
import "../commerce/commerce.css";
import "../account/notifications.css";
const financial: Record<string, string> = {
  held: "Valor retido",
  disputed: "Em análise",
  refund_pending: "Reembolso pendente",
  partially_refunded: "Reembolso parcial",
  refunded: "Reembolsada",
  released: "Retenção encerrada",
};
export default function ProducerSalesPage({
  userId,
  onNavigate,
}: {
  userId: string;
  onNavigate: (to: string) => void;
}) {
  const [source, setSource] = useState("all"),
    [page, setPage] = useState(1);
  const selected = new URLSearchParams(location.search).get("orderId");
  const { data, error, refresh } = useOrderQuery(
    `/v1/producer/sales?page=${page}&source=${source}${selected ? "&orderId=" + encodeURIComponent(selected) : ""}`,
    userId,
    ProducerSalesSchema,
  );
  return (
    <section className="hvm-commerce">
      <span className="eyebrow">Portal do produtor</span>
      <h1>Minhas vendas</h1>
      <p>
        Vendas confirmadas da sua loja, pelo catálogo e pelo caixa presencial.
      </p>
      <nav className="hvm-sales-links" aria-label="Gestão das vendas">
        <button
          className="primary"
          onClick={() => onNavigate("/produtor/caixa")}
        >
          Caixa do produtor
        </button>
        <button
          className="secondary"
          onClick={() => onNavigate("/produtor/pedidos")}
        >
          Pedidos da minha loja
        </button>
        <button
          className="secondary"
          onClick={() => onNavigate("/produtor/reembolsos")}
        >
          Reembolsos das vendas
        </button>
        <button className="text-button" onClick={refresh}>
          Atualizar
        </button>
      </nav>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Carregando suas vendas…</p>}
      {data && (
        <>
          <div className="hvm-sale-summary">
            {[
              ["Vendas confirmadas", String(data.summary.saleCount)],
              ["Total vendido", money(data.summary.grossCents)],
              ["Reembolsado", money(data.summary.refundedCents)],
              ["Retido", money(data.summary.heldCents)],
              ["Em análise", money(data.summary.disputedCents)],
              ["Retenção encerrada", money(data.summary.releasedCents)],
            ].map(([label, value]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
          <p>
            Os valores refletem os registros de vendas e retenções. O repasse
            depende da confirmação do provedor de pagamento.
          </p>
          <label>
            Origem da venda
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Todas</option>
              <option value="online">Catálogo online</option>
              <option value="pos">Caixa presencial</option>
            </select>
          </label>
          {selected && (
            <button
              className="text-button"
              onClick={() => onNavigate("/produtor/vendas")}
            >
              Ver todas as vendas
            </button>
          )}
          {!data.sales.length && <p>Nenhuma venda confirmada neste filtro.</p>}
          <div className="commerce-grid">
            {data.sales.map((s) => (
              <article
                key={s.id}
                className={
                  "commerce-card " +
                  (selected === s.id ? "hvm-sale-selected" : "")
                }
              >
                <span className="eyebrow">
                  {s.source === "online"
                    ? "Catálogo online"
                    : "Caixa presencial"}
                </span>
                <h2>{s.orderNumber}</h2>
                <p>
                  {s.storeName} · {date(s.createdAt)}
                </p>
                <strong>{money(s.totalCents)}</strong>
                <p>
                  {financial[s.holdState] ?? "Situação financeira atualizada"}
                  {s.refundedCents > 0 &&
                    ` · ${money(s.refundedCents)} reembolsados`}
                </p>
                {s.fulfillmentStatus && (
                  <p>{ORDER_STATUS_LABELS[s.fulfillmentStatus]}</p>
                )}
                <ul>
                  {s.items.map((i, index) => (
                    <li key={i.productId + ":" + index}>
                      {i.quantity} × {i.title} · {money(i.totalPriceCents)}
                    </li>
                  ))}
                </ul>
                <div className="hvm-sales-links">
                  {s.source === "online" && (
                    <button
                      className="secondary"
                      onClick={() =>
                        onNavigate("/produtor/pedidos?orderId=" + s.id)
                      }
                    >
                      Gerenciar pedido da loja
                    </button>
                  )}
                  {s.openRefundId && (
                    <button
                      className="secondary"
                      onClick={() =>
                        onNavigate(
                          "/produtor/reembolsos?caseId=" + s.openRefundId,
                        )
                      }
                    >
                      Acompanhar reembolso da venda
                    </button>
                  )}
                  {s.storeSlug && (
                    <button
                      className="text-button"
                      onClick={() => onNavigate("/produtores/" + s.storeSlug)}
                    >
                      Ver avaliações da loja
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {data.pages > 1 && (
            <nav
              className="hvm-notification-pagination"
              aria-label="Páginas de vendas"
            >
              <button
                className="secondary"
                disabled={data.page === 1}
                onClick={() => setPage(data.page - 1)}
              >
                Anterior
              </button>
              <span>
                {data.page} de {data.pages}
              </span>
              <button
                className="secondary"
                disabled={data.page === data.pages}
                onClick={() => setPage(data.page + 1)}
              >
                Próxima
              </button>
            </nav>
          )}
          <h2>Revisões do caixa presencial</h2>
          <p>
            Revisões preparadas aguardam a confirmação do consumidor e do
            pagamento para se tornarem vendas.
          </p>
          {!data.posRevisions.length && <p>Nenhuma revisão recente.</p>}
          <div className="commerce-grid">
            {data.posRevisions.map((s) => (
              <article className="commerce-card" key={s.id}>
                <h3>
                  {s.status === "draft"
                    ? "Aguardando consumidor"
                    : s.status === "accepted"
                      ? "Aguardando pagamento"
                      : "Cancelada"}
                </h3>
                <strong>{money(s.totalCents)}</strong>
                <p>{date(s.createdAt)}</p>
                <button
                  className="secondary"
                  onClick={() => onNavigate("/produtor/caixa")}
                >
                  Abrir caixa do produtor
                </button>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

import { PageLoading } from "../../components/PageLoading";
import { useState } from "react";
import {
  ProducerRefundListSchema,
  ProducerRefundSchema,
} from "../../../shared/contracts/producerSales";
import { useOrderQuery } from "../../hooks/useOrderQuery";
import { money, date, statusLabels } from "../../lib/commerce";
import "../commerce/commerce.css";
import "../account/notifications.css";
export default function ProducerRefundsPage({
  userId,
  onNavigate,
}: {
  userId: string;
  onNavigate: (to: string) => void;
}) {
  const initial = new URLSearchParams(location.search).get("caseId");
  const [selectedId, setSelectedId] = useState<string | null>(initial),
    [page, setPage] = useState(1),
    [filter, setFilter] = useState("all");
  const list = useOrderQuery(
    `/v1/producer/refunds?page=${page}&filter=${filter}`,
    userId,
    ProducerRefundListSchema,
  );
  const detail = useOrderQuery(
    `/v1/producer/refunds/${selectedId ?? "none"}`,
    selectedId ? userId : null,
    ProducerRefundSchema,
  );
  return (
    <section className="hvm-commerce">
      <span className="eyebrow">Portal do produtor</span>
      <h1>Reembolsos das minhas vendas</h1>
      <p>
        Acompanhe os pedidos de reembolso de vendas da sua loja. A análise e as
        decisões são conduzidas entre o consumidor e a administração autorizada.
      </p>
      <nav className="hvm-sales-links" aria-label="Vendas e reembolsos">
        <button
          className="secondary"
          onClick={() => onNavigate("/produtor/vendas")}
        >
          Minhas vendas
        </button>
        <button
          className="text-button"
          onClick={() => {
            list.refresh();
            detail.refresh();
          }}
        >
          Atualizar
        </button>
      </nav>
      {(list.error || detail.error) && (
        <p role="alert">{list.error || detail.error}</p>
      )}
      <label>
        Situação
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">Todas</option>
          <option value="open">Em andamento</option>
          <option value="closed">Encerradas</option>
        </select>
      </label>
      {!list.data && !list.error && (
        <PageLoading label="Carregando reembolsos das vendas…" />
      )}
      {list.data && !list.data.cases.length && (
        <p>Nenhuma solicitação de reembolso neste filtro.</p>
      )}
      <div className="commerce-grid">
        {list.data?.cases.map((r) => (
          <article className="commerce-card" key={r.id}>
            <h2>{r.orderNumber}</h2>
            <p>{r.storeName}</p>
            <strong>{statusLabels[r.status] ?? r.status}</strong>
            <p>
              Solicitado: {money(r.requestedAmountCents)} · {date(r.createdAt)}
            </p>
            <button
              className="secondary"
              aria-pressed={selectedId === r.id}
              onClick={() => setSelectedId(r.id)}
            >
              Ver andamento
            </button>
          </article>
        ))}
      </div>
      {list.data && list.data.pages > 1 && (
        <nav
          className="hvm-notification-pagination"
          aria-label="Páginas de reembolsos"
        >
          <button
            className="secondary"
            disabled={list.data.page === 1}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </button>
          <span>
            {list.data.page} de {list.data.pages}
          </span>
          <button
            className="secondary"
            disabled={list.data.page === list.data.pages}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </button>
        </nav>
      )}
      {detail.data && (
        <article className="commerce-card">
          <h2>Andamento de {detail.data.orderNumber}</h2>
          <p>{statusLabels[detail.data.status] ?? detail.data.status}</p>
          <p>
            Valor solicitado: {money(detail.data.requestedAmountCents)}
            {detail.data.approvedAmountCents !== null &&
              ` · Valor aprovado: ${money(detail.data.approvedAmountCents)}`}
          </p>
          <h3>Etapas do processo</h3>
          <ol className="hvm-producer-refund-history">
            {detail.data.history.map((h, i) => (
              <li key={i}>
                <strong>{statusLabels[h.status] ?? h.status}</strong> ·{" "}
                {date(h.createdAt)}
              </li>
            ))}
          </ol>
          <h3>Contatos da administração</h3>
          <p>
            A equipe poderá enviar orientações sobre esta venda. Você acompanha
            o processo por esta tela.
          </p>
          {!detail.data.contacts.length && (
            <p>Nenhum contato da administração até o momento.</p>
          )}
          {detail.data.contacts.map((c) => (
            <div className="commerce-message" key={c.id}>
              <strong>Equipe responsável</strong>
              <p className="commerce-prewrap">{c.message}</p>
              <small>{date(c.createdAt)}</small>
            </div>
          ))}
          <button
            className="secondary"
            onClick={() =>
              onNavigate("/produtor/vendas?orderId=" + detail.data!.orderId)
            }
          >
            Ver venda relacionada
          </button>
        </article>
      )}
    </section>
  );
}

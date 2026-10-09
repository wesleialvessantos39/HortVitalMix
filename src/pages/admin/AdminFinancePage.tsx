import { useState } from "react";
import { Landmark } from "lucide-react";
import {
  AdminFinanceQuerySchema,
  AdminFinanceResponseSchema,
  type AdminFinanceQuery,
} from "../../../shared/contracts/adminOperations";
import { PageLoading } from "../../components/PageLoading";
import {
  localToday,
  money,
  number,
  when,
  OperationsError,
  OperationsHeader,
  OperationsMetrics,
  OperationsPagination,
  OperationsTable,
  OperationsTabs,
  OperationsUnavailable,
  useOperationsQuery,
  type AdminOperationsPageProps,
} from "./adminOperationsView";

const parse = (input: unknown) => AdminFinanceResponseSchema.parse(input);
const paymentLabels = {
  pending: "Pendente",
  approved: "Confirmado",
  failed: "Falhou",
  refunded: "Estornado",
};
const holdLabels = {
  held: "Retido",
  disputed: "Em disputa",
  refund_pending: "Estorno pendente",
  partially_refunded: "Estorno parcial",
  refunded: "Estornado",
  released: "Liberado",
};
const orderLabels = {
  confirmed: "Confirmado",
  received: "Recebido",
  refunded: "Estornado",
};
const methodLabels = {
  pix: "Pix",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
};
const sourceLabels = {
  online: "Compra online",
  pos: "Venda no caixa",
  subscription: "Assinatura",
};
function defaults(): AdminFinanceQuery {
  const to = localToday();
  return AdminFinanceQuerySchema.parse({
    from: new Date(Date.parse(to) - 29 * 86400000).toISOString().slice(0, 10),
    to,
  });
}
export function AdminFinancePage({
  access,
  onNavigate,
}: AdminOperationsPageProps) {
  const [filters, setFilters] = useState(defaults);
  const [draft, setDraft] = useState(defaults);
  const [filterError, setFilterError] = useState("");
  const path =
    "/v1/admin/finance/overview?" +
    new URLSearchParams(
      Object.entries(filters).map(([key, value]) => [key, String(value)]),
    );
  const query = useOperationsQuery(access, "finance_ops", path, parse);
  const changeView = (view: AdminFinanceQuery["view"]) => {
    setFilters((value) => ({ ...value, view, page: 1 }));
    setDraft((value) => ({ ...value, view, page: 1 }));
    setFilterError("");
  };
  if (!query.permitted)
    return <OperationsUnavailable onNavigate={onNavigate} />;
  const data = query.data;
  return (
    <section
      className="admin-page admin-ops-page"
      aria-labelledby="finance-page-title"
    >
      <OperationsHeader
        title="Financeiro"
        headingId="finance-page-title"
        description="Pagamentos e retenções comerciais, com os valores registrados no sistema."
        icon={Landmark}
        loading={query.loading}
        onRefresh={query.refresh}
      />
      <OperationsTabs
        value={filters.view}
        items={[
          { value: "payments", label: "Pagamentos" },
          { value: "orders", label: "Pedidos e retenções" },
        ]}
        onChange={changeView}
      />
      <form
        className="admin-card admin-ops-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = AdminFinanceQuerySchema.safeParse({
            ...draft,
            page: 1,
          });
          if (!parsed.success) {
            setFilterError(
              parsed.error.issues[0]?.message ??
                "Revise o período da consulta.",
            );
            return;
          }
          setFilters(parsed.data);
          setFilterError("");
        }}
      >
        <label>
          Data inicial
          <input
            type="date"
            required
            value={draft.from ?? ""}
            onChange={(event) =>
              setDraft((value) => ({ ...value, from: event.target.value }))
            }
          />
        </label>
        <label>
          Data final
          <input
            type="date"
            required
            value={draft.to ?? ""}
            min={draft.from}
            onChange={(event) =>
              setDraft((value) => ({ ...value, to: event.target.value }))
            }
          />
        </label>
        {filters.view === "payments" ? (
          <label>
            Situação do pagamento
            <select
              value={draft.paymentStatus}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  paymentStatus: event.target
                    .value as AdminFinanceQuery["paymentStatus"],
                }))
              }
            >
              <option value="all">Todas as situações</option>
              {Object.entries(paymentLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Situação da retenção
            <select
              value={draft.holdState}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  holdState: event.target
                    .value as AdminFinanceQuery["holdState"],
                }))
              }
            >
              <option value="all">Todas as situações</option>
              {Object.entries(holdLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="submit"
          className="admin-primary"
          disabled={query.loading}
        >
          Aplicar filtros
        </button>
        <p className="admin-ops-filter-note">
          Até 366 dias por consulta. Datas no fuso de Cuiabá.
        </p>
        {filterError && (
          <p className="admin-ops-filter-error" role="alert">
            {filterError}
          </p>
        )}
      </form>
      {query.error && (
        <OperationsError
          message={query.error}
          stale={Boolean(data)}
          onRetry={query.refresh}
          loading={query.loading}
        />
      )}
      {!data && !query.error && <PageLoading label="Carregando financeiro" />}
      {data && (
        <>
          <OperationsMetrics
            items={[
              {
                label: "Pagamentos confirmados",
                value: number(data.metrics.approvedPayments),
                note: "Cobranças aprovadas no período, incluindo assinaturas.",
              },
              {
                label: "Valor confirmado",
                value: money(data.metrics.approvedAmountCents),
                note: "Valor das cobranças aprovadas; não representa saldo bancário.",
              },
              {
                label: "Valores retidos",
                value: money(data.metrics.heldAmountCents),
                note: "Pedidos criados no período com retenção vigente, descontados os estornos.",
              },
              {
                label: "Valores liberados",
                value: money(data.metrics.releasedAmountCents),
                note: "Liberação registrada para pedidos do período; não confirma repasse bancário.",
              },
            ]}
          />
          <section
            className="admin-card admin-ops-records"
            aria-labelledby="finance-records-title"
          >
            <div className="admin-ops-records-heading">
              <h2 id="finance-records-title">
                {data.view === "payments"
                  ? "Pagamentos no período"
                  : "Pedidos e retenções no período"}
              </h2>
              <span>{number(data.pagination.total)} registros</span>
            </div>
            {data.pagination.total === 0 ? (
              <p className="admin-empty">
                Nenhum registro corresponde a este período e aos filtros
                selecionados.
              </p>
            ) : data.view === "payments" ? (
              <OperationsTable label="Pagamentos">
                <thead>
                  <tr>
                    <th>Referência e origem</th>
                    <th>Forma</th>
                    <th>Valor</th>
                    <th>Situação</th>
                    <th>Data e prazo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Referência e origem">
                        <strong>{sourceLabels[item.source]}</strong>
                        <small>{item.id}</small>
                        <small>
                          {number(item.orderCount)}{" "}
                          {item.orderCount === 1
                            ? "pedido vinculado"
                            : "pedidos vinculados"}
                        </small>
                      </td>
                      <td data-label="Forma">{methodLabels[item.method]}</td>
                      <td data-label="Valor">
                        <strong>{money(item.amountCents)}</strong>
                      </td>
                      <td data-label="Situação">
                        <span
                          className={"admin-ops-status status-" + item.status}
                        >
                          {paymentLabels[item.status]}
                        </span>
                        {item.status === "pending" &&
                          Date.parse(item.expiresAt) < Date.now() && (
                            <small>Prazo vencido</small>
                          )}
                      </td>
                      <td data-label="Data e prazo">
                        <time dateTime={item.createdAt}>
                          {when(item.createdAt)}
                        </time>
                        <small>Prazo: {when(item.expiresAt)}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </OperationsTable>
            ) : (
              <OperationsTable label="Pedidos e retenções">
                <thead>
                  <tr>
                    <th>Pedido e loja</th>
                    <th>Total do pedido</th>
                    <th>Retenção</th>
                    <th>Após estorno</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Pedido e loja">
                        <strong>Pedido #{item.orderNumber}</strong>
                        <small>{item.storeName}</small>
                        <small>{orderLabels[item.status]}</small>
                      </td>
                      <td data-label="Total do pedido">
                        {money(item.totalCents)}
                      </td>
                      <td data-label="Retenção">
                        <span className="admin-ops-status">
                          {item.holdState
                            ? holdLabels[item.holdState]
                            : "Sem retenção"}
                        </span>
                        {item.releaseAfter && (
                          <small>
                            Liberação prevista: {when(item.releaseAfter)}
                          </small>
                        )}
                      </td>
                      <td data-label="Após estorno">
                        <strong>{money(item.retainedCents)}</strong>
                        <small>Estornado: {money(item.refundedCents)}</small>
                      </td>
                      <td data-label="Data">
                        <time dateTime={item.createdAt}>
                          {when(item.createdAt)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </OperationsTable>
            )}
            <OperationsPagination
              pagination={data.pagination}
              loading={query.loading}
              onPage={(page) => setFilters((value) => ({ ...value, page }))}
            />
          </section>
          <p className="admin-ops-freshness">
            Atualizado em {when(data.generatedAt)}. Atualização automática a
            cada 30 segundos enquanto esta tela estiver aberta. Os indicadores
            representam todo o período; o filtro de situação restringe a lista.
          </p>
        </>
      )}
    </section>
  );
}

export default AdminFinancePage;

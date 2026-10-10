import { useState } from "react";
import { api } from "../../lib/api";
import { money, commerceMessage, statusLabels } from "../../lib/commerce";
import {
  FinanceRegistersResponseSchema,
  type FinanceRegister,
} from "../../../shared/contracts/departmentOperations";
import {
  useOperationsQuery,
  type AdminOperationsPageProps,
} from "./adminOperationsView";
import {
  AdminCommandConfirmation,
  useAdminConfirmedCommand,
} from "./useAdminConfirmedCommand";
import "../commerce/departmentExtensions.css";
const parse = (value: unknown) => FinanceRegistersResponseSchema.parse(value);
const names = {
  pos: "Caixas dos produtores (leitura)",
  subscriptions: "Ciclos de assinaturas",
  refunds: "Reembolsos de compras e assinaturas",
  payments: "Cobranças e pagamentos",
  orders: "Pedidos comerciais",
};
export function AdminFinanceRegisters({ access }: AdminOperationsPageProps) {
  const [view, setView] = useState<keyof typeof names>("pos"),
    [page, setPage] = useState(1),
    [search, setSearch] = useState("");
  const [selected, setSelected] = useState<FinanceRegister | null>(null),
    [status, setStatus] = useState("in_review"),
    [note, setNote] = useState(""),
    [error, setError] = useState("");
  const [from, setFrom] = useState(
      new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
    ),
    [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const query = useOperationsQuery(
    access,
    "finance_ops",
    `/v1/admin/finance/registers?view=${view}&page=${page}&search=${encodeURIComponent(search)}&from=${from}&to=${to}`,
    parse,
  );
  const command = useAdminConfirmedCommand(access.role, (e) =>
    setError(commerceMessage(e)),
  );
  function save(form: HTMLFormElement) {
    if (!selected || note.trim().length < 10) return;
    const id = crypto.randomUUID(),
      body = {
        targetType: view,
        targetId: selected.id,
        status,
        note,
        expectedRevision: selected.case?.revision ?? 0,
      };
    void command.run(async (signal) => {
      await api("/v1/admin/finance/cases", {
        method: "POST",
        headers: { "X-Command-Id": id },
        body: JSON.stringify(body),
        signal,
      });
      form.dispatchEvent(new Event("hvm:form-saved", { bubbles: true }));
      setSelected(null);
      setError("");
      query.refresh();
      window.dispatchEvent(new Event("hvm:departments-changed"));
    });
  }
  return (
    <section className="department-extension">
      <header>
        <div>
          <h2>Registros financeiros e conciliação</h2>
          <p>
            Leia os caixas dos produtores, ciclos, pagamentos e solicitações.
            Registrar uma conferência não movimenta dinheiro nem opera o caixa
            de outra conta.
          </p>
        </div>
        <button
          className="admin-secondary"
          disabled={query.loading || command.busy}
          onClick={query.refresh}
        >
          Atualizar consulta
        </button>
      </header>
      <div className="department-extension-actions" data-hvm-pwa-ui>
        <label>
          Origem
          <select
            value={view}
            onChange={(e) => {
              setView(e.target.value as keyof typeof names);
              setPage(1);
              setSelected(null);
            }}
          >
            {Object.entries(names).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Desde
          <input
            type="date"
            required
            value={from}
            max={to}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            required
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Buscar referência, nome ou identificador
          <input
            type="search"
            maxLength={80}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      {(query.error || error) && <p role="alert">{query.error || error}</p>}
      {query.data && (
        <>
          <p>
            {query.data.total} registros no período escolhido ·{" "}
            {query.data.pendingCases} conferências pendentes.{" "}
            {query.data.gatewayAvailable
              ? "Meio de pagamento conectado."
              : "Sem meio de pagamento conectado: consulta e conciliação disponíveis, cobrança e estorno aguardam integração."}
          </p>
          <div className="department-extension-grid">
            {query.data.rows.map((row) => (
              <article key={row.id}>
                <h3>{row.name}</h3>
                <p>
                  {row.reference} · {statusLabels[row.status] ?? row.status} ·{" "}
                  {money(row.amountCents)}
                </p>
                <time>{new Date(row.createdAt).toLocaleString("pt-BR")}</time>
                <p>
                  {row.case
                    ? `Conferência: ${row.case.status === "resolved" ? "Resolvida" : row.case.status === "in_review" ? "Em análise" : "Aberta"} — ${row.case.note}`
                    : "Sem conferência administrativa registrada."}
                </p>
                <button
                  className="admin-secondary"
                  disabled={command.busy}
                  onClick={() => {
                    setSelected(row);
                    setStatus(row.case?.status ?? "in_review");
                    setNote(row.case?.note ?? "");
                  }}
                >
                  Registrar ou resolver conferência
                </button>
              </article>
            ))}
          </div>
          {!query.data.rows.length && (
            <p role="status">
              Nenhum registro neste filtro. O departamento está pronto para
              receber as movimentações reais.
            </p>
          )}
          <nav aria-label="Páginas de registros financeiros">
            <button
              className="admin-secondary"
              disabled={page === 1 || command.busy}
              onClick={() => setPage((v) => v - 1)}
            >
              Anterior
            </button>
            <span>
              {page} de {query.data.pages}
            </span>
            <button
              className="admin-secondary"
              disabled={page >= query.data.pages || command.busy}
              onClick={() => setPage((v) => v + 1)}
            >
              Próxima
            </button>
          </nav>
        </>
      )}
      {selected && (
        <form
          data-hvm-update-busy="true"
          onSubmit={(e) => {
            e.preventDefault();
            save(e.currentTarget);
          }}
        >
          <h3>Conferência de {selected.reference}</h3>
          <label>
            Situação da conferência
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">Aberta</option>
              <option value="in_review">Em análise</option>
              <option value="resolved">Resolvida</option>
            </select>
          </label>
          <label>
            Conclusão ou providência
            <textarea
              minLength={10}
              maxLength={2000}
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="department-extension-actions">
            <button className="admin-primary" disabled={command.busy}>
              Salvar conferência
            </button>
            <button
              type="button"
              className="admin-secondary"
              disabled={command.busy}
              onClick={() => setSelected(null)}
            >
              Fechar
            </button>
          </div>
        </form>
      )}
      <AdminCommandConfirmation
        confirmation={command.confirmation}
        onConfirmed={command.confirm}
        onCancel={command.cancel}
      />
    </section>
  );
}

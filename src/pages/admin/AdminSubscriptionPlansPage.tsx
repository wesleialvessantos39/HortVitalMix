import { PageLoading } from "../../components/PageLoading";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api, type ApiFailure } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
import { money } from "../../lib/commerce";
import { subscriptionMessage, billingLabels } from "../../lib/subscriptions";
import {
  PlanInputSchema,
  type SubscriptionPlan,
} from "../../../shared/contracts/subscription";
import { AdminReauthentication } from "../../components/commerce/AdminReauthentication";
import { useSession } from "../../hooks/useSession";
import "../public/subscriptions.css";
type Draft = {
  slug: string;
  name: string;
  targetAudience: "consumer" | "producer";
  deliveriesPerWeek: number;
  price: string;
  billingPeriod: "weekly" | "biweekly" | "monthly";
  description: string;
  storeId: string;
  isActive: boolean;
};
const empty = (): Draft => ({
  slug: "",
  name: "",
  targetAudience: "consumer",
  deliveriesPerWeek: 1,
  price: "",
  billingPeriod: "monthly",
  description: "",
  storeId: "",
  isActive: false,
});
export default function AdminSubscriptionPlansPage() {
  const { session } = useSession(),
    [plans, setPlans] = useState<SubscriptionPlan[]>([]),
    [stores, setStores] = useState<Array<{ id: string; name: string }>>([]),
    [draft, setDraft] = useState<Draft>(empty),
    [editing, setEditing] = useState<SubscriptionPlan | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [reauth, setReauth] = useState(false),
    [loading, setLoading] = useState(true);
  const pending = useRef<{ key: string; id: string } | null>(null),
    flight = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const v = await api<{
        plans: SubscriptionPlan[];
        stores: Array<{ id: string; name: string }>;
      }>("/v1/admin/subscription-plans", { signal });
      if (!signal?.aborted) {
        setPlans(v.plans);
        setStores(v.stores);
      }
    } catch (e) {
      if (!signal?.aborted) setError(subscriptionMessage(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);
  function edit(p: SubscriptionPlan) {
    setEditing(p);
    setDraft({
      slug: p.slug,
      name: p.name,
      targetAudience: p.targetAudience,
      deliveriesPerWeek: p.deliveriesPerWeek,
      price: (p.priceCents / 100).toFixed(2),
      billingPeriod: p.billingPeriod,
      description: p.description,
      storeId: p.storeId ?? "",
      isActive: p.isActive,
    });
    setNotice("");
    setError("");
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (flight.current) return;
    setError("");
    setNotice("");
    const checked = PlanInputSchema.safeParse({
      slug: draft.slug,
      name: draft.name,
      targetAudience: draft.targetAudience,
      deliveriesPerWeek: draft.deliveriesPerWeek,
      priceCents: Math.round(Number(draft.price.replace(",", ".")) * 100),
      billingPeriod: draft.billingPeriod,
      description: draft.description,
      storeId: draft.targetAudience === "consumer" ? draft.storeId : null,
      isActive: draft.isActive,
    });
    if (!checked.success || !/^\d+(?:[.,]\d{1,2})?$/.test(draft.price)) {
      setError("Confira nome, identificador, preço, loja e frequência.");
      return;
    }
    const path =
        "/v1/admin/subscription-plans" + (editing ? "/" + editing.id : ""),
      body = editing
        ? { plan: checked.data, expectedRevision: editing.revision }
        : checked.data,
      key = path + JSON.stringify(body);
    if (pending.current?.key !== key)
      pending.current = { key, id: cryptoRandomUUID() };
    flight.current = true;
    setBusy(true);
    try {
      await api(path, {
        method: editing ? "PATCH" : "POST",
        headers: { "X-Command-Id": pending.current.id },
        body: JSON.stringify(body),
      });
      pending.current = null;
      setEditing(null);
      setDraft(empty());
      setNotice(
        "Plano salvo. Contratos existentes mantêm as condições contratadas.",
      );
      await load();
    } catch (e) {
      if ((e as ApiFailure).message === "ADMIN_REAUTHENTICATION_REQUIRED")
        setReauth(true);
      else if (
        (e as ApiFailure).status &&
        ((e as ApiFailure).status ?? 0) < 500
      )
        pending.current = null;
      setError(subscriptionMessage(e));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="subscription-admin">
      <header>
        <span className="eyebrow">Monetização rural</span>
        <h1>Planos de assinatura</h1>
        <p>
          Defina nomes, preços e frequências antes de publicar. A cobrança Pix
          utiliza a conta de recebimento já configurada.
        </p>
      </header>
      {loading && !plans.length && <PageLoading label="Carregando planos…" />}
      {error && (
        <p role="alert" className="subscription-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="subscription-notice">
          {notice}
        </p>
      )}
      {reauth && session && (
        <AdminReauthentication
          session={session}
          onConfirmed={() => {
            setReauth(false);
            setError("");
          }}
        />
      )}
      <form className="subscription-card" onSubmit={save}>
        <h2>{editing ? "Editar plano" : "Novo plano"}</h2>
        <div className="subscription-admin-form">
          <label>
            Nome do plano
            <input
              required
              maxLength={128}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Identificador
            <input
              required
              maxLength={64}
              placeholder="cesta-semanal"
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            />
          </label>
          <label>
            Público
            <select
              aria-label="Público"
              value={draft.targetAudience}
              onChange={(e) => {
                const targetAudience = e.target
                  .value as Draft["targetAudience"];
                setDraft({
                  ...draft,
                  targetAudience,
                  deliveriesPerWeek: targetAudience === "producer" ? 0 : 1,
                  storeId: "",
                });
              }}
            >
              <option value="consumer">Consumidor</option>
              <option value="producer">Produtor</option>
            </select>
          </label>
          <label>
            Preço por ciclo (R$)
            <input
              required
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            />
          </label>
          <label>
            Período da cobrança
            <select
              aria-label="Período da cobrança"
              value={draft.billingPeriod}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  billingPeriod: e.target.value as Draft["billingPeriod"],
                })
              }
            >
              <option value="weekly">Semanal</option>
              <option value="biweekly">Quinzenal</option>
              <option value="monthly">Mensal</option>
            </select>
          </label>
          {draft.targetAudience === "consumer" && (
            <>
              <label>
                Loja responsável
                <select
                  aria-label="Loja responsável"
                  required
                  value={draft.storeId}
                  onChange={(e) =>
                    setDraft({ ...draft, storeId: e.target.value })
                  }
                >
                  <option value="">Selecione uma loja</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Entregas por semana
                <input
                  type="number"
                  min="1"
                  max="7"
                  required
                  value={draft.deliveriesPerWeek}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      deliveriesPerWeek: Number(e.target.value),
                    })
                  }
                />
              </label>
            </>
          )}
          <label className="subscription-description">
            Descrição e benefícios
            <textarea
              required
              maxLength={2000}
              rows={4}
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </label>
          <label className="subscription-checkbox">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) =>
                setDraft({ ...draft, isActive: e.target.checked })
              }
            />
            Disponível para novas assinaturas
          </label>
        </div>
        <div className="subscription-actions">
          <button className="admin-primary" disabled={busy || reauth}>
            {busy ? "Salvando…" : "Salvar plano"}
          </button>
          {editing && (
            <button
              type="button"
              className="admin-secondary"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setDraft(empty());
              }}
            >
              Cancelar edição
            </button>
          )}
        </div>
      </form>
      <div className="subscription-grid">
        {plans.map((p) => (
          <article key={p.id} className="subscription-card">
            <h2>{p.name}</h2>
            <p>
              {p.targetAudience === "consumer" ? "Consumidor" : "Produtor"} ·{" "}
              {p.isActive ? "Publicado" : "Inativo"}
            </p>
            <p>
              {money(p.priceCents)} por {billingLabels[p.billingPeriod]}
            </p>
            <p>{p.description}</p>
            <button
              className="admin-secondary"
              disabled={busy}
              onClick={() => edit(p)}
            >
              Editar {p.name}
            </button>
          </article>
        ))}
      </div>
      {!loading && !plans.length && (
        <p>Nenhum plano foi definido. Cadastre o primeiro acima.</p>
      )}
    </section>
  );
}

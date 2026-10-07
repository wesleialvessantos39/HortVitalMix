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
import {
  billingLabels,
  subscriptionLabels,
  subscriptionMessage,
} from "../../lib/subscriptions";
import { weekdays } from "../../lib/deliveryLogistics";
import type { ShellSession } from "../../hooks/useSession";
import type {
  SubscriptionPlan,
  SubscriptionView,
  SubscriptionOptions,
} from "../../../shared/contracts/subscription";
import type { AddressAdvancedView } from "../../../shared/contracts/addressAdvanced";
import type { PaymentView } from "../../../shared/contracts/commerce";
import "./subscriptions.css";
type Recurrence = {
  dayOfWeek: number;
  preferredWindowId: string;
  basketTemplate: string[];
};
export default function SubscriptionPlansPage({
  audience,
  session,
  onNavigate,
  onlyMine = false,
}: {
  audience: "consumer" | "producer";
  session: ShellSession | null;
  onNavigate: (path: string) => void;
  onlyMine?: boolean;
}) {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]),
    [subscriptions, setSubscriptions] = useState<SubscriptionView[]>([]),
    [gateway, setGateway] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState<SubscriptionPlan | null>(null),
    [addresses, setAddresses] = useState<AddressAdvancedView[]>([]),
    [address, setAddress] = useState(""),
    [options, setOptions] = useState<SubscriptionOptions>({
      windows: [],
      products: [],
    }),
    [recurrences, setRecurrences] = useState<Recurrence[]>([]),
    [busy, setBusy] = useState(false),
    [confirmedCancel, setConfirmedCancel] = useState<string | null>(null);
  const flight = useRef(false),
    pending = useRef<{ key: string; id: string } | null>(null);
  const owner = session?.activeRole === audience;
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      const requests = [
        api<{ plans: SubscriptionPlan[]; gatewayAvailable: boolean }>(
          "/v1/subscription-plans?audience=" + audience,
          { signal },
        ).then((v) => {
          if (!signal?.aborted) {
            setPlans(v.plans);
            setGateway(v.gatewayAvailable);
          }
        }),
      ];
      if (owner)
        requests.push(
          api<{ subscriptions: SubscriptionView[]; gatewayAvailable: boolean }>(
            "/v1/subscriptions",
            { signal },
          ).then((v) => {
            if (!signal?.aborted) {
              setSubscriptions(
                v.subscriptions.filter(
                  (s) => s.plan.targetAudience === audience,
                ),
              );
              setGateway(v.gatewayAvailable);
            }
          }),
        );
      try {
        await Promise.all(requests);
      } catch (e) {
        if (!signal?.aborted) setError(subscriptionMessage(e));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [audience, owner, session?.userId],
  );
  useEffect(() => {
    const c = new AbortController();
    setSubscriptions([]);
    setError("");
    void load(c.signal);
    return () => c.abort();
  }, [load]);
  useEffect(() => {
    if (!selected || selected.targetAudience !== "consumer") return;
    const c = new AbortController();
    setOptions({ windows: [], products: [] });
    setAddresses([]);
    void Promise.all([
      api<SubscriptionOptions>("/v1/subscription-options/" + selected.storeId, {
        signal: c.signal,
      }),
      api<{ addresses: AddressAdvancedView[] }>("/v1/account/addresses", {
        signal: c.signal,
      }),
    ])
      .then(([o, a]) => {
        if (!c.signal.aborted) {
          setOptions(o);
          setAddresses(a.addresses);
          setAddress(
            a.addresses.find((x) => x.isDefault)?.id ??
              a.addresses[0]?.id ??
              "",
          );
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(subscriptionMessage(e));
      });
    return () => c.abort();
  }, [selected?.id]);
  async function mutate<T = SubscriptionView>(path: string, body: unknown) {
    if (flight.current) return null;
    flight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const payload = JSON.stringify(body),
      key = path + payload;
    if (pending.current?.key !== key)
      pending.current = { key, id: cryptoRandomUUID() };
    try {
      const result = await api<T>(path, {
        method: "POST",
        headers: { "X-Command-Id": pending.current.id },
        body: payload,
      });
      pending.current = null;
      await load();
      return result;
    } catch (e) {
      const status = (e as ApiFailure).status;
      if (status && status >= 400 && status < 500) pending.current = null;
      setError(subscriptionMessage(e));
      await load();
      return null;
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  function choose(plan: SubscriptionPlan) {
    if (!owner) {
      onNavigate(
        "/entrar/" + (audience === "producer" ? "produtor" : "consumidor"),
      );
      return;
    }
    setSelected(plan);
    setError("");
    setRecurrences(
      Array.from({ length: plan.deliveriesPerWeek }, () => ({
        dayOfWeek: 0,
        preferredWindowId: "",
        basketTemplate: [],
      })),
    );
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const body =
      audience === "consumer"
        ? {
            planId: selected.id,
            deliveryAddressId: address,
            recurrence: recurrences[0],
            additionalRecurrences: recurrences.slice(1),
          }
        : { planId: selected.id };
    if (await mutate("/v1/subscriptions", body)) {
      setSelected(null);
      setNotice(
        "Assinatura registrada. Cada ciclo Pix é confirmado separadamente; não há débito automático.",
      );
    }
  }
  async function bill(s: SubscriptionView) {
    const result = await mutate<{
      payment: PaymentView | null;
      subscription: SubscriptionView;
    }>(`/v1/subscriptions/${s.id}/billing`, {});
    if (result?.payment?.id) onNavigate("/pagamentos/" + result.payment.id);
    else if (result)
      setNotice(
        result.subscription.plan.priceCents === 0
          ? "Ciclo gratuito registrado, sem cobrança Pix."
          : "Ciclo já faturado. Consulte o histórico de pagamentos.",
      );
  }
  const mine = owner && subscriptions.length > 0;
  return (
    <section className="subscription-page">
      <header>
        <span className="eyebrow">
          {audience === "producer"
            ? "Clube do produtor"
            : "Do campo para sua rotina"}
        </span>
        <h1>
          {onlyMine
            ? "Minhas assinaturas"
            : audience === "producer"
              ? "Planos do produtor"
              : "Clube de hortifrúti"}
        </h1>
        <p>
          {audience === "producer"
            ? "Seu trial é gratuito por 30 dias e concedido uma única vez. Escolha o plano adequado para o período seguinte."
            : "Escolha a loja, sua cesta e os horários preferidos para as entregas da semana."}
        </p>
      </header>
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
      {loading && <p role="status">Carregando assinaturas…</p>}
      {!gateway && (
        <p className="subscription-notice">
          O recebimento Pix ainda está em preparação. Planos pagos podem ser
          consultados; a cobrança estará disponível quando a conta de
          recebimento for conectada.
        </p>
      )}
      {!onlyMine && (
        <>
          <div className="subscription-grid">
            {plans.map((p) => (
              <article className="subscription-card" key={p.id}>
                <h2>{p.name}</h2>
                {p.storeName && <p>{p.storeName}</p>}
                <p className="subscription-price">
                  {money(p.priceCents)}{" "}
                  <small>por {billingLabels[p.billingPeriod]}</small>
                </p>
                <p>{p.description}</p>
                {audience === "consumer" && (
                  <p>
                    {p.deliveriesPerWeek}{" "}
                    {p.deliveriesPerWeek === 1 ? "entrega" : "entregas"} por
                    semana
                  </p>
                )}
                <button
                  className="primary"
                  disabled={
                    busy ||
                    subscriptions.some(
                      (s) => s.plan.id === p.id && s.status !== "cancelled",
                    )
                  }
                  onClick={() => choose(p)}
                >
                  {subscriptions.some(
                    (s) => s.plan.id === p.id && s.status !== "cancelled",
                  )
                    ? "Você já tem este plano"
                    : "Escolher plano"}
                </button>
              </article>
            ))}
          </div>
          {!loading && !plans.length && (
            <div className="subscription-card">
              <h2>Novos planos em preparação</h2>
              <p>
                Os planos estarão aqui assim que os preços e as condições forem
                definidos. Suas assinaturas existentes continuam disponíveis
                abaixo.
              </p>
            </div>
          )}
          {audience === "consumer" && (
            <aside className="subscription-card">
              <h2>Você é produtor?</h2>
              <p>
                Conheça seu período gratuito e os planos para produtores em um
                espaço próprio.
              </p>
              <button
                className="secondary"
                onClick={() => onNavigate("/produtor/assinaturas")}
              >
                Conhecer o clube do produtor
              </button>
            </aside>
          )}
        </>
      )}
      {selected && (
        <form className="subscription-card" onSubmit={create}>
          <h2>Configurar {selected.name}</h2>
          <p>
            {money(selected.priceCents)} por{" "}
            {billingLabels[selected.billingPeriod]}. Cada ciclo exige sua
            confirmação Pix.
          </p>
          {audience === "consumer" && (
            <>
              <label>
                Endereço de entrega
                <select
                  aria-label="Endereço de entrega"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                >
                  <option value="">Escolha seu endereço</option>
                  {addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} — {a.street}, {a.number}
                    </option>
                  ))}
                </select>
              </label>
              {!addresses.length && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onNavigate("/conta/enderecos")}
                >
                  Cadastrar endereço
                </button>
              )}
              {recurrences.map((r, index) => (
                <fieldset key={index}>
                  <legend>Entrega semanal {index + 1}</legend>
                  <label>
                    Horário preferencial
                    <select
                      aria-label={`Horário preferencial da entrega ${index+1}`}
                      required
                      value={r.preferredWindowId}
                      onChange={(e) => {
                        const w = options.windows.find(
                          (x) => x.id === e.target.value,
                        );
                        setRecurrences((all) =>
                          all.map((x, i) =>
                            i === index
                              ? {
                                  ...x,
                                  preferredWindowId: w?.id ?? "",
                                  dayOfWeek: w?.dayOfWeek ?? 0,
                                }
                              : x,
                          ),
                        );
                      }}
                    >
                      <option value="">Escolha o dia e horário</option>
                      {options.windows.map((w) => (
                        <option
                          key={w.id}
                          value={w.id}
                          disabled={recurrences.some(
                            (x, i) =>
                              i !== index &&
                              x.preferredWindowId &&
                              x.dayOfWeek === w.dayOfWeek,
                          )}
                        >
                          {weekdays[w.dayOfWeek]} · {w.startTime}–{w.endTime}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>Produtos preferidos</p>
                  <div className="subscription-products">
                    {options.products.map((p) => (
                      <label className="subscription-checkbox" key={p.id}>
                        <input
                          type="checkbox"
                          checked={r.basketTemplate.includes(p.id)}
                          onChange={(e) =>
                            setRecurrences((all) =>
                              all.map((x, i) =>
                                i === index
                                  ? {
                                      ...x,
                                      basketTemplate: e.target.checked
                                        ? [...x.basketTemplate, p.id]
                                        : x.basketTemplate.filter(
                                            (id) => id !== p.id,
                                          ),
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                        {p.title}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <p>
                Os horários são preferências. Cada entrega precisa ter seu
                pedido confirmado e agendado pela loja.
              </p>
            </>
          )}
          <div className="subscription-actions">
            <button
              className="primary"
              disabled={
                busy ||
                (audience === "consumer" &&
                  (!address ||
                    recurrences.some(
                      (r) => !r.preferredWindowId || !r.basketTemplate.length,
                    )))
              }
            >
              Confirmar assinatura
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Voltar aos planos
            </button>
          </div>
        </form>
      )}
      {owner && (
        <section>
          <h2>Minhas assinaturas</h2>
          {!loading && !mine && (
            <p>Você ainda não tem assinaturas neste portal.</p>
          )}
          <div className="subscription-grid">
            {subscriptions.map((s) => (
              <article className="subscription-card" key={s.id}>
                <h3>{s.plan.name}</h3>
                <p>
                  <strong>{subscriptionLabels[s.status]}</strong> ·{" "}
                  {money(s.plan.priceCents)} por{" "}
                  {billingLabels[s.plan.billingPeriod]}
                </p>
                <p>
                  Período:{" "}
                  {new Date(s.currentPeriodStart).toLocaleDateString("pt-BR")} a{" "}
                  {new Date(s.currentPeriodEnd).toLocaleDateString("pt-BR")}
                </p>
                {s.pauseUntil && (
                  <p>
                    Pausa limitada até{" "}
                    {new Date(s.pauseUntil).toLocaleDateString("pt-BR")}. Ciclos
                    já faturados são preservados.
                  </p>
                )}
                {s.recurrences.map((r) => (
                  <p key={r.id}>
                    {weekdays[r.dayOfWeek]} · {r.window.startTime}–
                    {r.window.endTime}
                    {!r.isActive ? " · recorrência suspensa" : ""}
                    {!r.preferredWindowId
                      ? " · horário removido pela loja"
                      : ""}
                  </p>
                ))}
                <div className="subscription-actions">
                  {s.status === "active" && (
                    <button
                      className="secondary"
                      disabled={
                        busy ||
                        (!!s.pauseUntil &&
                          Date.parse(s.pauseUntil) > Date.now())
                      }
                      onClick={() =>
                        void mutate(`/v1/subscriptions/${s.id}/pause`, {
                          expectedRevision: s.revision,
                        })
                      }
                    >
                      Pausar por até 14 dias
                    </button>
                  )}
                  {s.status === "paused" && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void mutate(`/v1/subscriptions/${s.id}/resume`, {
                          expectedRevision: s.revision,
                        })
                      }
                    >
                      Retomar entregas
                    </button>
                  )}
                  {s.status !== "cancelled" && s.status !== "trialing" && (
                    <button
                      className="primary"
                      disabled={busy || (s.plan.priceCents > 0 && !gateway)}
                      onClick={() => void bill(s)}
                    >
                      {s.plan.priceCents === 0
                        ? "Registrar ciclo gratuito"
                        : "Gerar Pix do ciclo"}
                    </button>
                  )}
                  {s.status !== "cancelled" && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => setConfirmedCancel(s.id)}
                    >
                      Cancelar assinatura
                    </button>
                  )}
                </div>
                {confirmedCancel === s.id && (
                  <div className="subscription-notice">
                    <p>
                      Cancelar impede novas recorrências e ciclos. Cobranças já
                      faturadas não são anuladas.
                    </p>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        void mutate(`/v1/subscriptions/${s.id}/cancel`, {
                          expectedRevision: s.revision,
                        }).then((r) => {
                          if (r) setConfirmedCancel(null);
                        });
                      }}
                    >
                      Confirmar cancelamento
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setConfirmedCancel(null)}
                    >
                      Manter assinatura
                    </button>
                  </div>
                )}
                {s.cycles.length > 0 && (
                  <ul className="subscription-cycles">
                    {s.cycles.map((c) => (
                      <li key={c.id}>
                        Ciclo {c.cycleIndex} · {money(c.amountCents)} ·{" "}
                        {c.status === "paid"
                          ? "Pago"
                          : c.status === "pending"
                            ? "Pendente"
                            : c.status === "failed"
                              ? "Não concluído"
                              : "Reembolsado"}
                        {c.paymentCreationState === "uncertain" &&
                          " · em conferência"}
                        {c.paymentIntentId && (
                          <button
                            className="text-button"
                            onClick={() =>
                              onNavigate("/pagamentos/" + c.paymentIntentId)
                            }
                          >
                            Ver pagamento
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      {onlyMine && !owner && (
        <div className="subscription-card">
          <p>
            Entre no portal{" "}
            {audience === "producer" ? "do produtor" : "do consumidor"} para
            consultar suas assinaturas.
          </p>
          <button
            className="primary"
            onClick={() =>
              onNavigate(
                "/entrar/" +
                  (audience === "producer" ? "produtor" : "consumidor"),
              )
            }
          >
            Entrar
          </button>
        </div>
      )}
    </section>
  );
}

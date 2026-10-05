import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ArrowLeft, MapPin, Truck } from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import { cryptoRandomUUID as newUuid } from "../../lib/uuid";
import type { ShellSession } from "../../hooks/useSession";
import DeliveryEligibilityBadge from "../../components/DeliveryEligibilityBadge";
import {
  DeliverySettingsResponseSchema,
  SaveDeliverySettingsSchema,
  type DeliverySettings,
  type SaveDeliverySettings,
} from "../../../shared/contracts/delivery";
import "./products.css";
import "./deliveryArea.css";

type Draft = {
  radius: string;
  active: boolean;
  base: string;
  perKm: string;
  minimum: string;
  freeAbove: string;
  hours: string;
};
const fromSettings = (value: DeliverySettings): Draft => ({
  radius: String(value.serviceArea?.radiusKm ?? 15),
  active: value.serviceArea?.isActive ?? true,
  base: (value.rules.baseFeeCents / 100).toFixed(2),
  perKm: (value.rules.feePerKmCents / 100).toFixed(2),
  minimum: (value.rules.minOrderCents / 100).toFixed(2),
  freeAbove:
    value.rules.freeDeliveryThresholdCents === null
      ? ""
      : (value.rules.freeDeliveryThresholdCents / 100).toFixed(2),
  hours: String(value.rules.estimatedPrepHours),
});
const moneyCents = (text: string) =>
  /^\d+(?:[.,]\d{1,2})?$/.test(text)
    ? Math.round(Number(text.replace(",", ".")) * 100)
    : NaN;
const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function errorMessage(error: unknown) {
  const messages: Record<string, string> = {
    DELIVERY_ORIGIN_REQUIRED:
      "Ative sua loja com um imóvel aprovado e GPS da sede para configurar a entrega.",
    DELIVERY_REVISION_CONFLICT:
      "A configuração mudou em outro dispositivo. Seus campos foram preservados. Recarregue os dados antes de salvar novamente.",
    DELIVERY_COMMAND_CONFLICT:
      "Esta solicitação já foi usada com outros dados. Recarregue a configuração para continuar.",
    DELIVERY_VALIDATION_FAILED:
      "Revise o raio, as tarifas e o prazo de preparo.",
    VALIDATION_ERROR: "Revise o raio, as tarifas e o prazo de preparo.",
    PRODUCER_PROFILE_REQUIRED: "Entre com a conta de produtor titular da loja.",
  };
  return (
    messages[(error as ApiFailure).message] ??
    "Não foi possível concluir agora. Seus campos foram preservados. Tente novamente."
  );
}
export default function ProducerDeliveryAreaPage({
  session,
  onNavigate,
}: {
  session: ShellSession;
  onNavigate: (path: string) => void;
}) {
  const [settings, setSettings] = useState<DeliverySettings | null>(null),
    [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false),
    [reauth, setReauth] = useState(false),
    [password, setPassword] = useState(""),
    [reauthError, setReauthError] = useState("");
  const command = useRef<{ fingerprint: string; id: string } | null>(null),
    pending = useRef<SaveDeliverySettings | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError("");
    try {
      const value = DeliverySettingsResponseSchema.parse(
        await api("/v1/producer/store/delivery", { signal }),
      );
      if (signal?.aborted) return;
      setSettings(value);
      setDraft(fromSettings(value));
      setConflict(false);
      setError("");
      command.current = null;
    } catch (e) {
      if (!signal?.aborted) setLoadError(errorMessage(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    return () => abort.abort();
  }, [load, session.userId]);
  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((old) => (old ? { ...old, [key]: value } : old));
    setNotice("");
  }
  async function execute(input: SaveDeliverySettings) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = DeliverySettingsResponseSchema.parse(
        await api("/v1/producer/store/delivery", {
          method: "PUT",
          body: JSON.stringify(input),
        }),
      );
      setSettings(saved);
      setDraft(fromSettings(saved));
      pending.current = null;
      command.current = null;
      setReauth(false);
      setPassword("");
      setConflict(false);
      setNotice(
        "Área de entrega e tarifas salvas. A distância até Ariquemes foi confirmada.",
      );
    } catch (e) {
      const fault = e as ApiFailure;
      if (["AUTH_REQUIRED", "RECENT_AUTH_REQUIRED"].includes(fault.message)) {
        pending.current = input;
        setReauth(true);
      } else {
        setError(errorMessage(e));
        if (fault.message === "DELIVERY_REVISION_CONFLICT") setConflict(true);
      }
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !settings) return;
    const fields = {
      expectedRevision: settings.revision,
      radiusKm: Number(draft.radius),
      isActive: draft.active,
      rules: {
        baseFeeCents: moneyCents(draft.base),
        feePerKmCents: moneyCents(draft.perKm),
        minOrderCents: moneyCents(draft.minimum),
        freeDeliveryThresholdCents:
          draft.freeAbove.trim() === "" ? null : moneyCents(draft.freeAbove),
        estimatedPrepHours: Number(draft.hours),
      },
    };
    const fingerprint = JSON.stringify(fields);
    if (command.current?.fingerprint !== fingerprint)
      command.current = { fingerprint, id: newUuid() };
    const input = SaveDeliverySettingsSchema.safeParse({
      ...fields,
      commandId: command.current.id,
    });
    if (!input.success) {
      setError(
        "Informe raio de 1 a 150 km, tarifas válidas e preparo em horas inteiras positivas. Frete grátis deve ter um valor maior que zero ou ficar em branco.",
      );
      return;
    }
    await execute(input.data);
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setReauthError("");
    try {
      const restored = await api<ShellSession>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: session.email,
          password,
          portalRole: "producer",
        }),
      });
      if (restored.userId !== session.userId) throw Error("IDENTITY_MISMATCH");
      window.dispatchEvent(new CustomEvent("hvm:session-changed"));
      setPassword("");
      if (pending.current) await execute(pending.current);
    } catch {
      setReauthError("Não foi possível confirmar sua senha. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  const disabled = busy || reauth || loading || !settings?.canConfigure;
  const distance = settings?.ariquemesDistanceKm;
  const covers =
    distance !== null &&
    distance !== undefined &&
    draft !== null &&
    distance <= Number(draft.radius);
  const dirty =
    settings &&
    draft &&
    JSON.stringify(draft) !== JSON.stringify(fromSettings(settings));
  return (
    <section className="hvm-products hvm-delivery-area">
      <button
        className="text-button"
        onClick={() => onNavigate("/produtor/loja")}
      >
        <ArrowLeft size={17} /> Minha loja
      </button>
      <header className="hvm-products-heading">
        <div>
          <p className="eyebrow">Da sua chácara até o cliente</p>
          <h1>Área de entrega e frete</h1>
          <p>Defina até onde você entrega e as tarifas da sua loja.</p>
        </div>
        <Truck size={34} aria-hidden="true" />
      </header>
      {loading ? (
        <p role="status">Carregando a área de entrega…</p>
      ) : loadError ? (
        <div className="delivery-notice" role="alert">
          <p>{loadError}</p>
          <button className="secondary" onClick={() => void load()}>
            Tentar novamente
          </button>
        </div>
      ) : !settings?.store ? (
        <div className="delivery-notice">
          <h2>Configure sua loja primeiro</h2>
          <p>
            A área de entrega pertence à sua loja e usa a sede do imóvel
            vinculado.
          </p>
          <button
            className="primary"
            onClick={() => onNavigate("/produtor/loja")}
          >
            Configurar minha loja
          </button>
        </div>
      ) : draft ? (
        <>
          <div className="delivery-origin">
            <MapPin size={22} aria-hidden="true" />
            <div>
              <h2>Origem da entrega</h2>
              {settings.origin ? (
                <>
                  <p>{settings.origin.propertyName}</p>
                  <p className="muted">
                    GPS da sede já cadastrado:{" "}
                    {settings.origin.centerLatitude.toFixed(5)},{" "}
                    {settings.origin.centerLongitude.toFixed(5)}
                  </p>
                </>
              ) : (
                <p>O imóvel da loja precisa ter o GPS da sede cadastrado.</p>
              )}
            </div>
          </div>
          {!settings.canConfigure && (
            <p className="delivery-notice" role="status">
              Ative sua loja com um imóvel aprovado e GPS da sede para
              configurar a entrega.
            </p>
          )}
          {notice && (
            <p className="delivery-success" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="delivery-notice" role="alert">
              {error}
            </p>
          )}
          {conflict && (
            <button
              className="secondary"
              disabled={busy || reauth}
              onClick={() => void load()}
            >
              Recarregar configuração
            </button>
          )}
          <form onSubmit={save} className="delivery-form">
            <fieldset disabled={disabled}>
              <legend>Alcance da entrega</legend>
              <label htmlFor="delivery-radius">
                Raio de entrega <strong>{draft.radius} km</strong>
              </label>
              <input
                id="delivery-radius"
                type="range"
                min="1"
                max="150"
                step="1"
                value={draft.radius}
                onChange={(e) => patch("radius", e.target.value)}
                aria-describedby="delivery-distance-note"
              />
              <div className="delivery-range-scale" aria-hidden="true">
                <span>1 km</span>
                <span>150 km</span>
              </div>
              <p id="delivery-distance-note" className="muted">
                Distância em linha reta a partir da sede. A rota por estrada
                pode ser maior.
              </p>
              {distance !== null && distance !== undefined && (
                <div className="delivery-reference">
                  <h3>Referência: centro de Ariquemes</h3>
                  <p>
                    A sede está a{" "}
                    {distance.toLocaleString("pt-BR", {
                      maximumFractionDigits: 2,
                    })}{" "}
                    km do centro.
                  </p>
                  <DeliveryEligibilityBadge isEligible={covers} />
                  <p className="muted">
                    A entrega de cada cliente depende da localização do endereço
                    cadastrado.
                  </p>
                </div>
              )}
              <label className="delivery-toggle">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => patch("active", e.target.checked)}
                />{" "}
                Entrega habilitada nesta área
              </label>
            </fieldset>
            <fieldset disabled={disabled}>
              <legend>Tarifas e preparo</legend>
              <div className="delivery-fields">
                <label>
                  Taxa base (R$)
                  <input
                    inputMode="decimal"
                    value={draft.base}
                    onChange={(e) => patch("base", e.target.value)}
                    required
                  />
                </label>
                <label>
                  Valor por km (R$)
                  <input
                    inputMode="decimal"
                    value={draft.perKm}
                    onChange={(e) => patch("perKm", e.target.value)}
                    required
                  />
                </label>
                <label>
                  Pedido mínimo para entrega (R$)
                  <input
                    inputMode="decimal"
                    value={draft.minimum}
                    onChange={(e) => patch("minimum", e.target.value)}
                    required
                  />
                </label>
                <div className="delivery-field">
                  <label htmlFor="delivery-free-threshold">
                    Frete grátis a partir de (R$)
                  </label>
                  <input
                    id="delivery-free-threshold"
                    aria-describedby="delivery-free-help"
                    inputMode="decimal"
                    value={draft.freeAbove}
                    onChange={(e) => patch("freeAbove", e.target.value)}
                    placeholder="Opcional"
                  />
                  <span className="muted" id="delivery-free-help">
                    Deixe em branco para não oferecer frete grátis.
                  </span>
                </div>
                <label>
                  Preparo estimado (horas)
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={draft.hours}
                    onChange={(e) => patch("hours", e.target.value)}
                    required
                  />
                </label>
              </div>
              <p className="delivery-formula">
                Frete = taxa base + distância em km × valor por km, arredondado
                em centavos.
              </p>
              {Number.isFinite(moneyCents(draft.base)) &&
                Number.isFinite(moneyCents(draft.perKm)) && (
                  <p className="muted">
                    Exemplo para 10 km:{" "}
                    {brl(moneyCents(draft.base) + 10 * moneyCents(draft.perKm))}
                    , antes de eventual frete grátis.
                  </p>
                )}
            </fieldset>
            <div className="delivery-actions">
              <button
                className="primary"
                type="submit"
                disabled={disabled || conflict}
              >
                {busy ? "Salvando…" : "Salvar área e tarifas"}
              </button>
              <span className="muted">
                {dirty
                  ? "Alterações ainda não salvas."
                  : settings.revision > 0
                    ? "Configuração salva."
                    : "A área ainda não foi configurada."}
              </span>
            </div>
          </form>
          {reauth && (
            <form className="delivery-reauth" onSubmit={confirm}>
              <h2>Confirme sua senha</h2>
              <p>
                Seus campos continuam preenchidos. Confirme para salvar a área e
                as tarifas.
              </p>
              <label>
                Senha
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              {reauthError && <p role="alert">{reauthError}</p>}
              <div className="delivery-actions">
                <button className="primary" disabled={busy}>
                  Confirmar e salvar
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setReauth(false);
                    setPassword("");
                    pending.current = null;
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </>
      ) : null}
    </section>
  );
}

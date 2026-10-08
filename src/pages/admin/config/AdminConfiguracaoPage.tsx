import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  MapPin,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Mail,
  Palette,
  Phone,
  Clock3,
} from "lucide-react";
import type { AdminVerifySessionResponse } from "../../../../shared/contracts/adminGovernance.ts";
import { UpdateGlobalConfigPayloadSchema } from "../../../../shared/contracts/adminConfig.ts";
import { PageLoading } from "../../../components/PageLoading";
import { useConfigAdmin } from "./useConfigAdmin.ts";
import { useConfigUpdate } from "./useConfigUpdate.ts";
import { cryptoRandomUUID } from "../../../lib/uuid.ts";
import "./AdminConfiguracaoPage.css";

export function AdminConfiguracaoPage({
  access,
  onNavigate,
}: {
  access: AdminVerifySessionResponse;
  onNavigate?: (to: string) => void;
}) {
  const { state, reload, refreshing } = useConfigAdmin();
  const { outcome, submit, reset } = useConfigUpdate();
  const [activeTab, setActiveTab] = useState<ConfigTab>("identity");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [platformName, setPlatformName] = useState("");
  const [slogan, setSlogan] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [uf, setUf] = useState("RO");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [timezone, setTimezone] = useState("America/Porto_Velho");
  const [commandId, setCommandId] = useState(() => cryptoRandomUUID());

  useEffect(() => {
    if (state.status === "ready" && state.config) {
      setPlatformName(state.config.platformName);
      setSlogan(state.config.slogan);
      setMunicipality(state.config.defaultMunicipality);
      setUf(state.config.defaultState);
      setEmail(state.config.supportEmail);
      setPhone(state.config.supportPhone ?? "");
      setCurrency(state.config.currency);
      setTimezone(state.config.timezone);
    }
  }, [state.status, state.config]);

  useEffect(() => {
    if (outcome.kind !== "success") return;
    setCommandId(cryptoRandomUUID());
    const timer = window.setTimeout(() => reset(), 4500);
    return () => window.clearTimeout(timer);
  }, [outcome.kind, reset]);

  useEffect(() => {
    if (outcome.kind !== "reauth_required") return;
    const timer = window.setTimeout(() => {
      const target =
        access.role === "platform_super_admin"
          ? "/entrar/super-administrador?reason=reauth"
          : "/entrar/administrador?reason=reauth";
      if (onNavigate) onNavigate(target);
      else location.assign(target);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [outcome.kind, onNavigate, access.role]);

  if (state.status === "loading" && !state.config) return <PageLoading label="Carregando configuração" />;
  if (state.status === "error")
    return (
      <ErrorCard
        message={state.errorMessage ?? "Erro desconhecido."}
        onRetry={reload}
      />
    );
  if (state.status === "empty") return <EmptyCard onRetry={reload} />;
  if (!state.config)
    return <ErrorCard message="Configuração indisponível." onRetry={reload} />;

  const trimmedPhone = phone.trim();
  const hasChanges =
    platformName.trim() !== state.config.platformName ||
    slogan.trim() !== state.config.slogan ||
    municipality.trim() !== state.config.defaultMunicipality ||
    uf !== state.config.defaultState ||
    email.trim().toLowerCase() !== state.config.supportEmail ||
    trimmedPhone !== (state.config.supportPhone ?? "") ||
    currency !== state.config.currency ||
    timezone !== state.config.timezone;

  const canSubmit =
    hasChanges &&
    !refreshing &&
    outcome.kind !== "submitting" &&
    outcome.kind !== "conflict";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!hasChanges || !state.config || outcome.kind === "submitting") return;

    const payload: Record<string, unknown> = {};
    if (platformName.trim() !== state.config.platformName) payload.platformName = platformName.trim();
    if (slogan.trim() !== state.config.slogan) payload.slogan = slogan.trim();
    if (municipality.trim() !== state.config.defaultMunicipality)
      payload.defaultMunicipality = municipality.trim();
    if (uf !== state.config.defaultState) payload.defaultState = uf;
    if (email.trim().toLowerCase() !== state.config.supportEmail) payload.supportEmail = email.trim().toLowerCase();
    if (trimmedPhone !== (state.config.supportPhone ?? ""))
      payload.supportPhone = trimmedPhone.length === 0 ? null : trimmedPhone;
    if (currency !== state.config.currency) payload.currency = currency;
    if (timezone !== state.config.timezone) payload.timezone = timezone;

    const validated = UpdateGlobalConfigPayloadSchema.safeParse(payload);
    if (!validated.success) {
      const field = String(validated.error.issues[0]?.path[0] ?? "");
      setActiveTab(field === "supportEmail" || field === "supportPhone" ? "support" : field === "platformName" || field === "slogan" ? "identity" : "operation");
      setValidationError("Revise os campos informados. Use uma moeda de três letras e o telefone no formato internacional, quando preenchido.");
      return;
    }
    setValidationError(null);
    const result = await submit(validated.data, state.config.revision, commandId);
    if (result.kind === "success") await reload();
  }

  const statusText =
    outcome.kind === "submitting"
      ? "Salvando alterações…"
      : hasChanges
        ? "Alterações prontas para salvar"
        : state.errorMessage
          ? "Última configuração recebida — atualização não confirmada"
          : "Tudo sincronizado — nenhuma alteração pendente";

  return (
    <section className="admin-config-page" aria-labelledby="admin-config-title">
      <header className="admin-config-header">
        <div>
          <span className="admin-config-eyebrow">
            <Settings2 size={14} /> Central administrativa
          </span>
          <h1 id="admin-config-title">Configuração Global</h1>
          <p className="admin-config-subtitle">
            Defina a identidade da plataforma, a referência regional e os canais de suporte. As alterações são auditadas e sincronizadas com o sistema.
          </p>
        </div>
        <button
          type="button"
          className="admin-config-refresh"
          onClick={() => {
            void reload();
          }}
          disabled={refreshing || hasChanges || outcome.kind === "submitting"}
          aria-label="Atualizar configuração"
        >
          <RefreshCw size={16} className={refreshing ? "hvm-sync-spinning" : undefined} />
          {refreshing ? "Atualizando…" : "Atualizar configuração"}
        </button>
      </header>

      <div className="admin-config-summary" aria-label="Configuração vigente">
        <span><Palette size={15} /><strong>{state.config.platformName}</strong></span>
        <span><MapPin size={15} />{state.config.defaultMunicipality} / {state.config.defaultState}</span>
        <span><ShieldCheck size={15} />Revisão {state.config.revision}</span>
        <time dateTime={state.config.updatedAt}>Atualizada em {configUpdatedAt(state.config.updatedAt, state.config.timezone)}</time>
      </div>

      {outcome.kind === "conflict" && (
        <div className="admin-config-banner admin-config-banner--warning" role="alert">
          <AlertTriangle />
          <div>
            <strong>Outra sessão alterou a configuração.</strong>
            <p>Nenhuma alteração local foi sobrescrita automaticamente.</p>
            <button
              type="button"
              onClick={async () => {
                reset();
                setCommandId(cryptoRandomUUID());
                await reload();
              }}
            >
              <RefreshCw size={16} /> Recarregar configuração atual
            </button>
          </div>
        </div>
      )}

      {outcome.kind === "success" && (
        <div className="admin-config-banner admin-config-banner--success" role="status">
          <CheckCircle2 />
          <div>
            <strong>Configuração sincronizada com sucesso.</strong>
            <span> Frontend, backend e banco usam a nova configuração.</span>
          </div>
        </div>
      )}

      {outcome.kind === "reauth_required" && (
        <div className="admin-config-banner admin-config-banner--danger" role="alert">
          <AlertTriangle />
          <div>
            <strong>Confirmação de segurança necessária.</strong>
            <p>Você será redirecionado ao seu portal administrativo para autenticar novamente.</p>
          </div>
        </div>
      )}

      {outcome.kind === "error" && (
        <div className="admin-config-banner admin-config-banner--danger" role="alert">
          <AlertTriangle />
          <div>
            <strong>Falha ao salvar.</strong>
            <p>{outcome.message}</p>
          </div>
        </div>
      )}

      {state.errorMessage && <div className="admin-config-banner admin-config-banner--warning" role="alert"><AlertTriangle size={18}/><p>{state.errorMessage} A configuração carregada foi preservada.</p></div>}
      {validationError && <div className="admin-config-banner admin-config-banner--danger" role="alert"><AlertTriangle size={18}/><p>{validationError}</p></div>}
      <form className="admin-config-form" onSubmit={onSubmit}>
        <div className="admin-config-section-heading">
          <div><span className="admin-config-eyebrow">Identidade e operação</span><h2>Parâmetros globais</h2></div>
          <div className={"admin-config-status " + (hasChanges ? "is-dirty" : "is-synced")} aria-live="polite">{statusText}</div>
        </div>
        <div className="admin-config-tabs" role="tablist" aria-label="Grupos de configuração">
          {CONFIG_TABS.map(({ key, label, icon: Icon }, index) => <button type="button" key={key} id={"cfg-tab-" + key}
            role="tab" aria-selected={activeTab === key} aria-controls={"cfg-panel-" + key} tabIndex={activeTab === key ? 0 : -1}
            onClick={() => setActiveTab(key)} onKeyDown={event => {
              const next = event.key === "ArrowRight" ? (index + 1) % CONFIG_TABS.length : event.key === "ArrowLeft" ? (index + CONFIG_TABS.length - 1) % CONFIG_TABS.length : event.key === "Home" ? 0 : event.key === "End" ? CONFIG_TABS.length - 1 : null;
              if (next === null) return;
              event.preventDefault(); setActiveTab(CONFIG_TABS[next].key);
              document.getElementById("cfg-tab-" + CONFIG_TABS[next].key)?.focus();
            }}><Icon size={16}/><span>{label}</span></button>)}
        </div>
        <div className="admin-config-workspace">
          <fieldset disabled={refreshing || outcome.kind === "submitting" || outcome.kind === "conflict"}>
            <div role="tabpanel" id={"cfg-panel-" + activeTab} aria-labelledby={"cfg-tab-" + activeTab}>
              {activeTab === "identity" && <>
                <p className="admin-config-group-description">Como as pessoas reconhecem sua plataforma na vitrine e nos portais administrativos.</p>
                <div className="admin-config-grid">
                  <div className="admin-config-field"><label htmlFor="cfg-platform">Nome da plataforma</label><input id="cfg-platform" value={platformName} onChange={event => setPlatformName(event.target.value)} minLength={2} maxLength={80} required/><small>Nome público, com até 80 caracteres.</small></div>
                  <div className="admin-config-field"><label htmlFor="cfg-slogan">Slogan institucional</label><input id="cfg-slogan" value={slogan} onChange={event => setSlogan(event.target.value)} minLength={5} maxLength={255} required/><small>Mensagem usada pela aplicação, com até 255 caracteres.</small></div>
                </div>
              </>}
              {activeTab === "operation" && <>
                <p className="admin-config-group-description">Referência regional, moeda e horários usados na operação da plataforma.</p>
                <div className="admin-config-grid admin-config-grid--location">
                  <div className="admin-config-field"><label htmlFor="cfg-municipality">Município padrão</label><input id="cfg-municipality" value={municipality} onChange={event => setMunicipality(event.target.value)} minLength={2} maxLength={100} required/></div>
                  <div className="admin-config-field"><label htmlFor="cfg-uf">UF padrão</label><select id="cfg-uf" value={uf} onChange={event => setUf(event.target.value)} required>{BRAZILIAN_STATES.map(code => <option key={code} value={code}>{code}</option>)}</select></div>
                </div>
                <div className="admin-config-grid">
                  <div className="admin-config-field"><label htmlFor="cfg-currency">Moeda</label><input id="cfg-currency" value={currency} onChange={event => setCurrency(event.target.value.toUpperCase().slice(0, 3))} minLength={3} maxLength={3} pattern="[A-Z]{3}" required/><small>Código internacional de três letras, como BRL.</small></div>
                  <div className="admin-config-field"><label htmlFor="cfg-timezone">Fuso horário operacional</label><select id="cfg-timezone" value={timezone} onChange={event => setTimezone(event.target.value)} required>{!BRAZIL_TIMEZONES.includes(timezone) && <option value={timezone}>{timezone}</option>}{BRAZIL_TIMEZONES.map(zone => <option key={zone} value={zone}>{zone}</option>)}</select><small>Referência para horários operacionais e datas.</small></div>
                </div>
              </>}
              {activeTab === "support" && <>
                <p className="admin-config-group-description">Canais oficiais apresentados nas mensagens de cobertura, bloqueio e exclusão.</p>
                <div className="admin-config-grid">
                  <div className="admin-config-field"><label htmlFor="cfg-email">E-mail de suporte</label><input id="cfg-email" type="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={255} required/><small>Endereço oficial para atender as pessoas.</small></div>
                  <div className="admin-config-field"><label htmlFor="cfg-phone">Telefone de suporte (opcional)</label><input id="cfg-phone" type="tel" placeholder="+5569999999999" pattern="\+[1-9][0-9]{1,14}" value={phone} onChange={event => setPhone(event.target.value)}/><small>Formato internacional E.164. Vazio remove o telefone.</small></div>
                </div>
              </>}
            </div>
          </fieldset>
          <section className="admin-config-preview" aria-label="Prévia dos parâmetros">
            <span className="admin-config-eyebrow">Prévia {hasChanges ? "das alterações" : "vigente"}</span>
            {activeTab === "identity" ? <><Palette size={24}/><h3>{platformName || "Nome da plataforma"}</h3><p>{slogan || "Mensagem institucional"}</p><small>Identidade usada nas áreas públicas e administrativas.</small></>
              : activeTab === "operation" ? <><MapPin size={24}/><h3>{municipality || "Município"} / {uf}</h3><p>{currency} · {timezone.replace("America/", "").replaceAll("_", " ")}</p><small>O município padrão é a referência inicial. A cobertura é gerenciada no departamento de Localidades.</small></>
              : <><Mail size={24}/><h3>Atendimento oficial</h3><p>{email || "E-mail de suporte"}</p><p>{phone || "Sem telefone configurado"}</p><small>Confira os contatos antes de salvar; as mensagens do sistema usam esses canais.</small></>}
          </section>
        </div>

        <footer className="admin-config-footer">
          <div className="admin-config-security-note">
            <ShieldCheck size={17} />
            <span>Alterações exigem sessão administrativa recente e são registradas em auditoria.</span>
          </div>
          <div className="admin-config-actions">
            <button
              type="button"
              className="admin-config-reset"
              onClick={() => {
                reset();
                setCommandId(cryptoRandomUUID());
                void reload();
              }}
              disabled={outcome.kind === "submitting" || !hasChanges}
            >
              Descartar
            </button>
            <button
              type="submit"
              className="admin-config-submit"
              disabled={!canSubmit}
              aria-busy={outcome.kind === "submitting"}
            >
              {outcome.kind === "submitting"
                ? "Salvando…"
                : hasChanges
                  ? "Salvar alterações"
                  : "Nenhuma alteração"}
            </button>
          </div>
        </footer>
      </form>
    </section>
  );
}

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void | Promise<void>;
}) {
  return (
    <section className="admin-config-page">
      <div className="admin-config-card admin-config-card--error" role="alert">
        <AlertTriangle />
        <div>
          <h2>Não foi possível carregar a configuração</h2>
          <p>{message}</p>
          <button type="button" onClick={() => void onRetry()}>
            <RefreshCw size={16} /> Tentar novamente
          </button>
        </div>
      </div>
    </section>
  );
}

function EmptyCard({
  onRetry,
}: {
  onRetry: () => void | Promise<void>;
}) {
  return (
    <section className="admin-config-page">
      <div className="admin-config-card admin-config-card--empty" role="status">
        <AlertTriangle />
        <div>
          <h2>Configuração global ausente</h2>
          <p>O registro canônico de configuração não está disponível.</p>
          <button type="button" onClick={() => void onRetry()}>
            <RefreshCw size={16} /> Tentar novamente
          </button>
        </div>
      </div>
    </section>
  );
}

function configUpdatedAt(value: string, timezone: string) {
  try { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: timezone }).format(new Date(value)); }
  catch { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
}

type ConfigTab = "identity" | "operation" | "support";
const CONFIG_TABS = [
  { key: "identity" as const, label: "Identidade", icon: Palette },
  { key: "operation" as const, label: "Operação", icon: Clock3 },
  { key: "support" as const, label: "Suporte", icon: Phone },
];

const BRAZILIAN_STATES = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

const BRAZIL_TIMEZONES = [
  "America/Porto_Velho",
  "America/Manaus",
  "America/Rio_Branco",
  "America/Cuiaba",
  "America/Sao_Paulo",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Bahia",
  "America/Noronha",
];

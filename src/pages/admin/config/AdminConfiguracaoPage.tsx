import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  FileCheck2,
  History,
  MapPin,
  RefreshCw,
  Settings2,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { api } from "../../../lib/api.ts";
import type { AdminVerifySessionResponse } from "../../../../shared/contracts/adminGovernance.ts";
import type { GlobalConfigOverview } from "../../../../shared/contracts/adminConfig.ts";
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
  const { state, reload } = useConfigAdmin();
  const { outcome, submit, reset } = useConfigUpdate();
  const [overview, setOverview] = useState<GlobalConfigOverview | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [platformName, setPlatformName] = useState("");
  const [slogan, setSlogan] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [uf, setUf] = useState("RO");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [timezone, setTimezone] = useState("America/Porto_Velho");
  const [commandId, setCommandId] = useState(() => cryptoRandomUUID());

  const isSuper = access.role === "platform_super_admin";
  const canAccounts = isSuper || access.sectors.includes("account_governance");
  const canLocalities = isSuper || access.sectors.includes("location_management");
  const canDocuments = isSuper || access.sectors.includes("document_verification");

  async function loadOverview() {
    setOverviewError(false);
    try {
      setOverview(await api<GlobalConfigOverview>("/v1/admin/configuration/overview"));
    } catch {
      setOverviewError(true);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

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
    void loadOverview();
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

  if (state.status === "loading") return <LoadingSkeleton />;
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
    platformName !== state.config.platformName ||
    slogan !== state.config.slogan ||
    municipality !== state.config.defaultMunicipality ||
    uf !== state.config.defaultState ||
    email !== state.config.supportEmail ||
    trimmedPhone !== (state.config.supportPhone ?? "") ||
    currency !== state.config.currency ||
    timezone !== state.config.timezone;

  const canSubmit =
    hasChanges &&
    outcome.kind !== "submitting" &&
    outcome.kind !== "conflict";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!hasChanges || !state.config || outcome.kind === "submitting") return;

    const payload: Record<string, unknown> = {};
    if (platformName !== state.config.platformName) payload.platformName = platformName;
    if (slogan !== state.config.slogan) payload.slogan = slogan;
    if (municipality !== state.config.defaultMunicipality)
      payload.defaultMunicipality = municipality;
    if (uf !== state.config.defaultState) payload.defaultState = uf;
    if (email !== state.config.supportEmail) payload.supportEmail = email;
    if (trimmedPhone !== (state.config.supportPhone ?? ""))
      payload.supportPhone = trimmedPhone.length === 0 ? null : trimmedPhone;
    if (currency !== state.config.currency) payload.currency = currency;
    if (timezone !== state.config.timezone) payload.timezone = timezone;

    const result = await submit(payload, state.config.revision, commandId);
    if (result.kind === "success") await reload();
  }

  const statusText =
    outcome.kind === "submitting"
      ? "Salvando alterações…"
      : hasChanges
        ? "Alterações prontas para salvar"
        : "Tudo sincronizado — nenhuma alteração pendente";

  const cards = [
    {
      key: "users",
      title: "Contas e aprovações",
      value: overview
        ? overview.activeUsers + " ativas · " + overview.pendingRegistrationReviews + " em análise"
        : "—",
      note: overview ? overview.blockedUsers + " bloqueadas agora" : "Carregando indicadores",
      icon: UsersRound,
      enabled: canAccounts,
      target: "/admin/usuarios",
    },
    {
      key: "localities",
      title: "Cobertura regional",
      value: overview
        ? overview.activeMunicipalities + " ativas · " + overview.blockedMunicipalities + " bloqueadas"
        : "—",
      note: "Cadastro, exclusão, bloqueio e retomada de municípios",
      icon: MapPin,
      enabled: canLocalities,
      target: "/admin/localidades",
    },
    {
      key: "verification",
      title: "Imóveis e auditoria",
      value: overview
        ? overview.approvedProperties + " aprovados · " + overview.verificationQueue + " na fila"
        : "—",
      note: "Documentos, análise e aprovação rural",
      icon: FileCheck2,
      enabled: canDocuments,
      target: "/admin/documentos/fila",
    },
    {
      key: "blocks",
      title: "Bloqueios operacionais",
      value: overview ? overview.activeAccessBlocks + " ativos" : "—",
      note: "Compra, publicação e escopos por região",
      icon: Ban,
      enabled: canLocalities,
      target: "/admin/bloqueios",
    },
    {
      key: "audit",
      title: "Atividade de governança",
      value: overview ? overview.auditEvents24h + " eventos em 24 h" : "—",
      note: "Rastreabilidade de alterações administrativas",
      icon: History,
      enabled: isSuper,
      target: "/admin/governanca",
    },
  ];

  const visibleCards = cards.filter((card) => card.enabled);

  return (
    <section className="admin-config-page" aria-labelledby="admin-config-title">
      <header className="admin-config-header">
        <div>
          <span className="admin-config-eyebrow">
            <Settings2 size={14} /> Central administrativa
          </span>
          <h1 id="admin-config-title">Configuração Global</h1>
          <p className="admin-config-subtitle">
            Controle institucional e visão operacional da plataforma em um único
            lugar. As permissões abaixo respeitam os poderes delegados pelo Super
            administrador.
          </p>
        </div>
        <button
          type="button"
          className="admin-config-refresh"
          onClick={() => {
            void reload();
            void loadOverview();
          }}
          disabled={outcome.kind === "submitting"}
        >
          <RefreshCw size={16} />
          Atualizar painel
        </button>
      </header>

      <section className="admin-config-overview" aria-label="Visão geral do sistema">
        <div className="admin-config-section-heading">
          <div>
            <span className="admin-config-eyebrow">Visão operacional</span>
            <h2>Administração do sistema</h2>
          </div>
          {overviewError && (
            <button type="button" className="admin-config-link" onClick={() => void loadOverview()}>
              Recarregar indicadores
            </button>
          )}
        </div>
        <div className="admin-config-metrics">
          {visibleCards.map(({ key, title, value, note, icon: Icon, target }) => (
            <button
              type="button"
              className="admin-config-metric"
              key={key}
              onClick={() => onNavigate?.(target)}
            >
              <span className="admin-config-metric-icon"><Icon size={19} /></span>
              <span>
                <strong>{title}</strong>
                <b>{value}</b>
                <small>{note}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

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

      <form className="admin-config-form" onSubmit={onSubmit}>
        <div className="admin-config-section-heading">
          <div>
            <span className="admin-config-eyebrow">Identidade e operação</span>
            <h2>Parâmetros globais</h2>
          </div>
          <div className={"admin-config-status " + (hasChanges ? "is-dirty" : "is-synced")} aria-live="polite">
            {statusText}
          </div>
        </div>

        <fieldset disabled={outcome.kind === "submitting" || outcome.kind === "conflict"}>
          <div className="admin-config-grid">
            <div className="admin-config-field">
              <label htmlFor="cfg-platform">Nome da plataforma</label>
              <input
                id="cfg-platform"
                value={platformName}
                onChange={(event) => setPlatformName(event.target.value)}
                minLength={2}
                maxLength={80}
                required
              />
              <small>Nome exibido nas áreas públicas e administrativas.</small>
            </div>
            <div className="admin-config-field">
              <label htmlFor="cfg-slogan">Slogan institucional</label>
              <input
                id="cfg-slogan"
                value={slogan}
                onChange={(event) => setSlogan(event.target.value)}
                minLength={5}
                maxLength={255}
                required
              />
              <small>Mensagem institucional usada pela aplicação.</small>
            </div>
          </div>

          <div className="admin-config-grid admin-config-grid--location">
            <div className="admin-config-field">
              <label htmlFor="cfg-municipality">Município padrão</label>
              <input
                id="cfg-municipality"
                value={municipality}
                onChange={(event) => setMunicipality(event.target.value)}
                minLength={2}
                maxLength={100}
                required
              />
            </div>
            <div className="admin-config-field">
              <label htmlFor="cfg-uf">UF padrão</label>
              <select id="cfg-uf" value={uf} onChange={(event) => setUf(event.target.value)} required>
                {BRAZILIAN_STATES.map((stateCode) => (
                  <option key={stateCode} value={stateCode}>{stateCode}</option>
                ))}
              </select>
            </div>
            <div className="admin-config-field">
              <label htmlFor="cfg-currency">Moeda</label>
              <input
                id="cfg-currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase().slice(0, 3))}
                minLength={3}
                maxLength={3}
                pattern="[A-Z]{3}"
                required
              />
            </div>
          </div>

          <div className="admin-config-grid">
            <div className="admin-config-field">
              <label htmlFor="cfg-timezone">Fuso horário operacional</label>
              <select id="cfg-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} required>
                {BRAZIL_TIMEZONES.map((zone) => (
                  <option value={zone} key={zone}>{zone}</option>
                ))}
              </select>
              <small>Afeta horários operacionais e apresentação de datas.</small>
            </div>
            <div className="admin-config-field">
              <label htmlFor="cfg-email">E-mail de suporte</label>
              <input
                id="cfg-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={255}
                required
              />
              <small>Canal exibido nas mensagens de bloqueio, exclusão e cobertura.</small>
            </div>
          </div>

          <div className="admin-config-field">
            <label htmlFor="cfg-phone">Telefone de suporte (opcional)</label>
            <input
              id="cfg-phone"
              type="tel"
              placeholder="+5569999999999"
              pattern="\+[1-9][0-9]{1,14}"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
            <small>Formato internacional E.164. Deixe vazio para remover.</small>
          </div>
        </fieldset>

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

function LoadingSkeleton() {
  return (
    <section className="admin-config-page" aria-busy="true" aria-label="Carregando configuração">
      <div className="admin-config-skeleton admin-config-skeleton--title" />
      <div className="admin-config-metrics">
        {[0, 1, 2, 3].map((item) => (
          <div className="admin-config-skeleton admin-config-skeleton--metric" key={item} />
        ))}
      </div>
      <div className="admin-config-skeleton admin-config-skeleton--form" />
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

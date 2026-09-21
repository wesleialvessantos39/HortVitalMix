import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { useConfigAdmin } from "./useConfigAdmin.ts";
import { useConfigUpdate } from "./useConfigUpdate.ts";
import { cryptoRandomUUID } from "../../../lib/uuid.ts";
import "./AdminConfiguracaoPage.css";

export function AdminConfiguracaoPage({
  onNavigate,
}: {
  onNavigate?: (to: string) => void;
}) {
  const { state, reload } = useConfigAdmin();
  const { outcome, submit, reset } = useConfigUpdate();
  const [slogan, setSlogan] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [uf, setUf] = useState("RO");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [commandId, setCommandId] = useState(() => cryptoRandomUUID());

  useEffect(() => {
    if (state.status === "ready" && state.config) {
      setSlogan(state.config.slogan);
      setMunicipality(state.config.defaultMunicipality);
      setUf(state.config.defaultState);
      setEmail(state.config.supportEmail);
      setPhone(state.config.supportPhone ?? "");
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
      const target = "/entrar/super-administrador?reason=reauth";
      if (onNavigate) onNavigate(target);
      else location.assign(target);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [outcome.kind, onNavigate]);

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

  const revision = state.config.revision;
  const trimmedPhone = phone.trim();
  const hasChanges =
    slogan !== state.config.slogan ||
    municipality !== state.config.defaultMunicipality ||
    uf !== state.config.defaultState ||
    email !== state.config.supportEmail ||
    trimmedPhone !== (state.config.supportPhone ?? "");

  const canSubmit =
    hasChanges &&
    outcome.kind !== "submitting" &&
    outcome.kind !== "conflict";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!hasChanges || !state.config) return;

    const payload: Record<string, unknown> = {};
    if (slogan !== state.config.slogan) payload.slogan = slogan;
    if (municipality !== state.config.defaultMunicipality)
      payload.defaultMunicipality = municipality;
    if (uf !== state.config.defaultState) payload.defaultState = uf;
    if (email !== state.config.supportEmail) payload.supportEmail = email;
    if (trimmedPhone !== (state.config.supportPhone ?? ""))
      payload.supportPhone = trimmedPhone.length === 0 ? null : trimmedPhone;

    const result = await submit(payload, revision, commandId);
    if (result.kind === "success") await reload();
  }

  const statusText =
    outcome.kind === "submitting"
      ? "Salvando alterações…"
      : hasChanges
        ? "Alterações não salvas"
        : "Configuração sincronizada";

  return (
    <section className="admin-config-page" aria-labelledby="admin-config-title">
      <header className="admin-config-header">
        <div>
          <span className="admin-config-eyebrow">
            <Settings2 size={14} /> Administração Geral
          </span>
          <h1 id="admin-config-title">Configuração Global</h1>
          <p className="admin-config-subtitle">
            Alterações são revisionadas e auditadas. Nenhuma edição sobrescreve
            silenciosamente a de outro operador.
          </p>
        </div>
        <div className="admin-config-badge" aria-live="polite">
          <span className="admin-config-badge-label">Revisão</span>
          <span className="admin-config-badge-value">#{revision}</span>
        </div>
      </header>

      {outcome.kind === "conflict" && (
        <div
          className="admin-config-banner admin-config-banner--warning"
          role="alert"
        >
          <AlertTriangle />
          <div>
            <strong>Conflito de revisão.</strong>
            <p>
              Os dados foram alterados por outro operador (revisão atual:
              #{outcome.currentRevision}). Nenhuma alteração sua foi aplicada.
            </p>
            <button
              type="button"
              onClick={async () => {
                reset();
                setCommandId(cryptoRandomUUID());
                await reload();
              }}
            >
              <RefreshCw size={16} /> Recarregar revisão atual
            </button>
          </div>
        </div>
      )}

      {outcome.kind === "success" && (
        <div
          className="admin-config-banner admin-config-banner--success"
          role="status"
        >
          <CheckCircle2 />
          <div>
            <strong>Configuração atualizada com sucesso.</strong>
            <span> Nova revisão: #{outcome.revision}.</span>
          </div>
        </div>
      )}

      {outcome.kind === "reauth_required" && (
        <div
          className="admin-config-banner admin-config-banner--danger"
          role="alert"
        >
          <AlertTriangle />
          <div>
            <strong>Reautenticação requerida.</strong>
            <p>
              Operações administrativas exigem sessão recente. Você será
              redirecionado ao acesso de Super Administrador.
            </p>
          </div>
        </div>
      )}

      {outcome.kind === "error" && (
        <div
          className="admin-config-banner admin-config-banner--danger"
          role="alert"
        >
          <AlertTriangle />
          <div>
            <strong>Falha ao salvar.</strong>
            <p>{outcome.message}</p>
          </div>
        </div>
      )}

      <form className="admin-config-form" onSubmit={onSubmit}>
        <div className="admin-config-status" aria-live="polite">
          {statusText}
        </div>

        <fieldset
          disabled={
            outcome.kind === "submitting" || outcome.kind === "conflict"
          }
        >
          <div className="admin-config-field">
            <label htmlFor="cfg-slogan">Slogan institucional</label>
            <input
              id="cfg-slogan"
              type="text"
              value={slogan}
              onChange={(event) => setSlogan(event.target.value)}
              minLength={5}
              maxLength={255}
              required
            />
            <small>Exibido no cabeçalho de toda a aplicação.</small>
          </div>

          <div className="admin-config-grid">
            <div className="admin-config-field">
              <label htmlFor="cfg-municipality">Município padrão</label>
              <input
                id="cfg-municipality"
                type="text"
                value={municipality}
                onChange={(event) => setMunicipality(event.target.value)}
                minLength={2}
                maxLength={100}
                required
              />
            </div>
            <div className="admin-config-field admin-config-field--uf">
              <label htmlFor="cfg-uf">UF</label>
              <select
                id="cfg-uf"
                value={uf}
                onChange={(event) => setUf(event.target.value)}
                required
              >
                {BRAZILIAN_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="admin-config-grid">
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
            </div>
            <div className="admin-config-field">
              <label htmlFor="cfg-phone">Telefone de suporte (opcional)</label>
              <input
                id="cfg-phone"
                type="tel"
                placeholder="+5563999999999"
                pattern="\+[1-9][0-9]{1,14}"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
              <small>Formato E.164. Deixe vazio para remover.</small>
            </div>
          </div>
        </fieldset>

        <footer className="admin-config-footer">
          <button
            type="submit"
            className="admin-config-submit"
            disabled={!canSubmit}
          >
            {outcome.kind === "submitting"
              ? "Salvando…"
              : "Salvar alterações"}
          </button>
          <button
            type="button"
            className="admin-config-reset"
            onClick={() => {
              reset();
              setCommandId(cryptoRandomUUID());
              void reload();
            }}
            disabled={outcome.kind === "submitting"}
          >
            Descartar alterações
          </button>
        </footer>
      </form>
    </section>
  );
}

function LoadingSkeleton() {
  return (
    <section
      className="admin-config-page"
      aria-busy="true"
      aria-label="Carregando configuração"
    >
      <div className="admin-config-skeleton admin-config-skeleton--title" />
      <div className="admin-config-skeleton admin-config-skeleton--field" />
      <div className="admin-config-skeleton admin-config-skeleton--field" />
      <div className="admin-config-skeleton admin-config-skeleton--field" />
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
      <div
        className="admin-config-card admin-config-card--error"
        role="alert"
      >
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
      <div
        className="admin-config-card admin-config-card--empty"
        role="status"
      >
        <AlertTriangle />
        <div>
          <h2>Configuração ausente</h2>
          <p>
            O singleton de configuração não está presente. Contate o suporte
            técnico antes de prosseguir.
          </p>
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

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Globe2,
  LockKeyhole,
  MapPin,
  Palette,
  RefreshCw,
  Save,
} from 'lucide-react';
import type { PublicConfig } from '../../../shared/contracts/configuration';
import type { EnvironmentResponse } from '../../../shared/contracts/foundation';
import { BrandLogo } from '../../components/brand/BrandLogo';
import { EnvironmentNotice } from '../../components/environment/EnvironmentNotice';
import { FoundationApiError, foundationApi } from '../../services/foundationApi';

interface AdminConfigurationPageProps {
  config: PublicConfig;
  environment: EnvironmentResponse;
  databaseReady: boolean;
  onConfigUpdated: (config: PublicConfig) => void;
  onReload: () => void;
}

interface FormState {
  tagline: string;
  pageTitle: string;
  logoAltText: string;
  email: string;
  phone: string;
  whatsapp: string;
  countryCode: string;
  stateCode: string;
  city: string;
  locale: string;
  currency: string;
  timezone: string;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success'; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'denied'; message: string }
  | { kind: 'error'; message: string };

function toForm(config: PublicConfig): FormState {
  return {
    tagline: config.brand.tagline,
    pageTitle: config.brand.pageTitle,
    logoAltText: config.brand.logoAltText,
    email: config.contacts.email ?? '',
    phone: config.contacts.phone ?? '',
    whatsapp: config.contacts.whatsapp ?? '',
    countryCode: config.region.countryCode,
    stateCode: config.region.stateCode,
    city: config.region.city,
    locale: config.parameters.locale,
    currency: config.parameters.currency,
    timezone: config.parameters.timezone,
  };
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function AdminConfigurationPage({
  config,
  environment,
  databaseReady,
  onConfigUpdated,
  onReload,
}: AdminConfigurationPageProps) {
  const [form, setForm] = useState<FormState>(() => toForm(config));
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });

  useEffect(() => {
    setForm(toForm(config));
  }, [config]);

  const hasChanges = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(toForm(config)),
    [form, config],
  );

  function setField<K extends keyof FormState>(field: K, value: FormState[K]): void {
    setForm((current) => ({ ...current, [field]: value }));
    if (saveState.kind !== 'idle') setSaveState({ kind: 'idle' });
  }

  async function save(): Promise<void> {
    if (!databaseReady || !hasChanges || saveState.kind === 'saving') return;
    setSaveState({ kind: 'saving' });

    try {
      const response = await foundationApi.updateConfiguration({
        commandId: crypto.randomUUID(),
        expectedRevision: config.revision,
        changes: {
          brand: {
            tagline: form.tagline,
            pageTitle: form.pageTitle,
            logoAltText: form.logoAltText,
          },
          contacts: {
            email: nullable(form.email),
            phone: nullable(form.phone),
            whatsapp: nullable(form.whatsapp),
          },
          region: {
            countryCode: form.countryCode.toUpperCase(),
            stateCode: form.stateCode.toUpperCase(),
            city: form.city,
          },
          parameters: {
            locale: form.locale,
            currency: form.currency.toUpperCase(),
            timezone: form.timezone,
          },
        },
      });

      onConfigUpdated(response.config);
      setSaveState({
        kind: 'success',
        message: response.changed
          ? `Configuração salva na revisão ${response.config.revision}.`
          : 'Nenhuma alteração efetiva foi necessária.',
      });
    } catch (error) {
      if (error instanceof FoundationApiError) {
        if (error.status === 409) {
          setSaveState({ kind: 'conflict', message: error.message });
          return;
        }
        if (error.status === 403) {
          setSaveState({
            kind: 'denied',
            message: 'O acesso administrativo é necessário para salvar alterações.',
          });
          return;
        }
        setSaveState({ kind: 'error', message: error.message });
        return;
      }

      setSaveState({
        kind: 'error',
        message: 'Não foi possível concluir a operação. Tente novamente.',
      });
    }
  }

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <a className="admin-brand-link" href="/" aria-label="Voltar para a página inicial">
          <BrandLogo brand={config.brand} compact />
        </a>
        <a className="secondary-button admin-back-link" href="/">Voltar ao site</a>
      </header>

      <div className="admin-shell">
        <EnvironmentNotice environment={environment} />
        <section className="admin-heading">
          <div>
            <p className="eyebrow">Configuração da plataforma</p>
            <h1>Marca, contatos e região</h1>
            <p>
              A configuração pública é revisionada e aplicada de forma consistente no site.
              A identidade principal da marca permanece protegida.
            </p>
          </div>
          <div className="revision-pill" aria-label={`Revisão atual ${config.revision}`}>
            Revisão {config.revision}
          </div>
        </section>

        {!databaseReady && (
          <div className="admin-alert warning" role="alert">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>Persistência indisponível</strong>
              <span>Os dados podem ser consultados, mas nenhuma alteração será confirmada sem o banco.</span>
            </div>
            <button type="button" className="icon-button" onClick={onReload} aria-label="Verificar novamente">
              <RefreshCw size={18} />
            </button>
          </div>
        )}

        {saveState.kind === 'success' && (
          <div className="admin-alert success" role="status">
            <CheckCircle2 aria-hidden="true" />
            <div><strong>Alteração confirmada</strong><span>{saveState.message}</span></div>
          </div>
        )}

        {saveState.kind === 'conflict' && (
          <div className="admin-alert warning" role="alert">
            <AlertTriangle aria-hidden="true" />
            <div><strong>Configuração atualizada em outra sessão</strong><span>{saveState.message}</span></div>
            <button type="button" className="secondary-button compact-action" onClick={onReload}>Recarregar</button>
          </div>
        )}

        {saveState.kind === 'denied' && (
          <div className="admin-alert neutral" role="alert">
            <LockKeyhole aria-hidden="true" />
            <div><strong>Acesso protegido</strong><span>{saveState.message}</span></div>
          </div>
        )}

        {saveState.kind === 'error' && (
          <div className="admin-alert error" role="alert">
            <AlertTriangle aria-hidden="true" />
            <div><strong>Não foi possível salvar</strong><span>{saveState.message}</span></div>
          </div>
        )}

        <div className="admin-grid">
          <section className="config-card">
            <div className="config-card-heading">
              <Palette aria-hidden="true" />
              <div><h2>Identidade</h2><p>A marca principal e as cores seguem a identidade visual oficial.</p></div>
            </div>
            <div className="form-grid">
              <label>
                <span>Marca</span>
                <input value={config.brand.name} disabled />
              </label>
              <label>
                <span>Slogan</span>
                <input value={form.tagline} maxLength={120} onChange={(event) => setField('tagline', event.target.value)} />
              </label>
              <label className="full-field">
                <span>Título da página</span>
                <input value={form.pageTitle} maxLength={120} onChange={(event) => setField('pageTitle', event.target.value)} />
              </label>
              <label className="full-field">
                <span>Texto acessível da marca</span>
                <input value={form.logoAltText} maxLength={160} onChange={(event) => setField('logoAltText', event.target.value)} />
              </label>
            </div>
            <div className="theme-preview" aria-label="Cores oficiais da marca">
              <span style={{ background: config.brand.theme.primary }}>Verde principal</span>
              <span style={{ background: config.brand.theme.secondary }}>Verde vivo</span>
              <span style={{ background: config.brand.theme.accent }}>Laranja</span>
            </div>
          </section>

          <section className="config-card">
            <div className="config-card-heading">
              <MapPin aria-hidden="true" />
              <div><h2>Região</h2><p>Define a apresentação regional usada nas telas públicas.</p></div>
            </div>
            <div className="form-grid">
              <label>
                <span>Cidade</span>
                <input value={form.city} onChange={(event) => setField('city', event.target.value)} />
              </label>
              <label>
                <span>UF</span>
                <input value={form.stateCode} maxLength={2} onChange={(event) => setField('stateCode', event.target.value.toUpperCase())} />
              </label>
              <label>
                <span>País</span>
                <input value={form.countryCode} maxLength={2} onChange={(event) => setField('countryCode', event.target.value.toUpperCase())} />
              </label>
              <label>
                <span>Fuso horário</span>
                <input value={form.timezone} onChange={(event) => setField('timezone', event.target.value)} />
              </label>
            </div>
          </section>

          <section className="config-card">
            <div className="config-card-heading">
              <Globe2 aria-hidden="true" />
              <div><h2>Parâmetros</h2><p>Idioma e moeda usados para novas experiências da plataforma.</p></div>
            </div>
            <div className="form-grid">
              <label>
                <span>Localidade</span>
                <input value={form.locale} onChange={(event) => setField('locale', event.target.value)} />
              </label>
              <label>
                <span>Moeda</span>
                <input value={form.currency} maxLength={3} onChange={(event) => setField('currency', event.target.value.toUpperCase())} />
              </label>
            </div>
            <p className="form-note">
              Alterar a moeda da configuração não modifica valores já registrados em operações históricas.
            </p>
          </section>

          <section className="config-card">
            <div className="config-card-heading">
              <LockKeyhole aria-hidden="true" />
              <div><h2>Contatos públicos</h2><p>Campos podem ficar vazios; somente valores informados aparecem no site.</p></div>
            </div>
            <div className="form-grid">
              <label className="full-field">
                <span>E-mail</span>
                <input type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} />
              </label>
              <label>
                <span>Telefone</span>
                <input value={form.phone} onChange={(event) => setField('phone', event.target.value)} />
              </label>
              <label>
                <span>WhatsApp</span>
                <input value={form.whatsapp} onChange={(event) => setField('whatsapp', event.target.value)} />
              </label>
            </div>
          </section>
        </div>

        <div className="admin-savebar">
          <div>
            <strong>{hasChanges ? 'Existem alterações não salvas' : 'Configuração sincronizada'}</strong>
            <span>As alterações só são confirmadas após resposta válida do servidor.</span>
          </div>
          <button
            type="button"
            className="primary-button save-config-button"
            disabled={!databaseReady || !hasChanges || saveState.kind === 'saving'}
            onClick={() => void save()}
          >
            <Save size={18} aria-hidden="true" />
            {saveState.kind === 'saving' ? 'Salvando…' : 'Salvar alterações'}
          </button>
        </div>
      </div>
    </main>
  );
}

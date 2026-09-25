import { AccountGreeting } from "../../components/AccountGreeting";
import { accountExperience } from "./accountExperience";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  Check,
  MapPin,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import type { ShellSession } from "../../hooks/useSession";
import type {
  ConsentView,
  PreferencesView,
  ProfileView,
} from "../../../shared/contracts/profilePrivacy";
import type { AddressAdvancedView } from "../../../shared/contracts/addressAdvanced";
import { PrivacyExportButton } from "./PrivacyExportButton";
import { AddressManager } from "./AddressManager";

type Props = {
  path: string;
  session: ShellSession;
  onNavigate: (to: string) => void;
};

const sections = [
  ["/conta/perfil", "Perfil", UserRound],
  ["/conta/enderecos", "Endereços", MapPin],
  ["/conta/preferencias", "Preferências", SlidersHorizontal],
  ["/conta/privacidade", "Privacidade", ShieldCheck],
] as const;

function commandId() {
  return crypto.randomUUID();
}

export function AccountHub({ path, session, onNavigate }: Props) {
  const experience = accountExperience(session.activeRole);
  const administrative = session.activeRole === "platform_admin" || session.activeRole === "platform_super_admin";
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [addresses, setAddresses] = useState<AddressAdvancedView[]>([]);
  const [preferences, setPreferences] =
    useState<PreferencesView | null>(null);
  const [consents, setConsents] = useState<ConsentView[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function load() {
    setNotice("");
    try {
      const [profileResult, addressResult, preferenceResult] =
        await Promise.all([
          path === "/conta" || path === "/conta/perfil" || path === "/conta/preferencias"
            ? api<ProfileView>("/v1/account/profile") : Promise.resolve(profile),
          path === "/conta"
            ? api<{ addresses: AddressAdvancedView[] }>("/v1/account/addresses") : Promise.resolve({addresses}),
          path === "/conta/preferencias" || path === "/conta/privacidade" ? api<{
            preferences: PreferencesView;
            consents: ConsentView[];
          }>("/v1/account/preferences") : Promise.resolve({preferences,consents}),
        ]);
      setProfile(profileResult);
      setAddresses(addressResult.addresses);
      setPreferences(preferenceResult.preferences);
      setConsents(preferenceResult.consents);
    } catch {
      setNotice("Não foi possível carregar os dados da conta agora.");
    }
  }

  useEffect(() => {
    void load();
  }, [session.userId, path]);

  const defaultAddress = useMemo(
    () => addresses.find((address) => address.isDefault) ?? null,
    [addresses],
  );

  if (path === "/conta") {
    return (
      <section className="account-hub">
        <header className="account-hub-heading">
          <div>
            <span className="eyebrow">Minha conta</span>
            <h1><AccountGreeting fullName={profile?.fullName ?? ""} /></h1>
            <p>{experience.introduction}</p>
          </div>
        </header>

        {defaultAddress && (
          <button
            className="account-delivery-card"
            onClick={() => onNavigate("/conta/enderecos")}
          >
            <MapPin />
            <span>
              <small>Entrega para</small>
              <strong>
                {defaultAddress.neighborhood +
                  " · " +
                  defaultAddress.city +
                  "/" +
                  defaultAddress.state}
              </strong>
            </span>
          </button>
        )}

        <div className="account-hub-grid">
          {sections.map(([to, label, Icon], index) => (
            <button
              key={to}
              className="account-hub-card"
              onClick={() => onNavigate(to)}
            >
              <Icon />
              <span>
                <strong>{label}</strong>
                <small>
                  {experience.cards[index]}
                </small>
              </span>
            </button>
          ))}
        </div>
        <button className="secondary account-action" type="button" onClick={() => onNavigate("/minha-conta")}>
          Segurança e sair da conta
        </button>
        {notice && (
          <p role="status" className="account-notice">
            {notice}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="account-hub account-hub-detail">
      <header className="account-detail-top">
        <button aria-label="Voltar" onClick={() => onNavigate("/conta")}>
          <ArrowLeft />
        </button>
        <div>
          <span className="eyebrow">Minha conta</span>
          <h1>
            {sections.find(([route]) => route === path)?.[1] ?? "Conta"}
          </h1>
        </div>
      </header>

      <nav className="account-section-nav" aria-label="Seções da conta">
        {sections.map(([to, label]) => (
          <button
            key={to}
            className={to === path ? "active" : ""}
            onClick={() => onNavigate(to)}
          >
            {label}
          </button>
        ))}
      </nav>

      {path === "/conta/perfil" && profile && (
        <form
          className="account-panel"
          key={profile.revision}
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setNotice("");
            const form = new FormData(event.currentTarget);
            try {
              const result = await api<{
                status: string;
                currentRevision?: number;
              }>("/v1/account/profile", {
                method: "PATCH",
                body: JSON.stringify({
                  fullName: form.get("fullName"),
                  expectedRevision: profile.revision,
                  commandId: commandId(),
                }),
              });
              if (result.status === "conflict") {
                setNotice(
                  "Seus dados foram alterados em outra sessão. Recarregamos a versão atual.",
                );
                await load();
                return;
              }
              await load();
              setNotice("Perfil atualizado.");
            } catch (error) {
              if ((error as ApiFailure).status === 409) {
                await load();
                setNotice("Seus dados mudaram em outra sessão. Confira a versão atual e tente novamente.");
              } else setNotice("Não foi possível atualizar o perfil.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="account-section-intro"><h2>Identificação e contato</h2><p>{experience.profile}</p></div>
          <label>
            Nome completo
            <input
              name="fullName"
              defaultValue={profile.fullName}
              minLength={3}
              maxLength={255}
              required
            />
          </label>
          <label>
            CPF
            <input value={profile.cpfMasked} disabled />
          </label>

          <label>
            Celular
            <input value={profile.phone} disabled />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Salvando…" : "Salvar alterações"}
          </button>
        </form>
      )}

      {path === "/conta/enderecos" && (
        <AddressManager
          title={experience.addressTitle}
          help={experience.addressHelp}
        />
      )}

      {path === "/conta/preferencias" && preferences && (
        <form
          className="account-panel"
          key={preferences.revision}
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setNotice("");
            const form = new FormData(event.currentTarget);
            try {
              const result = await api<{ status: string }>(
                "/v1/account/preferences",
                {
                  method: "PATCH",
                  body: JSON.stringify({
                    marketingConsent:
                      form.get("marketingConsent") === "on",
                    orderUpdatesChannel:
                      form.get("orderUpdatesChannel"),
                    quietHoursEnabled:
                      form.get("quietHoursEnabled") === "on",
                    quietHoursStart:
                      form.get("quietHoursStart") || null,
                    quietHoursEnd:
                      form.get("quietHoursEnd") || null,
                    expectedRevision: preferences.revision,
                    commandId: commandId(),
                  }),
                },
              );
              if (result.status === "conflict") {
                setNotice(
                  "Preferências alteradas em outra sessão. Recarregamos os dados.",
                );
                await load();
                return;
              }
              await load();
              setNotice("Preferências salvas.");
            } catch (error) {
              if ((error as ApiFailure).status === 409) {
                await load();
                setNotice("Suas preferências mudaram em outra sessão. Confira a versão atual.");
              } else setNotice("Não foi possível salvar as preferências.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="account-section-intro"><h2>Sua conta e suas escolhas</h2><p>{experience.preferences}</p></div>
          <dl className="account-identity-summary">
            <div><dt>Tipo de conta</dt><dd>{experience.label}</dd></div>
            <div><dt>E-mail de acesso</dt><dd>{profile?.email || session.email || "Não informado"}</dd></div>
          </dl>
          {administrative && <div className="account-work-tools">
            <h3>Ferramentas de trabalho</h3>
            <button type="button" className="secondary" onClick={() => onNavigate("/admin/usuarios")}>Consultar usuários</button>
            <button type="button" className="secondary" onClick={() => onNavigate("/admin/governanca")}>Gerenciar convites</button>
            {session.activeRole === "platform_super_admin" && <button type="button" className="secondary" onClick={() => onNavigate("/admin/configuracao")}>Configurações globais</button>}
          </div>}
          {!administrative ? <fieldset>
            <legend>Avisos sobre {session.activeRole === "producer" ? "suas compras pessoais" : "pedidos"}</legend>
            {(["email", "sms", "both"] as const).map((value) => (
              <label className="account-radio" key={value}>
                <input
                  type="radio"
                  name="orderUpdatesChannel"
                  value={value}
                  defaultChecked={
                    preferences.orderUpdatesChannel === value
                  }
                />
                <span>
                  {value === "email"
                    ? "E-mail"
                    : value === "sms"
                      ? "SMS"
                      : "E-mail e SMS"}
                </span>
              </label>
            ))}
          </fieldset> : <input type="hidden" name="orderUpdatesChannel" value={preferences.orderUpdatesChannel} />}
          <p className="account-context-note">Horário de silêncio e novidades são escolhas pessoais. Avisos obrigatórios de segurança continuam ativos.</p>
          <label className="account-toggle">
            <input
              type="checkbox"
              name="quietHoursEnabled"
              defaultChecked={preferences.quietHoursEnabled}
            />
            <span>Ativar horário de silêncio</span>
          </label>
          <div className="account-time-grid">
            <label>
              Início
              <input
                type="time"
                name="quietHoursStart"
                defaultValue={preferences.quietHoursStart ?? ""}
              />
            </label>
            <label>
              Fim
              <input
                type="time"
                name="quietHoursEnd"
                defaultValue={preferences.quietHoursEnd ?? ""}
              />
            </label>
          </div>
          <label className="account-toggle">
            <input
              type="checkbox"
              name="marketingConsent"
              defaultChecked={preferences.marketingConsent}
            />
            <span>Receber novidades e ofertas</span>
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Salvando…" : "Salvar preferências"}
          </button>
        </form>
      )}

      {path === "/conta/privacidade" && (
        <div className="account-panel">
          <h2>Privacidade e consentimentos</h2>
          <p>{experience.privacy}</p>
          <div className="account-privacy-summary">
            <article><ShieldCheck /><h3>Você escolhe</h3><p>Atualize a autorização de novidades em Preferências quando quiser.</p><button type="button" className="secondary" onClick={() => onNavigate("/conta/preferencias")}>Revisar minhas escolhas</button></article>
            <article><UserRound /><h3>Seus dados com você</h3><p>A exportação reúne seus dados pessoais e exige confirmação recente da senha.</p></article>
          </div>
          <PrivacyExportButton session={session} onNotice={setNotice} />

          <div className="consent-list">
            {consents.length ? (
              consents.map((consent) => (
                <article key={consent.id}>
                  <Check />
                  <div>
                    <strong>
                      {consent.consentType === "marketing"
                        ? "Comunicações de marketing"
                        : consent.consentType}
                    </strong>
                    <span>
                      {(consent.isGranted
                        ? "Consentimento concedido"
                        : "Consentimento retirado") +
                        " · política " +
                        consent.policyVersion}
                    </span>
                    <small>
                      {new Date(
                        consent.registeredAt,
                      ).toLocaleString("pt-BR")}
                    </small>
                  </div>
                </article>
              ))
            ) : (
              <p className="account-empty">
                Nenhum consentimento registrado ainda.
              </p>
            )}
          </div>
        </div>
      )}

      {notice && (
        <p role="status" className="account-notice">
          {notice}
        </p>
      )}
    </section>
  );
}


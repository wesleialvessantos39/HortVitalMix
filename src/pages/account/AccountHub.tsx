import { AccountGreeting } from "../../components/AccountGreeting";
import { accountExperience } from "./accountExperience";
import {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  Check,
  MapPin,
  ShieldCheck,
  SlidersHorizontal,
  Sprout,
  Store,
  Salad,
  Truck,
  PackageCheck,
  UserRound,
  CreditCard,
  Flag,
  ReceiptText,
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
import { PostalLookupService } from "../../services/PostalLookupService";
// Coordinates AddressManager events: "hortivitalmix:default-address-changed" and PostalLookupService

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
  const [preferences, setPreferences] =
    useState<PreferencesView | null>(null);
  const [consents, setConsents] = useState<ConsentView[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [producerApproved, setProducerApproved] = useState<boolean | null>(null);
  const [producerGuideOpen, setProducerGuideOpen] = useState(false);
  const [producerGuideProperty, setProducerGuideProperty] = useState<{
    id: string;
    status: string;
    wizardCurrentStep: number;
  } | null>(null);

  async function load(signal?: AbortSignal) {
    setNotice("");
    const pending: Promise<unknown>[] = [];
    const failed = () => { if (!signal?.aborted) setNotice("Não foi possível carregar parte dos dados da conta agora."); };
    // Independent sections must not hold up the identity already returned by the session.
    if (path === "/conta/perfil" || path === "/conta/preferencias")
      pending.push(api<ProfileView>("/v1/account/profile", { signal }).then((value) => { if (!signal?.aborted) setProfile(value); }).catch(failed));
    if (path === "/conta/preferencias" || path === "/conta/privacidade")
      pending.push(api<{ preferences: PreferencesView; consents: ConsentView[] }>("/v1/account/preferences", { signal })
        .then((result) => { if (!signal?.aborted) { setPreferences(result.preferences); setConsents(result.consents); } }).catch(failed));
    await Promise.all(pending);
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [session.userId, path]);

  useEffect(() => {
    if (path !== "/conta" || session.activeRole !== "producer") return;
    const controller = new AbortController();
    void api<{
      properties: Array<{
        id: string;
        status: string;
        wizardCurrentStep: number;
        queueStatus?: string | null;
        reviewDecision?: string | null;
      }>;
    }>("/v1/producer/properties", { signal: controller.signal })
      .then(({ properties }) => {
        if (controller.signal.aborted) return;
        setProducerApproved(
          properties.some(
            (property) =>
              property.status === "verified" ||
              property.queueStatus === "approved" ||
              property.reviewDecision === "approved",
          ),
        );
        setProducerGuideProperty(
          properties.find((property) =>
            ["draft", "completed", "rejected"].includes(property.status),
          ) ?? null,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setProducerApproved(null);
          setProducerGuideProperty(null);
        }
      });
    return () => controller.abort();
  }, [path, session.activeRole, session.userId]);

  if (path === "/conta") {
    return (
      <section className="account-hub">
        <header className="account-hub-heading">
          <div>
            <span className="eyebrow">{administrative ? "Minha conta e privacidade" : "Minha conta"}</span>
            <h1><AccountGreeting fullName={profile?.fullName ?? session.fullName ?? undefined} /></h1>
            <p>{experience.label} · {session.email}</p>
            <p>{experience.introduction}</p>
          </div>
        </header>

        {session.activeRole === "producer" && producerApproved === false && (
          <section className="producer-onboarding-notice" role="status">
            <div>
              <strong>Seu cadastro de produtor ainda não foi aprovado.</strong>
              <p>Para continuar, cadastre seu imóvel rural e envie as informações para análise.</p>
            </div>
            <button
              type="button"
              className="secondary"
              aria-expanded={producerGuideOpen}
              aria-controls="producer-onboarding-guide"
              onClick={() => setProducerGuideOpen((open) => !open)}
            >
              {producerGuideOpen ? "Fechar guia" : "Ver guia passo a passo"}
            </button>
            {producerGuideOpen && (
              <div id="producer-onboarding-guide" className="producer-onboarding-guide">
                <ol>
                  <li>
                    {producerGuideProperty
                      ? `Existe um imóvel em andamento. O cadastro salvo está na etapa ${Math.max(1, Math.min(6, producerGuideProperty.wizardCurrentStep))} de 6.`
                      : "Abra Imóveis rurais e inicie um novo cadastro."}
                  </li>
                  <li>A etapa 1 é <strong>Documentos do imóvel</strong>; anexe e confira o CAR ou CCIR.</li>
                  <li>Ao abrir o imóvel, as etapas pendentes são recalculadas pelos dados reais e ficam disponíveis para acesso direto.</li>
                  <li>Na etapa 6, confira a ficha e envie para análise.</li>
                </ol>
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    onNavigate(
                      producerGuideProperty
                        ? `/produtor/propriedades/novo?id=${encodeURIComponent(producerGuideProperty.id)}&step=${Math.max(1, Math.min(6, producerGuideProperty.wizardCurrentStep))}`
                        : "/produtor/propriedades",
                    )
                  }
                >
                  {producerGuideProperty ? "Continuar cadastro do imóvel" : "Ir para Imóveis rurais"}
                </button>
              </div>
            )}
          </section>
        )}

        <div className="account-hub-grid">
          {!administrative&&<>
            <button className="account-hub-card" onClick={()=>onNavigate("/compras")}><ReceiptText/><span><strong>Minhas compras</strong><small>Revisões, pagamentos e comprovantes da compra</small></span></button>
            <button className="account-hub-card" onClick={()=>onNavigate("/pedidos")}><Truck/><span><strong>Acompanhar pedidos</strong><small>Do preparo na horta até a entrega</small></span></button>
            <button className="account-hub-card" onClick={()=>onNavigate("/reembolsos")}><ShieldCheck/><span><strong>Reembolsos</strong><small>Confira a política e acompanhe suas solicitações</small></span></button>
            <button className="account-hub-card" onClick={()=>onNavigate("/denuncias")}><Flag/><span><strong>Denúncias e segurança</strong><small>Relate problemas e converse com a equipe responsável</small></span></button>
          </>}
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
          {session.activeRole === "producer" && (
            <>
              <button
                className="account-hub-card account-hub-card-rural"
                onClick={() => onNavigate("/produtor/propriedades")}
              >
                <Sprout />
                <span>
                  <strong>Imóveis rurais</strong>
                  <small>Cadastre propriedades, áreas, água e atividades produtivas</small>
                </span>
              </button>
              <button className="account-hub-card" onClick={() => onNavigate("/produtor/loja")}>
                <Store />
                <span><strong>Minha loja</strong><small>Prepare sua vitrine, configure horários e acompanhe a abertura</small></span>
              </button>
              <button className="account-hub-card" onClick={()=>onNavigate("/produtor/caixa")}><CreditCard/><span><strong>Caixa do produtor</strong><small>Prepare vendas presenciais com Pix do sistema ou maquininha</small></span></button>
              <button className="account-hub-card" onClick={()=>onNavigate("/produtor/loja/janelas")}><PackageCheck/><span><strong>Janelas de entrega</strong><small>Horários e vagas para agendar entregas</small></span></button>
              <button className="account-hub-card" onClick={()=>onNavigate("/produtor/pedidos")}><PackageCheck/><span><strong>Pedidos da minha loja</strong><small>Organize o preparo e acompanhe cada entrega</small></span></button>
              <button className="account-hub-card" onClick={() => onNavigate("/produtor/produtos")}>
                <Salad />
                <span><strong>Meus produtos</strong><small>Cadastre alimentos, fotos, embalagens e preços de venda</small></span>
              </button>
              {producerApproved && (
                <button
                  className="account-hub-card"
                  onClick={() => onNavigate("/produtor/entrega")}
                >
                  <Truck />
                  <span>
                    <strong>Escopo de entrega</strong>
                    <small>Defina se você entrega no município do imóvel, em todos ou em municípios escolhidos</small>
                  </span>
                </button>
              )}
            </>
          )}
        </div>
        <button className="secondary account-action" type="button" onClick={() => onNavigate(administrative ? "/admin/painel" : "/minha-conta")}>
          {administrative ? "Voltar ao painel administrativo" : "Segurança e sair da conta"}
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
          <span className="eyebrow">{administrative ? "Minha conta e privacidade" : "Minha conta"}</span>
          <h1>
            {path === "/conta/enderecos" ? experience.addressTitle : sections.find(([route]) => route === path)?.[1] ?? "Conta"}
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
          key={session.userId}
          title={experience.addressTitle}
          help={experience.addressHelp}
          administrative={administrative}
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
            <div><dt>E-mail de acesso</dt><dd>{session.email || profile?.email || "Não informado"}</dd></div>
          </dl>
          {administrative && <div className="account-work-tools">
            <h3>Ferramentas de trabalho</h3>
            <button type="button" className="secondary" onClick={() => onNavigate("/admin/usuarios")}>Consultar usuários</button>
            <button type="button" className="secondary" onClick={() => onNavigate("/admin/governanca")}>Gerenciar convites</button>
            {session.activeRole === "platform_super_admin" && <button type="button" className="secondary" onClick={() => onNavigate("/admin/configuracao")}>Configurações globais</button>}
          </div>}
          {session.activeRole === "consumer" ? <fieldset>
            <legend>Avisos sobre seus pedidos</legend>
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

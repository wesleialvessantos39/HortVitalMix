import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Leaf,
  Images,
  Pause,
  Store,
} from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import { cryptoRandomUUID as newUuid } from "../../lib/uuid";
import type { ShellSession } from "../../hooks/useSession";
import {
  SaveStoreSettingsSchema,
  StoreOwnerResponseSchema,
  StoreSettingsResponseSchema,
  STORE_DAY_LABELS,
  type StoreOwner,
  type StoreSettings,
} from "../../../shared/contracts/producerStore";
import "./producerStore.css";
import { StoreMediaSettings } from "./StoreMediaSettings";

type Props = { session: ShellSession; onNavigate: (path: string) => void };
type Draft = {
  propertyId: string;
  storeSlug: string;
  storeName: string;
  bio: string;
  minimum: string;
  cutoffHour: string;
  operatingHours: StoreOwner["operatingHours"];
};
const statusLabels: Record<StoreOwner["status"], string> = {
  draft: "Rascunho",
  pending_review: "Em análise",
  active: "Vitrine aberta",
  paused: "Pausada",
  closed: "Encerrada",
};
function draftFrom(store: StoreOwner): Draft {
  return {
    propertyId: store.propertyId ?? "",
    storeSlug: store.storeSlug,
    storeName: store.storeName,
    bio: store.bio,
    minimum: (store.minOrderAmountCents / 100).toFixed(2),
    cutoffHour: store.cutoffHour,
    operatingHours: store.operatingHours,
  };
}
function errorMessage(error: ApiFailure) {
  if (error.message === "STORE_PUBLISH_FORBIDDEN")
    return "Seu imóvel ainda não foi homologado ou está indisponível para publicação nesta região. Acompanhe em Meus Imóveis e confira a cobertura e os bloqueios.";
  if (error.message === "STORE_SLUG_CONFLICT")
    return "Este endereço de loja já está em uso. Escolha outro endereço.";
  if (error.message === "STORE_REVISION_CONFLICT")
    return "A loja mudou em outro dispositivo. Suas alterações continuam aqui; recarregue as configurações antes de salvar novamente.";
  if (error.message === "STORE_BIO_INVALID")
    return "A apresentação precisa ter pelo menos 10 caracteres de texto depois da remoção de HTML.";
  if (error.message === "PROPERTY_NOT_FOUND")
    return "O imóvel selecionado não está mais disponível. Recarregue e escolha um imóvel seu.";
  if (error.message === "STORE_TRANSITION_FORBIDDEN")
    return "A situação da loja mudou. Recarregue as configurações para continuar.";
  return "Não foi possível concluir agora. Tente novamente.";
}

export default function ProducerStoreSettingsPage({
  session,
  onNavigate,
}: Props) {
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<"settings" | "hours" | "media">("settings");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [pauseReason, setPauseReason] = useState(
    "Pausa de emergência na colheita.",
  );
  const [reauthOpen, setReauthOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [reauthError, setReauthError] = useState("");
  const pending = useRef<(() => Promise<void>) | null>(null);
  const store = settings?.store;
  const dirty = Boolean(
    store &&
    draft &&
    JSON.stringify(draft) !== JSON.stringify(draftFrom(store)),
  );

  const hydrate = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = StoreSettingsResponseSchema.parse(
        await api("/v1/producer/store?media=1", { signal }),
      );
      if (signal?.aborted) return;
      setSettings(result);
      setDraft(result.store ? draftFrom(result.store) : null);
      setConflict(false);
    } catch (failure) {
      if (!signal?.aborted) setError(errorMessage(failure as ApiFailure));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void hydrate(controller.signal);
    return () => controller.abort();
  }, [hydrate, session.userId]);

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setNotice("");
  }
  async function execute(
    path: string,
    method: "POST" | "PATCH",
    input: unknown,
    message: string,
  ) {
    const run = async () => {
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const response = await api<{ store: StoreOwner }>(path + "?media=1", {
          method,
          body: JSON.stringify(input),
        });
        const saved = StoreOwnerResponseSchema.parse(response.store);
        setSettings((current) =>
          current ? { ...current, store: saved } : null,
        );
        setDraft(draftFrom(saved));
        pending.current = null;
        setReauthOpen(false);
        setPassword("");
        await hydrate();
        setNotice(message);
      } catch (failure) {
        const fault = failure as ApiFailure;
        if (fault.message === "RECENT_AUTH_REQUIRED") {
          pending.current = run;
          setReauthOpen(true);
        } else {
          setError(errorMessage(fault));
          setConflict(
            fault.message === "STORE_REVISION_CONFLICT" ||
              fault.message === "STORE_TRANSITION_FORBIDDEN",
          );
        }
      } finally {
        setBusy(false);
      }
    };
    await run();
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!store || !draft) return;
    const amount = draft.minimum.replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) {
      setError("Informe o pedido mínimo em reais com até duas casas decimais.");
      return;
    }
    const parsed = SaveStoreSettingsSchema.safeParse({
      propertyId: draft.propertyId,
      storeSlug: draft.storeSlug,
      storeName: draft.storeName,
      bio: draft.bio,
      minOrderAmountCents: Math.round(Number(amount) * 100),
      cutoffHour: draft.cutoffHour,
      operatingHours: draft.operatingHours,
      expectedRevision: store.revision,
      commandId: newUuid(),
    });
    if (!parsed.success) {
      setError(
        "Revise o imóvel, nome, endereço da loja e apresentação (mínimo de 10 caracteres), além dos horários.",
      );
      return;
    }
    await execute(
      `/v1/producer/store/${store.id}`,
      "PATCH",
      parsed.data,
      "Configurações e horários salvos.",
    );
  }
  async function confirmPassword(event: FormEvent) {
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
      if (restored.userId !== session.userId)
        throw new Error("IDENTITY_MISMATCH");
      window.dispatchEvent(new CustomEvent("hvm:session-changed"));
      setPassword("");
      await pending.current?.();
    } catch {
      setReauthError("Não foi possível confirmar sua senha. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hvm-store hvm-store-settings">
      <header className="hvm-store-heading">
        <button
          className="hvm-store-back"
          aria-label="Voltar para minha conta"
          onClick={() => onNavigate("/conta")}
        >
          <ArrowLeft />
        </button>
        <div>
          <span className="eyebrow">Do campo para a sua região</span>
          <h1>Minha loja</h1>
          <p>Apresente sua produção e organize a rotina da sua vitrine.</p>
        </div>
        {store && (
          <span className={`hvm-store-status hvm-store-status-${store.status}`}>
            {statusLabels[store.status]}
          </span>
        )}
      </header>
      {loading ? (
        <p role="status" className="account-notice">
          Carregando sua loja…
        </p>
      ) : !settings ? (
        <div className="hvm-store-empty">
          <Store />
          <h2>Vamos tentar novamente</h2>
          <button
            className="secondary"
            onClick={() => {
              setError("");
              void hydrate();
            }}
          >
            Recarregar loja
          </button>
        </div>
      ) : !store || !draft ? (
        <div className="hvm-store-empty">
          <span className="hvm-store-emblem">
            <Leaf />
          </span>
          <h2>Sua história merece uma vitrine</h2>
          <p>
            Crie seu rascunho para configurar nome, apresentação e horários. A
            abertura depende de um imóvel aprovado na região.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void execute(
                "/v1/producer/store",
                "POST",
                { commandId: newUuid() },
                "Rascunho criado. Agora personalize sua loja.",
              )
            }
          >
            {busy ? "Criando…" : "Criar minha vitrine"}
          </button>
          <button
            className="secondary"
            onClick={() => onNavigate("/produtor/propriedades")}
          >
            Meus Imóveis
          </button>
        </div>
      ) : (
        <>
          <div className="hvm-store-overview">
            <span className="hvm-store-emblem">
              <Store />
            </span>
            <div>
              <h2>{store.storeName}</h2>
              <p>Uma vitrine para quem valoriza o que você cultiva.</p>
            </div>
            {store.status === "active" && settings.canPublish && (
              <a
                href={`/produtores/${store.storeSlug}`}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(`/produtores/${store.storeSlug}`);
                }}
              >
                <ExternalLink size={16} /> Ver vitrine pública
              </a>
            )}
          </div>
          {!settings.canPublish && (
            <div className="hvm-store-guidance">
              <Leaf size={22} />
              <div>
                <strong>Prepare sua loja com tranquilidade</strong>
                <p>
                  Para abrir, salve a apresentação e vincule um imóvel
                  homologado. A região precisa estar ativa e sem bloqueios de
                  publicação.
                </p>
                <button
                  className="hvm-store-text-button"
                  onClick={() => onNavigate("/produtor/propriedades")}
                >
                  Acompanhar em Meus Imóveis
                </button>
              </div>
            </div>
          )}
          <button
            className="secondary"
            onClick={() => onNavigate("/produtor/loja/entrega")}
          >
            Área de entrega e frete
          </button>
          <button className="secondary" onClick={()=>onNavigate("/produtor/loja/janelas")}>Janelas de entrega</button>
          <div
            role="tablist"
            aria-label="Configurações da loja"
            className="hvm-store-tabs"
          >
            <button
              id="store-settings-tab"
              role="tab"
              aria-selected={tab === "settings"}
              aria-controls="store-settings-panel"
              onClick={() => setTab("settings")}
            >
              <Store size={17} /> Apresentação
            </button>
            <button
              id="store-hours-tab"
              role="tab"
              aria-selected={tab === "hours"}
              aria-controls="store-hours-panel"
              onClick={() => setTab("hours")}
            >
              <Clock3 size={17} /> Rotina e horários
            </button>
            <button
              id="store-media-tab"
              role="tab"
              aria-selected={tab === "media"}
              aria-controls="store-media-panel"
              disabled={busy || mediaBusy}
              onClick={() => setTab("media")}
            >
              <Images size={17} /> Fotos e capa
            </button>
          </div>
          <div
            id="store-media-panel"
            role="tabpanel"
            aria-labelledby="store-media-tab"
            hidden={tab !== "media"}
          >
            <StoreMediaSettings
              key={store.id}
              store={store}
              disabled={busy || store.status === "closed"}
              onBusyChange={setMediaBusy}
              onReload={() => hydrate()}
              onRecentAuth={(retry) => {
                pending.current = retry;
                setReauthOpen(true);
              }}
              onUpdated={(saved) => {
                setSettings((current) =>
                  current ? { ...current, store: saved } : null,
                );
                pending.current = null;
                setReauthOpen(false);
                setPassword("");
              }}
            />
          </div>
          <form onSubmit={save} noValidate hidden={tab === "media"}>
            <fieldset
              disabled={busy || mediaBusy || store.status === "closed"}
              className="hvm-store-fieldset"
            >
              <div
                id="store-settings-panel"
                role="tabpanel"
                aria-labelledby="store-settings-tab"
                hidden={tab !== "settings"}
              >
                <div className="hvm-store-form-grid">
                  <label>
                    Nome da loja
                    <input
                      value={draft.storeName}
                      maxLength={128}
                      onChange={(event) =>
                        patch("storeName", event.target.value)
                      }
                      autoComplete="organization"
                    />
                  </label>
                  <label>
                    Endereço da vitrine
                    <input
                      value={draft.storeSlug}
                      maxLength={128}
                      onChange={(event) =>
                        patch("storeSlug", event.target.value)
                      }
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                    <small>
                      Use letras minúsculas, números e hífens. Exemplo:
                      chacara-boa-colheita
                    </small>
                  </label>
                  <label className="hvm-store-full">
                    Imóvel da loja
                    <select
                      value={draft.propertyId}
                      onChange={(event) =>
                        patch("propertyId", event.target.value)
                      }
                    >
                      <option value="">Selecione seu imóvel rural</option>
                      {settings.properties.map((property) => (
                        <option key={property.id} value={property.id}>
                          {property.name} ·{" "}
                          {property.approved
                            ? "Aprovado"
                            : "Aguardando homologação"}
                        </option>
                      ))}
                    </select>
                    <small>
                      Somente um imóvel seu, aprovado na região, libera a
                      publicação.
                    </small>
                  </label>
                  <label className="hvm-store-full">
                    Apresentação da produção
                    <textarea
                      value={draft.bio}
                      maxLength={2000}
                      rows={6}
                      onChange={(event) => patch("bio", event.target.value)}
                      placeholder="Conte sobre o que você cultiva, sua história no campo e os cuidados com a produção."
                    />
                    <small>
                      {draft.bio.length}/2000 caracteres. Texto e quebras de
                      linha.
                    </small>
                  </label>
                  <label>
                    Pedido mínimo (R$)
                    <input
                      inputMode="decimal"
                      value={draft.minimum}
                      onChange={(event) => patch("minimum", event.target.value)}
                    />
                  </label>
                  <label>
                    Horário de corte padrão
                    <input
                      type="time"
                      value={draft.cutoffHour}
                      onChange={(event) =>
                        patch("cutoffHour", event.target.value)
                      }
                    />
                    <small>Horário local de Rondônia.</small>
                  </label>
                </div>
              </div>
              <div
                id="store-hours-panel"
                role="tabpanel"
                aria-labelledby="store-hours-tab"
                hidden={tab !== "hours"}
              >
                <h2>Do seu tempo de colheita ao dia da entrega</h2>
                <p className="hvm-store-muted">
                  Marque os dias da sua rotina e o horário limite para cada dia.
                </p>
                <div className="hvm-store-days">
                  {draft.operatingHours.map((day) => (
                    <div className="hvm-store-day" key={day.dayOfWeek}>
                      <h3>{STORE_DAY_LABELS[day.dayOfWeek]}</h3>
                      <label className="hvm-store-checkbox">
                        <input
                          type="checkbox"
                          aria-label={`Dia de Colheita — ${STORE_DAY_LABELS[day.dayOfWeek]}`}
                          checked={day.isHarvestDay}
                          onChange={(event) =>
                            patch(
                              "operatingHours",
                              draft.operatingHours.map((current) =>
                                current.dayOfWeek === day.dayOfWeek
                                  ? {
                                      ...current,
                                      isHarvestDay: event.target.checked,
                                    }
                                  : current,
                              ),
                            )
                          }
                        />{" "}
                        Dia de Colheita
                      </label>
                      <label className="hvm-store-checkbox">
                        <input
                          type="checkbox"
                          aria-label={`Dia de Entrega — ${STORE_DAY_LABELS[day.dayOfWeek]}`}
                          checked={day.isDeliveryDay}
                          onChange={(event) =>
                            patch(
                              "operatingHours",
                              draft.operatingHours.map((current) =>
                                current.dayOfWeek === day.dayOfWeek
                                  ? {
                                      ...current,
                                      isDeliveryDay: event.target.checked,
                                    }
                                  : current,
                              ),
                            )
                          }
                        />{" "}
                        Dia de Entrega
                      </label>
                      <label>
                        Horário de corte
                        <input
                          aria-label={`Horário de corte — ${STORE_DAY_LABELS[day.dayOfWeek]}`}
                          type="time"
                          value={day.cutoffTime}
                          onChange={(event) =>
                            patch(
                              "operatingHours",
                              draft.operatingHours.map((current) =>
                                current.dayOfWeek === day.dayOfWeek
                                  ? {
                                      ...current,
                                      cutoffTime: event.target.value,
                                    }
                                  : current,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </fieldset>
            <div className="hvm-store-actions">
              <button
                className="primary"
                type="submit"
                disabled={
                  busy ||
                  mediaBusy ||
                  !dirty ||
                  conflict ||
                  store.status === "closed"
                }
              >
                {busy ? "Salvando…" : "Salvar configurações"}
              </button>
              <span className="hvm-store-muted">
                {dirty
                  ? "Você tem alterações para salvar."
                  : "Tudo salvo por aqui."}
              </span>
            </div>
          </form>
          <div className="hvm-store-commercial">
            <div>
              <h2>
                {store.status === "active"
                  ? "Controle da vitrine"
                  : "Tudo pronto para abrir?"}
              </h2>
              <p>
                {store.status === "active"
                  ? "Se precisar interromper a operação, pause a vitrine imediatamente."
                  : "A publicação confere novamente a aprovação do imóvel e a disponibilidade da região."}
              </p>
            </div>
            {store.status === "active" ? (
              <div className="hvm-store-pause">
                <label>
                  Motivo da pausa
                  <input
                    maxLength={500}
                    value={pauseReason}
                    onChange={(event) => setPauseReason(event.target.value)}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={
                    busy ||
                    mediaBusy ||
                    conflict ||
                    pauseReason.trim().length < 3
                  }
                  onClick={() =>
                    void execute(
                      `/v1/producer/store/${store.id}/pause`,
                      "POST",
                      {
                        expectedRevision: store.revision,
                        commandId: newUuid(),
                        reason: pauseReason,
                      },
                      "Vitrine pausada. Ela não aparece para visitantes.",
                    )
                  }
                >
                  <Pause size={18} /> Pausa de Emergência
                </button>
              </div>
            ) : ["draft", "paused"].includes(store.status) ? (
              <button
                className="primary"
                disabled={busy || mediaBusy || dirty || conflict}
                onClick={() =>
                  void execute(
                    `/v1/producer/store/${store.id}/publish`,
                    "POST",
                    { expectedRevision: store.revision, commandId: newUuid() },
                    "Sua vitrine está aberta!",
                  )
                }
              >
                <CheckCircle2 size={18} /> Abrir Loja para Vendas
              </button>
            ) : null}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {conflict && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setError("");
            void hydrate();
          }}
        >
          Recarregar configurações
        </button>
      )}
      {notice && (
        <p role="status" className="account-notice">
          {notice}
        </p>
      )}
      {reauthOpen && (
        <form className="hvm-store-reauth" onSubmit={confirmPassword}>
          <h2>Confirme sua senha</h2>
          <p>Uma confirmação recente protege as configurações da sua loja.</p>
          <label>
            Senha atual
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {reauthError && (
            <p role="alert" className="account-error">
              {reauthError}
            </p>
          )}
          <div className="hvm-store-actions">
            <button className="primary" disabled={busy || !password}>
              Confirmar e continuar
            </button>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setReauthOpen(false);
                setPassword("");
                pending.current = null;
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

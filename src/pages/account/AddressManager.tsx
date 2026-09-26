import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Home,
  LocateFixed,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import type { AddressAdvancedView } from "../../../shared/contracts/addressAdvanced";
import { QUICK_ADDRESS_LABELS } from "../../../shared/contracts/addressAdvanced";
import { PostalLookupService } from "../../services/PostalLookupService";
import { OsmPinMap } from "./OsmPinMap";

type AddressState =
  | "loading"
  | "ready"
  | "empty"
  | "error"
  | "conflict";

type Props = {
  title: string;
  help: string;
  initialAddresses?: AddressAdvancedView[];
};

function commandId() {
  return crypto.randomUUID();
}

function mutationMessage(error: unknown) {
  const failure = error as ApiFailure;
  if (failure.message === "RECENT_AUTH_REQUIRED")
    return "Por segurança, entre novamente antes de alterar seus endereços.";
  if (failure.message === "ADDRESS_DUPLICATE")
    return "Este endereço já está cadastrado.";
  if (failure.status === 422 || failure.message === "ADDRESS_LIMIT_EXCEEDED")
    return "Limite de 10 endereços atingido. Remova um.";
  return "Não foi possível concluir a alteração agora.";
}

function LocationStatus({ address }: { address: AddressAdvancedView }) {
  const accuracy = address.geocodingAccuracy;
  const label =
    accuracy === "manual"
      ? "Ponto ajustado por você"
      : accuracy === "rooftop"
        ? "Ponto de entrega localizado"
        : accuracy === "street" || accuracy === "neighborhood"
          ? "Localização aproximada"
          : "Sem ponto no mapa";

  return (
    <span className={"address-location-status is-" + accuracy}>
      {accuracy === "none" ? <AlertTriangle /> : <MapPin />}
      <span>{label}</span>
    </span>
  );
}

export function AddressManager({ title, help, initialAddresses }: Props) {
  const [addresses, setAddresses] = useState<AddressAdvancedView[]>(initialAddresses ?? []);
  const [state, setState] = useState<AddressState>(initialAddresses ? (initialAddresses.length ? "ready" : "empty") : "loading");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<AddressAdvancedView | null>(null);

  const load = useCallback(async (keepConflict = false) => {
    if (!keepConflict) setState((current) => current === "ready" || current === "empty" ? current : "loading");
    setNotice("");
    try {
      const result = await api<{ addresses: AddressAdvancedView[] }>(
        "/v1/account/addresses",
      );
      setAddresses(result.addresses);
      setState(
        keepConflict
          ? "conflict"
          : result.addresses.length
            ? "ready"
            : "empty",
      );
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const limitReached = addresses.length >= 10;

  async function handleConflict() {
    await load(true);
  }

  async function makeDefault(address: AddressAdvancedView) {
    setBusyId(address.id);
    setNotice("");
    try {
      await api("/v1/account/addresses/" + address.id + "/default", {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: address.revision,
          commandId: commandId(),
        }),
      });
      await load();
      window.dispatchEvent(
        new Event("hortivitalmix:default-address-changed"),
      );
    } catch (error) {
      if ((error as ApiFailure).status === 409) {
        await handleConflict();
      } else {
        setNotice(mutationMessage(error));
      }
    } finally {
      setBusyId(null);
    }
  }

  async function removeAddress(address: AddressAdvancedView) {
    if (!confirm("Remover este endereço?")) return;
    setBusyId(address.id);
    setNotice("");
    try {
      await api("/v1/account/addresses/" + address.id, {
        method: "DELETE",
        body: JSON.stringify({
          expectedRevision: address.revision,
          commandId: commandId(),
        }),
      });
      await load();
      window.dispatchEvent(
        new Event("hortivitalmix:default-address-changed"),
      );
    } catch (error) {
      if ((error as ApiFailure).status === 409) {
        await handleConflict();
      } else {
        setNotice(mutationMessage(error));
      }
    } finally {
      setBusyId(null);
    }
  }

  function openCreate() {
    if (limitReached) {
      setNotice("Limite de 10 endereços atingido. Remova um.");
      return;
    }
    setEditing(null);
    setSheetOpen(true);
  }

  function openEdit(address: AddressAdvancedView) {
    setEditing(address);
    setSheetOpen(true);
  }

  const panelHeader = (
    <div className="account-panel-title address-manager-heading">
      <div>
        <h2>{title}</h2>
        <p>{help}</p>
      </div>
      <button
        className="primary account-small-button"
        type="button"
        onClick={openCreate}
        disabled={limitReached || state === "loading" || state === "error"}
      >
        <Plus />
        {state === "empty" ? "Adicionar um endereço" : "Adicionar novo endereço"}
      </button>
    </div>
  );

  if (state === "loading") {
    return (
      <div className="account-panel address-manager" aria-busy="true">
        {panelHeader}
        <div className="address-list" aria-label="Carregando endereços">
          {[0, 1].map((item) => (
            <div key={item} className="address-card address-card-skeleton">
              <span className="skeleton-block skeleton-icon" />
              <div>
                <span className="skeleton-block skeleton-title" />
                <span className="skeleton-block skeleton-line" />
                <span className="skeleton-block skeleton-line short" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="account-panel address-manager">
        {panelHeader}
        <div className="address-state-card address-state-error" role="alert">
          <AlertTriangle />
          <div>
            <h3>Não foi possível carregar seus endereços</h3>
            <p>Confira sua conexão e tente novamente. Seus dados não foram alterados.</p>
          </div>
          <button className="secondary" type="button" onClick={() => void load()}>
            <RefreshCw />
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="account-panel address-manager">
      {panelHeader}

      {state === "conflict" && (
        <div className="address-state-card address-state-conflict" role="status">
          <AlertTriangle />
          <div>
            <h3>Este endereço mudou em outra sessão</h3>
            <p>Recarregamos a versão mais recente para evitar sobrescrever dados.</p>
          </div>
          <button
            className="secondary"
            type="button"
            onClick={() =>
              setState(addresses.length ? "ready" : "empty")
            }
          >
            Continuar
          </button>
        </div>
      )}

      {limitReached && (
        <div className="address-limit-notice" role="status">
          <AlertTriangle />
          <span>Limite de 10 endereços atingido. Remova um.</span>
        </div>
      )}

      {state === "empty" ? (
        <div className="address-state-card address-state-empty">
          <MapPin />
          <div>
            <h3>Nenhum endereço cadastrado</h3>
            <p>Cadastre seu primeiro endereço pessoal. Ele será definido como padrão automaticamente.</p>
          </div>
        </div>
      ) : (
        <div className="address-list">
          {addresses.map((address) => (
            <article key={address.id} className="address-card">
              <div className="address-card-icon" aria-hidden="true">
                <Home />
              </div>
              <div className="address-card-body">
                <div className="address-card-title">
                  <strong>{address.label}</strong>
                  {address.isDefault && (
                    <span className="address-default-badge">
                      <CheckCircle2 />
                      Padrão
                    </span>
                  )}
                </div>

                <p>
                  {address.street +
                    ", " +
                    address.number +
                    (address.complement
                      ? " · " + address.complement
                      : "")}
                </p>
                <p>
                  {address.neighborhood +
                    " · " +
                    address.city +
                    "/" +
                    address.state +
                    " · CEP " +
                    address.cep.replace(/(\d{5})(\d{3})/, "$1-$2")}
                </p>

                {address.deliveryNotes && (
                  <div className="address-delivery-note">
                    <strong>Para a entrega</strong>
                    <span>{address.deliveryNotes}</span>
                  </div>
                )}

                <LocationStatus address={address} />

                <div className="address-actions">
                  <button
                    type="button"
                    disabled={Boolean(busyId)}
                    onClick={() => openEdit(address)}
                  >
                    <Pencil />
                    Editar
                  </button>

                  {!address.isDefault && (
                    <button
                      type="button"
                      disabled={Boolean(busyId)}
                      onClick={() => void makeDefault(address)}
                    >
                      <CheckCircle2 />
                      Tornar padrão
                    </button>
                  )}

                  <button
                    className="danger-link"
                    type="button"
                    disabled={Boolean(busyId)}
                    onClick={() => void removeAddress(address)}
                  >
                    <Trash2 />
                    {busyId === address.id ? "Removendo…" : "Remover"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {notice && (
        <p className="account-notice" role="status">
          {notice}
        </p>
      )}

      {sheetOpen && (
        <AddressEditorSheet
          initial={editing}
          onClose={() => {
            setSheetOpen(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setSheetOpen(false);
            setEditing(null);
            await load();
            window.dispatchEvent(
              new Event("hortivitalmix:default-address-changed"),
            );
          }}
          onConflict={async () => {
            setSheetOpen(false);
            setEditing(null);
            await handleConflict();
          }}
          onNotice={setNotice}
        />
      )}
    </div>
  );
}

function AddressEditorSheet({
  initial,
  onClose,
  onSaved,
  onConflict,
  onNotice,
}: {
  initial: AddressAdvancedView | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onConflict: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const editing = Boolean(initial);
  const [label, setLabel] = useState(initial?.label ?? "Casa");
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deliveryNotes, setDeliveryNotes] = useState(
    initial?.deliveryNotes ?? "",
  );
  const [coordinates, setCoordinates] = useState<{
    latitude: number;
    longitude: number;
  } | null>(
    initial?.latitude !== null &&
      initial?.latitude !== undefined &&
      initial?.longitude !== null &&
      initial?.longitude !== undefined
      ? {
          latitude: initial.latitude,
          longitude: initial.longitude,
        }
      : null,
  );
  const [coordinatesDirty, setCoordinatesDirty] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [error, setError] = useState("");
  const [fields, setFields] = useState({
    cep: initial?.cep ?? "",
    street: initial?.street ?? "",
    number: initial?.number ?? "S/N",
    complement: initial?.complement ?? "",
    neighborhood: initial?.neighborhood ?? "",
    city: initial?.city ?? "",
    state: initial?.state ?? "RO",
    isDefault: initial?.isDefault ?? false,
  });
  const submission = useRef(false);
  const lookupVersion = useRef(0);

  async function postalLookup(raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length !== 8) return;
    const version = ++lookupVersion.current;
    setLookingUp(true);
    const result = await PostalLookupService.lookup(raw);
    if (version !== lookupVersion.current) return;
    setLookingUp(false);
    if (!result) return;
    setFields((current) => ({
      ...current,
      cep: digits,
      street: result.street || current.street,
      neighborhood: result.neighborhood || current.neighborhood,
      city: result.city || current.city,
      state: result.state || current.state || "RO",
    }));
  }

  function useCurrentLocation() {
    setLocationMessage("");
    if (!navigator.geolocation) {
      setLocationMessage(
        "Localização do aparelho indisponível. Toque no mapa para posicionar o ponto.",
      );
      return;
    }

    setLocationMessage("Solicitando permissão de localização…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setCoordinates(next);
        setCoordinatesDirty(true);
        setLocationMessage(
          "Localização recebida. Arraste o marcador se precisar ajustar.",
        );
      },
      () => {
        setLocationMessage(
          "Permissão não concedida. Você pode posicionar o ponto manualmente no mapa.",
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60_000,
      },
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submission.current) return;
    submission.current = true;
    setSaving(true);
    setError("");
    onNotice("");

    const base = {
      label,
      cep: fields.cep,
      street: fields.street,
      number: fields.number || "S/N",
      complement: fields.complement.trim() || null,
      neighborhood: fields.neighborhood,
      city: fields.city,
      state: fields.state.toUpperCase(),
      deliveryNotes: deliveryNotes.trim() || null,
      commandId: commandId(),
    };

    const coordinatePayload =
      coordinatesDirty && coordinates
        ? {
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
          }
        : {};

    try {
      if (initial) {
        await api("/v1/account/addresses/" + initial.id, {
          method: "PATCH",
          body: JSON.stringify({
            ...base,
            ...coordinatePayload,
            expectedRevision: initial.revision,
          }),
        });
      } else {
        await api("/v1/account/addresses", {
          method: "POST",
          body: JSON.stringify({
            ...base,
            ...(coordinates
              ? {
                  latitude: coordinates.latitude,
                  longitude: coordinates.longitude,
                }
              : {}),
            isDefault: fields.isDefault,
          }),
        });
      }
      await onSaved();
    } catch (caught) {
      const failure = caught as ApiFailure;
      if (failure.status === 409 && failure.message !== "ADDRESS_DUPLICATE") {
        await onConflict();
        return;
      }
      const message = mutationMessage(caught);
      setError(message);
      if (failure.status === 422) onNotice(message);
    } finally {
      submission.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="account-sheet-backdrop" role="presentation">
      <form
        className="account-sheet address-editor-sheet"
        onSubmit={submit}
        aria-label={editing ? "Editar endereço" : "Novo endereço"}
      >
        <header>
          <div>
            <span className="eyebrow">Local de entrega</span>
            <h2>{editing ? "Editar endereço" : "Novo endereço"}</h2>
          </div>
          <button type="button" aria-label="Fechar" onClick={onClose}>
            <X />
          </button>
        </header>

        <fieldset className="address-quick-labels">
          <legend>Rótulo</legend>
          <div>
            {QUICK_ADDRESS_LABELS.map((quickLabel) => (
              <button
                key={quickLabel}
                type="button"
                aria-pressed={label === quickLabel}
                onClick={() => setLabel(quickLabel)}
              >
                {quickLabel}
              </button>
            ))}
          </div>
          <label>
            Outro rótulo
            <input
              name="label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={64}
              required
            />
          </label>
        </fieldset>

        <label>
          CEP
          <input
            name="cep"
            inputMode="numeric"
            placeholder="00000-000"
            value={fields.cep}
            onChange={(event) => {
              lookupVersion.current += 1;
              setLookingUp(false);
              setFields({
                ...fields,
                cep: event.target.value.replace(/\D/g, "").slice(0, 8),
              });
            }}
            onBlur={(event) => void postalLookup(event.currentTarget.value)}
            required
          />
          {lookingUp && <small>Buscando endereço…</small>}
        </label>

        <label>
          Rua
          <input
            name="street"
            value={fields.street}
            onChange={(event) =>
              setFields({ ...fields, street: event.target.value })
            }
            minLength={2}
            maxLength={255}
            required
          />
        </label>

        <div className="account-time-grid">
          <label>
            Número
            <input
              name="number"
              value={fields.number}
              onChange={(event) =>
                setFields({ ...fields, number: event.target.value })
              }
              maxLength={32}
              required
            />
          </label>
          <label>
            Complemento
            <input
              name="complement"
              value={fields.complement}
              onChange={(event) =>
                setFields({ ...fields, complement: event.target.value })
              }
              maxLength={128}
            />
          </label>
        </div>

        <label>
          Bairro
          <input
            name="neighborhood"
            value={fields.neighborhood}
            onChange={(event) =>
              setFields({ ...fields, neighborhood: event.target.value })
            }
            minLength={2}
            maxLength={128}
            required
          />
        </label>

        <div className="account-time-grid">
          <label>
            Cidade
            <input
              name="city"
              value={fields.city}
              onChange={(event) =>
                setFields({ ...fields, city: event.target.value })
              }
              minLength={2}
              maxLength={100}
              required
            />
          </label>
          <label>
            UF
            <input
              name="state"
              value={fields.state}
              onChange={(event) =>
                setFields({
                  ...fields,
                  state: event.target.value.toUpperCase().slice(0, 2),
                })
              }
              maxLength={2}
              required
            />
          </label>
        </div>

        <label>
          Instruções para entrega
          <textarea
            name="deliveryNotes"
            value={deliveryNotes}
            onChange={(event) => setDeliveryNotes(event.target.value)}
            maxLength={255}
            placeholder="Ex.: portão branco, chamar no interfone"
          />
          <small>{deliveryNotes.length}/255</small>
        </label>

        <section className="address-map-section" aria-labelledby="map-heading">
          <div className="address-map-heading">
            <div>
              <strong id="map-heading">Ponto de entrega no mapa</strong>
              <span>
                Ajuste apenas se ajudar a localizar sua entrada com mais precisão.
              </span>
            </div>
            <button
              className="secondary address-location-button"
              type="button"
              onClick={useCurrentLocation}
            >
              <LocateFixed />
              Usar minha localização atual
            </button>
          </div>

          <OsmPinMap
            latitude={coordinates?.latitude ?? null}
            longitude={coordinates?.longitude ?? null}
            onChange={(next) => {
              setCoordinates(next);
              setCoordinatesDirty(true);
              setLocationMessage("Ponto ajustado manualmente.");
            }}
          />

          {locationMessage && (
            <p className="address-location-message" role="status">
              <MapPin />
              <span>{locationMessage}</span>
            </p>
          )}
        </section>

        {!editing && (
          <label className="account-toggle">
            <input
              type="checkbox"
              name="isDefault"
              checked={fields.isDefault}
              onChange={(event) =>
                setFields({ ...fields, isDefault: event.target.checked })
              }
            />
            <span>Definir como endereço padrão</span>
          </label>
        )}

        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}

        <button className="primary" disabled={saving}>
          {saving
            ? "Salvando…"
            : editing
              ? "Salvar alterações"
              : "Salvar endereço"}
        </button>
      </form>
    </div>
  );
}

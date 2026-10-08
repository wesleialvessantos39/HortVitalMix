import { PageLoading } from "../../components/PageLoading";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ArrowLeft, ArrowRight, Package, Wheat, History } from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import { enqueueCommand,offlineTransport,producerRead } from "../../lib/offlineDb";
import type { ShellSession } from "../../hooks/useSession";
import {
  RegisterHarvestCommandSchema,
  InventoryResponseSchema,
  HarvestResponseSchema,
  INVENTORY_LOTS_PAGE_SIZE,
  INVENTORY_MOVEMENTS_PAGE_SIZE,
  INVENTORY_MOVEMENT_LABELS,
  addInventoryDays,
  type Inventory,
  type RegisterHarvest,
} from "../../../shared/contracts/inventory";
import { UNIT_LABELS } from "../../../shared/contracts/product";
import "./products.css";
import "./inventory.css";
const messages: Record<string, string> = {
  INVENTORY_STORE_INELIGIBLE:
    "Ative sua loja e conclua a aprovação do imóvel para lançar uma colheita.",
  INVENTORY_PRODUCT_NOT_FOUND:
    "Este produto não está disponível para sua conta.",
  INVENTORY_LOT_CODE_CONFLICT:
    "Este código de lote já foi cadastrado neste produto. Confira os lotes e use um código diferente para uma nova colheita.",
  INVENTORY_COMMAND_CONFLICT:
    "A solicitação foi usada com outros dados. Recarregue os lotes antes de tentar novamente.",
  INVENTORY_FUTURE_HARVEST: "A data de colheita não pode ser futura.",
  INVENTORY_VALIDATION_FAILED: "Revise código, datas e quantidade da colheita.",
  VALIDATION_ERROR: "Revise código, datas e quantidade da colheita.",
  PRODUCER_PROFILE_REQUIRED:
    "Entre com a conta de produtor titular deste produto.",
  OFFLINE_SNAPSHOT_MISSING:"Abra os lotes deste produto com conexão antes de lançar colheitas no campo.",
  OFFLINE_STORAGE_UNAVAILABLE:"Não foi possível salvar neste aparelho. Seus dados permanecem no formulário; libere espaço e tente novamente.",
};
function message(error: unknown) {
  return (
    messages[(error as ApiFailure).message] ??
    "Não foi possível concluir agora. Seus dados foram preservados. Tente novamente."
  );
}
const dateText = (date: string) =>
  new Date(date + "T12:00:00Z").toLocaleDateString("pt-BR", {
    timeZone: "UTC",
  });
export default function InventoryLotsPage({
  id,
  session,
  onNavigate,
}: {
  id: string;
  session: ShellSession;
  onNavigate: (path: string) => void;
}) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState("");
  const [lotsPage, setLotsPage] = useState(1),
    [movementsPage, setMovementsPage] = useState(1);
  const [draft, setDraft] = useState({
    lotCode: "",
    harvestDate: "",
    expirationDate: "",
    quantity: "",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [reauth, setReauth] = useState(false),
    [password, setPassword] = useState(""),
    [reauthError, setReauthError] = useState("");
  const initialDates = useRef(false),
    command = useRef<{ fingerprint: string; id: string } | null>(null);
  const pending = useRef<RegisterHarvest | null>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError("");
      try {
        const result = await producerRead(session.userId,
            `/v1/producer/products/${id}/lots?lotsPage=${lotsPage}&movementsPage=${movementsPage}`,
            InventoryResponseSchema,signal,
        );
        if (signal?.aborted) return;
        setInventory(result);
        if (!initialDates.current) {
          initialDates.current = true;
          setDraft((current) => ({
            ...current,
            harvestDate: result.businessDate,
            expirationDate: addInventoryDays(
              result.businessDate,
              result.product.shelfLifeDays,
            ),
          }));
        }
      } catch (failure) {
        if (!signal?.aborted) setLoadError(message(failure));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [id, lotsPage, movementsPage,session.userId],
  );
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    return () => abort.abort();
  }, [load, session.userId]);
  useEffect(()=> {const refresh=()=>void load();window.addEventListener("hvm:offline-synchronized",refresh);window.addEventListener("offline",refresh);return()=>{window.removeEventListener("hvm:offline-synchronized",refresh);window.removeEventListener("offline",refresh);};},[load]);
  async function queue(input:RegisterHarvest) {
    if(!inventory?.product.revision)throw new Error("OFFLINE_SNAPSHOT_MISSING");
    const {commandId,...harvest}=input;
    await enqueueCommand(session.userId,{commandId,commandType:"inventory.harvest",baseRevision:inventory.product.revision,payload:{productId:id,harvest}});
    pending.current=null;command.current=null;setReauth(false);setPassword("");
    setDraft(current=>({...current,lotCode:"",quantity:""}));setNotice("Colheita salva neste aparelho; aguardando sincronização e confirmação do servidor.");
  }
  async function execute(input: RegisterHarvest) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if(!navigator.onLine){await queue(input);return;}
      const result = HarvestResponseSchema.parse(
        await api(`/v1/producer/products/${id}/lots`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      );
      setInventory(result.inventory);
      setLotsPage(1);
      setMovementsPage(1);
      pending.current = null;
      command.current = null;
      setReauth(false);
      setPassword("");
      setDraft((current) => ({ ...current, lotCode: "", quantity: "" }));
      setNotice(
        "Colheita registrada. O lote e a entrada no histórico foram salvos.",
      );
    } catch (failure) {
      if(offlineTransport(failure)) {
        try{await queue(input);}catch(storageError){setError(message(storageError));}
        return;
      }
      const fault = failure as ApiFailure;
      if (["AUTH_REQUIRED", "RECENT_AUTH_REQUIRED"].includes(fault.message)) {
        pending.current = input;
        setReauth(true);
      } else setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  async function register(event: FormEvent) {
    event.preventDefault();
    const fields = { ...draft, quantity: Number(draft.quantity) };
    const fingerprint = JSON.stringify(fields);
    if (command.current?.fingerprint !== fingerprint)
      command.current = { fingerprint, id: crypto.randomUUID() };
    const input = RegisterHarvestCommandSchema.safeParse({
      ...fields,
      commandId: command.current.id,
    });
    if (
      !input.success ||
      (inventory && fields.harvestDate > (navigator.onLine?inventory.businessDate:new Date().toISOString().slice(0,10)))
    ) {
      setError(
        "Informe um código, uma colheita até hoje, validade igual ou posterior à colheita e quantidade inteira positiva.",
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
      if (restored.userId !== session.userId)
        throw new Error("IDENTITY_MISMATCH");
      window.dispatchEvent(new CustomEvent("hvm:session-changed"));
      setPassword("");
      if (pending.current) await execute(pending.current);
    } catch {
      setReauthError("Não foi possível confirmar sua senha. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  const disabled = busy || reauth || loading || !inventory?.canRegisterHarvest;
  return (
    <section className="hvm-products hvm-inventory">
      <button
        className="text-button"
        onClick={() => onNavigate("/produtor/produtos")}
      >
        <ArrowLeft size={17} /> Meus produtos
      </button>
      <header className="hvm-product-heading">
        <div>
          <span className="eyebrow">Do campo ao seu estoque</span>
          <h1>Lotes e colheitas</h1>
          <p>
            {inventory?.product.title ??
              "Acompanhe a validade e as entradas da sua produção."}
          </p>
        </div>
        <button
          className="secondary"
          onClick={() => onNavigate(`/produtor/produtos/${id}/editar`)}
        >
          Editar produto
        </button>
      </header>
      {loading && !inventory && (
        <PageLoading label="Carregando lotes e movimentos…" />
      )}
      {loadError ? (
        <div className="hvm-product-notice hvm-product-error" role="alert">
          <p>{loadError}</p>
          <button className="secondary" onClick={() => void load()}>
            Tentar novamente
          </button>
        </div>
      ) : (
        inventory && (
          <>
            <div
              className="hvm-inventory-summary"
              aria-label="Resumo do estoque"
            >
              <div>
                <Package size={21} />
                <span>Disponível para venda</span>
                <strong>{inventory.availableQuantity}</strong>
                <small>
                  {UNIT_LABELS[inventory.product.unitType]} · lotes dentro da
                  validade
                </small>
              </div>
              <div>
                <History size={21} />
                <span>Reservado</span>
                <strong>{inventory.reservedQuantity}</strong>
                <small>
                  {UNIT_LABELS[inventory.product.unitType]} · reservas ativas
                </small>
              </div>
              <div>
                <Wheat size={21} />
                <span>Lotes registrados</span>
                <strong>{inventory.pagination.lotsTotal}</strong>
                <small>Histórico da sua produção</small>
              </div>
            </div>
            {!inventory.canRegisterHarvest && (
              <div className="hvm-product-notice">
                <p>{messages.INVENTORY_STORE_INELIGIBLE}</p>
                <button
                  className="secondary"
                  onClick={() => onNavigate("/produtor/loja")}
                >
                  Minha loja
                </button>
              </div>
            )}
            {error && (
              <p className="hvm-product-notice hvm-product-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="hvm-product-notice" role="status">
                {notice}
              </p>
            )}
            {reauth && (
              <form
                className="hvm-product-panel hvm-product-reauth"
                onSubmit={confirm}
                aria-label="Confirmar sessão"
              >
                <h2>Confirme sua senha</h2>
                <p>
                  Sua colheita está preservada. Após confirmar, retomamos o
                  lançamento.
                </p>
                <label>
                  Senha atual
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                {reauthError && <p role="alert">{reauthError}</p>}
                <div className="hvm-product-actions">
                  <button className="primary" disabled={busy || !password}>
                    Confirmar e continuar
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      pending.current = null;
                      setReauth(false);
                      setPassword("");
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
            <form
              className="hvm-product-panel"
              onSubmit={register}
              aria-label="Lançar colheita"
            >
              <h2>
                <Wheat size={21} /> Lançar colheita
              </h2>
              <p>
                Identifique o lote e informe a quantidade em{" "}
                {UNIT_LABELS[inventory.product.unitType]}.
              </p>
              <fieldset disabled={disabled} className="hvm-inventory-fields">
                <legend className="visually-hidden">Dados da colheita</legend>
                <label>
                  Código do lote
                  <input
                    required
                    maxLength={64}
                    value={draft.lotCode}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        lotCode: e.target.value,
                      }))
                    }
                    placeholder="Ex.: COUVE-0510"
                  />
                </label>
                <label>
                  Quantidade
                  <input
                    type="number"
                    required
                    min={1}
                    max={2147483647}
                    step={1}
                    inputMode="numeric"
                    value={draft.quantity}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        quantity: e.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Data da colheita
                  <input
                    type="date"
                    required
                    max={navigator.onLine?inventory.businessDate:new Date().toISOString().slice(0,10)}
                    value={draft.harvestDate}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        harvestDate: e.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Data de validade
                  <input
                    type="date"
                    required
                    min={draft.harvestDate || undefined}
                    value={draft.expirationDate}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        expirationDate: e.target.value,
                      }))
                    }
                  />
                </label>
              </fieldset>
              <button className="primary" disabled={disabled}>
                {busy ? "Salvando colheita…" : "Registrar colheita"}
              </button>
            </form>
            <section
              className="hvm-product-panel"
              aria-label="Lotes cadastrados"
            >
              <h2>Lotes cadastrados</h2>
              {!inventory.lots.length ? (
                <div className="hvm-product-empty">
                  <Package size={32} />
                  <h3>Nenhum lote registrado</h3>
                  <p>
                    Lance a primeira colheita para disponibilizar este alimento.
                  </p>
                </div>
              ) : (
                <div className="hvm-inventory-lots">
                  {inventory.lots.map((lot) => (
                    <article key={lot.id} className="hvm-inventory-lot">
                      <div className="hvm-inventory-lot-title">
                        <h3>{lot.lotCode}</h3>
                        <span
                          className={`hvm-inventory-validity ${lot.expiresInDays < 0 ? "expired" : lot.expiresInDays <= 2 ? "near" : ""}`}
                        >
                          {lot.expiresInDays < 0
                            ? "Vencido"
                            : lot.expiresInDays === 0
                              ? "Vence hoje"
                              : lot.expiresInDays <= 2
                                ? "Validade próxima"
                                : "Dentro da validade"}
                        </span>
                      </div>
                      <p>
                        Colheita: {dateText(lot.harvestDate)} · Validade:{" "}
                        {dateText(lot.expirationDate)}
                      </p>
                      <dl>
                        <div>
                          <dt>Inicial</dt>
                          <dd>{lot.initialQuantity}</dd>
                        </div>
                        <div>
                          <dt>Saldo do lote</dt>
                          <dd>{lot.currentQuantity}</dd>
                        </div>
                        <div>
                          <dt>Reservado</dt>
                          <dd>{lot.reservedQuantity}</dd>
                        </div>
                      </dl>
                      {lot.expiresInDays < 0 && (
                        <small>
                          Este lote está fora da disponibilidade para venda.
                        </small>
                      )}
                    </article>
                  ))}
                </div>
              )}
              <Pagination
                label="lotes"
                page={lotsPage}
                total={inventory.pagination.lotsTotal}
                size={INVENTORY_LOTS_PAGE_SIZE}
                disabled={loading || busy}
                onPage={setLotsPage}
              />
            </section>
            <section
              className="hvm-product-panel"
              aria-label="Histórico de movimentos"
            >
              <h2>Histórico de movimentos</h2>
              {!inventory.movements.length ? (
                <p>Nenhum movimento registrado.</p>
              ) : (
                <ol className="hvm-inventory-history">
                  {inventory.movements.map((m) => (
                    <li key={m.id}>
                      <div>
                        <strong>
                          {INVENTORY_MOVEMENT_LABELS[m.movementType]}
                        </strong>
                        <span
                          className={
                            m.quantityDelta < 0 ? "negative" : "positive"
                          }
                        >
                          {m.quantityDelta > 0 ? "+" : ""}
                          {m.quantityDelta}{" "}
                          {UNIT_LABELS[inventory.product.unitType]}
                        </span>
                      </div>
                      <p>
                        Lote {m.lotCode} · {m.reasonDescription}
                      </p>
                      <time dateTime={m.createdAt}>
                        {new Date(m.createdAt).toLocaleString("pt-BR", {
                          timeZone: "America/Porto_Velho",
                        })}
                      </time>
                    </li>
                  ))}
                </ol>
              )}
              <Pagination
                label="movimentos"
                page={movementsPage}
                total={inventory.pagination.movementsTotal}
                size={INVENTORY_MOVEMENTS_PAGE_SIZE}
                disabled={loading || busy}
                onPage={setMovementsPage}
              />
            </section>
          </>
        )
      )}
    </section>
  );
}
function Pagination({
  label,
  page,
  total,
  size,
  disabled,
  onPage,
}: {
  label: string;
  page: number;
  total: number;
  size: number;
  disabled: boolean;
  onPage: (page: number) => void;
}) {
  if (total <= size) return null;
  const pages = Math.ceil(total / size);
  return (
    <nav
      className="hvm-inventory-pagination"
      aria-label={`Páginas de ${label}`}
    >
      <button
        className="secondary"
        disabled={disabled || page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label={`${label}: página anterior`}
      >
        <ArrowLeft size={16} /> Anterior
      </button>
      <span>
        Página {page} de {pages}
      </span>
      <button
        className="secondary"
        disabled={disabled || page >= pages}
        onClick={() => onPage(page + 1)}
        aria-label={`${label}: próxima página`}
      >
        Próxima <ArrowRight size={16} />
      </button>
    </nav>
  );
}

import { PageLoading } from "../../components/PageLoading";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Flag, MessageSquare, ShieldCheck } from "lucide-react";
import type { CaseView, OrderView } from "../../../shared/contracts/commerce";
import { api, type ApiFailure } from "../../lib/api";
import {
  commerceMessage,
  commerceMutation,
  money,
  date,
  statusLabels,
} from "../../lib/commerce";
import type { ShellSession } from "../../hooks/useSession";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";
import { RefundPolicy } from "../../components/commerce/RefundPolicy";
import { AdminReauthentication } from "../../components/commerce/AdminReauthentication";
import "./commerce.css";
type Target = {
  id: string;
  name: string;
  orderId: string | null;
  storeSlug?: string;
};
const refundReasons = [
  ["withdrawal", "Arrependimento"],
  ["quality", "Qualidade ou defeito"],
  ["missing_items", "Itens faltantes"],
  ["not_delivered", "Compra não entregue"],
  ["wrong_product", "Produto diferente"],
  ["other", "Outro problema"],
] as const;
const complaintReasons = [
  ["fraud", "Suspeita de fraude"],
  ["unsafe_food", "Alimento impróprio ou inseguro"],
  ["harassment", "Assédio ou comportamento abusivo"],
  ["misleading_information", "Informação enganosa"],
  ["payment_issue", "Problema com pagamento"],
  ["other", "Outro problema"],
] as const;
export default function CasesPage({
  kind,
  session,
  onNavigate,
  adminAccess,
}: {
  kind: "refund" | "complaint";
  session: ShellSession | null;
  onNavigate: (path: string) => void;
  adminAccess?: AdminVerifySessionResponse;
}) {
  const isAdmin = !!adminAccess,
    plural = kind === "refund" ? "refunds" : "complaints",
    base = `/v1/${isAdmin ? "admin/" : ""}commerce`,
    query = new URLSearchParams(location.search);
  const [cases, setCases] = useState<CaseView[]>([]),
    [selected, setSelected] = useState<CaseView | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(query.get("caseId")),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [reauth, setReauth] = useState(false),
    [orders, setOrders] = useState<OrderView[]>([]),
    [orderId, setOrderId] = useState(query.get("orderId") ?? ""),
    [reason, setReason] = useState("other"),
    [description, setDescription] = useState(""),
    [amount, setAmount] = useState(""),
    [targetType, setTargetType] = useState(query.get("targetType") ?? "store"),
    [targetId, setTargetId] = useState(query.get("targetId") ?? ""),
    [targets, setTargets] = useState<Target[]>([]),
    [targetSearch, setTargetSearch] = useState(query.get("search") ?? ""),
    [message, setMessage] = useState(""),
    [sellerMessage, setSellerMessage] = useState(""),
    [decision, setDecision] = useState("review"),
    [notes, setNotes] = useState(""),
    [approvedAmount, setApprovedAmount] = useState(""),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1);
  const flight = useRef(false),
    detailRevision = useRef(0);
  const userId = session?.userId;
  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void api<{ cases: CaseView[]; pages: number }>(
      `${base}/${plural}?page=${page}&filter=${filter}`,
      {
        signal: controller.signal,
      },
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setCases(value.cases);
          setPages(value.pages ?? 1);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(commerceMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    if (!isAdmin && kind === "refund")
      void api<{ orders: OrderView[] }>("/v1/commerce/purchases", {
        signal: controller.signal,
      })
        .then((value) => {
          if (!controller.signal.aborted) setOrders(value.orders);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(commerceMessage(e));
        });
    return () => controller.abort();
  }, [userId, base, plural, isAdmin, kind, page, filter]);
  useEffect(() => {
    if (isAdmin || kind !== "complaint" || !userId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<{ targets: Target[] }>(
        `/v1/commerce/report-targets?type=${encodeURIComponent(targetType)}&search=${encodeURIComponent(targetSearch)}`,
        { signal: controller.signal },
      )
        .then((value) => {
          if (!controller.signal.aborted) {
            setTargets(value.targets);
            const match = value.targets.find(
              (target) =>
                target.storeSlug ===
                new URLSearchParams(location.search).get("storeSlug"),
            );
            if (match) setTargetId(match.id);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(commerceMessage(e));
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [userId, isAdmin, kind, targetType, targetSearch]);
  useEffect(() => {
    if (!selectedId || !userId) return;
    const controller = new AbortController();
    const revision = ++detailRevision.current;
    setSelected(null);
    void api<CaseView>(`${base}/${plural}/${selectedId}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted && revision === detailRevision.current) {
          setSelected(value);
          setApprovedAmount(String((value.requestedAmountCents ?? 0) / 100));
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(commerceMessage(e));
      });
    return () => controller.abort();
  }, [userId, base, plural, selectedId]);
  useEffect(() => {
    if (!userId) return;
    const controller=new AbortController();let running=false;
    async function update() {
      if(running||controller.signal.aborted||document.visibilityState==="hidden"||navigator.onLine===false)return;
      running=true;
      try {
        const value=await api<{cases:CaseView[];pages:number}>(`${base}/${plural}?page=${page}&filter=${filter}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});
        if(controller.signal.aborted)return;
        setCases(value.cases);setPages(value.pages??1);
        if(selectedId) {
          const detail=await api<CaseView>(`${base}/${plural}/${selectedId}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});
          if(!controller.signal.aborted)setSelected(detail);
        }
      } catch(e) {
        if(!controller.signal.aborted){setError(commerceMessage(e));if([401,403,404].includes((e as ApiFailure).status??0))setSelected(null);}
      } finally {running=false;}
    }
    const sync=()=>void update(),timer=setInterval(sync,30000);
    window.addEventListener("hvm:notifications-updated",sync);
    window.addEventListener("focus",sync);window.addEventListener("online",sync);document.addEventListener("visibilitychange",sync);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener("hvm:notifications-updated",sync);window.removeEventListener("focus",sync);window.removeEventListener("online",sync);document.removeEventListener("visibilitychange",sync);};
  }, [userId,base,plural,page,filter,selectedId]);
  useEffect(() => {
    const order = orders.find((value) => value.id === orderId);
    if (order) setAmount((order.totalCents / 100).toFixed(2));
  }, [orders, orderId]);
  function failure(e: unknown) {
    setError(commerceMessage(e));
    if (
      [
        "ADMIN_REAUTH_REQUIRED",
        "REAUTH_REQUIRED",
        "RECENT_AUTH_REQUIRED",
      ].includes((e as ApiFailure).message)
    )
      setReauth(true);
  }
  async function execute(operation: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (e) {
      failure(e);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    const value = await api<{ cases: CaseView[]; pages: number }>(
      `${base}/${plural}?page=${page}&filter=${filter}`,
    );
    setCases(value.cases);
    setPages(value.pages ?? 1);
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!userId) return;
    await execute(async () => {
      const target = targets.find(
        (value) =>
          value.id === targetId &&
          (targetType !== "customer" || !orderId || value.orderId === orderId),
      );
      const payload =
        kind === "refund"
          ? {
              orderId,
              reason,
              description,
              requestedAmountCents: Math.round(
                Number(amount.replace(",", ".")) * 100,
              ),
            }
          : {
              targetType,
              targetId,
              orderId: target?.orderId ?? (orderId || null),
              reason,
              description,
            };
      const result = await commerceMutation<CaseView>(
        `${base}/${plural}`,
        payload,
        userId,
      );
      setSelectedId(result.id);
      setDescription("");
      setNotice(
        kind === "refund"
          ? "Solicitação registrada. O repasse permanece bloqueado durante a análise."
          : "Denúncia registrada de forma privada para análise da equipe de segurança.",
      );
      await refresh();
    });
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!userId || !selected) return;
    await execute(async () => {
      setSelected(
        await commerceMutation<CaseView>(
          `${base}/${plural}/${selected.id}/messages`,
          { message },
          userId,
        ),
      );
      setMessage("");
      setNotice("Mensagem enviada à solicitação.");
    });
  }
  async function contactSeller(event: FormEvent) {
    event.preventDefault();
    if(!isAdmin||kind!=="refund"||!selected||!userId)return;
    await execute(async()=>{
      setSelected(await commerceMutation<CaseView>(`${base}/refunds/${selected.id}/seller-contacts`,{message:sellerMessage},userId));
      setSellerMessage("");setNotice("Contato registrado para o vendedor acompanhar.");
    });
  }
  async function decide(event: FormEvent) {
    event.preventDefault();
    if (!userId || !selected) return;
    await execute(async () => {
      const payload = {
        expectedRevision: selected.revision,
        decision,
        notes,
        ...(kind === "refund" && decision === "approve"
          ? {
              approvedAmountCents: Math.round(
                Number(approvedAmount.replace(",", ".")) * 100,
              ),
            }
          : {}),
      };
      setSelected(
        await commerceMutation<CaseView>(
          `${base}/${plural}/${selected.id}/decision`,
          payload,
          userId,
        ),
      );
      setNotes("");
      setNotice("Decisão registrada com autor e data no histórico.");
      await refresh();
    });
  }
  async function attach(file: File | undefined) {
    if (!file || !userId || !selected) return;
    if (file.size > 2097152) {
      setError("O anexo deve ter até 2 MB.");
      return;
    }
    await execute(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      await commerceMutation(
        `${base}/evidence`,
        {
          caseType: kind,
          caseId: selected.id,
          fileName: file.name,
          mimeType: file.type,
          base64: btoa(binary),
        },
        userId,
      );
      setSelected(await api<CaseView>(`${base}/${plural}/${selected.id}`));
      setNotice("Anexo privado enviado.");
    });
  }
  async function evidence(id: string) {
    await execute(async () => {
      const value = await api<{ url: string }>(`${base}/evidence/${id}`);
      const parsed = new URL(value.url);
      if (parsed.origin !== "https://xipbsazvymkqqfmfegwu.supabase.co")
        throw Error("UNTRUSTED_EVIDENCE_URL");
      const link = document.createElement("a");
      link.href = value.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
    });
  }
  const closed =
    selected &&
    ["resolved", "dismissed", "rejected", "refunded"].includes(selected.status);
  return (
    <section className="hvm-commerce">
      <h1>
        {kind === "refund"
          ? isAdmin
            ? "Gestão de reembolsos"
            : "Meus reembolsos"
          : isAdmin
            ? "Denúncias e segurança"
            : "Minhas denúncias"}
      </h1>
      <p>
        {kind === "refund"
          ? "Acompanhe as solicitações, a análise e a confirmação do estorno."
          : "Relate problemas com lojas, produtores, produtos ou compras. As denúncias são privadas e analisadas pela equipe autorizada."}
      </p>
      {error && (
        <p role="alert" className="commerce-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="commerce-success">
          {notice}
        </p>
      )}
      {reauth && session && (
        <AdminReauthentication
          session={session}
          onConfirmed={() => {
            setReauth(false);
            setError("");
            setNotice(
              "Identidade confirmada. Sua edição foi preservada; envie a decisão novamente.",
            );
          }}
        />
      )}
      {!session ? (
        <article className="commerce-card">
          <p>Entre na sua conta para enviar e acompanhar solicitações.</p>
          <button
            className="primary"
            onClick={() => onNavigate("/entrar/consumidor")}
          >
            Entrar
          </button>
          <p>
            Se não conseguir acessar sua conta, procure hortivitalmix@gmail.com.
          </p>
        </article>
      ) : (
        <>
          {!isAdmin && (
            <form
              className="commerce-card"
              onSubmit={(event) => void create(event)}
            >
              <h2>
                {kind === "refund"
                  ? "Solicitar reembolso"
                  : "Registrar uma denúncia"}
              </h2>
              {kind === "refund" ? (
                <>
                  <label>
                    Compra
                    <select
                      required
                      value={orderId}
                      onChange={(event) => setOrderId(event.target.value)}
                    >
                      <option value="">Escolha uma compra paga</option>
                      {orders
                        .filter((order) => order.status !== "refunded")
                        .map((order) => (
                          <option key={order.id} value={order.id}>
                            {order.orderNumber} · {order.storeName} ·{" "}
                            {money(order.totalCents)}
                          </option>
                        ))}
                    </select>
                  </label>
                  {!orders.length && (
                    <p>
                      Uma solicitação de reembolso precisa estar vinculada a uma
                      compra com pagamento confirmado.
                    </p>
                  )}
                  <label>
                    Valor solicitado (R$)
                    <input
                      required
                      inputMode="decimal"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="0,00"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    O que você quer denunciar?
                    <select
                      value={targetType}
                      onChange={(event) => {
                        setTargetType(event.target.value);
                        setTargetId("");
                        setOrderId("");
                        setTargets([]);
                      }}
                    >
                      <option value="store">Loja</option>
                      <option value="producer">Produtor</option>
                      <option value="product">Produto</option>
                      {session.activeRole === "producer" && (
                        <option value="customer">
                          Cliente de uma compra na minha loja
                        </option>
                      )}
                    </select>
                  </label>
                  <label>
                    Buscar loja, produtor ou produto
                    <input
                      value={targetSearch}
                      onChange={(event) => setTargetSearch(event.target.value)}
                      disabled={targetType === "customer"}
                      placeholder="Busque pelo nome"
                    />
                  </label>
                  <label>
                    Item ou compra denunciada
                    <select
                      required
                      value={
                        targetType === "customer"
                          ? `${targetId}|${orderId}`
                          : targetId
                      }
                      onChange={(event) => {
                        const [id, order] = event.target.value.split("|");
                        setTargetId(id);
                        if (targetType === "customer") setOrderId(order ?? "");
                      }}
                    >
                      <option value="">Escolha o item</option>
                      {targetId &&
                        !targets.some((target) => target.id === targetId) && (
                          <option
                            value={
                              targetType === "customer"
                                ? `${targetId}|${orderId}`
                                : targetId
                            }
                          >
                            Item vinculado à compra selecionada
                          </option>
                        )}
                      {targets.map((target) => (
                        <option
                          key={`${target.id}|${target.orderId ?? ""}`}
                          value={
                            targetType === "customer"
                              ? `${target.id}|${target.orderId}`
                              : target.id
                          }
                        >
                          {target.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="commerce-form-help">
                    O produtor só pode denunciar clientes com uma compra
                    vinculada à sua loja. Nenhuma denúncia aplica uma penalidade
                    automaticamente.
                  </p>
                </>
              )}
              <label>
                Motivo
                <select
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                >
                  {(kind === "refund" ? refundReasons : complaintReasons).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Descreva o que aconteceu
                <textarea
                  required
                  minLength={10}
                  maxLength={4000}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Informe os fatos, o produto ou a compra e o que você precisa. Não envie senhas nem dados do cartão."
                />
              </label>
              <p className="commerce-form-help">
                Você poderá enviar fotos ou comprovantes privados após registrar
                a solicitação.
              </p>
              <button
                className="primary"
                disabled={
                  busy ||
                  (kind === "refund" && !orderId) ||
                  (kind === "complaint" && !targetId)
                }
              >
                {busy
                  ? "Registrando…"
                  : kind === "refund"
                    ? "Enviar solicitação"
                    : "Enviar denúncia"}
              </button>
            </form>
          )}
          <div className="commerce-grid">
            <article className="commerce-card">
              <h2>{isAdmin ? "Fila de análise" : "Seu histórico"}</h2>
              <label>
                Exibir
                <select
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">Todas</option>
                  <option value="open">Em andamento</option>
                  <option value="closed">Encerradas</option>
                </select>
              </label>
              {loading ? (
                <PageLoading label="Carregando solicitações…" compact />
              ) : !cases.length ? (
                <p>Nenhuma solicitação registrada.</p>
              ) : (
                <div className="commerce-case-list">
                  {cases
                    .filter(
                      (row) =>
                        filter === "all" ||
                        (filter === "closed") ===
                          [
                            "resolved",
                            "dismissed",
                            "rejected",
                            "refunded",
                          ].includes(row.status),
                    )
                    .map((row) => (
                      <button
                        key={row.id}
                        aria-pressed={selectedId === row.id}
                        onClick={() => {
                          setSelectedId(row.id);
                          setNotes("");
                          setMessage("");
                          setDecision("review");
                          setError("");
                        }}
                      >
                        <span>
                          <strong>
                            {(kind === "refund"
                              ? refundReasons
                              : complaintReasons
                            ).find(([value]) => value === row.reason)?.[1] ??
                              row.reason}
                          </strong>
                          <small>{date(row.createdAt)}</small>
                          <span className="commerce-reference">
                            Protocolo {row.id.slice(0, 8)}
                          </span>
                        </span>
                        <span className="commerce-tag">
                          {statusLabels[row.status] ?? row.status}
                        </span>
                      </button>
                    ))}
                </div>
              )}
              {pages > 1 && (
                <nav
                  className="commerce-actions"
                  aria-label="Páginas de solicitações"
                >
                  <button
                    className="secondary"
                    disabled={loading || page <= 1}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Anterior
                  </button>
                  <span>
                    Página {page} de {pages}
                  </span>
                  <button
                    className="secondary"
                    disabled={loading || page >= pages}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Próxima
                  </button>
                </nav>
              )}
            </article>
            <article className="commerce-card">
              <h2>
                <MessageSquare size={19} /> Detalhes e mensagens
              </h2>
              {!selected ? (
                <p>
                  {selectedId
                    ? "Carregando os detalhes…"
                    : "Escolha uma solicitação para consultar o histórico."}
                </p>
              ) : (
                <>
                  <span className="commerce-tag">
                    {statusLabels[selected.status]}
                  </span>
                  <p className="commerce-reference">Protocolo {selected.id}</p>
                  <p className="commerce-prewrap">{selected.description}</p>
                  {selected.requestedAmountCents !== undefined && (
                    <p>
                      Solicitado:{" "}
                      <strong>{money(selected.requestedAmountCents)}</strong>
                      {selected.approvedAmountCents
                        ? ` · Aprovado: ${money(selected.approvedAmountCents)}`
                        : ""}
                    </p>
                  )}
                  <h3>Histórico</h3>
                  <ol className="commerce-history">
                    {selected.history.map((event, index) => (
                      <li key={`${event.createdAt}-${index}`}>
                        <strong>
                          {statusLabels[event.status] ?? event.status}
                        </strong>
                        <p className="commerce-prewrap">{event.notes}</p>
                        <small>{date(event.createdAt)}</small>
                      </li>
                    ))}
                  </ol>
                  <h3>Mensagens</h3>
                  {!selected.messages.length && (
                    <p>Nenhuma mensagem adicional.</p>
                  )}
                  {selected.messages.map((value) => (
                    <div className="commerce-message" key={value.id}>
                      <strong>
                        {value.author === "admin"
                          ? "Equipe responsável"
                          : value.author === "producer"
                            ? "Produtor"
                            : "Cliente"}
                      </strong>
                      <p className="commerce-prewrap">{value.message}</p>
                      <small>{date(value.createdAt)}</small>
                    </div>
                  ))}
                  {!closed && (
                    <form onSubmit={(event) => void send(event)}>
                      <label>
                        {isAdmin
                          ? "Mensagem ao solicitante"
                          : "Adicionar informação"}
                        <textarea
                          required
                          minLength={10}
                          maxLength={4000}
                          value={message}
                          onChange={(event) => setMessage(event.target.value)}
                        />
                      </label>
                      <button className="secondary" disabled={busy}>
                        Enviar mensagem
                      </button>
                    </form>
                  )}
                  {isAdmin&&kind==="refund"&&<section aria-label="Contato com vendedor"><h3>Contato com o vendedor</h3><p>{selected.seller?.storeName} · {selected.seller?.orderNumber}</p><p>As orientações desta seção ficam disponíveis ao produtor titular da venda. A conversa com o consumidor permanece no atendimento privado.</p>
                    {selected.sellerContacts?.map(c=><div className="commerce-message" key={c.id}><p className="commerce-prewrap">{c.message}</p><small>{date(c.createdAt)}</small></div>)}
                    {!closed&&<form className="hvm-seller-contact-form" onSubmit={event=>void contactSeller(event)}><label>Orientação ao vendedor<textarea value={sellerMessage} required minLength={10} maxLength={4000} onChange={event=>setSellerMessage(event.target.value)}/></label><button className="secondary" disabled={busy}>Enviar ao vendedor</button></form>}
                  </section>}
                  <h3>Anexos privados</h3>
                  {selected.evidence.map((value) => (
                    <button
                      className="text-button"
                      key={value.id}
                      disabled={busy}
                      onClick={() => void evidence(value.id)}
                    >
                      {value.fileName}
                    </button>
                  ))}
                  {!closed && (
                    <label>
                      Adicionar foto ou comprovante (até 2 MB)
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        disabled={busy}
                        onChange={(event) => {
                          void attach(event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  {isAdmin && !closed && (
                    <form onSubmit={(event) => void decide(event)}>
                      <h3>
                        <ShieldCheck size={18} /> Decisão administrativa
                      </h3>
                      <label>
                        Etapa
                        <select
                          value={decision}
                          onChange={(event) => setDecision(event.target.value)}
                        >
                          <option value="review">
                            Iniciar / continuar análise
                          </option>
                          {kind === "refund" ? (
                            <>
                              <option value="approve">Aprovar reembolso</option>
                              <option value="reject">
                                Recusar com justificativa
                              </option>
                            </>
                          ) : (
                            <>
                              <option value="request_information">
                                Solicitar informações
                              </option>
                              <option value="resolve">Concluir análise</option>
                              <option value="dismiss">
                                Arquivar com justificativa
                              </option>
                            </>
                          )}
                        </select>
                      </label>
                      {kind === "refund" && decision === "approve" && (
                        <label>
                          Valor aprovado (R$)
                          <input
                            required
                            inputMode="decimal"
                            value={approvedAmount}
                            onChange={(event) =>
                              setApprovedAmount(event.target.value)
                            }
                          />
                        </label>
                      )}
                      <label>
                        Justificativa e orientação ao solicitante
                        <textarea
                          required
                          minLength={10}
                          maxLength={4000}
                          value={notes}
                          onChange={(event) => setNotes(event.target.value)}
                        />
                      </label>
                      <p className="commerce-form-help">
                        Essa justificativa ficará visível ao solicitante e será
                        registrada com autor e data.
                      </p>
                      {kind === "refund" && (
                        <p className="commerce-note">
                          A aprovação autoriza o estorno. A devolução financeira
                          dependerá da conta de pagamento e da confirmação do
                          provedor.
                        </p>
                      )}
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          (kind === "refund" &&
                            !["requested", "under_review"].includes(
                              selected.status,
                            ))
                        }
                      >
                        Registrar decisão
                      </button>
                    </form>
                  )}
                  {isAdmin &&
                    kind === "complaint" &&
                    selected.subjectUserId && (
                      <aside className="commerce-note">
                        <h3>
                          <Flag size={18} /> Integração com segurança
                        </h3>
                        <p>
                          A conta vinculada está disponível para análise na
                          governança. Bloqueios ou outras sanções exigem a
                          permissão própria e o procedimento de segurança
                          existente.
                        </p>
                        <p className="commerce-reference">
                          Conta {selected.subjectUserId}
                        </p>
                        {(adminAccess?.role === "platform_super_admin" ||
                          adminAccess?.sectors.includes(
                            "account_governance",
                          )) && (
                          <button
                            className="secondary"
                            onClick={() =>
                              onNavigate(
                                `/admin/usuarios?userId=${selected.subjectUserId}`,
                              )
                            }
                          >
                            Analisar segurança da conta
                          </button>
                        )}
                      </aside>
                    )}
                </>
              )}
            </article>
          </div>
          <p className="commerce-form-help">
            Dificuldade de acesso? Fale com hortivitalmix@gmail.com. Não envie
            dados completos do cartão ou senhas.
          </p>
        </>
      )}
      {!isAdmin && kind === "refund" && (
        <RefundPolicy onNavigate={onNavigate} />
      )}
    </section>
  );
}

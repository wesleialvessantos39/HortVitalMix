import { PageLoading } from "../../components/PageLoading";
import { useEffect, useState } from "react";
import { CreditCard, QrCode, ShieldCheck, Clock3 } from "lucide-react";
import type { PaymentView } from "../../../shared/contracts/commerce";
import { api } from "../../lib/api";
import { commerceMessage, money } from "../../lib/commerce";
import { RefundPolicy } from "../../components/commerce/RefundPolicy";
import "./commerce.css";
export default function PaymentPreparedPage({
  id,
  userId,
  onNavigate,
}: {
  id: string;
  userId: string | null;
  onNavigate: (path: string) => void;
}) {
  const [payment, setPayment] = useState<PaymentView | null>(null),
    [error, setError] = useState(""),
    [agree, setAgree] = useState(false),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    void api<PaymentView>("/v1/payments/" + encodeURIComponent(id), {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setPayment(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(commerceMessage(e));
      });
    return () => controller.abort();
  }, [id, userId]);
  useEffect(() => {
    if (!payment || payment.status !== "pending") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [payment?.status]);
  useEffect(() => {
    if (!payment?.gatewayAvailable || payment.status !== "pending" || !userId)
      return;
    const controller = new AbortController();
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      void api<PaymentView>("/v1/payments/" + id, { signal: controller.signal })
        .then((value) => {
          if (!controller.signal.aborted) {
            setPayment(value);
            if (value.status === "approved") onNavigate(value.subscriptionId ? "/assinaturas/minhas" : "/compras");
          }
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    }, 5000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [id, userId, payment?.gatewayAvailable, payment?.status, onNavigate]);
  async function accept() {
    if (!payment || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/v1/payments/" + id + "/policy", {
        method: "POST",
        body: JSON.stringify({ policyVersion: payment.policy.version }),
      });
      setAccepted(true);
    } catch (e) {
      setError(commerceMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const seconds = payment
    ? Math.max(0, Math.floor((Date.parse(payment.expiresAt) - now) / 1000))
    : 0;
  return (
    <section className="hvm-commerce">
      <button className="text-button" onClick={() => onNavigate(payment?.subscriptionId ? "/assinaturas/minhas" : "/checkout")}>
        {payment?.subscriptionId ? "← Voltar às assinaturas" : "← Voltar à revisão"}
      </button>
      <h1>{payment?.subscriptionId ? "Pagamento do ciclo da assinatura" : "Pagamento da compra"}</h1>
      {!userId ? (
        <div className="commerce-card">
          <p>
            Entre na sua conta para acessar o pagamento e os termos da sua
            compra.
          </p>
          <button
            className="primary"
            onClick={() => onNavigate("/entrar/consumidor")}
          >
            Entrar
          </button>
        </div>
      ) : (
        <>
          {error && (
            <p role="alert" className="commerce-error">
              {error}
            </p>
          )}
          {!payment && !error && <PageLoading label="Carregando sua compra…" />}
          {payment && (
            <>
              <div className="commerce-grid">
                <article className="commerce-card">
                  <span className="commerce-tag">
                    {payment.gatewayAvailable
                      ? "Pagamento protegido"
                      : "Pagamentos em preparação"}
                  </span>
                  <h2>Total {money(payment.amountCents)}</h2>
                  {payment.status === "pending" ? (
                    <p>
                      <Clock3 size={17} />{" "}
                      {seconds
                        ? `${payment.subscriptionId ? "Prazo do Pix" : "Reserva"}: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
                        : payment.subscriptionId ? "O prazo deste Pix terminou. Consulte o ciclo nas suas assinaturas." : "O prazo desta reserva terminou. Revise sua seleção no checkout."}
                    </p>
                  ) : (
                    <p role="status">
                      {payment.status === "approved"
                        ? "Pagamento confirmado."
                        : payment.status === "refunded"
                          ? "Reembolso confirmado."
                          : "Pagamento não concluído."}
                    </p>
                  )}
                  {!payment.gatewayAvailable && (
                    <p>
                      A conta de recebimento ainda será conectada. A seleção
                      está registrada, mas nenhum pagamento foi solicitado.
                    </p>
                  )}
                  {payment.method === "pix" ? (
                    <div className="commerce-payment-slot">
                      <h3>
                        <QrCode /> Pix do sistema
                      </h3>
                      {payment.pixQrCodeBase64 && payment.gatewayAvailable ? (
                        <img
                          alt="QR Code Pix para pagamento"
                          src={`data:image/png;base64,${payment.pixQrCodeBase64}`}
                        />
                      ) : (
                        <div
                          className="commerce-qr-placeholder"
                          aria-label="Espaço reservado para o QR Code Pix"
                        >
                          <QrCode size={68} />
                          <span>QR Code disponível após ativação</span>
                        </div>
                      )}
                      <label>
                        Pix Copia e Cola
                        <textarea
                          readOnly
                          disabled={!payment.pixCopyPaste}
                          value={
                            payment.gatewayAvailable
                              ? (payment.pixCopyPaste ?? "")
                              : ""
                          }
                          placeholder="O código da cobrança aparecerá aqui"
                        />
                      </label>
                      <button
                        className="secondary"
                        disabled={
                          !payment.gatewayAvailable || !payment.pixCopyPaste
                        }
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(payment.pixCopyPaste!)
                            .then(() => setError("Código Pix copiado."))
                            .catch(() =>
                              setError("Selecione e copie o código Pix."),
                            )
                        }
                      >
                        Copiar código Pix
                      </button>
                    </div>
                  ) : (
                    <div className="commerce-payment-slot">
                      <h3>
                        <CreditCard /> Cartão de{" "}
                        {payment.method === "credit_card"
                          ? "crédito"
                          : "débito"}
                      </h3>
                      <p>
                        Os dados serão preenchidos no formulário protegido do
                        provedor quando os pagamentos forem ativados.
                      </p>
                      <fieldset disabled>
                        <legend>Dados do cartão</legend>
                        <label>
                          Nome no cartão
                          <input
                            autoComplete="off"
                            placeholder="Nome impresso no cartão"
                          />
                        </label>
                        <label>
                          Número do cartão
                          <input
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder="•••• •••• •••• ••••"
                          />
                        </label>
                        <div className="commerce-grid">
                          <label>
                            Validade
                            <input autoComplete="off" placeholder="MM/AA" />
                          </label>
                          <label>
                            Código de segurança
                            <input autoComplete="off" placeholder="CVV" />
                          </label>
                        </div>
                      </fieldset>
                    </div>
                  )}
                  <small>
                    <ShieldCheck size={15} /> Não há coleta de dados do cartão
                    nesta etapa.
                  </small>
                </article>
                <div>
                  <RefundPolicy
                    policy={payment.policy}
                    onNavigate={onNavigate}
                  />
                  {payment.status === "pending" && seconds > 0 && (
                    <div className="commerce-card">
                      <label className="commerce-checkbox">
                        <input
                          type="checkbox"
                          checked={agree}
                          onChange={(e) => setAgree(e.target.checked)}
                          disabled={accepted}
                        />
                        <span>
                          Li a política de reembolso e os prazos da compra.
                        </span>
                      </label>
                      <button
                        className="primary"
                        disabled={!agree || busy || accepted}
                        onClick={() => void accept()}
                      >
                        {accepted
                          ? "Termos registrados"
                          : busy
                            ? "Registrando…"
                            : "Registrar aceite dos termos"}
                      </button>
                      <button
                        className="secondary"
                        disabled
                        title="Disponível após conectar a conta de recebimento"
                      >
                        {payment.method === "pix"
                          ? "Gerar QR Code Pix"
                          : "Pagar com cartão"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <button
                className="text-button"
                onClick={() => onNavigate("/compras")}
              >
                Ver minhas compras
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}

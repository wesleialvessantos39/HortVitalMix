import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { CommercePolicy } from "../../../shared/contracts/commerce";
import { api } from "../../lib/api";
import { date } from "../../lib/commerce";
import "../../pages/commerce/commerce.css";

export function RefundPolicy({
  policy: provided,
  withdrawalDeadline,
  problemDeadline,
  onNavigate,
}: {
  policy?: CommercePolicy;
  withdrawalDeadline?: string | null;
  problemDeadline?: string | null;
  onNavigate?: (path: string) => void;
}) {
  const [loaded, setLoaded] = useState<CommercePolicy | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (provided) return;
    const controller = new AbortController();
    void api<{ policy: CommercePolicy }>("/v1/commerce/policy", {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setLoaded(result.policy);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [provided]);
  const policy = provided ?? loaded;
  return (
    <aside className="commerce-policy" aria-label="Política de reembolso">
      <h3>
        <ShieldCheck size={19} /> Sua compra tem proteção
      </h3>
      {policy ? (
        <>
          <p>
            Nas compras online, você pode solicitar arrependimento em até{" "}
            <strong>
              {policy.onlineWithdrawalDays} dias após receber os produtos
            </strong>
            , quando aplicável. O reembolso inclui os valores devidos da compra
            e da entrega.
          </p>
          {withdrawalDeadline ? (
            <p className="commerce-deadline">
              Prazo de arrependimento desta compra:{" "}
              <strong>{date(withdrawalDeadline)}</strong>.
            </p>
          ) : (
            <p>
              A data final será exibida no comprovante após a confirmação do
              recebimento.
            </p>
          )}
          <p>
            Compras presenciais:{" "}
            {policy.inPersonReturnDays
              ? `a política comercial permite solicitar devolução em ${policy.inPersonReturnDays} dias após o recebimento.`
              : "o arrependimento sem problema não gera devolução automática."}{" "}
            Produtos com defeito, qualidade inadequada, itens faltantes ou não
            entregues podem ser enviados para análise.
          </p>
          {problemDeadline && (
            <p>
              Referência para problemas aparentes em alimentos e outros produtos
              não duráveis: <strong>{date(problemDeadline)}</strong>. Vícios
              ocultos têm contagem própria.
            </p>
          )}
          <p>
            Os direitos do Código de Defesa do Consumidor permanecem
            preservados. O prazo de retenção financeira não limita o direito de
            denunciar ou pedir análise de um problema.
          </p>
          <p>
            O repasse ao produtor fica previsto para pelo menos{" "}
            <strong>{policy.holdingDays} dias após a entrega</strong> e
            permanece bloqueado enquanto houver disputa. Reembolsos aprovados
            serão devolvidos pelo meio de pagamento, após a confirmação do
            provedor.
          </p>
          {policy.additionalTerms && (
            <p className="commerce-prewrap">{policy.additionalTerms}</p>
          )}
          <small>
            Política versão {policy.version}.{" "}
            <a
              href="https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm"
              target="_blank"
              rel="noreferrer"
            >
              CDC: artigos 18, 26 e 49
            </a>
            .
          </small>
        </>
      ) : (
        <p role="status">
          {failed
            ? "A política não está disponível agora. Atualize antes de aceitar os termos."
            : "Carregando os termos da compra…"}
        </p>
      )}
      {onNavigate && (
        <div className="commerce-actions">
          <button
            className="text-button"
            onClick={() => onNavigate("/reembolsos")}
          >
            Solicitar reembolso
          </button>
          <button
            className="text-button"
            onClick={() => onNavigate("/denuncias")}
          >
            Denunciar um problema
          </button>
        </div>
      )}
    </aside>
  );
}

import { api, type ApiFailure } from "./api";
export const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value / 100,
  );
export const date = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Porto_Velho",
  }).format(new Date(value));
export const statusLabels: Record<string, string> = {
  draft: "Venda preparada",
  accepted: "Revisada pelo cliente",
  cancelled: "Cancelada",
  paid: "Paga",
  pending: "Pagamento pendente",
  approved: "Aprovado; estorno pendente",
  confirmed: "Compra confirmada",
  received: "Recebimento confirmado",
  submitted: "Denúncia recebida",
  requested: "Solicitação recebida",
  under_review: "Em análise",
  awaiting_information: "Aguardando informações",
  resolved: "Concluída",
  dismissed: "Arquivada",
  rejected: "Solicitação recusada",
  processing: "Estorno em processamento",
  refunded: "Estorno confirmado",
  held: "Retido",
  disputed: "Bloqueado por disputa",
  refund_pending: "Estorno pendente",
  partially_refunded: "Parcialmente reembolsado",
  released: "Repassado",
};
export function commerceMessage(error: unknown) {
  const code = (error as ApiFailure)?.message;
  const messages: Record<string, string> = {
    CONSUMER_REQUIRED: "Cadastre-se e entre como consumidor para comprar.",
    AUTH_REQUIRED: "Entre na sua conta para continuar.",
    FORBIDDEN: "Sua conta não tem a permissão necessária.",
    POS_STORE_UNAVAILABLE:
      "O caixa estará disponível quando sua loja estiver ativa e aprovada.",
    POS_INSUFFICIENT_STOCK:
      "A quantidade escolhida ultrapassa o estoque disponível. Revise a venda.",
    POS_PRODUCT_UNAVAILABLE:
      "Um dos produtos não está mais disponível na sua loja.",
    POS_SALE_NOT_FOUND: "Essa venda não está disponível para sua conta.",
    POS_SALE_EXPIRED:
      "O prazo da venda terminou ou ela foi cancelada. Peça ao produtor uma nova revisão.",
    POS_SELF_PURCHASE: "O produtor não pode aceitar a própria venda.",
    GATEWAY_NOT_CONFIGURED:
      "A conta de recebimento ainda está em preparação. Nenhuma cobrança ou estorno foi realizado.",
    REVISION_CONFLICT:
      "Outra pessoa atualizou este registro. Atualize a tela antes de decidir.",
    CONFLICT: "Já existe uma solicitação em andamento para esta compra.",
    CASE_STATE_CONFLICT:
      "O estado desta solicitação mudou. Atualize antes de continuar.",
    CASE_CLOSED:
      "Esta solicitação está encerrada. Abra uma nova se precisar de ajuda.",
    REFUND_AMOUNT_INVALID:
      "Confira o valor: ele deve respeitar o saldo disponível da compra.",
    IN_PERSON_WITHDRAWAL_NOT_APPLICABLE:
      "Esta compra presencial não tem devolução comercial por arrependimento. Se houver problema, escolha o motivo correspondente.",
    WITHDRAWAL_PERIOD_ENDED:
      "O prazo de arrependimento terminou. Problemas com o produto ainda podem ser enviados para análise.",
    COMPLAINT_RELATIONSHIP_REQUIRED:
      "Escolha uma compra vinculada a esse cliente ou ao item denunciado.",
    COMPLAINT_TARGET_NOT_FOUND:
      "O item denunciado não está disponível. Use a compra correspondente ou procure o suporte.",
    EVIDENCE_INVALID: "Use uma imagem JPG, PNG, WebP ou PDF de até 2 MB.",
    EVIDENCE_LIMIT: "O limite é de dez anexos por solicitação.",
    ADMIN_REAUTH_REQUIRED:
      "Confirme novamente sua senha administrativa para continuar.",
    REAUTH_REQUIRED:
      "Confirme novamente sua senha administrativa para continuar.",
    POLICY_CHANGED:
      "A política mudou. Atualize e revise os termos antes de continuar.",
    PAYMENT_EXPIRED:
      "O prazo da reserva terminou. Volte ao checkout e revise sua seleção.",
  };
  return (
    messages[code] ??
    "Não foi possível concluir agora. Você pode tentar novamente com segurança."
  );
}
/** Reuse the command after a lost HTTP response, including page reloads. */
export async function commerceMutation<T>(
  path: string,
  payload: Record<string, unknown>,
  userId: string,
) {
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify({ path, payload })),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const key = `hvm:commerce-command:${userId}:${hash}`;
  let commandId = crypto.randomUUID();
  try {
    const saved = sessionStorage.getItem(key);
    if (saved)
      commandId = saved as `${string}-${string}-${string}-${string}-${string}`;
    else sessionStorage.setItem(key, commandId);
  } catch {
    /* Server enforces uniqueness. */
  }
  const value = await api<T>(path, {
    method: "POST",
    body: JSON.stringify({ ...payload, commandId }),
  });
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Private browser mode. */
  }
  return value;
}

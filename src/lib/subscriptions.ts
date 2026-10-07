import type { ApiFailure } from "./api";
export const billingLabels = {
  weekly: "semana",
  biweekly: "quinzena",
  monthly: "mês",
};
export const subscriptionLabels = {
  trialing: "Período gratuito",
  active: "Ativa",
  paused: "Pausada",
  past_due: "Aguardando pagamento",
  cancelled: "Cancelada",
};
export function subscriptionMessage(e: unknown) {
  const messages: Record<string, string> = {
    GATEWAY_NOT_CONFIGURED:
      "O recebimento Pix ainda não está conectado. Nenhuma cobrança foi criada.",
    PIX_CREATION_UNCERTAIN:
      "A solicitação Pix precisa ser conferida. Aguarde a conciliação; não solicite outra cobrança.",
    PIX_RECONCILIATION_REQUIRED:
      "Esta cobrança está em conferência. Entre em contato com o suporte antes de tentar novamente.",
    PLAN_UNAVAILABLE: "Esse plano não está disponível para novas assinaturas.",
    CONFLICT:
      "Já existe uma assinatura deste plano ou esse identificador já está em uso.",
    RECURRENCE_REQUIRED:
      "Escolha um endereço e um horário para cada entrega semanal.",
    WINDOW_UNAVAILABLE:
      "O horário escolhido não está disponível. Atualize a seleção.",
    BASKET_UNAVAILABLE:
      "Há produtos indisponíveis na cesta. Atualize sua seleção.",
    ADDRESS_UNAVAILABLE: "Escolha um endereço seu com localização cadastrada.",
    BILLING_NOT_DUE:
      "O período gratuito ainda não terminou. Não há cobrança neste momento.",
    INVALID_CYCLE: "Esse ciclo não está disponível para cobrança.",
    SUBSCRIPTION_NOT_ACTIVE: "Só é possível pausar uma assinatura ativa.",
    SUBSCRIPTION_NOT_PAUSED: "Essa assinatura já está em atividade.",
    PAUSE_ALREADY_USED:
      "A pausa anterior ainda está dentro dos 14 dias. Aguarde o término antes de pausar novamente.",
    REVISION_CONFLICT:
      "A assinatura mudou em outra sessão. Atualize antes de continuar.",
    SUBSCRIPTION_CANCELLED: "Essa assinatura já foi cancelada.",
    SUBSCRIPTION_NOT_FOUND: "A assinatura não foi encontrada nesta conta.",
    VALIDATION_ERROR: "Confira os dados do plano, endereço e recorrência.",
    AUTH_REQUIRED: "Entre na sua conta para continuar.",
    CONSUMER_REQUIRED: "Acesse o portal do consumidor para assinar uma cesta.",
    PRODUCER_REQUIRED: "Acesse o portal do produtor para gerenciar seu plano.",
    FORBIDDEN: "Sua conta não tem permissão para esta operação.",
    ADMIN_REAUTHENTICATION_REQUIRED:
      "Confirme sua senha para alterar os planos.",
  };
  return (
    messages[(e as ApiFailure)?.message] ??
    "Não foi possível concluir agora. Tente novamente; o reenvio será protegido contra duplicação."
  );
}

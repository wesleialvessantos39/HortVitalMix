export function reviewMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    REVISION_CONFLICT:
      "Esta avaliação mudou. Atualize a lista antes de decidir.",
    REVIEW_NOT_MODERATED: "A avaliação já está pública. Atualize a lista.",
    AUTH_REQUIRED: "Entre na sua conta para avaliar seu pedido.",
    ORDER_NOT_FOUND: "Este pedido não está disponível para sua conta.",
    REVIEW_NOT_DELIVERED: "A avaliação fica disponível depois da entrega.",
    REVIEW_STORE_UNAVAILABLE:
      "A loja deste pedido não está disponível para avaliação.",
    REVIEW_ALREADY_EXISTS: "Este pedido já foi avaliado.",
    REVIEW_ALREADY_MODERATED:
      "Esta avaliação já foi moderada. Atualize a lista.",
    REVIEW_NOT_FOUND: "Esta avaliação não está disponível.",
    COMMAND_REUSED:
      "Esta solicitação já foi usada com outros dados. Atualize a página.",
    CONFLICT: "Já existe uma avaliação para este pedido. Atualize a página.",
    VALIDATION_ERROR: "Escolha uma nota de 1 a 5 e confira o texto informado.",
    FORBIDDEN: "Sua conta não tem permissão para moderar avaliações.",
    ADMIN_FORBIDDEN: "Sua conta não tem permissão para moderar avaliações.",
    ADMIN_SECTOR_FORBIDDEN:
      "Sua conta não tem permissão para moderar avaliações.",
    ADMIN_REAUTHENTICATION_REQUIRED:
      "Confirme sua identidade para moderar a avaliação.",
    DEPENDENCY_UNAVAILABLE:
      "Não foi possível consultar as avaliações agora. Tente novamente.",
  };
  return (
    messages[code] ??
    "Não foi possível concluir. Tente novamente; uma solicitação repetida não duplica sua avaliação."
  );
}

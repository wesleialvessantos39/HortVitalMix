import type { ApiFailure } from "./api";
export const weekdays = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];
export function deliveryMessage(e: unknown) {
  const messages: Record<string, string> = {
    CAPACITY_EXCEEDED: "Essa janela ficou lotada. Escolha outro horário.",
    WINDOW_UNAVAILABLE: "Essa janela não está disponível para este pedido.",
    INVALID_DELIVERY_DATE:
      "Escolha uma data futura, no dia da semana da janela.",
    ORDER_NOT_READY:
      "O pedido precisa estar pronto para entrega antes do agendamento.",
    ORDER_ALREADY_ALLOCATED: "Esse pedido já tem uma janela reservada.",
    REVISION_CONFLICT:
      "Os dados foram atualizados em outra sessão. Atualize antes de continuar.",
    WINDOW_HAS_ALLOCATIONS:
      "Há entregas agendadas. Crie outra janela para mudar o dia ou horário.",
    CAPACITY_BELOW_ALLOCATIONS:
      "A capacidade não pode ficar abaixo das vagas já reservadas.",
    DELIVERY_ALLOCATION_REQUIRED:
      "Agende uma janela antes de sair para entrega.",
    DELIVERY_PROOF_REQUIRED:
      "Registre quem recebeu o pedido para confirmar a entrega.",
    ORDER_NOT_OUT_FOR_DELIVERY:
      "Só é possível confirmar pedidos que saíram para entrega.",
    VALIDATION_ERROR: "Confira o nome, a data, o horário e os demais campos.",
    CONFLICT: "Já existe uma janela com esse dia e horário.",
    AUTH_REQUIRED: "Sua sessão terminou. Entre novamente.",
    PRODUCER_REQUIRED: "Entre como produtor para gerenciar entregas.",
    STORE_NOT_FOUND: "Crie sua loja antes de configurar as entregas.",
  };
  return (
    messages[(e as ApiFailure)?.message] ??
    "Não foi possível salvar agora. Tente novamente; a mesma ação será reenviada com segurança."
  );
}

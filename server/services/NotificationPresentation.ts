import {
  NOTIFICATION_LABELS,
  type Notification,
  type NotificationCategory,
  type NotificationDetail,
  type NotificationRecipientRole,
} from "../../shared/contracts/notification.ts";
import type { AdminSectorCode } from "../../shared/contracts/adminGovernance.ts";

const audienceLabels: Record<NotificationRecipientRole, string> = {
  consumer: "Consumidor",
  producer: "Produtor",
  platform_admin: "Administrador",
  platform_super_admin: "Super administrador",
};
const nextSteps: Record<NotificationCategory, string> = {
  purchases:
    "Consulte a situação da compra ou do pagamento e as orientações disponíveis.",
  sales:
    "Confira os itens e a situação financeira da venda na área da sua loja.",
  orders: "Confira o andamento do pedido e as próximas etapas da entrega.",
  refunds: "Consulte o andamento do reembolso e as orientações do atendimento.",
  complaints:
    "Acompanhe a denúncia na central privada e consulte as orientações da equipe.",
  reviews:
    "Consulte a avaliação e as informações da compra ou da loja relacionada.",
  subscriptions:
    "Confira a situação da assinatura, seus ciclos e os próximos vencimentos.",
  properties: "Consulte o imóvel e as orientações para a análise do cadastro.",
  documents:
    "Confira a situação dos documentos e as orientações de verificação.",
  account: "Consulte os dados e as orientações de acesso da sua conta.",
  catalog: "Confira os produtos e as informações atualizadas do catálogo.",
  inventory:
    "Confira a disponibilidade dos produtos, os lotes e as próximas colheitas.",
  delivery: "Consulte a janela e o andamento da entrega do pedido.",
  administration:
    "Consulte a atualização na área responsável, de acordo com suas permissões.",
};
const publicTopics: Record<NotificationCategory, string> = {
  purchases: "uma compra ou um pagamento vinculado à sua conta",
  sales: "uma venda da sua loja",
  orders: "um pedido vinculado à sua conta",
  refunds: "um reembolso vinculado à sua conta",
  complaints: "uma denúncia registrada na sua central privada",
  reviews: "uma avaliação vinculada à sua compra ou à sua loja",
  subscriptions: "uma assinatura vinculada à sua conta",
  properties: "um imóvel vinculado à sua conta",
  documents: "a verificação de documentos vinculados à sua conta",
  account: "os dados ou o acesso da sua conta",
  catalog: "o catálogo da sua loja",
  inventory: "a disponibilidade de produtos da sua loja",
  delivery: "a entrega de um pedido vinculado à sua conta",
  administration: "uma orientação administrativa vinculada à sua conta",
};

/** Labels explain a recorded event; they do not infer facts or run an action. */
export function explainNotification(
  notification: Notification,
  role: NotificationRecipientRole,
  action: NotificationDetail["action"],
): NotificationDetail {
  const administrative =
    role === "platform_admin" || role === "platform_super_admin";
  return {
    ...notification,
    recipientRole: role,
    context: {
      categoryLabel: NOTIFICATION_LABELS[notification.category],
      audienceLabel: audienceLabels[role],
      why: administrative
        ? notification.category === "account"
          ? "Esta atualização está vinculada à sua conta administrativa ou ao setor de gestão de contas autorizado para o seu acesso."
          : `Esta atualização de ${NOTIFICATION_LABELS[notification.category].toLowerCase()} foi destinada ao seu acesso administrativo. Somente avisos dentro das suas permissões atuais são apresentados.`
        : `Este aviso informa uma atualização sobre ${publicTopics[notification.category]}. Ele foi destinado ao seu perfil de ${audienceLabels[role].toLowerCase()}.`,
      nextStep: action
        ? administrative && notification.category === "refunds"
          ? "Consulte o atendimento e as informações disponíveis antes de registrar qualquer decisão."
          : administrative && notification.category === "complaints"
            ? "Consulte o relato privado e o histórico antes de registrar o encaminhamento do caso."
            : nextSteps[notification.category]
        : "Você pode consultar esta atualização aqui. A área de origem não está disponível para o seu perfil ou suas permissões atuais.",
    },
    action,
  };
}

export const PUBLIC_NOTIFICATION_CATEGORIES: Record<
  "consumer" | "producer",
  NotificationCategory[]
> = {
  consumer: [
    "purchases",
    "orders",
    "refunds",
    "complaints",
    "reviews",
    "subscriptions",
    "account",
    "delivery",
  ],
  producer: [
    "sales",
    "orders",
    "refunds",
    "complaints",
    "reviews",
    "subscriptions",
    "properties",
    "documents",
    "account",
    "catalog",
    "inventory",
    "delivery",
    "purchases",
  ],
};
export const ADMIN_NOTIFICATION_CATEGORIES: Partial<
  Record<AdminSectorCode, NotificationCategory[]>
> = {
  document_verification: ["properties", "documents"],
  catalog_moderation: ["catalog", "inventory"],
  finance_ops: ["sales", "orders", "delivery"],
  location_management: ["administration"],
  account_governance: ["account", "administration"],
  platform_configuration: ["administration"],
  refund_management: ["refunds"],
  complaint_management: ["complaints", "reviews"],
  payment_configuration: ["subscriptions", "purchases", "administration"],
};

type Destination = {
  prefix: string;
  label: string;
  sector?: AdminSectorCode;
  superOnly?: boolean;
};
const adminDestinations: Destination[] = [
  {
    prefix: "/admin/reembolsos",
    label: "Abrir atendimento do reembolso",
    sector: "refund_management",
  },
  {
    prefix: "/admin/politica-reembolso",
    label: "Ver política de reembolso",
    sector: "refund_management",
  },
  {
    prefix: "/admin/denuncias",
    label: "Abrir atendimento da denúncia",
    sector: "complaint_management",
  },
  {
    prefix: "/admin/avaliacoes",
    label: "Consultar avaliações",
    sector: "complaint_management",
  },
  {
    prefix: "/admin/pagamentos",
    label: "Consultar pagamentos",
    sector: "payment_configuration",
  },
  {
    prefix: "/admin/assinaturas",
    label: "Consultar assinaturas",
    sector: "payment_configuration",
  },
  {
    prefix: "/admin/documentos/fila",
    label: "Abrir fila de verificação",
    sector: "document_verification",
  },
  {
    prefix: "/admin/imoveis",
    label: "Consultar imóveis",
    sector: "document_verification",
  },
  {
    prefix: "/admin/localidades",
    label: "Consultar cobertura e localidades",
    sector: "location_management",
  },
  {
    prefix: "/admin/bloqueios",
    label: "Consultar bloqueios regionais",
    sector: "location_management",
  },
  {
    prefix: "/admin/configuracao",
    label: "Consultar configuração da plataforma",
    sector: "platform_configuration",
  },
  {
    prefix: "/admin/categorias",
    label: "Consultar categorias",
    sector: "catalog_moderation",
    superOnly: true,
  },
  {
    prefix: "/admin/bi",
    label: "Consultar BI executivo",
    sector: "platform_configuration",
    superOnly: true,
  },
  {
    prefix: "/admin/usuarios",
    label: "Consultar contas e acessos",
    sector: "account_governance",
  },
  {
    prefix: "/admin/governanca",
    label: "Consultar equipe e permissões",
    sector: "account_governance",
  },
  { prefix: "/admin/conta", label: "Consultar minha conta administrativa" },
  { prefix: "/admin/painel", label: "Abrir painel global" },
];
export const ADMIN_NOTIFICATION_ROUTE_SECTORS = adminDestinations.flatMap(
  ({ prefix, sector }) => (sector ? [{ prefix, sector }] : []),
);
const publicDestinations: Destination[] = [
  { prefix: "/produtor/reembolsos", label: "Consultar reembolso da venda" },
  { prefix: "/produtor/vendas", label: "Consultar minhas vendas" },
  { prefix: "/produtor/pedidos", label: "Consultar pedidos da minha loja" },
  { prefix: "/produtor/produtos", label: "Consultar produtos e estoque" },
  { prefix: "/produtor", label: "Consultar área do produtor" },
  { prefix: "/reembolsos", label: "Abrir meu atendimento de reembolso" },
  { prefix: "/denuncias", label: "Abrir minha denúncia" },
  { prefix: "/pedidos", label: "Consultar pedido" },
  { prefix: "/compras", label: "Consultar minhas compras" },
  { prefix: "/assinaturas", label: "Consultar minhas assinaturas" },
  { prefix: "/pagamentos", label: "Consultar pagamento" },
  { prefix: "/imoveis", label: "Consultar meus imóveis" },
  { prefix: "/documentos", label: "Consultar meus documentos" },
  { prefix: "/conta", label: "Consultar minha conta" },
];
function matches(path: string, prefix: string) {
  return (
    path === prefix ||
    path.startsWith(prefix + "/") ||
    path.startsWith(prefix + "?") ||
    path.startsWith(prefix + "#")
  );
}
export function notificationDestination(
  path: string,
  role: NotificationRecipientRole,
) {
  const administrative =
    role === "platform_admin" || role === "platform_super_admin";
  const destination = (
    administrative ? adminDestinations : publicDestinations
  ).find((item) => matches(path, item.prefix));
  if (
    !destination ||
    (destination.superOnly && role !== "platform_super_admin")
  )
    return null;
  if (role === "consumer" && matches(path, "/produtor")) return null;
  if (
    role === "producer" &&
    (matches(path, "/compras") || matches(path, "/pedidos"))
  )
    return null;
  return destination;
}

const consumer = {
  label: "Consumidor", introduction: "Tudo para cuidar da sua conta e receber suas compras com tranquilidade.",
  cards: ["Seu nome e informações de contato", "Organize onde receber suas compras", "Escolha como acompanhar seus pedidos", "Controle seus consentimentos e seus dados"],
  profile: "Mantenha seus dados de contato atualizados para facilitar o atendimento e suas entregas.",
  addressTitle: "Seus locais de entrega", addressHelp: "Salve casa e outros locais onde recebe compras. O endereço padrão será usado como sua primeira opção.",
  preferences: "Escolha os canais para atualizações de pedidos e os horários em que prefere receber comunicações.",
  privacy: "Gerencie o uso dos seus dados pessoais e consulte o histórico das suas escolhas de comunicação.",
};
const producer = {
  label: "Produtor", introduction: "Seus dados pessoais e suas escolhas de comunicação em um só lugar.",
  cards: ["Identificação e contato do responsável", "Seus endereços residenciais", "Organize seus horários de comunicação", "Proteja sua identidade e acompanhe seus consentimentos"],
  profile: "Estas são as informações pessoais do responsável pela conta. Dados da propriedade e da produção são cadastrados separadamente.",
  addressTitle: "Endereços pessoais", addressHelp: "Cadastre sua residência e locais de entrega pessoal. Estes endereços não definem a localização da propriedade, coleta ou área de produção.",
  preferences: "Organize suas comunicações pessoais em torno da sua rotina no campo. Avisos de vendas serão configurados quando o módulo de pedidos estiver disponível.",
  privacy: "Controle os consentimentos da sua conta pessoal. Endereços residenciais permanecem separados dos registros da propriedade e da produção.",
};
const administrator = {
  label: "Administrador", introduction: "Cuide da sua conta e acesse suas ferramentas de trabalho.",
  cards: ["Sua identificação e contato pessoal", "Endereços de contato administrativo", "Sua conta e ferramentas dos setores", "Seus dados pessoais e consentimentos"],
  profile: "Sua identificação pessoal é independente dos usuários que você administra. Alterar estes dados não altera seus setores ou permissões.",
  addressTitle: "Endereços administrativos", addressHelp: "Organize seus endereços de contato, escritório e correspondência administrativa. Estes dados são privados da sua conta.",
  preferences: "Consulte seu tipo de acesso e abra as ferramentas disponíveis para os seus setores. As escolhas de comunicação abaixo são pessoais e não alteram permissões.",
  privacy: "Consulte seus consentimentos e exporte seus dados pessoais. Esta exportação não concede acesso aos dados de outras pessoas.",
};
export function accountExperience(role?: string | null) {
  if (role === "producer") return producer;
  if (role === "platform_admin") return administrator;
  if (role === "platform_super_admin") return { ...administrator, label: "Super administrador", introduction: "Sua conta pessoal e os controles da plataforma organizados para o dia a dia.", cards: ["Identificação do responsável pela conta", "Endereços de contato da superadministração", "Sua conta e os controles globais", "Privacidade pessoal e histórico de consentimentos"], preferences: "Acesse a governança e os parâmetros globais da plataforma. As preferências pessoais desta página não modificam as configurações gerais." };
  return consumer;
}

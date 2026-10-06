import { z } from "zod";

export const LGPD_CADASTRO_POLICY_VERSION = "lgpd-cadastro-2026-10-02";
export const RegistrationConsentSchema = z
  .object({ policyVersion: z.literal(LGPD_CADASTRO_POLICY_VERSION) })
  .strict();

export const LgpdCadastroAcceptanceSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(255).pipe(z.email()),
    userId: z.uuid(),
    policyVersion: z.literal(LGPD_CADASTRO_POLICY_VERSION),
    consentProof: z.string().min(1).max(2048).optional(),
  })
  .strict();

export const lgpdCadastroTerm = {
  title: "O que você está aceitando",
  intro:
    "Este aceite vale para o cadastro de consumidor e para o cadastro de produtor. Ele autoriza o HortiVitalMix a tratar os dados abaixo para criar e manter a sua conta. Não autoriza venda de dados nem mensagem de propaganda.",
  sections: [
    {
      heading: "Dados pedidos neste cadastro",
      items: [
        "Nome completo.",
        "CPF, só para identificar a pessoa da conta. Este aceite não muda o CPF.",
        "E-mail e celular, para contato e para confirmar o cadastro.",
        "Senha, guardada pelo serviço de acesso. Ela não fica escrita neste termo.",
        "No cadastro de produtor, os dados necessários para criar e manter o perfil de produtor.",
      ],
    },
    {
      heading: "Para que esses dados são usados",
      items: [
        "Criar a conta e saber quem está entrando.",
        "Enviar a confirmação e os avisos do próprio cadastro.",
        "No produtor, permitir cadastrar e acompanhar a análise do imóvel rural.",
      ],
    },
    {
      heading: "O que este aceite não faz",
      items: [
        "Não vende nem cede os dados para propaganda.",
        "Não publica o CPF.",
        "Não substitui uma escolha separada de mensagens promocionais, se ela existir depois na conta.",
      ],
    },
    {
      heading: "Seus direitos (Lei nº 13.709/2018 — LGPD)",
      items: [
        "Saber quais dados estão na conta.",
        "Corrigir o que estiver errado.",
        "Pedir a exclusão da conta.",
        "Retirar este aceite. Sem ele, o cadastro não pode ser mantido.",
      ],
    },
  ],
  contact:
    "Pedidos sobre estes dados: hortivitalmix@gmail.com. Versão do termo: lgpd-cadastro-2026-10-02.",
} as const;

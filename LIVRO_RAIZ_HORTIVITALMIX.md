# Livro-Raiz HortiVitalMix

## Fonte de autoridade

- Manual: **MANUAL MESTRE TÉCNICO GREENFIELD v7 (MÓDULO v7)**.
- Regra de execução: fatias verticais casadas; banco, backend, frontend e navegação evoluem juntos.
- Dados fictícios, respostas simuladas e sucesso forçado são proibidos.

## Ambientes oficiais

| Ambiente | Neon branch | Estado |
| --- | --- | --- |
| Desenvolvimento | `development` (`br-lingering-haze-ac1jsgp8`) | Criada |
| Homologação | `homologation` (`br-twilight-darkness-aclggben`) | Criada |
| Produção | `production` (`br-falling-sunset-acc583ns`) | Criada |

Projeto Neon: `HortiVitalMix` (`flat-bonus-20719397`), PostgreSQL 17, região `aws-sa-east-1`.

## Volume 01 — Trilha 1

Status: **implementada e publicada; conexão segura do Neon no runtime da Vercel pendente de configuração externa**.

Entregas incorporadas:

- Runtime único Vite + Express no desenvolvimento.
- API de liveness, readiness e configuração pública.
- Atualização administrativa com revisão otimista, permissão de fundação e auditoria.
- Migration `0001_trilha1_foundation_and_config.sql` com histórico, releases, configuração singleton e auditoria append-only.
- Shell global responsiva, navegação SPA, header desktop, header mobile, bottom navigation e estados reais de dependência.
- Paleta, tipografia e estrutura visual alinhadas às referências desktop/mobile homologadas.
- Configuração Vercel versionada sem segredos.

## Critérios de fechamento

- [x] Migration aplicada e verificada primeiro em `development` (versão 1, checksum `547fc051791a36aa39e6803681968dfe9e2282e581f580bf9693588c66c1bb19`).
- [x] Typecheck sem erros.
- [x] Testes automatizados sem falhas.
- [x] Build de produção concluído.
- [x] Inspeção visual em 360 px, 768 px e 1440 px, sem scroll horizontal ou ruptura estrutural.
- [x] Commit publicado no GitHub e deployment de produção inspecionado.

### Evidência e limitações do ambiente de execução

- Repositório: `wesleialvessantos39/HortVitalMix`; implementação consolidada no commit `793939a3efe1415e4ee24b1eb8b841532dc55c71`.
- Produção: `https://hortivitalmix.vercel.app`; deployment `dpl_D1mvDsWKu61rCrKb8VMVbL9sJBXf` em estado `READY`.
- O endpoint `/api/health` respondeu `200` com `x-request-id`; a rota administrativa respondeu `403` sem a permissão exigida, conforme contrato.
- `/api/ready` e `/api/v1/config` respondem `503` enquanto a Vercel não receber a conexão Neon. O erro explícito preserva a regra de não simular sucesso.
- A migration e os dados-base foram conferidos pela conexão oficial do Neon na branch `development`.
- Para fechar o vínculo operacional em produção, definir na Vercel as variáveis protegidas `DATABASE_URL`, `APP_ENV=production`, `APP_RELEASE` e `PLATFORM_CONFIG_ADMIN_TOKEN`; nenhum segredo real foi versionado.

## 2026-09-15 — Revisão corretiva da Trilha 01 contra o Manual Mestre Técnico v7

A Trilha 01 foi reauditada diretamente contra o Manual Mestre Técnico v7. A revisão encontrou divergências entre a implementação inicial e o contrato atual do manual, principalmente no formato das tabelas de fundação, nos contratos públicos, na semântica de readiness, na organização do backend e no shell responsivo.

Correções consolidadas:
- contratos canônicos movidos para `shared/contracts/foundation.ts`;
- runtime centralizado em `server/config/runtime.ts`;
- pool PostgreSQL/Neon isolado em `server/db/pool.ts`;
- rotas de fundação em `server/routes/foundationRoutes.ts`;
- `GET /api/health` passou a informar status, instante, ambiente e requestId;
- `GET /api/ready` passou a validar banco, versão de schema e release corrente registrada em `app_releases`;
- `GET /api/v1/config` passou a devolver o contrato público canônico da configuração global;
- administração de configuração e dependência de token administrativo foram retiradas da Trilha 01; autorização administrativa pertence às trilhas posteriores;
- shell global foi separado em `src/components/layout/MainShell.tsx`, com desktop, mobile e bottom navigation;
- build de deploy passou a executar typecheck + testes + build Vite como gate obrigatório;
- configuração pública foi alinhada ao nome, slogan, município, UF, moeda, timezone e suporte previstos no v7.

### Decisão de compatibilidade de migração

A migration `0001_trilha1_foundation_and_config.sql` já estava aplicada na branch Neon `development`, com checksum histórico registrado. Por isso ela **não foi reescrita**. Alterar o arquivo já aplicado invalidaria a verificação de checksum do runner e violaria a regra de imutabilidade das migrations.

Foi criada a migration aditiva `0002_trilha01_manual_v7_alignment.sql` para levar o schema existente ao contrato da Trilha 01 v7 preservando o histórico. Consequência: a próxima migration do projeto deve usar o próximo número livre; qualquer numeração ilustrativa do manual deve ser adaptada ao histórico real do repositório sem renumerar migrations já aplicadas.

### Evidência de validação

No preview da Vercel da branch corretiva:
- TypeScript `tsc --noEmit`: aprovado;
- Vitest: 1 arquivo, 3 testes, todos aprovados;
- Vite production build: aprovado;
- deployment de preview: gerado a partir do commit corretivo.

O GitHub Actions registrou falha antes de iniciar qualquer step do job `validate` (sem checkout, npm, typecheck, teste ou build executados). Por isso o gate de build da Vercel foi reforçado para executar a mesma validação de código antes do deploy, sem mascarar a anomalia do runner do GitHub.


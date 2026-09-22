# Volume 01 — Trilha 03 — Validação Técnica

Fonte normativa: **MANUAL MESTRE TÉCNICO v10 — TRILHAS 01 A 06**.

## Baseline preservado

A implementação parte do estado homologado da Trilha 02 (schema lógico 14) e preserva integralmente os avanços já existentes de identidade multi-papel, confirmação, recuperação, código de segurança, configuração global/auditoria, Conta pública separada da Administração e integração GitHub → Vercel.

Nenhum fluxo real existente foi substituído por stub, simulação ou fallback fictício.

## Backend

- sessão continua baseada em Supabase Auth/JWT e cookies HttpOnly;
- login público e administrativo possuem endpoints separados;
- papel administrativo enviado ao login público recebe 403 antes da autenticação;
- papel público enviado ao login administrativo recebe 403;
- cadastro público continua limitado a `consumer|producer`;
- Zod `.strict()` preservado nos payloads de autenticação;
- rate limit: 10 tentativas em 15 minutos por hash de IP;
- cookies: `HttpOnly`, `Secure` em produção e `SameSite=Lax`;
- mensagens de credenciais permanecem genéricas;
- fluxos avançados por papel de confirmação/recuperação/reautenticação foram preservados.

## Frontend

- `/cadastro` é a escolha explícita entre Consumidor e Produtor;
- `/cadastro/consumidor` e `/cadastro/produtor` permanecem independentes;
- `/admin/entrar` é alias administrativo independente;
- normalização compartilhada de CPF, e-mail e celular;
- CPF com validação matemática;
- componentes reutilizáveis de CPF, celular e força da senha;
- shell reage à sessão real e direciona Conta autenticada a `/minha-conta`;
- design preserva os tokens visuais oficiais e as referências desktop/mobile.

## Responsividade

A suíte existente `tests/e2e/shell.spec.ts` cobre 320, 360, 430, 768, 1024 e 1440 px, incluindo cadastro, máscaras, navegação, separação Conta/Administração e ausência de overflow.

A T03 acrescenta `tests/e2e/trilha03-auth.spec.ts` para 320, 390, 768, 1024 e 1440 px, cobrindo:
- seletor `/cadastro`;
- ausência de papel administrativo no cadastro público;
- navegação para cadastro Consumer;
- alias `/admin/entrar`;
- ausência de Consumer/Producer no seletor administrativo;
- ausência de overflow horizontal.

## Supabase

Projeto canônico: **HortVitalMix — `xipbsazvymkqqfmfegwu`**.

Migrations da T03:
1. `20260922002647_trilha03_identity_hardening.sql`;
2. `20260922004505_trilha03_function_grants_hardening.sql`.

Schema lógico atual: **16**.

Objetos verificados:
- `fn_assert_public_role(text)`;
- `ix_app_people_email_login`;
- `fn_check_auth_people_consistency()`;
- `trg_fn_auth_user_email_changed()`;
- trigger `trg_hortivital_auth_user_email_changed`.

A segunda migration é corretiva e apenas revoga execução direta da função interna do trigger para papéis de API. Nenhuma tabela nova foi criada.

A consulta de consistência retornou **0 divergências de e-mail** entre `auth.users` e `app_people`.

## Gates

O build Vercel executa:
- `typecheck:app`;
- `security:check`;
- regressão unitária segura da T02;
- evidência histórica da T02;
- testes unitários da T03;
- evidência estrutural T03;
- Vite build;
- inspeção de bundle para segredos.

O gate legado da T02 foi tornado evolutivo: ele continua validando o hash histórico das 14 migrations da T02, mas não exige que o schema global permaneça congelado em 14.

O workflow gratuito da T03 provisiona Supabase local efêmero para integração real e E2E. Quando o GitHub não provisiona runner e encerra jobs com `steps: null`, isso é registrado como limitação de infraestrutura e nunca como teste aprovado.

## Não regressão

Os fluxos reais de confirmação, recuperação de senha, código de segurança, identidade Consumer+Producer no mesmo CPF, Administração independente, configuração global e auditoria da T02 permanecem preservados.


## Revisão final de desempenho, visibilidade e responsividade — 2026-09-21

Esta revisão foi executada sem utilizar ou alterar GitHub Actions. O projeto permanece no fluxo gratuito GitHub + Supabase + Vercel.

### Desempenho de autenticação

Foi encontrada latência evitável no caminho crítico:

- após o POST de login, o frontend fazia um GET adicional de sessão;
- a sessão executava validação Auth e múltiplas consultas separadas ao PostgreSQL;
- cookies de sessão antigos podiam fazer o middleware validar uma sessão anterior antes do próprio login/cadastro.

Correções:

- o POST de login agora devolve a sessão canônica completa (userId, email, roles e activeRole);
- o frontend adota essa resposta imediatamente, sem GET de sessão após autenticar;
- status da conta, papéis ativos, pessoa e validade opcional da sessão são resolvidos por `IdentityAccessService` em uma única consulta ao PostgreSQL;
- endpoints públicos de login/cadastro/recuperação não executam resolução de sessão anterior;
- visitante sem sessão não dispara tentativa inútil de refresh;
- Consumer, Producer, Administrador e Super administrador usam o mesmo caminho rápido;
- o backend publica `Server-Timing` para login e cadastro, permitindo observação futura sem logar credenciais.

A consulta consolidada foi validada diretamente contra o Supabase canônico por `EXPLAIN`. O plano usa a chave primária de `app_users` e o índice `ix_app_user_role_active`.

### Desempenho do cadastro

- buscas por CPF e e-mail, antes sequenciais, passaram a ocorrer em paralelo;
- persistência canônica continua transacional por RPC;
- envio/reenvio da confirmação de e-mail deixou o caminho crítico da resposta do cadastro;
- a tela navega assim que a identidade e o domínio foram persistidos;
- o reenvio de confirmação ocorre em seguida sem bloquear a navegação;
- caso o envio falhe, o fluxo existente de “Reenviar confirmação” permanece disponível.

### Visibilidade das telas T02/T03

Foram encontrados dois problemas reais de navegação:

1. `/admin/entrar` era capturado antes pelo seletor público e podia exibir Consumer/Producer. A condição foi corrigida.
2. `/cadastro` existia, mas a ação da home “Conheça as opções de cadastro” apontava para `/entrar`. Agora aponta para `/cadastro`.

Foi criado também o ponto canônico `/admin/painel`:

- Administrador entra no painel administrativo;
- Super administrador entra no mesmo painel e recebe a ação explícita **Abrir Configuração Global — Trilha 02**;
- `/admin/configuracao` continua restrito ao Super administrador pelo backend;
- Conta/segurança permanece em `/minha-conta`.

Assim, a tela da Trilha 02 não fica mais “escondida” dentro da conta genérica.

### Responsividade

Revisão mantida em três faixas:

- mobile: até 767 px, cartões e formulários em coluna, botões de toque com altura adequada e navegação inferior;
- tablet: 768–1199 px, largura limitada e grades de duas colunas quando há espaço;
- desktop: 1200 px ou mais, cartões em duas colunas e conteúdo central com limites máximos.

A Configuração Global T02 já possuía regras específicas para <=767 px e <=359 px. O novo painel administrativo recebeu limites próprios para tablet e mobile. A suíte Playwright versionada continua disponível para validação local/gratuita, sem depender de GitHub Actions.

### Regra de infraestrutura

Nenhum arquivo de `.github/workflows` foi alterado nesta revisão. GitHub Actions não participa do critério de conclusão solicitado pelo proprietário nesta etapa.

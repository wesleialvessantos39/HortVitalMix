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

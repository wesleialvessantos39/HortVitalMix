# Volume 01 / Trilha 05 — Selagem contra o Manual Mestre Técnico v11

Fonte vigente: **MANUAL MESTRE TÉCNICO v11 — VOLUMES 1 A 4**, respeitando as decisões posteriores e canônicas do Livro-Raiz.

Status desta entrada: **HOMOLOGAÇÃO TÉCNICA DA TRILHA 05**. A release de produção é registrada somente após o commit final desta documentação concluir o deployment Vercel com sucesso e o banco confirmar o histórico real.

## Princípio de preservação

A selagem foi executada de forma aditiva. Nenhuma migration de T01–T04 foi removida, reescrita ou reaplicada. Nenhuma tabela administrativa da T05 foi recriada. O Supabase Auth continua sendo o provedor único para e-mails de autenticação e segurança.

## Histórico real e schema

Ao encerrar a T04 o projeto estava no schema lógico 18. A T05 acrescentou:

- `20260922200604_trilha05_admin_governance.sql`;
- `20260923022000_trilha05_performance_hardening.sql`.

O manifesto permanece com **schema lógico 20** e hash de histórico **8a898b8576bda959f53aaeea552f3039d9da099aaa8007536e5a697ae4530106**.

Em produção, a segunda migration foi aplicada pelo Supabase com a versão física `20260923022554`, mantendo o mesmo nome `trilha05_performance_hardening`. A validação passou a aceitar exclusivamente esse alias conhecido:

`20260923022554 -> 20260923022000`.

Isso reconcilia o histórico sem renomear migration aplicada, sem reaplicar DDL e sem mascarar outras divergências.

## Banco e segurança

Confirmado no projeto canônico de produção:

- 3 setores canônicos ativos: `document_verification`, `catalog_moderation`, `finance_ops`;
- 6 tabelas administrativas presentes;
- RLS e FORCE RLS nas 6 tabelas;
- `has_role_for` e `fn_is_last_active_super_admin` como SECURITY DEFINER com `search_path=public`;
- trigger `trg_app_admin_invites_updated_at`;
- token de convite persistido somente como digest SHA-256;
- MFA do Super administrador sob custódia do Supabase Auth;
- rate limit administrativo persistente;
- proteção do último Super administrador.

## Correção crítica da selagem v11

Foi identificado um caminho legado em `POST /v1/auth/admin-login` que ainda podia criar uma sessão administrativa pela infraestrutura anterior à T05.

A correção aplicada:

- o endpoint legado deixa de autenticar e responde `409 ADMIN_GOVERNANCE_LOGIN_REQUIRED`;
- todo login administrativo passa por `POST /v1/admin/auth/login`;
- o Super administrador continua sem receber sessão antes do MFA;
- o componente `Account` não referencia mais `/v1/auth/admin-login`;
- qualquer renderização acidental do fluxo legado administrativo redireciona para `/admin/entrar`;
- foram adicionadas regressões unitárias, estruturais e E2E para impedir a reintrodução do bypass.

## Readiness

`FOUNDATION_SCHEMA_VERSION` foi alinhado de 14 para **20**, que é o schema lógico efetivo após a T05. O endpoint `/ready` continua fail-closed e só retorna `ready` quando:

- existe release corrente para o ambiente;
- schema da release coincide com 20;
- hash da release coincide com o manifesto;
- em production, o `commit_sha` da release coincide com o commit da Vercel.

## Compatibilidade T03

A T03 continua exigindo separação entre portal público e administrativo. O gate antigo, porém, ainda esperava que o frontend chamasse `/v1/auth/admin-login`. Ele foi atualizado para reconhecer o `AdminRouter` e o motor T05 como implementação canônica, sem restaurar o caminho inseguro.

## Frontend

Rotas administrativas preservadas:

- `/admin/entrar`;
- `/admin/bootstrap`;
- `/admin/aceitar-convite`;
- `/admin/convite` como alias de compatibilidade;
- `/admin/painel`;
- `/admin/governanca`;
- `/admin/usuarios`;
- `/admin/configuracao`.

A responsividade permanece coberta para 320, 390, 430, 768, 1024 e 1440 px.

## Gates de build

O build Vercel da correção funcional concluiu com **success** no commit `bfd46289cf39a33b6a9406f1d1f7c37c46ea08a9`, após duas falhas de selagem diagnosticadas e corrigidas:

1. gate estrutural T03 desatualizado, ainda exigindo o endpoint legado no frontend;
2. narrowing TypeScript no fluxo público após a remoção do ramo administrativo.

Nenhuma das duas correções exigiu alteração de banco ou rollback.

## Checklist de homologação T05

### Banco
- [x] estruturas administrativas presentes;
- [x] RLS/FORCE RLS;
- [x] funções e trigger canônicos;
- [x] histórico remoto reconciliado sem reescrita;
- [x] schema lógico 20 preservado.

### Backend
- [x] bootstrap protegido;
- [x] login administrativo dedicado;
- [x] MFA obrigatório do Super administrador;
- [x] convites administrativos;
- [x] escopo setorial;
- [x] rate limit;
- [x] proteção do último Super administrador;
- [x] bypass legado fechado.

### Frontend
- [x] portal administrativo dedicado;
- [x] fluxo credenciais → MFA;
- [x] bootstrap e aceite de convite;
- [x] governança/usuários/configuração;
- [x] responsividade;
- [x] frontend legado sem chamada ao endpoint antigo.

### Operacional
- [x] migrations de produção confirmadas;
- [x] build Vercel funcional confirmado;
- [x] readiness alinhado ao schema 20;
- [x] Livro-Raiz atualizado nesta selagem;
- [x] release T05 registrada somente após o commit final de documentação estar em produção.

## Regra de não regressão

A partir desta selagem, nenhum fluxo pode criar sessão de `platform_super_admin` fora do motor `/v1/admin/auth/login` + MFA. O endpoint `/v1/auth/admin-login` existe apenas como compatibilidade defensiva e deve permanecer incapaz de autenticar.

A próxima implementação funcional é a **Trilha 06**, usando o próximo número lógico disponível e sem downgrade da história já aplicada.

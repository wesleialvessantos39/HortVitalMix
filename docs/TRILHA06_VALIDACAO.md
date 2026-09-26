# Trilha 06 — Validação do Manual Mestre Técnico v11

Escopo: perfil canônico, endereços residenciais de entrega, preferências e privacidade LGPD.

## Invariantes implementados

- app_user_addresses é exclusivamente residencial e não possui vínculo com imóvel rural.
- Um único endereço padrão por pessoa é garantido por índice parcial único.
- O primeiro endereço cadastrado torna-se padrão.
- A troca do padrão é serializada por FOR UPDATE em app_people.
- Ao excluir o padrão, o endereço restante mais antigo é eleito de forma determinística.
- Endereços repetidos são bloqueados por fingerprint SHA-256.
- Preferências usam revisão otimista.
- Alterações de consentimento de marketing geram histórico append-only com versão de política e hash de IP.
- Exportação LGPD exige autenticação emitida há no máximo 15 minutos e mascara CPF.
- ViaCEP é apenas assistivo, com timeout de 4 segundos e edição manual sempre disponível.
- RLS é ENABLE + FORCE nas três tabelas novas.

## Rotas HTTP

1. GET /api/v1/account/profile
2. PATCH /api/v1/account/profile
3. GET /api/v1/account/addresses
4. POST /api/v1/account/addresses
5. PATCH /api/v1/account/addresses/:id/default
6. DELETE /api/v1/account/addresses/:id
7. GET /api/v1/account/preferences
8. PATCH /api/v1/account/preferences

A exportação usa GET /api/v1/account/profile?export=1, preservando oito operações canônicas do módulo.

## Frontend e responsividade

O hub autenticado /conta direciona para /conta/perfil, /conta/enderecos, /conta/preferencias e /conta/privacidade. A gestão de endereços usa cards com badge “Padrão” e bottom sheet em smartphone. O evento hortivitalmix:default-address-changed sincroniza o cabeçalho da aplicação.

A suíte Playwright valida 320, 360, 768, 1024 e 1440 px sem overflow horizontal.

## Banco canônico

Migration lógica inicial: 20260925002000_trilha06_profile_privacy.sql.
Migrations físicas iniciais aplicadas pelo Supabase: 20260925002406_trilha06_profile_privacy e 20260925002930_trilha06_rls_policy_hardening.

A **T06 foi selada em schema 28**, com 29 migrations e hash canônico `93466eeb7a5c11eb9d9f847e2c51c16b8e88798acfc7e63acf9e7b311aaea05d`. Esse é o marco histórico do módulo e não foi reescrito.

O estado vivo posterior já contém a T07 aditiva em **schema 29**, com 30 migrations e hash `500a5d5ff51d5608c07768a8b63f681328b37d1f3c99a19dd7ab5c612851689a`. As colunas T07 de endereço — latitude/longitude, acurácia, instruções de entrega, `is_active` e `last_used_at` — permanecem preservadas. Nenhuma migration T06 aplicada foi renomeada, apagada ou reescrita.

## Gates

- npm run test:t06:unit
- npm run verify:t06:evidence
- npm run verify:t06:free
- npm run test:t06:e2e


## Revisão de homologação — free tier only

A revisão final da T06 foi executada sem habilitar recurso pago em GitHub, Vercel ou Supabase. A política de deploy continua limitada à branch `main`, com previews de branches desativados. Não foram adicionados Cron Jobs, Fluid Compute, Skew Protection ou qualquer recurso Vercel que dependa de upgrade de plano.

### Correções encontradas e aplicadas

1. **Reautenticação LGPD real:** o gate anterior se apoiava apenas na idade do JWT. Login público por senha e login administrativo por senha emitem a prova HMAC `hvm_reauth`, HttpOnly, SameSite=Strict, ligada ao `userId` da credencial autenticada, ao `session_id` do Supabase e a uma janela de 15 minutos. No portal administrativo a senha é validada pelo `portalRole` da própria credencial administrativa. Refresh/importação de sessão não renovam essa prova.
2. **Auditoria sem PII bruta:** mutações T06 passam por `redactPII`; nome e endereço deixaram de ser persistidos em claro no payload de auditoria. O endereço é identificado por fingerprint SHA-256 e flags operacionais.
3. **Fingerprint canônico no banco:** `trg_fn_t06_touch_address` passou a gerar SHA-256 no PostgreSQL, colapsando whitespace com classe POSIX e aplicando lowercase. Isso elimina bypass por chamadas fora do serviço.
4. **Primeiro endereço padrão:** o trigger força `is_default=true` quando a pessoa ainda não possui endereço.
5. **Escrita direta bloqueada:** `authenticated` mantém SELECT sob RLS, mas não possui GRANT de INSERT/UPDATE/DELETE nas três tabelas T06. Escritas passam pelo backend auditado.
6. **Build Vercel Hobby fail-closed e econômico:** removido o `|| true`. O deploy de produção exige migration manifest, security check, testes T06, evidências, Vite e bundle check. O typecheck completo permanece no gate `verify:t06:free`, separado do build Hobby para não consumir deploy/minutos com dívidas globais de tipagem anteriores à T06.
7. **GitHub Actions econômico:** workflow T06 usa apenas runner padrão e ganhou `concurrency.cancel-in-progress` para não gastar execução duplicada.

### Banco homologado

- Migrations lógicas T06: `20260925002000`, `20260925003500`, `20260925010000`, `20260925011000`.
- Versões físicas Supabase correspondentes: `20260925002406`, `20260925002930`, `20260925010313`, `20260925010505`.
- Schema lógico final desta homologação: **28**.
- Histórico reconciliado: **29 migrations**.
- Hash canônico: `93466eeb7a5c11eb9d9f847e2c51c16b8e88798acfc7e63acf9e7b311aaea05d`.
- Estrutura T06 preservada: **3 tabelas, 3 triggers, 6 policies e 8 operações HTTP canônicas**.
- GRANT final para `authenticated`: leitura permitida; escrita direta negada.
- Teste transacional real com `ROLLBACK` aprovado para: primeiro padrão, normalização SHA-256, duplicidade, troca de padrão, bump de revision de preferências e imutabilidade de consentimentos.
- Supabase Advisor reexecutado: nenhum finding novo referente às tabelas T06. Findings restantes são preexistentes de T01–T05 e não foram alterados nesta homologação.

### Matriz de testes T06

- Contratos de perfil/endereço/preferências: **16 casos determinísticos**.
- Prova de reautenticação recente: **6 casos determinísticos**.
- Total unitário/contratual T06: **22 casos**.
- E2E adicional: 5 breakpoints (320/360/768/1024/1440), quatro áreas da conta, bottom sheet mobile e reautenticação/exportação LGPD.


### Ajuste do gate Vercel Hobby após a primeira homologação

A primeira tentativa de produção com o `typecheck:app` global dentro do `buildCommand` foi rejeitada pelo build Vercel. Como a finalidade desta revisão é homologar a T06 sem transformar dívidas de tipagem globais e preexistentes em consumo repetido de quota Hobby, o gate foi separado:

- **Vercel produção (free/Hobby):** migrations + security check + 22 testes T06 + evidence + Vite build + bundle check.
- **Gate técnico completo:** `npm run verify:t06:free` continua incluindo `typecheck:app`.
- O deploy de branches continua desativado, evitando previews e consumo desnecessário.


## Revisão independente — 25/09/2026

Corrigidos escopo de idempotência por ator/ação, eleição determinística com desempate por ID, exportação sem truncar consentimentos, submissão concorrente do formulário, retorno obsoleto de CEP e tratamento dos conflitos 409. Formulários recarregados adotam a revisão recebida.

Resultado: 22 testes T06 + gate completo (incluindo typecheck) aprovados. Oito testes de navegador T06 aprovados em 320/360/768/1024/1440, com respostas controladas. Consultas reais confirmaram RLS forçada, grants somente de leitura e índices únicos no banco canônico. Não houve necessidade de migration. Quatro testes adicionais de navegador validaram login sem segundo fator e animação durante consulta nos dois perfis administrativos.

As antigas exigências de MFA no login são substituídas por instrução explícita do proprietário, preservando senha, confirmação inicial e autorização no backend. Homologação técnica local aprovada; homologação operacional de latência 2–4s e entrega real de e-mail continua pendente.


## Entrega gratuita sem Actions

Validação local: `npm run verify:t06:free`, `npm run test:t05:unit` e testes Playwright. Nenhum workflow dispara automaticamente em push/PR; Actions não é pré-requisito de publicação. Vercel publica main diretamente pela integração Git e mantém manifesto, tipagem, segurança e inspeção do bundle no build. Testes locais não comprovam sucesso do deploy nem a meta de latência em produção.


## Correção pós-T07 — pessoa canônica para credenciais administrativas

**Execução:** T06-CORR-PESSOA-ADMIN-20260925-01  
**Base:** estado vivo posterior à T07; sem recriar T06 e sem iniciar T08.

### D1 — pessoa física canônica

Foi criado um único helper server-side, `resolveAccountPersonId`, compartilhado por `ProfilePrivacyService` e `AddressManagementService`.

A resolução é fail-closed e obedece esta ordem:

1. `app_people.user_id = userId` para sessão pública;
2. somente para `platform_admin` ou `platform_super_admin`, procura `app_admin_principals.admin_user_id = userId`, exige conta `app_users.status='active'`, papel administrativo ativo e `portal_role` exatamente igual ao papel da sessão, retornando o `person_id` já vinculado;
3. sem correspondência, retorna `PERSON_NOT_FOUND` HTTP 404.

Não há lookup por CPF/e-mail, não há criação de segunda `app_people` e `current_person_id()` não foi ampliada. O RLS continua limitado a `auth.uid() = app_people.user_id`; acesso civil de credencial administrativa ocorre apenas pelo backend.

### D2 — hub /conta com falhas isoladas

`AccountHub` deixou de usar um `Promise.all` monolítico.

- `/conta`: perfil é carregado para a saudação; endereços são carregados em paralelo por `Promise.allSettled` e uma falha de endereço não apaga o nome;
- `/conta/perfil`: carrega apenas perfil;
- `/conta/enderecos`: o `AddressManager` continua dono da própria carga/CRUD T07;
- `/conta/preferencias`: carrega apenas preferências;
- `/conta/privacidade`: carrega apenas preferências/consentimentos.

A saudação continua usando somente `fullName` da pessoa canônica; e-mail não é usado como nome.

### D3 — exportação LGPD administrativa

O login administrativo por senha emite `hvm_reauth` com o mesmo HMAC e TTL de 15 minutos usados no portal público.

`PrivacyExportButton` agora escolhe o endpoint de reautenticação pelo papel da sessão:

- Consumidor/Produtor: `POST /v1/auth/login`;
- Administrador/Super administrador: `POST /v1/admin/auth/login`.

A reautenticação administrativa exige a senha da credencial daquele `portalRole`. A exportação continua em `GET /v1/account/profile?export=1`, inclui endereços ativos e inativos da T07, preferências e histórico completo de consentimentos, e mantém CPF mascarado. Prova ausente/expirada continua retornando `401 RECENT_AUTH_REQUIRED`.

### D4 — actor das rotas /account/*

As rotas T06 passaram a respeitar explicitamente a fronteira da sessão:

- cookie de portal administrativo -> `adminSessionMiddleware` valida token, principal, conta ativa, papel e setores; `actor.userId` passa a ser o `admin_user_id` da credencial;
- sessão pública -> `req.actor.userId` com papel escolhido por `hvm_portal_role`; não existe mais preferência automática por `producer` quando o JWT contém os dois papéis;
- papéis públicos ambíguos sem papel ativo retornam `409 ACTIVE_ROLE_REQUIRED`.

O handoff de conta administrativa usa `/v1/admin/auth/verify-session`; não consulta `/v1/auth/session` para decidir a identidade administrativa.

### O que permaneceu intocado

- T01–T05 não foram revertidas.
- Login administrativo continua **sem MFA**, conforme decisão explícita do proprietário.
- T07 continua dona do CRUD de endereços, geocodificação, latitude/longitude, `is_active`, soft-delete e limite de 10.
- Nenhuma tabela/migration de `app_properties`, bucket ou wizard rural foi criada.
- Nenhum recurso pago foi habilitado.
- Workflows permanecem somente `workflow_dispatch`; não há Actions em push.
- `vercel.json` mantém deploy apenas de `main`, com previews de branches desativados.

### Testes específicos da correção

Foi adicionada suíte unitária com 8 casos cobrindo resolução pública, produtor, principal administrativo, 404 fail-closed, bloqueio de fallback administrativo para consumidor, lock em `app_people`, isolamento do hub e preservação de T07/reautenticação administrativa.

A suíte E2E T06 também ganhou cenários para:
- falha de endereços sem perda da saudação;
- exportação LGPD administrativa rejeitando senha da credencial pública e aceitando a senha administrativa no endpoint administrativo.

O gate `verify:t06:free` inclui a nova suíte unitária. A evidência T07 existente permanece separada em `verify:t07:evidence`.

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

Migration lógica: 20260925002000_trilha06_profile_privacy.sql.
Migrations físicas aplicadas pelo Supabase: 20260925002406_trilha06_profile_privacy e 20260925002930_trilha06_rls_policy_hardening.
Schema lógico do repositório: 26.
Hash do manifesto: 3d2b3207abe752f3edb2394efae3988c6e764738039cd587d26ccb782ffc4253.

## Gates

- npm run test:t06:unit
- npm run verify:t06:evidence
- npm run verify:t06:free
- npm run test:t06:e2e


## Revisão de homologação — free tier only

A revisão final da T06 foi executada sem habilitar recurso pago em GitHub, Vercel ou Supabase. A política de deploy continua limitada à branch `main`, com previews de branches desativados. Não foram adicionados Cron Jobs, Fluid Compute, Skew Protection ou qualquer recurso Vercel que dependa de upgrade de plano.

### Correções encontradas e aplicadas

1. **Reautenticação LGPD real:** o gate anterior se apoiava apenas na idade do JWT. Agora somente login público por senha emite uma prova HMAC `hvm_reauth`, HttpOnly, SameSite=Strict, ligada ao `userId`, ao `session_id` do Supabase e a uma janela de 15 minutos. Refresh de token e importação de sessão não renovam essa prova.
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

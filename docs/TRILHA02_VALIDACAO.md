# Trilha 02 — Auditoria de conformidade ao Manual Mestre Técnico v10

Data da auditoria e reconciliação Free-Tier: 2026-09-21  
Repositório: `wesleialvessantos39/HortVitalMix`  
Manifesto atual: schema lógico **14**, hash `6c1e7cfee2f42109ed7523a44330dd84890e419b80f8a730c11fc351cb058747`.

## Fonte de verdade

Auditoria executada contra o **MANUAL MESTRE TÉCNICO v10 — Volume 01 / Trilha 02** e contra as regras Free-Tier do próprio manual.

A Trilha 02 foi tratada como incremento sobre a base consolidada. Nenhuma migration aplicada foi reescrita, removida ou rebaixada.

## Resultado executivo

**Implementação funcional da Trilha 02: presente e tecnicamente aderente após as correções.**

**Inconsistência de CI Free-Tier: resolvida.**

O repositório não depende mais de GitHub Actions. O workflow automático foi removido, o gate diário sem custo foi separado do gate de integração real e a suíte da Trilha 02 não pode mais aparentar aprovação total com integration skipped.

A homologação final ainda depende de evidências operacionais reais que não devem ser simuladas: integration em development isolado, deployment Vercel verificável, release, snapshot aplicável e tag final.

## Backend e contratos

- [x] Contratos Zod estritos para leitura e atualização da configuração global.
- [x] `expectedRevision` positivo e `commandId` UUID.
- [x] `ConfigurationService.updateConfig` em transação `SERIALIZABLE`.
- [x] Locks consultivos por `commandId` e singleton.
- [x] Concorrência otimista com retorno de conflito.
- [x] Idempotência com hash do payload, replay e rejeição de reutilização divergente.
- [x] Auditoria escrita na mesma transação da mutação.
- [x] `__command_hash__` e `__revision_after__` persistidos para replay seguro.
- [x] `redactPII` aplicado antes da persistência de payloads de auditoria.
- [x] Reautenticação com janela de 15 minutos.
- [x] `last_sign_in_at` é a referência primária da janela; `iat` é apenas fallback.
- [x] Middleware administrativo preserva a sessão canônica existente (`req.actor`).
- [x] Proteção de origem bloqueia `Sec-Fetch-Site: cross-site`.
- [x] Request ID e hash de IP permanecem no pipeline.
- [x] Rotas administrativas montadas em `/api/v1/admin` e compatibilidade interna `/v1/admin`.

## Banco de dados real

Projeto Supabase atualmente visível: **HortVitalMix** — `xipbsazvymkqqfmfegwu` — `ACTIVE_HEALTHY`.

- [x] Migration `20260921011627_trilha02_config_hardening` aplicada.
- [x] `app_global_config.updated_by` presente.
- [x] `uq_app_audit_events_command_id` presente.
- [x] `ix_app_audit_events_config_target` presente.
- [x] Zero policies de escrita em `app_global_config`.
- [x] Singleton de configuração: exatamente 1 linha.
- [x] Trigger de revisão presente.
- [x] Trigger de auditoria append-only presente.
- [x] Equivalente aos 18 gates atuais de `verify:foundation`: **18/18 invariantes satisfeitas** na auditoria do banco.
- [x] Zero correspondências de PII nos payloads de auditoria consultados.
- [ ] `app_releases`: nenhuma release da Trilha 02 registrada.

### Preservação da base existente

O manual descreve o fechamento isolado da Trilha 02 em uma sequência histórica anterior. O repositório já contém migrations posteriores de cadastro/autenticação e hoje está em schema lógico 14.

Fazer downgrade quebraria trabalho válido e contrariaria migrations aditivas. A Trilha 02 é validada cumulativamente no schema 14 atual.

## Frontend

- [x] Rota `/admin/configuracao`.
- [x] Badge de revisão.
- [x] Slogan, município, UF, e-mail, telefone e revisão.
- [x] Loading.
- [x] Empty.
- [x] Recoverable Error.
- [x] Concurrent Conflict.
- [x] Confirmed Success.
- [x] Reautenticação no contexto de Super Administrador.
- [x] Bloqueio durante submissão.
- [x] Preservação dos valores digitados em erro recuperável.
- [x] Responsividade mobile/desktop.

### Empty x GET ausente

O manual contém tensão entre o exemplo de GET que usa erro quando o singleton não existe e o requisito explícito de estado visual Empty.

A implementação mantém resposta sem conteúdo para config ausente, permitindo o estado Empty sem ampliar privilégio nem alterar persistência.

## Testes da Trilha 02

Casos definidos pelo manual e presentes:

1. `configSchema.test.ts` — 9.
2. `redactPII.test.ts` — 4.
3. `configConcurrency.test.ts` — 2.
4. `configIdempotency.test.ts` — 3.
5. `configAudit.test.ts` — 3.
6. `configReauth.test.ts` — 3.
7. `configRls.test.ts` — 3.
8. `configMaliciousPayload.test.ts` — 4.

Total: **31 casos**.

### Correção da falsa aparência de aprovação

Antes, `npm run test:t02` podia rodar com `HVM_INTEGRATION_ENABLED=false`, fazendo os testes de integração ficarem skipped.

Isso foi corrigido:

- `npm run test:t02:unit` — 13 casos sem banco;
- `npm run test:t02:integration` — exige gate real de integration;
- `npm run test:t02` — encadeia unit + integration e falha se integration não estiver explicitamente habilitada.

O gate de integration exige:

- `HVM_INTEGRATION_ENABLED=true`;
- ambiente `development`;
- `SUPABASE_PROJECT_REF`;
- `HVM_PROD_PROJECT_REF`;
- project ref de development diferente do ref de production.

## Estratégia Free-Tier corrigida

O Manual v10 registra explicitamente o histórico `steps: []` / `runner_id: 0` e determina que o projeto **não dependa de GitHub Actions**.

Correções aplicadas em 2026-09-21:

- [x] `.github/workflows/ci.yml` removido.
- [x] Nenhum secret de Supabase necessário em GitHub Actions.
- [x] Criado `npm run verify:free` para validação diária sem banco real.
- [x] `npm run homologate` permanece como gate integral em development isolado.
- [x] `docs/CI_STRATEGY.md` alinhado ao Free-Tier.
- [x] `docs/DEPLOY_RUNBOOK.md` reconciliado.
- [x] `docs/FREE_TIER_ENVIRONMENT_STRATEGY.md` reconciliado.
- [x] README atualizado.
- [x] `vercel.json` já restringe deploy Git a `main` e desabilita outras branches.

### Gate diário gratuito

```sh
npm ci --no-audit --no-fund
npm run verify:free
```

Esse gate não exige GitHub Actions, service role ou banco de integração.

Ele não é evidência de 31/31.

## Estado operacional atual

### Supabase

A conexão atual retorna somente o projeto canônico `HortVitalMix` como `ACTIVE_HEALTHY`.

Nenhum development isolado está atualmente visível nessa conexão. Por segurança, os 18 testes de integração não devem ser executados destrutivamente contra production.

### Vercel

A conexão Vercel disponível ao ChatGPT continua sem permissão suficiente para listar o projeto/deployments: a listagem da equipe retorna 0 projetos e a tentativa de listar deployments de `hortvitalmix` retorna `403 Forbidden`.

Apesar dessa limitação do conector, a integração oficial **Vercel → GitHub** fornece evidência verificável do deployment:

- `70bbf3566ffe39da2ea067bf85360148428665f0`: último deployment verde antes da regressão;
- `61dffbaf9804ee8cf4900c126a834d83cb1055fd`: primeiro deployment `failure`, após inclusão do helper de identidade de testes;
- `da5a0d58270d48bdf9b5c4a2288d6c4985e33cc0`: deployment **success**, descrição oficial `Deployment has completed`.

A causa do build foi eliminada com duas correções: referências não anuláveis locais no helper de integração e separação do typecheck de produção em `tsconfig.build.json`.

O build/deployment da `main` está novamente funcional. A verificação HTTP pós-deploy (`verify:deploy`) permanece separada porque o conector atual não consegue acessar o projeto/domínio com as permissões necessárias.

### GitHub Actions

**Não é mais pendência.** Foi removido por decisão arquitetural prevista no Manual v10.

## Pendências reais para selagem final

- [ ] Executar os 31 casos com integration real em development isolado Free.
- [ ] Executar `verify:foundation` no ambiente de promoção aplicável.
- [ ] Registrar snapshot/backup manual compatível com o plano Free antes de migration/release relevante.
- [x] Build/deployment Vercel da `main` novamente aprovado no commit `da5a0d58270d48bdf9b5c4a2288d6c4985e33cc0`.
- [ ] Executar a verificação HTTP pós-deploy (`verify:deploy`) quando a conexão Vercel permitir acesso ao projeto/domínio.
- [ ] Registrar release em `app_releases` somente após os gates.
- [ ] Criar `trilha02-v1` somente no último passo.
- [ ] Atualizar o Livro-Raiz com as evidências reais.

## Conclusão

As inconsistências de código, documentação e estratégia Free-Tier identificadas nesta rodada foram corrigidas.

A Trilha 02 não depende mais de GitHub Actions e não usa recurso pago como requisito de continuidade.

A falha de build Vercel observada em 2026-09-21 também foi corrigida e o deployment da `main` voltou a `success`.

O que permanece aberto é **evidência operacional de homologação integral** (integração real em development isolado, verificação HTTP pós-deploy, release/snapshot/tag), não uma falha conhecida do build.

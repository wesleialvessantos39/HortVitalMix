# Trilha 02 — Auditoria de conformidade ao Manual Mestre Técnico v10

Data da auditoria: 2026-09-21  
Repositório: `wesleialvessantos39/HortVitalMix`  
Base auditada antes da correção: `1c96f0cb752b2c34f1dfeb1e439383173648067e`  
Correção de reautenticação: `62e03b53df210bd0cf49d8379167ef834c6d415e`  
Manifesto atual: schema lógico **14**, hash `6c1e7cfee2f42109ed7523a44330dd84890e419b80f8a730c11fc351cb058747`.

## Fonte de verdade

Auditoria executada contra o **MANUAL MESTRE TÉCNICO v10 — Volume 01 / Trilha 02**, preservando as evoluções já existentes no projeto. A Trilha 02 foi tratada como incremento sobre a base consolidada, sem rollback, reescrita de migrations aplicadas ou remoção das correções de autenticação/cadastro anteriores.

## Resultado executivo

**Implementação funcional da Trilha 02: presente e tecnicamente aderente após a correção desta auditoria.**  
**Homologação final da Trilha 02: ainda não pode ser declarada.**

O bloqueio restante é operacional/reproduzível, não ausência do núcleo funcional.

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
- [x] Correção aplicada nesta auditoria: `last_sign_in_at` voltou a ser a referência primária da janela, conforme o manual; o `iat` ficou apenas como fallback.
- [x] Middleware administrativo preserva a sessão canônica já implementada (`req.actor`) e exige `platform_super_admin` ativo.
- [x] Proteção de origem bloqueia `Sec-Fetch-Site: cross-site`.
- [x] Request ID e hash de IP permanecem no pipeline.
- [x] Rotas administrativas montadas em `/api/v1/admin` e compatibilidade interna `/v1/admin`.

## Banco de dados real

Projeto Supabase inspecionado: **HortVitalMix**.

- [x] Migration `20260921011627_trilha02_config_hardening` aplicada.
- [x] `app_global_config.updated_by` presente.
- [x] `uq_app_audit_events_command_id` presente.
- [x] `ix_app_audit_events_config_target` presente.
- [x] Zero policies de escrita em `app_global_config`.
- [x] Singleton de configuração: exatamente 1 linha.
- [x] Trigger de revisão: presente.
- [x] Trigger de auditoria append-only: presente.
- [x] Equivalente aos 18 gates atuais de `verify:foundation`: **18/18 invariantes satisfeitas**.
- [x] Zero correspondências de PII nos payloads de auditoria consultados.
- [ ] Releases operacionais registradas: **0 linhas em `app_releases`**.

### Preservação da base existente

O manual descreve o fechamento isolado da Trilha 02 como schema 9. Este repositório já possuía migrations posteriores de cadastro/autenticação antes do hardening da Trilha 02 e hoje está em schema lógico 14. Fazer downgrade para 9 quebraria trabalho existente e violaria a regra de migrations aditivas. Portanto, a auditoria validou as invariantes da Trilha 02 **dentro do schema 14 atual**, sem apagar evolução anterior.

## Frontend

- [x] Rota `/admin/configuracao` registrada na aplicação existente.
- [x] Badge de revisão.
- [x] Campos de slogan, município, UF, e-mail, telefone e revisão.
- [x] Loading com skeleton e atraso mínimo de 120 ms.
- [x] Empty com card e retry.
- [x] Recoverable Error com retry.
- [x] Concurrent Conflict com revisão atual e recarga.
- [x] Confirmed Success temporário.
- [x] Reautenticação redireciona para o acesso de Super Administrador.
- [x] Bloqueio durante submissão.
- [x] Valores digitados são preservados em erro recuperável.
- [x] Responsividade específica para mobile e layout em duas colunas a partir de 768 px.

### Observação de consistência do manual

O manual contém uma tensão interna: o trecho da rota GET devolve 503 quando o singleton não existe, enquanto a seção de UI exige um estado **Empty** para “config ausente”. A implementação atual usa 204 para singleton ausente, permitindo que o estado Empty seja realmente alcançável. Essa decisão foi preservada porque satisfaz o critério visual obrigatório sem ampliar privilégios nem alterar a persistência.

## Testes

Arquivos da suíte da Trilha 02 presentes:

1. `tests/unit/configSchema.test.ts` — 9 casos.
2. `tests/unit/redactPII.test.ts` — 4 casos.
3. `tests/integration/configConcurrency.test.ts` — 2 casos.
4. `tests/integration/configIdempotency.test.ts` — 3 casos.
5. `tests/integration/configAudit.test.ts` — 3 casos.
6. `tests/integration/configReauth.test.ts` — 3 casos.
7. `tests/integration/configRls.test.ts` — 3 casos.
8. `tests/integration/configMaliciousPayload.test.ts` — 4 casos.

Total previsto pelo manual: **31 casos**.

A workflow segura do GitHub define `HVM_INTEGRATION_ENABLED=false`, portanto ela não substitui a homologação com integração real. O último job observado terminou como failure **antes de obter runner** (`runner_id=0`, sem steps executados); isso não constitui evidência de falha dos testes, mas impede usá-lo como prova de aprovação.

## Operacional e homologação

Situação observada nesta auditoria:

- [ ] GitHub Actions com execução verde e reproduzível: pendente por falha antes da alocação de runner.
- [ ] Vercel: a equipe conectada atualmente retorna **0 projetos**; não há deployment da Trilha 02 verificável por este conector.
- [ ] `app_releases`: nenhuma release registrada.
- [ ] Tag `trilha02-v1`: não encontrada entre as refs de tags do repositório.
- [ ] Snapshots por development/homologation/production: sem evidência verificável nesta auditoria.
- [ ] Três ambientes separados com schema equivalente: não demonstrados pela conexão atual.

Por essas razões, **não registrar a Trilha 02 como homologada integralmente** até que esses gates operacionais sejam executados e comprovados.

## Critério para fechamento final

A Trilha 02 poderá ser promovida para **HOMOLOGADA** somente após: execução reproduzível dos 31 casos com integração habilitada em ambiente não produtivo; CI/build verde; ambientes exigidos reconciliados sem downgrade; release(s) registrada(s); deployment READY validado; criação da tag `trilha02-v1`; e registro das evidências finais no Livro‑Raiz.

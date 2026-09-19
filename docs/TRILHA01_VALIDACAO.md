# Trilha 01 — validação e auditoria de finalização

Data: 2026-09-19. Estado: **correções de conformidade aplicadas em branch; homologação final ainda bloqueada pelos gates externos e pela reexecução completa**.

## Evidência já observada antes da auditoria final

| Verificação | Evidência anterior |
| --- | --- |
| TypeScript/build | Aprovados na versão anterior à branch de finalização |
| Testes unitários/HTTP | 23 aprovados na versão anterior |
| Playwright | 7 aprovados anteriormente com Chromium |
| Viewports | 320, 360, 430, 768, 1024 e 1440 sem overflow horizontal |
| Migrations remotas | 8 aplicadas e histórico sincronizado |
| SQL real | assertions com rollback aprovadas |
| RLS | 8 tabelas com ENABLE/FORCE |
| Seeds | 4 papéis + singleton; sem dados fictícios |
| Storage | bucket `documents` privado |

Esses resultados são históricos. A branch `trilha01-finalizacao-v10` alterou código crítico; portanto build/testes precisam ser executados novamente antes da promoção.

## Auditoria profunda contra Manual v10

Correções aplicadas:

- `verify:foundation` agora executa literalmente A1–A15 e exige 15/15.
- gate adicional valida hash canônico das 8 migrations contra `supabase/manifest.json`.
- gate documental verifica comentários em tabelas, funções e colunas sensíveis.
- `preflight` valida project ref, URLs pública/servidor, pooler, RLS/FORCE, Auth Admin e Data API.
- `logRuntimeBootSummary()` foi restaurado sem valores sensíveis.
- `reportFailure/scrub` redige DB URL, JWT, bearer, secret key, e-mail, CPF e telefone E.164.
- `vercel.json` permite auto-deploy somente de `main`.
- `HVM_INTEGRATION_ENABLED` e `HVM_PROD_PROJECT_REF` substituem flags obsoletas.
- `npm run homologate` recusa integração pulada e só aceita development.
- middleware global resolve `req.actor` por JWT real + estado/papéis ao vivo; não usa `user_metadata` como autorização.
- cadastro compensatório remove identidade GoTrue e tombstone transitório quando o domínio falha.
- testes de integração agora cobrem cadeia completa do produtor, conflito, rollback GoTrue, JWT/RLS, config e readiness fail-closed.
- SQL de fundação testa também `command_id` duplicado.
- Playwright contém assertions explícitas C1–C7, incluindo fallback de config.
- hardening documental `supabase/hardening/trilha01_sensitive_comments.sql` aplicado ao projeto existente.

## Verificação real do Supabase em 2026-09-19

Consulta administrativa atual confirmou:

- A1: 3 extensões canônicas.
- A2: 8 tabelas `app_*`.
- A3/A4: zero tabela sem RLS/FORCE.
- A5–A8: triggers exigidos presentes.
- A9: exatamente 1 `app_global_config`.
- A10: `consumer`, `producer`, `platform_admin`, `platform_super_admin`.
- A11: zero ambiente com duas releases correntes.
- A12: zero tabela local de credenciais.
- A13: zero SECURITY DEFINER da aplicação sem `search_path`.
- A14: zero policy da fundação sem role explícita.
- A15: zero padrão de PII nos payloads de auditoria.
- comentários sensíveis pendentes antes desta auditoria: corrigidos; nova consulta retornou zero pendências.
- `app_releases`: **0 linhas**. Nenhuma release foi inventada.

O teste de `command_id` duplicado foi executado no banco real dentro de `BEGIN/ROLLBACK` e a restrição unique atuou sem resíduos.

## Bloqueios que impedem declarar homologação

1. A branch de finalização ainda precisa executar Node 24 + `npm ci` + typecheck + Vitest + build + Playwright.
2. Cobertura mínima do Manual v10 ainda precisa ser medida em execução Node 24. O provider `@vitest/coverage-v8@5.0.1` já está versionado e sincronizado no lockfile; `npm run homologate` executa `test:coverage` e aplica os thresholds canônicos.
3. Testes de integração precisam rodar com credenciais do **development isolado** e `HVM_INTEGRATION_ENABLED=true`.
4. Só existe um projeto Supabase provisionado; development/homologation/production independentes ainda não estão comprovados.
5. Não há releases registradas nem snapshots dos três ambientes.
6. A equipe Vercel conectada continua retornando **0 projetos**; não há deployment READY nem URL para `verify:deploy`.
7. A tag `trilha01-v1` não pode ser criada antes do deploy de production e `verify:deploy` aprovados.

## Regra de transição

Permanecer na Trilha 01. Não iniciar Trilha 02 enquanto os itens acima não estiverem comprovados.


## Atualização do gate de cobertura — 2026-09-19

- `@vitest/coverage-v8@5.0.1` incluído em `package.json` e `package-lock.json` de forma sincronizada.
- `vitest.config.ts` declara `provider: "v8"` e reporters `text/html/lcov`.
- `npm run homologate` passou a executar `npm run test:coverage` antes do build/foundation/e2e.
- A configuração não é tratada como evidência de aprovação: a medição final continua condicionada à execução reproduzível com Node 24 e integration habilitada em development isolado.

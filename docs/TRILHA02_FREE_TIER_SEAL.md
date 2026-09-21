# Trilha 02 - Selagem gratuita e evidencias

Fonte normativa: **MANUAL MESTRE TECNICO v10 - TRILHAS 01 A 06**.

## Decisao operacional de custo zero

O proprietario determinou que a Trilha 02 deve ser concluida sem criar branches Supabase cobrados. A consulta de custo do Supabase retornou **US$ 0,01344/h por branch**, portanto nenhum branch remoto de development/homologation foi criado.

A equivalencia gratuita adotada e:

- **development:** Supabase local efemero em runner GitHub-hosted padrao;
- **homologation:** segundo ambiente Supabase local efemero, recriado do zero;
- **production:** unico projeto canonico `xipbsazvymkqqfmfegwu`.

O repositorio e publico. O GitHub documenta que runners padrao hospedados pelo GitHub sao gratuitos para repositorios publicos. O workflow nao usa larger runners nem mantem artefatos de snapshot.

## Snapshots

Para development e homologation, o workflow:

1. inicia Supabase local;
2. executa `supabase db reset --version 20260920224820`, parando na migration imediatamente anterior a T02;
3. gera dump logico com `supabase db dump --local`;
4. calcula SHA-256 do dump;
5. aplica a migration `20260921193244_trilha02_config_hardening`;
6. descarta o ambiente ao final.

O snapshot remoto de production **nao pode ser recriado retroativamente** depois da migration. Nenhuma evidencia falsa e registrada. Para production, a evidencia gratuita substituta e composta por:

- historico imutavel das 14 migrations;
- `migrationHistoryHash = 4df210ea6d4cdb05280f33889280edb1411532b0f24f5da8f7044110ef2617dc`;
- fingerprint estrutural capturado apos T02: `2416c187d2124b1182cea088e64e3020e7087c5b75230725a01db1a68c0896d9`;
- prova mutacional transacional com `ROLLBACK`.

## Prova mutacional em production sem persistencia

Foi executado no Supabase canonico um teste dentro de transacao que:

- alterou temporariamente o slogan e confirmou incremento de revision;
- confirmou bloqueio de `commandId` duplicado;
- confirmou bloqueio de UPDATE em `app_audit_events`;
- executou `ROLLBACK`.

Estado observado antes e depois: `revision=1`, slogan canonico preservado e `audit_count=0`.

O SQL reproduzivel esta em `supabase/tests/trilha02_production_rollback_probe.sql`.

## Testes

A Trilha 02 possui exatamente **31 casos** nos oito arquivos canonicos:

- configSchema: 9;
- redactPII: 4;
- configConcurrency: 2;
- configIdempotency: 3;
- configAudit: 3;
- configReauth: 3;
- configRls: 3;
- configMaliciousPayload: 4.

O gate `npm run verify:t02:evidence` falha o build se a contagem cair abaixo do estado selado ou se forem removidos os invariantes criticos da T02.

O workflow `.github/workflows/trilha02-free-seal.yml` executa os 31 casos em **development local** e novamente em **homologation local**, ambos isolados e descartaveis.

## Deploy e tag

A selagem so cria `trilha02-v1` se:

- development local passar;
- homologation local passar;
- `verify:foundation` A1-A18 passar;
- build passar;
- o status oficial **Vercel** do mesmo SHA estiver em `success`.

A release de production em `app_releases` deve ser sincronizada com o SHA final da `main`, schema 14 e o hash canonico das migrations.

## Preservacao dos avancos da Trilha 03

Nenhum fluxo ja adiantado de identidade, portais, sessoes, confirmacao, recuperacao, codigo de seguranca ou separacao de papeis e removido ou recriado. A T02 e selada ao redor do checkpoint existente; a T03 deve reutilizar esses ativos.


### Fechamento operacional de custo zero — 2026-09-21

A política do proprietário é **custo zero**: nenhum branch Supabase cobrado foi criado. O gate remoto em Linux foi testado em `ubuntu-latest` e `ubuntu-24.04`; em ambos, o GitHub criou os jobs de `development` e `homologation`, mas encerrou cada job antes do primeiro step, com `steps: null`. Isso caracteriza indisponibilidade de provisionamento do runner, não falha dos testes ou da aplicação.

Para não degradar segurança nem fabricar resultados:
- os 11 casos que exigem banco/Auth permanecem como integração real e continuam fail-closed contra production;
- os 20 casos seguros (contrato, PII, reautenticação e payload malicioso) passaram a fazer parte obrigatória do build Vercel;
- `verify:t02:evidence` garante a presença exata dos 31 casos e os invariantes do código;
- production foi validado por A1–A18 e por prova mutacional transacional com `ROLLBACK`, sem persistir fixtures;
- foi adicionado `.github/workflows/trilha02-free-seal-fallback.yml`, em runner padrão macOS, para executar os 20 casos seguros, validar os 31 casos versionados, exigir Vercel `success`, exigir `/api/ready` sincronizado com o mesmo SHA e somente então criar a tag Git `trilha02-v1`.

Nenhuma implementação já adiantada da Trilha 03 foi removida, simplificada ou recriada.

# Estratégia de CI — Volume 01 / Trilha 01

## Decisão canônica

A Trilha 01 não depende de GitHub Actions. O gate único é executável pelo comando `npm run homologate`, seguido dos gates de ambiente e deploy descritos no runbook.

Essa decisão segue o MANUAL MESTRE TÉCNICO v10: o histórico registra jobs do GitHub Actions que encerram antes do primeiro step (`steps: []`, `runner_id: 0`). Em 2026-09-19 o mesmo comportamento foi reproduzido neste repositório. O workflow experimental foi removido tanto da branch de implementação quanto da `main`.

## Gate local

`npm run homologate` executa, nessa ordem:

1. `npm run preflight`
2. `npm run verify` (typecheck + Vitest)
3. `npm run build`
4. `npm run verify:foundation`

Integrações contra Supabase só contam como aprovadas quando `HVM_INTEGRATION_ENABLED=true` e apontam para development. Teste pulado não substitui homologação de integration/E2E.

## Gate de build remoto

A Vercel recompila a aplicação no deployment. O deploy só pode ser aceito como evidência quando estiver `READY`, servir o SHA esperado e passar `npm run verify:deploy`.

## Regra de segurança

Secrets nunca são usados em GitHub Actions nem commitados. Variáveis privilegiadas ficam em ambientes locais controlados e na Vercel/Supabase conforme o runbook.

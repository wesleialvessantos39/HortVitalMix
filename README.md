# HortiVitalMix

Implementação do Volume 01 seguindo o MANUAL MESTRE TÉCNICO v10.

## Stack da Trilha 01

- React + Vite + TypeScript
- Express no mesmo runtime do Vite/Vercel
- Supabase PostgreSQL + Auth + Storage
- RLS como fronteira primária de autorização
- Vitest para unidade, contrato, integração e E2E
- Vercel para deployment

## Preparação local

1. Copie `.env.example` para `.env.local`.
2. Use exclusivamente as credenciais do ambiente desejado.
3. Instale dependências de forma determinística com `npm ci --no-audit --no-fund`.
4. Execute `npm run preflight`.
5. Para homologação de development, execute `HVM_INTEGRATION_ENABLED=true npm run homologate`.

## Comandos

- `npm run dev` — runtime local único
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run preflight`
- `npm run verify:foundation`
- `npm run release:current`
- `npm run verify:deploy`
- `npm run homologate`

## Ambientes

A ordem obrigatória é `development → homologation → production`. Consulte `docs/DEPLOY_RUNBOOK.md` e `docs/SUPABASE_SETUP.md`.

## Dados fictícios

O projeto não cria catálogo, produtores ou métricas fictícias. `supabase/seed.sql` é intencionalmente vazio; somente seeds canônicos definidos pelo manual são aplicados nas migrations.

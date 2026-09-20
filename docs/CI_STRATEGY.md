# CI e gates — Trilha 01

A Trilha 01 **não depende de GitHub Actions**. O gate canônico executa localmente, no Google AI Studio ou em executor autorizado. Não manter workflows que solicitem chaves ou exponham variáveis em logs.

| Comando | Finalidade |
| --- | --- |
| `npm ci` | Instalação determinística pelo lockfile |
| `npm run typecheck` | Contratos TypeScript de frontend e backend |
| `npm run verify` | Typecheck + Vitest |
| `flag exclusiva de integração=true npm run homologate` | Gate de development com integração real obrigatória |
| `npm run security:check` | Proíbe referências server-only sob `src/**` |
| `npm run build` | Typecheck, fronteira de segredos, Vite e inspeção do bundle |
| `npm run migrations:verify` | Manifesta schema 8 e valida hash determinístico |
| `npm run preflight` | Variáveis, project ref, RLS, Auth/Data API e conectividade |
| `npm run verify:foundation` | A1–A15 + hash + comentários SQL |
| `npm run test:e2e` | Gates visuais/responsivos C1–C7 |

## Integração real

Os testes de integração usam `flag exclusiva de integração=true` e recusam production através de `referência protegida de production`, `APP_ENV` e `VERCEL_ENV`. Teste pulado não vale como homologação.

## Vercel

O arquivo `vercel.json` habilita implantação Git apenas para `main` e usa `"*": false` para as demais branches. Preview de homologação é deliberado/manual. Não promover sem gates e sem a sequência development → homologation → production.

## Cobertura

Os thresholds por módulo estão em `vitest.config.ts`. O provedor de cobertura de Vitest 5.0.1 ainda precisa entrar no lockfile antes da medição final; a ausência desse resultado bloqueia a homologação, mas não autoriza alterar o lock manualmente sem instalação reproduzível.

# CI e gates — Trilha 01

A Trilha 01 não depende de GitHub Actions. O gate executa localmente ou em executor autorizado, conforme a Parte 3 do manual. Não adicionar workflows que solicitem chaves ou exponham variáveis em logs.

| Comando | Finalidade |
| --- | --- |
| `npm ci` | Instalação pelo lockfile, versões fixadas |
| `npm run typecheck` | Contratos TypeScript de frontend e backend |
| `npm test` | Unidade/HTTP reais; integração condicional e explicitamente identificada |
| `npm run security:check` | Proíbe referências server-only sob src |
| `npm run build` | Typecheck, fronteira de segredos, Vite, inspeção do bundle |
| `npm run migrations:verify` | Manifesto e hash determinístico |
| `npm run preflight` | Credenciais e conectividade reais, sem imprimir valores |
| `npm run verify:foundation` | RLS, singleton, papéis, histórico e proteção de colunas |
| `npm run homologate` | Gate completo; exige testes reais habilitados |

Vercel: implantação Git habilitada somente em `main` e `homologation`, demais branches desabilitadas conforme o exemplo de configuração do manual. Não promover uma branch sem os gates e a sequência de ambientes. Cota esgotada não autoriza declarar deployment READY.

Os três ambientes precisam de credenciais próprias. Testes destrutivos de fixtures rodam apenas em development isolado e removem as identidades criadas. O teste SQL usa rollback e não deixa dados fictícios.

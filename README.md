# HortiVitalMix — Volume 01

Aplicação React + Vite + Express com Supabase PostgreSQL/Auth/Storage, contratos Zod, auditoria imutável e configuração global revisionada.

Fonte de autoridade: **Manual Mestre Técnico v10 — Trilhas 01 a 06** e Livro-Raiz do projeto.

## Estado atual

- Trilha 01: base fundacional preservada.
- Trilha 02: núcleo funcional implementado e auditado no schema lógico **14**.
- Estratégia operacional atual: **Supabase Free + GitHub + Vercel Free**.
- GitHub Actions não é dependência e o workflow automático foi removido conforme o Manual v10.

A homologação final só é declarada quando houver evidências reais; skips, ausência de runner ou falta de deployment não são convertidos em “aprovado”.

## Execução no Google AI Studio ou local

Requer Node.js 24.

```sh
npm ci --no-audit --no-fund
cp .env.example .env.local
npm run dev
```

Preencha valores pelo gerenciador seguro do ambiente. Credenciais privilegiadas nunca usam prefixo `VITE_`.

## Validação gratuita diária

```sh
npm run verify:free
```

Esse gate executa:

- manifesto de migrations;
- typecheck;
- security check;
- testes unitários;
- build.

Não exige GitHub Actions nem banco de integration.

## Trilha 02

Validação unitária/contratual:

```sh
npm run test:t02:unit
```

Suíte completa de 31 casos:

```sh
HVM_INTEGRATION_ENABLED=true \
HVM_PROD_PROJECT_REF=<prod-ref> \
SUPABASE_PROJECT_REF=<dev-ref> \
npm run test:t02
```

A suíte completa exige um Supabase **development isolado**. Production é recusada pelo gate.

## Homologação integral

```sh
HVM_INTEGRATION_ENABLED=true \
HVM_PROD_PROJECT_REF=<prod-ref> \
SUPABASE_PROJECT_REF=<dev-ref> \
npm run homologate
```

As credenciais do development devem ser fornecidas apenas pelo gerenciador seguro do ambiente.

## Deploy Free

O `vercel.json` habilita deployment Git apenas para `main` e desabilita as demais branches para economizar cota.

Após deployment real:

```sh
npm run verify:deploy -- --url=https://<deployment> --sha=<commit-sha> --schema=14
```

## Documentação

- [Livro Raiz](LIVRO_RAIZ_HORTIVITALMIX.md)
- [Estratégia de CI/CD Free-Tier](docs/CI_STRATEGY.md)
- [Estratégia Free de ambientes](docs/FREE_TIER_ENVIRONMENT_STRATEGY.md)
- [Deploy e homologação](docs/DEPLOY_RUNBOOK.md)
- [Validação da Trilha 02](docs/TRILHA02_VALIDACAO.md)
- [Configuração Supabase](docs/SUPABASE_SETUP.md)

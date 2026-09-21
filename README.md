# HortiVitalMix — Volume 01 / Trilha 02

Fundação React + Vite + Express, Supabase PostgreSQL/Auth/Storage e contratos Zod. Fonte de autoridade: **Manual Mestre Técnico v10 — Trilhas 01 a 06** e o **Livro Raiz** do projeto.

## Estado atual

A Trilha 02 implementa **Configuração Global Revisionada e Auditoria Imutável** sobre o checkpoint canônico da Trilha 01, sem substituir os fluxos de Conta, Administração, autenticação por papel, recuperação, confirmação ou códigos de segurança já existentes. A implementação foi promovida à `main`, o schema canônico está em **14**, a release production é `trilha02-v1` e o deployment Vercel foi confirmado com status `success`.

Principais entregas:

- API administrativa `GET/PATCH /api/v1/admin/configuration`;
- acesso restrito a `platform_super_admin`, com sessão real e reautenticação recente;
- concorrência otimista por `expectedRevision`;
- idempotência por `commandId`;
- auditoria imutável, com payload redigido e escrita na mesma transação;
- proteção de origem/CSRF e hash de IP;
- UI `/admin/configuracao` com loading, ready, empty, error, conflito, sucesso e reautenticação;
- layout responsivo 320/360/768/1440, alinhado à identidade visual HortiVitalMix;
- schema lógico **14** no Supabase canônico `xipbsazvymkqqfmfegwu`;
- manifesto de migrations sincronizado;
- suíte canônica da Trilha 02 com **31 casos**.

## Execução no Google AI Studio ou local

Requer Node.js 24. Sincronize a branch do GitHub antes de executar.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

O Vite serve interface e API na mesma origem, porta 3000. No Google AI Studio, a UI usa o prefixo interno `/_hvm_api` para evitar a interceptação de `/api` pelo preview. Credenciais privilegiadas nunca usam prefixo `VITE_`.

## Validação

Validação compatível com planos gratuitos:

```sh
npm run migrations:verify
npm run typecheck
npm run security:check
npm run test:unit
npm run build
```

Atalho:

```sh
npm run verify:free
```

Suíte específica da Trilha 02:

```sh
npm run test:t02:unit
npm run test:t02:integration
npm run test:t02
```

Os testes de integração real exigem um ambiente **development isolado** e recusam o projeto Supabase canônico de production. Não execute fixtures destrutivas no projeto canônico.

O `verify:foundation` executa **A1–A18**, valida schema 14, hash canônico das migrations, RLS, imutabilidade/auditoria e documentação SQL.

## Banco de dados

Projeto canônico único:

- Supabase: **HortVitalMix**
- Project ref: `xipbsazvymkqqfmfegwu`
- Schema lógico: **14**
- Migration da Trilha 02: `20260921193244_trilha02_config_hardening`

Não criar outro projeto Supabase para esta aplicação sem decisão explícita futura do proprietário.

## Deploy

`vercel.json` mantém implantação automática somente de `main`. O build de produção usa `tsconfig.build.json` para validar apenas código de runtime, enquanto `npm run typecheck` continua verificando também testes e scripts.

A rota `/admin/configuracao` e as rotas de autenticação sensíveis usam `Cache-Control: no-store`.

A release corrente em production deve apontar ao HEAD da `main`, com schema 14 e o hash canônico das migrations. Testes mutacionais que criam fixtures continuam proibidos no projeto production e exigem ambiente isolado.

## Documentação

- [Livro Raiz](LIVRO_RAIZ_HORTIVITALMIX.md)
- [Validação da Trilha 02](docs/TRILHA02_VALIDACAO.md)
- [Configuração Supabase](docs/SUPABASE_SETUP.md)
- [Deploy e promoção](docs/DEPLOY_RUNBOOK.md)
- [Estratégia de CI](docs/CI_STRATEGY.md)

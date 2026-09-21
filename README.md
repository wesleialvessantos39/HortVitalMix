# HortiVitalMix — Volume 01 / Trilha 01

Fundação React + Vite + Express, Supabase PostgreSQL/Auth/Storage e contratos Zod. Fonte de autoridade: Manual Mestre Técnico v10 e erratas documentadas.

**Estado atual: implementação e auditoria de finalização em andamento; homologação final ainda não declarada.** Catálogo, pedidos, planos, endereços e administração pertencem às trilhas seguintes.

## Execução no Google AI Studio ou local

Requer Node.js 24. Sincronize a branch de trabalho do GitHub antes de executar.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Preencha os valores pelo gerenciador de segredos da plataforma. O Vite serve interface e API na mesma origem, porta 3000. O cadastro público possui fallback controlado para a API de Production quando o proxy do Google AI Studio devolve HTTP 403 sem JSON; login, sessão e rotas administrativas continuam same-origin e não recebem CORS público. Credenciais privilegiadas nunca usam prefixo `VITE_`.

Sem credenciais, o shell visual permanece navegável e endpoints dependentes do banco falham de forma fechada. Isso não equivale a homologação.

## Variáveis de teste real

A integração usa exclusivamente:

```text
flag exclusiva de integração=true
referência protegida de production=<ref-de-production>
```

Não usar `RUN_SUPABASE_INTEGRATION` ou `SUPABASE_TEST_PROJECT_REF`; esses nomes são obsoletos.

## Validação

Development isolado:

```sh
npm run migrations:verify
flag exclusiva de integração=true npm run homologate
npm run test:e2e
```

`npm run homologate` recusa execução se a integração real não estiver explicitamente habilitada ou se o runtime não estiver em `development`.

Gates adicionais:

```sh
npm run typecheck
npm run security:check
npm run build
npm run preflight
npm run verify:foundation
```

O `verify:foundation` executa A1–A15, valida schema lógico 8, hash canônico das migrations e documentação SQL de tabelas, funções e colunas sensíveis.

### Cobertura

A configuração contém os thresholds do Manual v10. A execução de cobertura exige o provedor compatível com Vitest 5.0.1 e o lockfile correspondente. Não considerar cobertura homologada enquanto esse gate não tiver sido executado com o lock regenerado.

## Deploy

`vercel.json` permite implantação automática somente de `main`; previews das demais branches são deliberados/manuais. A promoção de banco continua sequencial: development → homologation → production.

## Documentação

- [Livro Raiz](LIVRO_RAIZ_HORTIVITALMIX.md)
- [Configuração Supabase](docs/SUPABASE_SETUP.md)
- [Deploy e promoção](docs/DEPLOY_RUNBOOK.md)
- [Estratégia de CI](docs/CI_STRATEGY.md)
- [Resultados de verificação](docs/TRILHA01_VALIDACAO.md)
- [Errata e rastreabilidade](docs/TRILHA01_PENDENCIAS_MANUAL_V10.md)

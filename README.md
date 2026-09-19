# HortiVitalMix — Volume 01 / Trilha 01

Fundação React + Vite + Express, Supabase PostgreSQL/Auth/Storage e contratos Zod. Fonte: Manual Mestre Técnico v10 e errata autorizada pelo proprietário.

**Estado: implementação da fundação, com validação local e SQL real; homologação final pendente.** Não existem releases homologadas registradas. Catálogo, pedidos, planos e endereços pertencem às trilhas seguintes e exibem indisponibilidade explícita.

## Execução no Google AI Studio ou local

Requer Node.js 24. Sincronize a branch `main` do GitHub para o Studio antes de executar.

```sh
npm ci
cp .env.example .env
npm run dev
```

Preencha `.env` pelo gerenciador de segredos da plataforma. O Vite serve a interface e monta a API na mesma origem, porta 3000. Não criar API em outra porta. No Studio, adicione a origem exata do preview a `APP_ALLOWED_ORIGINS`. Nenhum segredo deve usar prefixo `VITE_`.

Sem credenciais o shell visual continua utilizável e a API retorna 503 nas operações dependentes. Isso não significa que login/cadastro estejam homologados.

## Validação

```sh
npm run verify
npm run build
npm run preflight
npm run verify:foundation
npx playwright install chromium
npm run test:e2e
```

`npm test` pula integração real quando não habilitada; isso não vale como aprovação. Para o gate completo, configure ambiente development isolado, `RUN_SUPABASE_INTEGRATION=1`, `SUPABASE_TEST_PROJECT_REF` igual ao projeto de teste e execute `npm run homologate`. Nenhum mock substitui Supabase.

## Documentação

- [Livro Raiz](LIVRO_RAIZ_HORTIVITALMIX.md)
- [Configuração Supabase](docs/SUPABASE_SETUP.md)
- [Deploy e promoção](docs/DEPLOY_RUNBOOK.md)
- [Estratégia de CI](docs/CI_STRATEGY.md)
- [Resultados de verificação](docs/TRILHA01_VALIDACAO.md)
- [Errata e rastreabilidade](docs/TRILHA01_PENDENCIAS_MANUAL_V10.md)

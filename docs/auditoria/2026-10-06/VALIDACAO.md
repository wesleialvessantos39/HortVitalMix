# Validação da auditoria — 2026-10-06

Este protocolo registra o que foi executado e os limites de prova. A infraestrutura local contém somente dados sintéticos; Supabase xipbsazvymkqqfmfegwu continua canônico.

## Código e dependências

Node local inicial 24.19.0. Depois da incompatibilidade de runtime, os gates abaixo foram repetidos em **Node 22.23.3**, mantendo engines 22.x:

```sh
npm run lint
npm run test:contract
npm test
npm run build
node scripts/check-api-cold-start.mjs
npm audit --json
npm run test:coverage
```

Lint/build/cold start/testes passaram. Cobertura falha nos thresholds preexistentes. O teste de cold start inclui subprocesso CommonJS puro sem tsx e subprocesso da API; reproduziu ERR_REQUIRE_ESM antes do override e passou depois. Três negativos novos verificam as classes de falha URI/SMIL/textarea/xmp com sanitizador 2.18 e parser CommonJS 10.1.0. O override só alcança o parser do sanitizador, não as dependências de tipos.

## PostgreSQL e navegador existentes

As 19 suítes Postgres usam URLs **127.0.0.1:55432/postgres** e guards já existentes. Cada suíte parte de cópia de um template com migrations do repositório e ACLs versionadas. Bancos com fixtures são renomeados/preservados depois da execução, nunca apagados para limpar um teste. O template usa definições reais de Auth/Storage e 63 migrations; não usa grants globais que mascarem as restrições versionadas. Última repetição direcionada ao parser: producerStorePostgres, 22/22 em Node 22.

Playwright existente executou todos os 316 casos. Resultado conjunto final: 311 aprovações/cinco timeouts; os mesmos cinco passaram isolados em 8,4–13,1 segundos, sem alterar o limite original. A única reexecução PostgreSQL de tempo também manteve o caso/assertion. Fixtures corrigidos seguem os contratos atuais; API/serviços podem ser adaptados nesses testes existentes. Não são apresentados como prova de produção.

## Supabase real local

Serviços em containers locais: **PostgreSQL 17, GoTrue 2.196.0, PostgREST 16.2, Storage 1.72.1 e Mailpit**. Gateway loopback 57421, banco 55433; API Auth/REST/Storage e criptografia dos JWT são reais. A Edge versionada executa em **Deno 2.9.6**, port 8000. Nenhuma branch ou projeto pago foi criado.

Configuração privada é JSON fora do repositório, chmod 600, com dbUrl/password/jwtSecret/anonKey/serviceKey. Os testes recusam host/port fora dos guards locais. Com a infraestrutura inicializada e a Edge executando:

```sh
HVM_AUDIT_REAL_SERVICES_CONFIG=/caminho/privado/config.json \
HVM_AUDIT_REAL_EDGE_URL=http://127.0.0.1:8000 \
npx vitest run tests/integration/auditRealSupabase.test.ts --maxWorkers=1
```

16/16: quatro papéis; autoria/titularidade; usuário A/B; papel/metadados/cookie privilegiados; admin/superadmin; not_after SQL/RPC; outra sessão/reauth vinculada; consentimento válido/alterado/replay; Storage privado/URL assinada/MIME; confirmação/recuperação/senha/logout; Edge cadastro atômico e consumer/producer na mesma pessoa.

26 casos existentes de integração usam o SDK real. Um adapter **somente de transporte de teste** converte o hostname Supabase virtual validado para o gateway loopback e recusa toda rede externa; não substitui respostas do Auth/REST/Storage por mocks. O adapter resolve a exigência do cliente de URL https supabase.co sem encaminhar dados sintéticos para produção.

Quatro casos de outbox foram executados adicionalmente com chave sintética: um passou/três falharam. A mesma execução no checkout original reproduziu as três falhas; serviço atual explicitamente desativado em favor de Auth/SMTP. Não ativar esse serviço antigo para conseguir um resultado verde.

Scripts e dados privados dessa execução ficam em /workspace/scratch. A reprodução de infraestrutura exige bootstrap local correspondente; a lista de comandos acima não afirma que containers são iniciados automaticamente pelo npm test. Não versionar configuração privada, .env, passwords ou tokens.

## Produção

Vercel API confirmou deployment READY, main/SHA e domínio principal. Após promover o código e registrar sua release, foram feitos health/ready/config, 14 negativos HTTP e 40 navegações reais. Nenhuma API do navegador foi mockada; 401 de sessão para visitante é uma resposta esperada e é registrada separadamente de pageerror. Larguras 320/390/768/1024/1440; quatro logins/aliases e catálogo, sem submits autenticados ou mutação de cesta.

No ambiente de auditoria, fetch Node sem proxy retornou ECONNREFUSED. O comando original de verificação passou usando o proxy já configurado:

```sh
NODE_USE_ENV_PROXY=1 npm run verify:deploy -- \
  --url https://hortvitalmix.vercel.app \
  --sha 1fafc77de3358ccfb66af1fe4eb5578857b59c66 --schema 57
```

Esse ajuste é de transporte local de auditoria, não mudança de env/arquitetura da aplicação. Na confirmação documental, usar o SHA efetivamente publicado e release correspondente.

Produção Auth/Storage privados positivos, MFA e IDOR entre contas reais exigem credenciais de homologação específicas: **pendentes**. Serviços reais locais e mocks unitários não substituem essa comprovação. Não criar conta/compra/upload canônico para mascarar essa ausência.

## Evidências e preservação

evidencias.json contém agregados e SHA-256 dos logs recuperados. O registro de fechamento documental identifica GitHub/main, deployment ativo, release/hash e smoke posteriores ao último deploy. Nenhum segredo ou URL de bypass da Vercel é publicado. A alteração de SQL é aditiva; rollback de código preserva RLS, grants restritos e histórico de release. A primeira falha e o rollback são documentados no relatório.

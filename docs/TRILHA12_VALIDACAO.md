# Trilha 12 — Vitrine comercial do produtor

Missão: implementar a vitrine, as configurações operacionais e a habilitação comercial de forma aditiva sobre T01–T11. Fontes: Livro-Raiz atualizado de 04/10/2026; missão T12 do PDF **HortiVitalMix — Plano Mestre de Trilhas T12–T25** fornecido pelo proprietário; `wesleialvessantos39/HortVitalMix@main`; Supabase canônico `xipbsazvymkqqfmfegwu`.

## Base efetivamente conferida

- `main` anterior: `cf869496e77956f1d50a538ac3b45d88a716a59c`.
- Release corrente anterior: `integrity-v46-cf86949`, schema **46**, 51 migrations.
- Hash anterior: `307a3186739b87f8a4ca008971b4b9b3df8220391568c1bd4cb1b3e8cc7eae22`.
- As duas tabelas de loja não existiam. A base usa `app_people` e `app_properties.producer_id`; não usa os nomes históricos `app_persons` ou `app_property_relationships` sugeridos no plano.
- O plano T12 partia de schema 40/41. O número correto desta entrega é **47**, sem renumerar migrations anteriores.

## Implementação

- Migration `20261004120547_trilha12_producer_store.sql`: `app_producer_stores`, `app_store_operating_hours`, índices de unicidade/consulta, RLS ENABLE/FORCE e SELECT para anon/authenticated. Nenhuma permissão de mutação para esses papéis.
- Funções de leitura booleanas no schema não exposto `hvm_store_private`. `property_is_eligible` é exclusiva do backend. A única função disponível para leitura pública, `store_is_visible`, devolve apenas se uma loja ativa pode ser exibida; não devolve identidade, documentos ou motivos de indisponibilidade. Ambas fixam `search_path` vazio.
- Publicação revalida perfil `verified`, confiança >= 2, titularidade do imóvel, decisão vigente pela view `app_property_current_verification`, aprovação regional, conta ativa, cobertura, bloqueios e escopo de entrega já existentes. Reutiliza os contratos SQL canônicos `fn_publish_eligible_properties` e `fn_producer_delivers_to`.
- A elegibilidade é conferida também nas leituras públicas e no RLS: uma loja já ativa deixa de ser visível quando perde aprovação, cobertura ou autorização. Não depende somente do status gravado na loja.
- Serviços transacionais com trava de perfil/loja, revisão otimista, `commandId` idempotente, verificação de payload repetido e auditoria append-only na mesma transação. A apresentação passa por `sanitize-html`, é validada novamente após sanitização e é renderizada como texto.
- Configurações e os sete dias podem ser salvos juntos, em uma revisão/transação. Há também operação específica de horários. UUIDs de proprietário nunca são aceitos do cliente.
- `/produtor/loja` inclui rascunho, configurações, rotina semanal, erros/conflitos, confirmação recente de senha, publicação e pausa de emergência. A pausa usa sessão/titularidade/origem e não exige nova senha; a reabertura refaz a trava comercial.
- `/produtores/:slug` funciona sem login, com selo de confiança, localização descritiva, apresentação, horário, pedido mínimo e dias operacionais. Rascunho/pausada/fechada/inelegível têm o mesmo 404 de uma loja inexistente. Falha de dependência tem tratamento próprio.
- Entrada “Minha loja” na conta do produtor, acessível pela navegação global. As páginas novas são carregadas sob demanda; CSS fica restrito à vitrine.

## Compatibilidade obrigatória com a governança v46

O DDL exemplificativo do plano usava `property_id NOT NULL / ON DELETE RESTRICT` e `producer_profile_id ON DELETE RESTRICT`. Aplicá-lo literalmente impediria a exclusão de imóvel/conta já homologada no Livro-Raiz. Por isso:

1. `property_id` pode ser nulo no rascunho ou após exclusão. Loja ativa exige vínculo e apresentação válida por CHECK. Trigger adicional pausa/desvincula a loja antes da exclusão e pausa quando o imóvel deixa de estar aprovado, preservando a auditoria.
2. Exclusão do perfil usa CASCADE somente nas novas tabelas, preservando o hard delete operacional da conta e os históricos anteriores.
3. Rascunho inicial pode ter apresentação vazia; publicação e salvamento validam pelo menos 10 caracteres limpos. Nenhuma descrição fictícia é publicada automaticamente.

Nenhuma migration histórica, função de autenticação, decisão da T11 ou lógica de exclusão existente foi substituída. Integrações existentes receberam apenas registro de rota/entrada de navegação e atualização do manifesto/readiness.

## Validação reproduzível

```sh
npm ci --no-audit --no-fund
npm run typecheck
npm test
npm run build
npm run test:t12:store:e2e
```

Os testes do serviço usam PostgreSQL 17 local descartável, com **todas as 52 migrations do repositório** e adaptadores locais mínimos para os schemas Auth/Storage. Eles não se apresentam como prova de GoTrue/SMTP/Storage remotos:

```sh
docker run -d --name hvm-t12-postgres -e POSTGRES_PASSWORD=hvm_t12_local_only -p 127.0.0.1:55432:5432 postgres:17-alpine
export HVM_T12_LOCAL_DATABASE_URL=postgres://postgres:hvm_t12_local_only@127.0.0.1:55432/postgres
node scripts/setup-store-local-postgres.mjs
npm run test:t12:store:postgres
```

O bootstrap recusa banco não vazio; bootstrap e suíte recusam host/porta diferentes de `127.0.0.1:55432`. Não criam branch/projeto Supabase nem recebem credenciais remotas. Sem a variável local, a suíte PostgreSQL é explicitamente ignorada.

Casos exercitados: publicação negativa/positiva, XSS, slug duplicado, revisão concorrente, replay concorrente e payload divergente, criação idempotente, horários atômicos, titularidade, RLS público/owner, privilégios de mutação, cobertura, conta, confiança, bloqueios regionais/imóvel, decisão revogada, escopo de entrega, exclusão de imóvel com arquivo v46, retirada de aprovação e exclusão Auth com limpeza de perfil/loja/horários.

O Playwright da T12 verifica 320/390/768/1440px sem overflow, formulário, matriz de sete dias, vitrine anônima, 403, conflito preservando edição, retomada do mesmo comando após senha, pausa imediata, 404, navegação pela conta e criação de rascunho. As respostas autenticadas são controladas no navegador; os testes de serviço/banco são separados.

## Regressões da base

Antes da implementação, 275 testes unitários passaram. A suíte geral encontrou falhas já presentes no SHA original: mocks sem `requireAdminSector`, consulta de confirmação sem `app_users.single()` e expectativas antigas que proibiam exclusão de imóveis permitida pela v46. Foram ajustados **somente os testes** às regras atuais; os serviços anteriores não foram alterados. Um literal de status no teste E2E da T08 recebeu `as const` para o TypeScript integral.

A suíte Playwright completa da entrega executou **178 casos: 135 passaram e 43 falharam**. A mesma suíte histórica no worktree isolado do SHA original executou **162 casos: 118 passaram e 44 falharam**. Todas as 43 falhas da entrega ocorreram também na base; nenhum novo teste falhou. O caso adicional da base é a geolocalização da T07, que passou na entrega. Ambos usaram Chromium portátil, dois workers e servidor local, sem credenciais pessoais. [Comparação dos casos](TRILHA12_REGRESSAO.json).

A suíte ampla permanece vermelha e não permite afirmar homologação integral de T01–T11. Os fluxos aprovados anteriormente não foram reescritos para corrigir seletores, mocks ou expectativas antigos do navegador fora desta missão.

## Infraestrutura e limite de escopo

Mantidos Supabase Free único, Vercel Hobby, runtime Express/Node Serverless em `pdx1` e publicação somente da `main`. Sem serviço pago ou GitHub Actions novo. Não foram implementados T13+, taxonomia, cadastro de produtos, carrinho, frete, pedidos ou pagamentos. Logo/banner permanecem opcionais; o envio de mídia não fazia parte da missão T12.

## Resultado e publicação

- TypeScript integral e build completo passaram, incluindo manifesto/hash, verificação de segredos e bundle.
- Suíte Vitest geral: **420 passaram / 52 ignorados**; os ignorados dependem de integração remota ou variável de banco local. Contratos/rotas T12: **26 passaram**, incluídos nessa suíte.
- Serviço contra PostgreSQL 17 local e 52 migrations: **22 passaram**. Playwright T12: **16 passaram**, incluindo revisão visual nas quatro larguras e nova execução após os ajustes de contraste/cabeçalho mobile.
- Migration aplicada no Supabase canônico: versão física **20261004124506**, equivalente à canônica **20261004120547**. Manifesto: schema **47**, hash **d846bc9157099e0725186ca88c06feb5f1c9f452651cd829fb98bbb130ede885**.
- Conferência após DDL: RLS ENABLE/FORCE nas duas tabelas, somente SELECT para anon/authenticated, zero tabela pública sem RLS e zero novo achado de segurança. Tabelas novas vazias; registros anteriores preservados (4 Auth/users, 3 pessoas, 2 perfis, 1 imóvel, 2 solicitações, 2 decisões, 7 documentos, 7 municípios).
- Suíte completa de navegador comparada ao SHA original: **zero falha nova**, com as limitações descritas acima. Publicação Vercel/release ainda não fechada neste registro.

Não se confunde build local, testes controlados ou banco local com homologação autenticada remota. Não foram usados dados reais do titular como fixtures nem enviados e-mails de teste a terceiros.

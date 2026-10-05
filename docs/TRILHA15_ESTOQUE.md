# Trilha 15 — estoque transacional, lotes e baixa atômica

Implementação aditiva sobre a T14 homologada (`4c2735d145e33aae4ed53f29b6e258604460b568`, schema 49), conforme o plano T12–T25, Volume 3. Projeto Supabase único `xipbsazvymkqqfmfegwu`, Vercel Hobby/main/pdx1 e nenhum serviço, dependência ou cron pago novo. Schema lógico **50**, **56 migrations**, hash **346882f5b85fdd09de8fa72d620139f28009323dcd1f0036cf0ef5c4058aa495**.

## Entrega

- `app_inventory_lots`, `app_inventory_movements` e `app_inventory_reservations`; estoque associado exclusivamente aos produtos da T14. Preços e revisões de produto permanecem intactos.
- `registerHarvest`: lote, entrada de colheita e auditoria na mesma transação. Código único por produto, datas válidas, colheita até a data corrente do banco e quantidade inteira positiva. `commandId`/fingerprint/lock impedem duplicação, inclusive em replays concorrentes e após resposta perdida.
- `reserveStock`: somente produto publicado, categoria ativa e loja elegível T12. `FOR UPDATE SKIP LOCKED`, ordem por validade e desempate estável; divide a quantidade entre lotes válidos. Insuficiência retorna `insufficient_stock` com rollback, sem reserva parcial ou estoque negativo. Lotes ocupados são ignorados sem esperar; outro produto continua operando.
- TTL **15 minutos**, centralizado em `shared/contracts/inventory.ts`. A reserva desconta `current_quantity` imediatamente. Quantidades são expressas na unidade inteira do produto.
- `releaseExpiredReservations`: trava o lote antes das reservas; libera reservas vencidas não consumidas/não liberadas e restaura a quantidade uma vez. Lazy sweep em cada consulta do catálogo público, no painel próprio e antes de reservar, sem cron.
- `consumeReservation`: trava lote/reserva, rejeita expiração/liberação/validade vencida, marca consumo e insere uma única venda. **Não desconta estoque novamente**. Replay do mesmo pedido retorna sucesso; outro pedido retorna 409. `consumed_order_id` guarda UUID opaco para vinculação futura, sem criar tabela/checkout de pedidos nesta trilha.
- Triggers diferidos nas três tabelas conferem saldo = movimentos − reservas ainda não liberadas/consumidas, entrada inicial e correspondência da venda à reserva. Histórico imutável; saldo sem lançamento correspondente é rejeitado ao commit.
- Métodos internos aceitam opcionalmente o `PoolClient` da transação do futuro checkout. **O chamador controla BEGIN/COMMIT/ROLLBACK**, deve abortar em insuficiência/erro e consumir todas as partes da reserva na mesma transação do pedido. Não usar consumo individual com commits separados para converter um pedido com vários lotes. Nenhum endpoint público de reservar/consumir existe em T15.

## Segurança e compatibilidade

RLS **ENABLE + FORCE** nas três tabelas. `anon` e `authenticated` não possuem SELECT nem escrita, mesmo para o produtor titular: leitura operacional passa pelo backend, que valida pessoa/usuário/papel/conta e titularidade. Escrita HTTP exige proteção de origem e a prova de autenticação recente já homologada; confirmação local conserva formulário e o mesmo comando. Nova colheita exige elegibilidade T12; loja pausada ainda pode consultar seu histórico.

O backend recebe SELECT/INSERT/UPDATE somente em lotes/reservas e SELECT/INSERT em movimentos, sem DELETE/TRUNCATE. A conferência remota detectou os grants automáticos de criação do Supabase, corrigidos em uma migration complementar; a migration já aplicada permaneceu imutável. Funções novas são SECURITY INVOKER, com search_path vazio e execução privada; nenhuma função, policy ou trigger anterior foi substituída.

**Adequação ao Livro-Raiz/v46:** FKs novas de lotes/reservas/movimentos usam cascata na exclusão operacional de produto/conta. O RESTRICT do exemplo impediria a exclusão já homologada. Autor de movimento é anulável com ON DELETE SET NULL para apagar identidade de outro ator excluído e conservar o histórico da loja sobrevivente. O trigger de imutabilidade permite somente a cascata quando o lote já não existe e essa anonimização quando o usuário já foi removido. Os dois caminhos foram testados com PostgreSQL real; fluxo anterior de exclusão permanece intacto.

Migration canônica `20261004235555_trilha15_inventory.sql`, física **20261005002132**. Complementar `20261005002322_trilha15_privileged_inventory_grants.sql`, física **20261005002434**. Ambas criadas pelo Supabase CLI; aliases físicos/canônicos e manifesto sincronizados. Nenhuma migration antiga foi editada.

O catálogo público da T14 acrescenta somente `inStock`, exibido como “Em estoque”/“Esgotado”. Lotes vencidos e quantidades reservadas são excluídos do disponível. Códigos, quantidades, movimentos, identidades e sessões de carrinho não entram na resposta pública. Campos de preço/fotos/conservação e filtros existentes continuam funcionando.

## Painel e API

`/produtor/produtos/:id/lotes`, acessível em **Meus produtos → Lotes e colheitas**. Lançamento, resumo disponível/reservado, histórico paginado, lotes paginados e avisos de validade próxima (0–2 dias) ou vencida. Formulário preservado em erro/duplicação/sessão antiga, sem trocar o login histórico. O saldo de lote vencido permanece no histórico e não integra o disponível para venda. Datas de domínio usam CURRENT_DATE do banco conforme o manual; horários do histórico são exibidos no fuso de Rondônia.

API nos prefixos `/v1`, `/api/v1`, `/_hvm_api/v1`:

| Método | Rota relativa | Operação |
| --- | --- | --- |
| GET | /producer/products/:id/lots | Painel próprio, lotsPage/movementsPage |
| POST | /producer/products/:id/lots | Lançamento atômico da colheita |
| GET | /products | Catálogo T14 com disponibilidade e lazy sweep |

Queries novas usam URL normalizada e consomem os metadados reservados `path`/`__hvm_path` da Vercel. Parâmetros desconhecidos/duplicados são rejeitados. Dispatcher, autenticação, configuração Vercel/CSP, dependências e lockfile anteriores permanecem intactos.

## Evidências

- **42** contratos/HTTP/montagem; **26** testes T15 em PostgreSQL real: última unidade concorrente, ausência de espera, FIFO multilote, TTL, rollback, expiração concorrente, baixa idempotente e UUID canônico, isolamento, RLS/grants, saldo, cascata/anonimização e paginação.
- Regressão PostgreSQL **22 T12 + 20 T13 + 18 T14**, sem mudar suas suítes. O primeiro ensaio da T13 encontrou categorias de fixtures anteriores no banco reutilizado; a repetição em banco local novo passou integralmente. As 55 migrations iniciais foram aplicadas desde zero, e a complementar também foi aplicada e conferida localmente.
- **72** verificações de navegador: **16 T12 + 25 T13 + 16 T14 + 15 T15**. Colheita/reautenticação em 320/390/768/1440 px, estados vazio/carregamento/erro/sucesso/conflito, acesso de visitante/consumidor, paginação e validade.
- História completa **React compilado → HTTP/guardas → PostgreSQL → catálogo** passou: navegação por Meus produtos, entrada de duas unidades, reserva, expiração via lazy sweep, novo consumo, repetição sem segunda baixa, histórico e preço anterior idêntico. Zero erro JavaScript; apenas Auth/Storage externos adaptados localmente.
- Suíte geral **571 passaram, 119 explicitamente ignorados, 690 total**; testes de banco/história que requerem URL local foram executados separadamente. Typecheck integral, build, segredos/bundle e cold start sem require(ESM) aprovados.
- Supabase: **52 relações anteriores** conservaram contagens/hashes após migração, novas tabelas vazias, zero tabela pública sem RLS. Sem WARN/ERROR novo no advisor de segurança e sem nova FK sem índice. Três INFO de RLS sem policies refletem o bloqueio deliberado de leitura direta exigido pelo manual; seis INFO de índices sem uso refletem tabelas vazias. [Explicação do linter](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Não foram criados dados sintéticos nem usuários de teste em produção. Evidências estruturadas em `TRILHA15_REGRESSAO.json`. A regressão dedicada acima comprova os caminhos afetados; as falhas históricas da suíte ampla permanecem registradas no fechamento da T14, sem declaração de homologação integral de todas as jornadas antigas.

Geometria/frete T16 e carrinho/checkout/pagamento seguem nas trilhas futuras. Publicação funcional conferida no fechamento abaixo; a release corrente acompanha a SHA final da main após deployment READY.


## Fechamento em produção

[PR #75](https://github.com/wesleialvessantos39/HortVitalMix/pull/75) integrado. SHA funcional **1c643205d7ff99d0063ddc97ba200a1ada46a22a**, deployment **dpl_HL3o9JgQfAWe55u3fPsMwRzEGM64**, READY, produção, main, pdx1. Release funcional **t15-v50-1c64320**, schema 50, 56 migrations e hash canônico acima. Health/readiness/configuração e SHA exata aprovadas por verify:deploy.

Consulta pública e busca: 200; queries desconhecidas/duplicadas: 400; catálogo privado e lotes sem sessão: 401; categorias oficiais T13: 200/cinco categorias. Request IDs presentes. Navegador publicado em 390/1440 px aprovou catálogo, filtro Frutas, ausência de overflow, bloqueio de editor/lotes para visitante e vitrine inexistente, com zero erro JavaScript. Nenhum log error/fatal apareceu no deployment funcional.

As **51 relações anteriores de negócio/identidade** mantiveram contagens e hashes após publicação; somente app_releases recebeu atualização autorizada. Tabelas novas continuam sem fixtures. Os fluxos autenticados de colheita/reserva/baixa foram verificados com React/HTTP/guardas/PostgreSQL locais reais; a transação externa também passou sob service_role com avaliação imediata dos triggers diferidos e rollback. A conferência publicada usou acesso anônimo, sem criar identidade ou colheita fictícia em produção.

O fechamento documental altera somente este relatório, a evidência JSON e a entrada do Livro-Raiz. Código funcional/schema/hash permanecem iguais; a release final é sincronizada com a SHA final da main somente após seu novo deployment READY e conferência de health/readiness/configuração.

# Trilha 21 — pedidos e rastreabilidade

Implementação aditiva sobre `main@fd02e63a27f11d7315130bc3f178b614fc29acf9`, schema 58. A fonte da numeração é o PDF **HortiVitalMix — Plano T12–T25**, Trilha 21, Volume 4: máquina de estados de pedidos e rastreabilidade. O Livro-Raiz e o código da main prevalecem sobre exemplos de DDL que pressupõem tabelas ainda inexistentes.

Supabase único: **HortVitalMix / xipbsazvymkqqfmfegwu**. Repositório: **wesleialvessantos39/HortVitalMix**. Vercel existente, plano gratuito, publicação somente pela main e região **pdx1**. Configuração de infraestrutura, dependências e lockfile anteriores preservados. Nenhum serviço pago, credencial ou gateway foi criado.

## Adaptação à T20 existente

A T20 já criou `app_orders`, pedidos separados por loja, retenções, confirmação de recebimento, caixa, reembolsos e denúncias. Seu estado comercial `confirmed / received / refunded` não foi substituído pela esteira de preparo. A T21 acrescenta `app_order_fulfillment`, com uma linha por pedido online, revisão própria e os seis estados exigidos. Assim, os contratos e a proteção financeira da T20 continuam funcionando.

A criação permanece na transação T20 de confirmação verificada do pagamento. O serviço `OrderService.createFromApprovedIntent` integra essa transação; um trigger captura os fatos do pedido, e uma restrição diferida exige que a intenção correspondente termine aprovada. Isso respeita a ordem atual da T20, que insere os pedidos antes de marcar a intenção aprovada. Não existe endpoint para o usuário declarar pagamento ou fabricar pedidos confirmados.

A T20 permanece **preparada, com gateway real inativo**. Os testes de pagamento usam confirmação sintética exclusivamente em PostgreSQL descartável. Esta entrega não declara cobrança, estorno bancário ou pedidos de contas reais homologados em produção.

## Estados, histórico e estoque

| Estado atual | Próximos estados permitidos |
| --- | --- |
| `confirmed` | `in_preparation`, `cancelled` |
| `in_preparation` | `ready_for_dispatch`, `cancelled` |
| `ready_for_dispatch` | `out_for_delivery` |
| `out_for_delivery` | `delivered` |
| `delivered` / `cancelled` | Nenhum |

O backend bloqueia o pedido e a esteira com `FOR UPDATE`, reconfere titularidade e papel ativo, e exige `expectedRevision`. Uma revisão desatualizada retorna **409**; uma transição ilegal retorna **422**. Os mesmos limites são impostos no banco, inclusive para acesso privilegiado. Administradores não têm atalho para pular etapas.

Cada comando usa `X-Command-Id` e o recibo idempotente existente. Uma resposta perdida pode ser recuperada após recarregar a página com o mesmo comando. Cada revisão registra um evento imutável com autor, papel, estados e data. O evento inicial tem origem `NULL`, conforme a semântica `null → confirmed` do manual; os eventos seguintes formam uma cadeia verificada ao final da transação.

Os itens são copiados da cotação T19, com nome, peso, unidade, corte, quantidade e preços congelados. Embalagem é registrada na criação. Soma dos itens deve coincidir com o subtotal; alterações de preço posteriores não modificam o pedido. Endereço, loja e fatos financeiros continuam nos snapshots imutáveis da T20. Remoção de produto/conta mantém os fatos históricos, permitindo somente a desvinculação da referência apagada prevista nos módulos anteriores.

Cancelar exige justificativa de **10 a 500 caracteres**, somente nas duas primeiras etapas. Reservas consumidas recebem crédito no lote de origem através dos movimentos T15 existentes; a baixa original continua registrada. `app_order_stock_returns` garante uma devolução por reserva. Estado, histórico, estoque, auditoria e solicitação de reembolso são confirmados ou revertidos juntos.

O cancelamento abre/reutiliza a solicitação de reembolso da T20 e mantém os valores bloqueados em disputa. Não marca estorno bancário como concluído. Uma solicitação parcial em análise impede o cancelamento até sua resolução, preservando a decisão financeira anterior. Pedidos já recebidos ou reembolsados não podem ser cancelados; confirmar recebimento de um pedido cancelado retorna 409.

## Banco e permissões

Migration canônica: `20261007012246_trilha21_orders_state_machine.sql`. Schema lógico **59**, **65 migrations**, hash **1db093de8e3fda956dc955b9001b73b20cd1e5f402e77b27f25550f88cf02b9d**.

Quatro tabelas novas: `app_order_fulfillment`, `app_order_items`, `app_order_events` e `app_order_stock_returns`. Todas com **RLS ENABLE/FORCE**. As três primeiras oferecem somente SELECT a authenticated, com policies separadas de comprador e produtor; o registro de devoluções não é exposto aos clientes. Mutações passam pelo backend service_role. Helpers privados são invoker, sem search_path implícito e sem EXECUTE de anon/authenticated.

As 64 migrations anteriores permanecem byte a byte iguais. A migration não reescreve pedidos, reservas, documentos, usuários ou lançamentos anteriores. Caso existam pedidos online antigos, preenche apenas os novos registros vinculados. A conferência remota anterior encontrou zero pedidos aprovados.

## Telas e APIs

| Área | Caminho | Resultado |
| --- | --- | --- |
| Produtor | `/produtor/pedidos` | Colunas por etapa, filtros, paginação, avanço permitido e cancelamento justificado. |
| Cliente | `/pedidos` | Lista de pedidos online e acesso ao acompanhamento. |
| Acompanhamento | `/pedidos/:id` | Timeline de cinco etapas, histórico, produtos, endereço e totais congelados. |
| Compras e proteção T20 | `/compras` | Fluxos anteriores de pagamentos, comprovantes, recebimento e reembolsos, com acesso ao acompanhamento. |
| Pagamento T20 | `/pagamentos/:id`, `/pedidos/:id/pagamento` | Rotas de pagamento preparadas preservadas. |

GET `/v1/orders`, `/v1/orders/:id`, `/v1/producer/orders`; POST `/v1/producer/orders/:id/transitions`. Prefixos `/api` e `/_hvm_api` continuam compatíveis. Sessão, proteção de origem, contratos Zod estritos e `Cache-Control: private, no-store`. Autor e papel nunca vêm do corpo enviado pelo cliente.

As telas atualizam sequencialmente a cada 15 segundos enquanto visíveis; foco/retorno à aba também atualizam. Consultas têm timeout, não se sobrepõem e são abortadas ao sair/trocar conta. Erros de acesso removem os dados privados. O detalhe para de consultar após estado terminal.

Fora do escopo: capacidade/janelas, foto ou assinatura como prova formal de entrega e GPS da T22; avaliações da T24; envio automático de mensagens. A transição `delivered` registra a etapa, sem antecipar esses módulos.

## Verificação

TypeScript global e de produção, build completo, manifesto/hash, segredos e cold start Node 22/24 aprovados. Os comandos próprios são `test:t21:unit`, `test:t21:postgres`, `test:t21:story` e `test:t21:e2e`.

Os testes SQL exigem endereço exclusivamente local na porta 55432 e não usam produção. Cobrem criação paga e multilojas, 422, concorrência 409, repetição de comando, snapshots, RLS de participantes/terceiros, autoria, cadeia completa, cancelamento atômico e devolução única, falha intermediária com rollback, conflito financeiro e preservação de recebimento/exclusão de conta da T20. A história executa React compilado → API/sessão/permissões → PostgreSQL → comprador; apenas Auth/Storage e confirmação financeira são adaptados no ambiente local.

Os testes de interface cobrem 320, 390, 768 e 1440 px, cancelamento, atualização automática/aba oculta, perda de resposta, conflito, visitante e pedido de terceiro. As suítes antigas de banco que deixam fixtures são executadas com replay completo em uma instância limpa por suíte; falhas por contaminação da execução conjunta não são contabilizadas como aprovação.

Validação final: **776 testes gerais aprovados / 303 condicionais não executados**; **196 testes PostgreSQL das trilhas anteriores + 19 T21 + uma história completa T21**, cada suíte em instância limpa. **21 cenários de interface T21 e 61 anteriores** passaram contra o build compilado. O teste anterior de otimização de fotos importa diretamente `/src/lib/optimizeImage.ts`, portanto foi conferido separadamente no servidor de desenvolvimento; essa diferença de ambiente não foi corrigida alterando o teste anterior. As primeiras rodadas pelo servidor de desenvolvimento apresentaram carregamentos intermitentes de módulos durante reinício/compilação; o build compilado resolveu essas falhas, sem alterar funcionalidades anteriores.

Migration física **20261007015514**, reconciliada somente por alias com a versão canônica. Comparação imediatamente antes/depois: **80/80 relações anteriores com contagens e digests idênticos**. Após a extensão, **80 tabelas app com RLS ENABLE/FORCE**, zero grants DML de clientes e zero EXECUTE de clientes nos helpers T21. Nenhum pedido/conta/arquivo de teste foi criado em produção.

Advisors: nenhum WARN/ERROR novo de segurança. Mantidos os cinco WARN anteriores. Há **três WARN novos de desempenho** por policies permissivas separadas nas três tabelas de leitura, exigência expressa da T21; auth.uid é avaliado por initplan e os vínculos são indexados. A futura otimização poderá combinar policies somente se a norma permitir. [Referência do advisor](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies). O [INFO de RLS sem policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) em devoluções é intencional: clientes não recebem acesso à tabela. Seis índices novos ainda sem uso são esperados em tabelas sem pedidos; não foram removidos para esconder o [INFO](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

Evidência: [TRILHA21_PRESERVACAO.json](TRILHA21_PRESERVACAO.json). O fechamento de produção e o selo da SHA exata são registrados somente depois de deployment READY na main.

# Trilha 25 — Modo rural offline e BI executivo

Implementação aditiva do encerramento do Plano T12–T25, Volume 5, sobre `main/eecf37000212d6811d8af86abe8e7e67077d536c`, schema 63/69 migrations. A versão desta trilha é **64/70 migrations**. As 69 migrations anteriores permanecem byte a byte iguais. Supabase único `xipbsazvymkqqfmfegwu`, Vercel gratuito, `main`/`pdx1`, dependências, imagens e módulos homologados preservados.

## Operação no campo

O produtor deve abrir **Meus produtos**, os **Lotes e colheitas** desejados e **Pedidos da minha loja** enquanto conectado. O banner informa quando as telas estão preparadas; um service worker nativo guarda somente HTML/JS/CSS estáticos, nunca APIs, sessões, pagamentos ou URLs dinâmicas de fotos. Leituras de catálogo, lotes e resumo dos pedidos da conta ficam no IndexedDB por até 24 horas. Telas não consultadas exigem conexão. Atualização do aplicativo mantém um build estático anterior para abas abertas.

Os avisos offline e do trial T23 ficam em faixas abaixo do cabeçalho, fora da área flexível do conteúdo. A regressão com trial real encontrou a faixa antiga comprimindo a grade de janelas T22 em 768px; o ajuste mantém mensagem/prazos/CTA e devolve a largura ao formulário e à grade. Nenhuma regra de assinatura foi alterada.

Sem conexão, o produtor pode registrar colheita, avançar/cancelar pedido com as regras T21 e registrar a prova T22. A interface informa **“salva neste aparelho; aguardando confirmação”**. Não há baixa, entrada de estoque, pagamento ou entrega fictícia enquanto a ação está somente no aparelho. Ações pendentes do mesmo pedido bloqueiam outro avanço até reconciliação/revisão; colheitas independentes podem ser enfileiradas. O banner é persistente abaixo do header existente e acompanha o estado da conexão.

Fila `pending_commands`: ID aleatório imutável, tipo permitido, revisão base, dados da ação, ordem sequencial, conta e resultado eventual. O identificador do aparelho também é aleatório; não coleta características do dispositivo. Máximo de 500 ações locais, lotes HTTP de até 50 comandos e menos de 24 KB em UTF-8. A fila só é retirada depois de resposta validada e transação IndexedDB concluída. Falha/perda de resposta mantém IDs para reenvio. Sessões/senhas/tokens Auth não entram no IndexedDB. Troca de conta não mostra nem envia a fila de outra conta. Saída/invalidação da sessão limpa snapshots privados, preservando a fila vinculada à conta para retorno legítimo.

A sincronização ocorre ao reconectar com a tela visível ou pelo botão **Sincronizar**, com uma operação em andamento por conta. Cada requisição valida Auth/sessão/papel reais; o servidor revalida conta e propriedade por item. Colheitas mantêm a confirmação recente T15; o banner permite confirmar a senha online, sem armazená-la. Finanças, denúncias, reembolsos, documentos e criação de produtos não passam por uma fila genérica.

## Reconciliação transacional

`POST /api/v1/producer/sync`, compatível com os prefixos internos existentes. Contratos estritos `ReconcileBatchSchema`/`SyncCommandSchema`, tipos permitidos `inventory.harvest`, `order.transition`, `delivery.proof`. Identidade deriva da sessão; body não escolhe conta/setor. Origem protegida, respostas privadas/no-store.

`OfflineSyncService.reconcileBatch`: uma transação por item, na ordem recebida. Lock por commandId, SHA-256 de JSON canônico, comparação de ator/dispositivo/payload, reuso de resultado imutável. Reutiliza `InventoryService.registerHarvest`, `OrderService.transitionStatus` e `DeliveryLogisticsService.registerDeliveryProof`, incluindo recibos online existentes para recuperar resultado de resposta perdida. Os serviços T15/T22 ganharam apenas a possibilidade de participar da transação do chamador; as rotas anteriores permanecem.

Nova colheita usa a revisão do **produto T14** como referência: o lote ainda não existe, e colheitas independentes não mudam a edição do produto. Pedidos usam a revisão existente de **app_order_fulfillment T21**, sem inventar revisão financeira em `app_orders`. Falha/estado divergente gera `conflict` com revisão/estado autorizado; alvo removido/estrangeiro ou ação inválida gera `rejected`, sem dados de terceiros. Conflitos não são reaplicados automaticamente: o produtor confere o estado atual e registra nova ação com novo ID. Erro temporário de dependência aborta a requisição, preservando recibos anteriores e a fila do aparelho.

Savepoint reverte a tentativa de domínio; constraints diferidas de estoque/pedidos são verificadas antes de registrar confirmação. Domínio, histórico e notificações existentes confirmam juntos; ação revertida não deixa aviso. `app_sync_command_journal` guarda resultado/hash, sem payload bruto. Imutável; cascade de exclusão operacional T06 preservada.

## BI executivo

Entrada **/admin/bi**, menu/atalho do **Super administrador**. Admin setorial, produtor, consumidor e visitante não recebem o BI. Middleware e SQL revalidam conta, principal e papel atuais; cálculo exige autenticação administrativa recente, com o formulário existente de confirmação. Não foi criado setor nem concedido acesso automaticamente.

`GET /api/v1/admin/bi?startDate=…&endDate=…` lê apenas definições/`app_kpi_metrics` e calendário de configuração. Período máximo: 31 dias. **Calcular período** solicita cada data em sequência a `POST /api/v1/admin/bi/calculate`; cálculo individual `KpiAggregationService.calculateDailyKpis` executa uma leitura SQL coerente e upsert único por código/data sob lock diário. Sem cron, Action, worker pago ou recálculo financeiro a cada renderização.

Indicadores:

- **GMV**: valores brutos de pedidos online entregues, pela primeira ocorrência `delivered` de `app_order_events`, no fuso configurado; inclui o total original com frete. Estornos posteriores não reduzem um indicador bruto. POS não participa dessa esteira de entrega e continua em Minhas vendas/caixa.
- **Ticket médio**: GMV/número de pedidos entregues. O cartão de período usa GMV total/contagem total, não média simples de médias diárias.
- **Produtores ativos**: lojas distintas com entrega por dia. A série é diária; não se soma como produtores únicos do período. Exclusão T06 conserva o tratamento existente dos identificadores de loja.
- **Conversão**: cotações T19 criadas no dia com intent T20 aprovado ou depois reembolsado, divididas pelas cotações desse dia. Cotação multilojas conta uma vez; pagamentos posteriores podem atualizar a coorte no próximo cálculo manual.
- **Receita bruta de assinaturas**: intents T23 vinculados a ciclo, pela primeira confirmação `approved` no registro transacional. Separada do GMV de alimentos.

Três definições obrigatórias e cinco auxiliares de contagem/conversão/assinatura, sem nova fonte financeira. Gráficos, tabela acessível, fórmulas, fuso e data do último cálculo. **Não calculado** distingue ausência de agregação de zero verdadeiro. Hoje é parcial. Gateway real permanece preparado/inativo conforme a decisão anterior; planos/nomes/preços continuam para configuração posterior no painel.

## Segurança e preservação

Migration CLI `20261007174202_trilha25_offline_sync_bi.sql`: três tabelas novas ENABLE/FORCE RLS, nenhum SELECT/DML de anon/authenticated. Grants backend mínimos: journal SELECT/INSERT, definições SELECT, métricas SELECT/INSERT/UPDATE. Helper privado SECURITY INVOKER/search_path vazio, revogado para clientes. Índices para autor, código/data e datas dos fatos agregados. Nenhum ALTER de entidades de negócio, reset, backfill de vendas/pagamentos ou alteração de mídia.

O mapa e a central de notificações das correções anteriores permanecem únicos: ações confirmadas offline passam pelos mesmos emissores transacionais de estoque/pedidos. Um conflito não cria status, venda ou notificação falsa. Regras de produtor versus consumidor, Minhas vendas, caixa, atendimento de reembolso e badge por opção continuam preservadas.

## Validação e fechamento

Scripts: `npm run test:t25:unit`, `test:t25:postgres`, `test:t25:story`. Suítes PostgreSQL/navegador exigem `HVM_T25_LOCAL_DATABASE_URL` em `127.0.0.1:55432/postgres` descartável e rejeitam alvo remoto. História usa Auth/Data API adaptados sobre sessões/permissões/dados reais locais, Express/serviços reais, Chromium/IndexedDB/service worker reais. Não se declara autenticação em contas de produção sem credenciais específicas.

Homologação: **868 gerais aprovados / 398 condicionais não executados na rodada geral**; **337 casos PostgreSQL** executados separadamente (18 T25 + 319 anteriores), **377 interfaces distintas** aprovadas entre a primeira rodada e rechecagens dirigidas, **sete histórias completas de navegador/banco** (T25 e seis anteriores). Modo avião, recarga, cancelamento em outra sessão, lote restante confirmado, replay, isolamento entre contas, autorização de BI e upsert determinístico passaram. UI em **320/390/768/1440**, banner visível durante rolagem, sem pageerror/overflow. TypeScript, build canônico, manifesto, segredos, cold start/bundle e audit de produção aprovados; zero vulnerabilidades de produção.

Três testes antigos de interface receberam ajustes sem mudar o fluxo de acesso publicado: destino de login já existente, link Conta no contexto da navegação mobile e recuperação da resposta perdida pelo IndexedDB T25. Esta última conserva o commandId/payload/revisão e verifica uma única transição. As demais falhas de tempo da rodada ampla passaram nas rechecagens sem aumentar timeout ou retirar assertions.

Aplicação física **20261007183835**, alias para a migration local; **96/96 relações anteriores** com contagem/digest idênticos após aplicação. **95/95 app_* ENABLE/FORCE**, grants anteriores de tabela/coluna iguais, nenhum DML de clientes/EXECUTE do helper T25. Cinco usuários Auth, 29 sessões e dez objetos Storage preservados. Journal/métricas vazios, oito definições iniciais. Advisors conservam os 5 WARN de segurança e 25 WARN de performance anteriores; somente INFO esperado de tabelas backend-only/índices sem uso foi acrescentado. Evidência: [TRILHA25_PRESERVACAO.json](TRILHA25_PRESERVACAO.json).

SHA/deployment/release e validação no domínio oficial serão registrados após a publicação main/READY/pdx1. Não foram criados pedidos, contas, pagamentos ou fatos BI de teste na produção. Esta trilha encerra o manual: continuidade somente em correções, ajustes e modificações solicitados, sem uma Trilha 26.

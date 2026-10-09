# Financeiro e Catálogo — 9 de outubro de 2026

## Funções e acesso

O inventário encontrou dois poderes canônicos sem tela administrativa própria: `finance_ops` e `catalog_moderation`. Foram criadas as rotas `/admin/financeiro` e `/admin/catalogo` para Administrador e Super administrador. Um poder negado prevalece também para Super administrador.

As telas utilizam dados existentes e não introduzem cobranças, repasses, aprovações ou mutações fictícias. Nenhuma nova tabela ou migração é necessária para esses dois departamentos.

- **Financeiro:** indicadores de pagamentos confirmados, valor confirmado, valores retidos e liberados; consultas paginadas de pagamentos e pedidos com suas retenções. Filtros por período e situação, até 50 registros por página e 366 dias por consulta. O período segue o dia operacional de Cuiabá (UTC−4). As notas distinguem registro interno de saldo ou repasse bancário.
- **Catálogo:** indicadores de produtos publicados, rascunhos, produtos efetivamente visíveis, lojas e categorias ativas; consultas de produtos, lojas e categorias com pesquisa literal, filtros e paginação. A visibilidade respeita o predicado existente da vitrine; preço futuro não aparece como preço vigente. Somente Super administrador recebe o atalho para organizar categorias.

Os endpoints são `/v1/admin/finance/overview` e `/v1/admin/catalog/overview`, disponíveis também nos prefixos API existentes. A autenticação administrativa canônica, as permissões e a sessão viva são exigidas antes da consulta. O serviço ainda revalida principal, conta ativa, papel, concessão vigente e negações no banco dentro da transação, antes de ler dados do departamento. Todas as respostas dessas rotas são `private, no-store`, incluindo falhas e negações.

Uma resposta incompleta ou incompatível do banco retorna `503 DEPARTMENT_UNAVAILABLE`, com rollback e sem métricas, em vez de atribuir ao operador um erro de preenchimento.

Os contratos expõem somente os campos necessários: não entregam CPF, contato privado, endereço do cliente, chave de pagamento, segredo, referência privada do gateway ou payload do provedor. Contagens e dinheiro negativos são recusados. Datas `timestamptz` com offset real do Postgres são aceitas e validadas.

## Organização e responsividade

As duas telas compartilham cabeçalho, indicadores, filtros, abas de consulta e paginação. As tabelas se reorganizam em cartões identificados conforme a largura disponível do departamento. Campos e botões preservam o espaço de toque, quebra de nomes e valores longos e foco visível por teclado. O carregamento inicial usa o componente `PageLoading` do sistema.

As consultas são atualizadas a cada 30 segundos enquanto a tela está visível, ao retornar à janela ou ao receber alteração de departamento. Uma atualização preserva filtros editados e a última consulta; erro temporário mostra o estado anterior com aviso, sem produzir zeros fictícios. Um erro de autorização remove imediatamente dados e indicadores. Respostas de um filtro, escopo ou identidade anterior não são exibidas na nova consulta.

## Verificação concluída

**28 testes aprovados:** 24 unitários/HTTP e 4 de integração SQL em Postgres sintético local, com fixtures exclusivamente descartáveis e rollback.

A integração verificou:

1. Execução das cinco consultas contra o schema real: pagamentos, pedidos, produtos, lojas e categorias.
2. Busca literal de `%` e `_`, paginação sem duplicação, preço vigente sem antecipar preço futuro, e atualização real da visibilidade após pausar uma loja.
3. Fronteiras de dia UTC−4; soma apenas de pagamentos aprovados; retenções descontadas de estornos; exclusão de retenção estornada dos valores retidos; valores liberados separados.
4. Revogação do setor no banco mesmo com contexto de acesso anterior, e poder negado de Super administrador.

A validação de aplicação (`npm run typecheck:app`) passou após a implementação. O log dos testes está em `docs/evidence/departamentos-operacionais-2026-10-09/unit-postgres.log`.

**11 testes de navegador aprovados** após o congelamento das fontes compartilhadas: matriz de 320, 390, 768, 1280 e 1440 pixels cobrindo as duas telas e seus cinco tipos de lista, além de filtros, paginação, ausência de resultados, preservação de rascunho, atualização automática, revogação e carregamento. A suíte é `tests/e2e/admin-operations.spec.ts`.

As dez capturas finais e o registro `verification.json`, com resultado e fingerprints dos arquivos verificados, estão em `docs/evidence/departamentos-operacionais-2026-10-09/`. A inspeção visual amostral em 320, 390, 768 e 1440 pixels confirmou identificação de campos, quebra de nomes longos, indicadores e controles adaptados. A verificação automática confirmou ausência de transbordamento horizontal da página e das tabelas em todas as cinco larguras. Uma rolagem vertical permanece necessária para listas extensas e detalhes, sem retirar funções da consulta.

Nenhum e-mail real foi enviado, nenhum usuário de produção foi criado e nenhum dado de negócio de produção foi alterado por essas verificações. Fixtures de navegador não substituem login real em produção nem prova de entrega de convites.

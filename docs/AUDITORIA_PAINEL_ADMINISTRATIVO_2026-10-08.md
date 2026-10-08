# Painel administrativo: indicadores e autorização

O painel deixou de depender de cartões estáticos e passou a consultar `GET /v1/admin/dashboard`. A resposta contém somente os departamentos permitidos pela sessão administrativa atual, incluindo as negações explícitas de poderes de Super administradores. Cada atualização executa uma consulta SQL com um único snapshot; os fragmentos de departamentos não autorizados são excluídos antes de consultar o banco.

São 36 indicadores departamentais. O 37º, auditoria global em 24 horas, é entregue exclusivamente a Super administradores com todos os nove poderes. Nenhuma métrica contém nomes, e-mails, CPFs, identificadores de clientes, documentos, transações individuais ou referências privadas do gateway.

| Poder | Indicadores reais | Critério relevante |
| --- | --- | --- |
| `account_governance` | Contas ativas; contas bloqueadas; cadastros em análise; convites pendentes | Contas precisam de pessoa não arquivada ou identidade administrativa vinculada a pessoa não arquivada. Credenciais provisórias de convites não entram. Estado de bloqueio é calculado para o momento atual. Administradores recebem somente seus convites; Super administradores com este poder recebem todos. Aceitos, expirados, invalidados e arquivados não entram na pendência. |
| `document_verification` | Imóveis aprovados; imóveis cadastrados; análises pendentes; documentos em processamento; documentos com falha | Imóveis aprovados têm `status=verified`; a fila desconsidera solicitações substituídas e inclui somente `pending`, `claimed`, `in_review`. |
| `catalog_moderation` | Produtos publicados; produtos em rascunho; categorias ativas; lojas ativas | Publicação do produto e atividade da loja são indicadores separados. A publicação isolada não afirma que o produto está elegível à vitrine, que aplica regras adicionais. |
| `location_management` | Municípios ativos; municípios bloqueados; restrições de acesso | Cobertura baseada no cadastro canônico e restrições parciais ainda ativas. |
| `finance_ops` | Pagamentos confirmados; valor confirmado; valores retidos; valores liberados | Intenções `approved`, incluindo assinaturas. Retenções descontam estornos já registrados. Liberação no sistema não equivale a confirmação de transferência bancária. Valores são inteiros em centavos. |
| `refund_management` | Solicitações em análise; estornos em andamento; reembolsos confirmados; valor solicitado em análise | Análise: `requested`, `under_review`; andamento: `approved`, `processing`; confirmado: `refunded`. Valor solicitado não afirma aprovação nem execução pelo gateway. |
| `complaint_management` | Denúncias abertas; denúncias concluídas; avaliações não moderadas; avaliações moderadas | Abertas: `submitted`, `under_review`, `awaiting_information`; concluídas: `resolved`, `dismissed`. Nenhum texto privado de denúncia é entregue. |
| `payment_configuration` | Cobranças pendentes; pagamentos com falha; assinaturas ativas e em teste; assinaturas em atraso; planos ativos | Pendentes incluem somente cobranças não expiradas. Assinaturas ativas incluem `active`, `trialing`; atraso é `past_due`. |
| `platform_configuration` | Revisão da configuração; alterações de configuração em 24 horas; indicadores operacionais definidos | Os eventos deste departamento restringem-se a `app_global_config`. O total global da auditoria aparece somente com todos os poderes e papel Super administrador. |

O endpoint usa `Cache-Control: private, no-store` e o middleware administrativo existente, que valida a sessão ativa e os poderes vigentes. Falha de banco devolve 503, sem converter ausência de dados em números zero. O contrato valida inteiros não negativos e recusa valores acima da faixa segura do JavaScript.

O endpoint antigo `/v1/admin/configuration/overview` devolve 410 com `DASHBOARD_OVERVIEW_MOVED` e o caminho do novo painel. Ele anteriormente misturava dados de contas, documentos e localidades sob uma única permissão de configuração. A configuração global concentra agora identidade e operação; os indicadores operacionais passam ao painel.

A tela atualiza os dados a cada 30 segundos enquanto visível, ao recuperar o foco e ao receber eventos locais de mudança de departamentos ou notificações. Trata-se de consulta periódica automática, sem afirmar entrega instantânea por WebSocket.

## Verificação

- `tests/unit/adminDashboard.test.ts`: 21 cenários de autorização por todos os nove poderes, Super administrador com poderes negados, privacidade, erros, ausência de sessão nos três prefixos HTTP, sem cache e desativação segura do endpoint legado.
- `tests/integration/adminDashboardPostgres.test.ts`: 5 cenários com SQL, constraints e triggers reais, todas as migrations aplicadas e fixtures sintéticas em transações com rollback: nove departamentos; mudança de cobertura refletida na atualização seguinte; convites por proprietário/expiração/invalidação/arquivamento; Super administrador com revogações; exclusão de credenciais provisórias do total de contas.
- O teste SQL aceita exclusivamente `127.0.0.1:55432/postgres` em `HVM_DASHBOARD_LOCAL_DATABASE_URL`; não aceita bancos remotos e não cria dados em produção.
- O serviço de indicadores não exige migration ou grant adicional. A migration do schema 66 pertence à correção da origem e das permissões de notificações, descrita no relatório conjunto; não concede novos poderes ao painel.

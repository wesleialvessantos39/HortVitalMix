# Departamentos, contas e assinaturas — auditoria de 10/10/2026

Base: main `3ae298aa3d658b4fc79dd93cb069bf388ef9826f`, schema 68. Continuação do Livro Raiz, sem nova trilha.

## Diagnóstico anterior à alteração

- `adminOperationsRoutes.ts` envia `req.query` diretamente a contratos strict. A Vercel acrescenta `path`/`__hvm_path` durante o encaminhamento; outras rotas já removem esses campos. Financeiro e Catálogo os rejeitam como filtro inválido. A ausência de gateway não é requisito dessas consultas e não deve gerar erro nem valores demonstrativos.
- `appUpdateNotice.css` usa flex com botão sem redução no desktop e texto com `overflow-wrap:anywhere`. O botão ocupa quase todo o cartão. Além disso, a lista conservadora de rotas seguras faz o aviso pedir retorno ao painel mesmo sem operação em andamento. A atualização já tem coordenação entre abas, integridade e proteção de IndexedDB; essas proteções devem permanecer.
- Existem nove poderes canônicos. Avaliações está agrupada com Denúncias; Assinaturas/planos com Pagamentos; Política de reembolso com Reembolsos. São os três departamentos a separar, com registros reais, controle próprio e propagação das concessões/negações anteriores equivalentes. Convites e edição de poderes têm limites fixos de nove/dez; devem acompanhar o catálogo completo de doze.
- Catálogo possui listas e navegação, mas não possui moderação de publicação documentada dentro do departamento. Financeiro não organiza consulta de caixa presencial, cobranças recorrentes e casos financeiros juntos. Administração deve ler o caixa do produtor, nunca lançar ou encerrar uma venda em nome dele.
- Avaliações só permite ocultar; faltam busca, notas, indicadores, consulta de histórico e restauração justificada, sem alterar a nota/comentário do cliente.
- Assinaturas já têm contratos congelados, recorrências, cobrança idempotente e cancelamento, mas o cancelamento não explica nem abre processo de reembolso. Reembolsos existentes tratam pedidos de produtos e restringem solicitantes a consumidores. É necessário um processo próprio para ciclos de assinatura de ambos os públicos, associado à mesma administração de Reembolsos e a uma política versionada independente.
- Planos de consumidor representam cestas de uma loja, com endereços, produtos e janelas; planos de produtor representam acesso sem entrega. Essas dependências não podem ser dispensadas. Administração poderá visualizar ambos os públicos, sem contratar usando uma identidade administrativa.
- A exclusão administrativa já remove Auth e domínio, arquiva propriedades e encaminha objetos ao Storage por fila. Não há autoexclusão. Há dependências posteriores (preços, pedidos, ciclos) a verificar em PostgreSQL real; exclusão não pode encerrar disputas nem apagar obrigações financeiras abertas. Arquivo de propriedade contém snapshot privado e é imutável, sem ação de exclusão autorizada ou apresentação na fila. Arquivos de conta excluída não devem contribuir a novo cadastro, mesmo com CAR/CCIR coincidente.

## Arquivos inspecionados

Livro Raiz; `shared/adminPermissions.ts`; contratos `adminGovernance`, `adminOperations`, `subscription`, `commerce`, `review`, `profilePrivacy`; serviços `AdminOperationsService`, `AdminDashboardService`, `CommerceSupport`, `CommerceService`, `AfterSalesService`, `SubscriptionService`, `ReviewService`, `ProfilePrivacyService`, `AdminGovernanceService`; rotas administrativas correspondentes, `profilePrivacyRoutes`, `subscriptionRoutes`, `reviewRoutes`; `AdminDepartmentsPage`, `AdminFinancePage`, `AdminCatalogPage`, `AdminReviewsPage`, `AdminSubscriptionPlansPage`, `AdminUsersPage`, `AdminGovernancePage`, `AccountHub`, `SubscriptionPlansPage`, `VerificationQueuePage`; `AppUpdateNotice`, `pwaSafety`, `offlineDb`, `OfflineStatusBanner`; migrations de governança, exclusão, comércio, assinaturas e avaliações; schema canônico via leitura Supabase.

## Limites da implementação

Automação continua sujeita à conexão e à execução do navegador. Sincronização de operações próprias não concede acesso administrativo. Sem gateway conectado, consulta/configuração/análise funcionam; nenhuma tela declara cobrança, repasse ou devolução de dinheiro sem confirmação confiável. LGPD admite retenção necessária por obrigação legal/defesa de direitos: o fluxo deve explicar isso, minimizar registros e remover acesso/identidade/dados operacionais; não prometer apagar evidência legal que precisa ser preservada. Homologação física de Android/iPhone e revisão jurídica da política concreta são registradas separadamente dos testes automatizados.


## Diagnóstico confirmado em PostgreSQL e navegador

A reprodução local identificou também: guarda imutável de consentimentos que bloqueava a exclusão em cascata; remoção do produtor antes dos imóveis que perdia a identificação de exclusão no arquivo; segunda auditoria com o mesmo comando no cancelamento que violava unicidade; consulta de categorias em transação readonly incompatível com a revalidação canônica FOR SHARE. As correções mantêm histórico imutável, permissões atuais e recibos idempotentes. O aviso precisava de largura explícita também em 768 px, além de remover o botão que comprimia o texto.

A exclusão foi exercitada com propriedades aprovadas, documentos, extrações, scans, revisões e consentimentos; não removeu dados de terceiros. Dinheiro confirmado e contratos com obrigação financeira conservam registro mínimo privado, com titular dissociado. Restauração de avaliação exige histórico com revisão e autoridade válida; alteração da nota/comentário continua proibida. Financeiro consulta caixas sem conceder comandos de caixa.

As evidências finais, a relação completa de arquivos, migrações físicas, commit e deployment confirmado constam na entrada correspondente do Livro Raiz e em `docs/evidence/departamentos-2026-10-10/`. Nenhuma conta real foi excluída e nenhum pagamento real foi executado durante os testes.

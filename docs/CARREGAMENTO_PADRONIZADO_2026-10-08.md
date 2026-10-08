# Carregamento inicial padronizado

Foram migrados **45 indicadores em 42 arquivos** para o componente comum `PageLoading`, incluindo **39 arquivos de páginas**. O componente compartilha o visual de skeleton usado na configuração global, mantém descrição acessível e respeita a preferência de reduzir animações. Áreas internas e diálogos usam a variante `compact` para limitar sua altura.

| Área | Arquivos migrados |
| --- | --- |
| Acesso administrativo | `AdminAccessGate`, `AdminAcceptInvitePage`, `AdminBootstrapPage`, `AdminAccountPage`, `AdminPermissionEditor` |
| Gestão administrativa | `AdminCategoriesPage`, `AdminGovernancePage`, `AdminUsersPage`, `AdminReviewsPage`, `AdminSubscriptionPlansPage`, `ExecutiveBiDashboardPage`, `RegistrationReviews`, `VerificationQueuePage`, `AdminLocalitiesPage`, `AdminCommercePage` |
| Conta e segurança | `AddressManager`, `ResetPasswordPage` |
| Produção e loja | `ProducerCatalogPage`, `ProductEditorPage`, `ProducerStoreSettingsPage`, `ProducerPropertiesPage`, `InventoryLotsPage` |
| Logística e vendas | `ProducerDeliveryAreaPage`, `DeliveryScopePage`, `DeliveryWindowsPage`, `ProducerOrdersPage`, `ProducerSalesPage`, `ProducerRefundsPage`, `ProducerPosPage` |
| Vitrine e descoberta | `HomeDiscoveryPage`, `PublicProducerStorePage`, `PublicProductCatalog`, `RegionalHighlights` |
| Compra e assinaturas | `CartPage`, `CheckoutReviewPage`, `OrderTrackingPage`, `SubscriptionPlansPage`, `PurchasesPage`, `PosSaleReviewPage`, `PaymentPreparedPage`, `CasesPage` |
| Documentos | `DocumentsPanel` |

As atualizações em segundo plano que já mantinham os dados visíveis continuam silenciosas. Nas páginas de conta administrativa, configuração de compra, inventário, planos, categorias, catálogo produtor, loja, entrega, cesta e localidades, o indicador também foi limitado à ausência de dados: uma atualização não coloca um skeleton por cima do conteúdo existente. O editor preserva essa regra somente quando o produto carregado corresponde ao ID da rota.

Mudanças de contexto que exigem recarregar uma seleção, como abas da fila e consultas de descoberta, continuam indicando sua leitura pendente. Não foram alterados timers, requisições, autenticação, operações de envio/salvamento ou paginação. Carregamento de imagens, seletores e controles individuais permanece com seus indicadores próprios. `Account.tsx` não contém um indicador inicial de página para migrar; seus controles de município e envio foram preservados.

**Validação:** `npm run typecheck` e `git diff --check` passaram. Oito cenários existentes de Playwright passaram, cobrindo redefinição de senha, loading anunciado, erro e recuperação de inventário, conflito que preserva edição e layouts de catálogo/inventário/descoberta em 320px. As chamadas desses cenários usam dados simulados, sem escrever na produção.

A padronização melhora a apresentação e a estabilidade visual; ela não comprova redução do tempo de resposta da API.

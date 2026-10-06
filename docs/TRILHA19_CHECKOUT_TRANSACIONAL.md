# MISSÃO DE ENGENHARIA — TRILHA 19

Checkout Transacional, Cotação Congelada e Idempotência — plano T12–T25, Volume 4.

## 0. Base preservada e fontes

- Livro-Raiz da main **3c6fdc83b76023b4b690cc05b5eddf3a934f097e**, T01–T18 e correções homologadas, schema lógico **55**.
- PDF anexado pelo proprietário **HortiVitalMix_Plano_Trilhas_T12-T25.pdf**, missão T19. Os exemplos antigos T19/T20 têm escopo e schema diferentes. Nesta fonte, gateway real, QR Pix e webhook são **T20**; acompanhamento é **T21**.
- Repositório **wesleialvessantos39/HortVitalMix@main**, Supabase único **xipbsazvymkqqfmfegwu**, Vercel gratuita/main/**pdx1**.
- Implementação aditiva. Nenhuma migration anterior, dependência, lockfile, configuração Vercel, motor de frete/estoque, regra de autenticação, política de cliente anterior ou foto foi substituída.

## 1. Escopo entregue — schema lógico 56

### 1.1 Banco e acesso

Migration CLI **20261006012938_trilha19_checkout_quotes.sql**. **62 migrations**, hash **2caaa0fd11223a49aceb6479581aad7c8e15a1fa122166564b06981d06217572**. Aplicada no projeto canônico como **20261006015914**, com alias físico/canônico no validador. O histórico remoto de 62 migrations foi validado em nomes/ordem/schema/hash.

- `app_checkout_quotes`: snapshot de endereço, itens agrupados por produtor, preço/versão T14, frete T16, subtotais/total, prazo de 15 minutos e consumo único. Fingerprint da cesta, IDs de reservas T15 e índices de titular/FKs.
- `app_command_receipts`: command_id único, titular, endpoint, SHA-256 do payload normalizado, código HTTP e resposta imutável. Não expõe recibos pela Data API; o backend valida o titular.
- `app_payment_intents`: intenção **pending**, valor congelado, método Pix/cartão, prazo, quote_id e command_id únicos. A persistência é exigida expressamente pelo fluxo T19, embora o DDL correspondente esteja apresentado na T20. As colunas previstas pela T20 foram criadas como pré-requisito; integração financeira não foi antecipada.
- RLS **ENABLE/FORCE** nas três tabelas. `authenticated` recebe somente SELECT das suas cotações/intents, com `(SELECT auth.uid())`, helper real da base. O pseudocódigo `current_user_id()` do PDF não existe na base e não foi criado outro mecanismo de identidade. Sem privilégios para anon/PUBLIC; mutações via `service_role`.
- Helpers de cobertura existentes são SECURITY INVOKER. Foram concedidos somente SELECT ao backend em `app_municipalities` e `app_properties`, necessários ao frete T16 dentro da transação `service_role`; grants/policies de cliente e as funções anteriores permanecem intactos.
- Triggers privados impedem reescrever snapshots, desfazer consumo ou alterar/excluir recibos. A exclusão operacional T06 preservada pode apagar dados pessoais e liberar os holds ativos na mesma transação.
- `delivery_address_id` e `cart_id` admitem SET NULL por exclusão do pai: a T07 continua podendo excluir um endereço e o snapshot original permanece íntegro. Confirmação da cotação perde a elegibilidade e exige revisão. Titular/pessoa usam CASCADE para preservar a exclusão operacional de conta.

- Supabase real confirmou RLS ENABLE/FORCE, SELECT do titular e ausência de privilégios de mutação de cliente nas três tabelas. As **65 relações existentes** mantiveram contagens e digests idênticos imediatamente após a migração, incluindo Auth, Storage, preços, estoque e cesta. Evidência sem dados pessoais em [TRILHA19_PRESERVACAO.json](TRILHA19_PRESERVACAO.json).
- Nenhum WARN/ERROR novo dos advisors. Apenas INFO [RLS sem policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) no recibo deliberadamente exclusivo do backend, e [índices ainda não usados](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) nas tabelas recém-criadas sem transações de produção. Nenhuma FK nova sem índice.

### 1.2 Serviço, atomicidade e contratos

`CheckoutService.ts`, `checkoutRoutes.ts` e contratos Zod estritos em `shared/contracts/checkout.ts`; cinco rotas nos prefixos `/v1`, `/api/v1`, `/_hvm_api/v1`:

- GET `/checkout/context`: resolve a cesta salva T18 e uma confirmação pendente vigente, recuperável em outro aparelho.
- POST `/checkout/quotes`: recebe exclusivamente cartId/endereço, verifica titular/conta/role ativos, propriedade da cesta/endereço, GPS/localidade, publicação/categoria/gates T12 e preço vigente T14. Recalcula frete no motor **T16** por loja, verifica área e mínimo individual, congela snapshot por **15 minutos** sem reservar estoque.
- GET `/checkout/quotes/:id` e `/checkout/confirmations/:id`: leitura pelo titular; identificadores alheios retornam 404.
- POST `/checkout/confirm`: exige **X-Command-Id UUID v4** e `{quoteId,paymentMethod}` estrito. Nenhum valor monetário ou identidade vem do corpo do cliente.
- Trava da conta T18 impede corrida com edição/fusão da cesta. Trava advisory T19 serializa inclusive uma chave ainda ausente; trava do recibo, cotação e cesta mantém concorrência segura. Payload normalizado produz hash estável para ordem de campos/capitalização dos UUIDs.
- Reenvio com mesma chave/hash retorna **201 e o mesmo body persistido**; mesmo ID com payload divergente retorna **409 COMMAND_ID_REUSED_DIFFERENT_PAYLOAD**. Titular e conta ativa são revalidados antes do replay.
- Cotação vencida/consumida retorna **410**. Mudança de cesta/endereço/frete exige recálculo. Alteração posterior de preço mantém a versão/valor congelados até a validade da cotação.
- Confirmação chama o **InventoryService.reserveStock T15** com o mesmo PoolClient, em ordem estável de produto. Reserva FIFO, consumo único da cotação, intent pending, recibo e auditoria confirmada são gravados em **uma transação**. Falha em qualquer etapa reverte tudo, inclusive holds já feitos em outras lojas. Prazo é conferido novamente após esperar as travas.
- Não há baixa de venda, limpeza automática da cesta ou transição de reserva para consumed nesta trilha. O estoque permanece reservado segundo T15 até a integração financeira futura. Uma confirmação pending vigente da mesma cesta é recuperada antes de permitir uma segunda reserva.
- Auditoria armazena IDs/contagens/valor/hash, sem endereço ou outros dados pessoais. Origem protegida; sessões/cookies/recuperação anteriores continuam usando o fluxo homologado.

### 1.3 Interface

- CTA **Revisar pedido** na cesta T18 abre `/checkout`; continua condicionado a disponibilidade e mínimo de cada loja.
- Revisão multilojas, endereço cadastrado com GPS, produtos/fotos, preço por porção, subtotal, mínimo individual, frete e total congelados. Desconto permanece zero: não foi inventado um motor de cupons ausente da base/PDF.
- Escolha Pix/cartão apenas define o método da intenção; nenhum dado de cartão é coletado nesta etapa.
- Cronômetro usa o relógio do servidor. Conflitos **409/410** mostram **“Os valores do seu pedido mudaram, revise antes de confirmar”**, com recálculo/revisão da cesta.
- **Confirmar Pedido** gera uma chave antes do envio, bloqueia cliques concorrentes e conserva chave/payload em sessionStorage por usuário e memória. Queda de rede/5xx/resposta não JSON não autoriza outro comando: **Recuperar confirmação** reenvia a mesma tentativa, inclusive após reload e falha de leitura do recibo.
- Confirmação mostra **Pagamento pendente**, total, referência e tempo restante de reserva. Reload/segundo aparelho recuperam o recibo e snapshot. Após encerrar o prazo, a seleção pode ser revista novamente.
- Layout/toque/foco/overflow auditados em **320/390/768/1440 px**. Código carregado por lazy import; requisições independentes em paralelo, timers/listeners limpos e controles com rótulos acessíveis.
- Fotos usam `MediaImage` e os caches/upload otimizado já homologados na T18. URLs assinadas são resolvidas fora do snapshot, com gates atuais; nenhum arquivo existente foi regravado/removido.

## 2. Fora de escopo

Gateway, QR/copia-e-cola Pix, webhook, liquidação financeira e captura real de cartão **T20**. Pedidos/esteira/acompanhar status **T21**. Ponto de retirada e cupons não fazem parte desta missão do PDF nem de contratos homologados presentes. A próxima trilha deverá evoluir os intents existentes de forma aditiva.

## 3. Verificação e limites

- **17** testes T19 de contrato/HTTP (5 contratos + 12 rotas), incluindo v4, payloads injetados, CSRF, replay e dispatcher.
- **25** cenários T19 PostgreSQL reais: dez confirmações paralelas; mesmo ID/payload divergente; chaves distintas para a mesma cotação; vencimento normal e durante trava; preço congelado/futuro; imutabilidade; rollback entre lojas e ao falhar recibo; cesta/endereço/frete alterados; mínimos/área; isolamento/RLS/grants; gates/conta bloqueada; segundo aparelho; exclusão de endereço/conta; cortes; estoque zero/vencido; disputa entre compradores.
- **1** história de React compilado → login/cookies/HTTP reais → PostgreSQL: cesta de duas lojas, snapshot, perda da resposta depois do commit, reenvio com mesma chave/body, intent/recibo únicos e reserva de quatro porções, recarga/segundo aparelho, capturas em mobile/desktop e ausência de erros JavaScript.
- **16** cenários T19 de navegador nas quatro larguras, conflitos/expiração/recálculo, pré-requisitos, clique duplo, resposta de rede/HTML201 perdida e reload enquanto a leitura do recibo falha.
- Regressões: **440** unitários (incluem 5 contratos T19), **141** HTTP (incluem 12 T19), **164** PostgreSQL anteriores T12–T18/mídias em bases descartáveis separadas e **116** cenários anteriores de navegador T12–T18. Três cenários antigos deram timeout na primeira execução conjunta e passaram na repetição isolada, sem alteração de implementação ou testes anteriores.

 Comandos novos: `npm run test:t19:unit`, `test:t19:postgres`, `test:t19:story`, `test:t19:e2e`. Banco/história exigem `HVM_T19_LOCAL_DATABASE_URL` exclusivamente **127.0.0.1:55432/postgres**, em banco descartável com migrations; história exige build anterior. Somente Auth/Storage externos são adaptados na história local: React, cookies, HTTP, Zod, serviços, transação, RLS e PostgreSQL são reais.

Typecheck de produção, build, manifesto, segurança e cold start ESM aprovados. Typecheck global conserva um erro pré-existente em `tests/unit/registrationBackground.test.ts:38` (`transform` versus `strip`), registrado na entrega T18 e reproduzido na base. Nenhum erro novo de TypeScript permanece.

O check legado **Supabase Preview** não interpreta os aliases de timestamps físicos/canônicos, limitação registrada na T18 e em entregas anteriores. A validação canônica do projeto confere versões/nomes/ordem/hash reais; nenhuma migration antiga é renumerada para contornar a integração. Publicação continua somente main, sem prévia paga ou fixture de conta/produto/estoque em produção.

## 4. Checklist

- [x] DDL aditivo, isolamento e imutabilidade validados em PostgreSQL.
- [x] Cotação congelada/TTL, confirmação atômica e replay exato implementados.
- [x] X-Command-Id v4 e payload divergente/410 validados.
- [x] Interface de revisão, recálculo e recuperação de resposta perdida entregue.
- [x] Fluxo completo React → HTTP → PostgreSQL, mobile/desktop conferido.
- [x] Migração remota, manifesto/alias/schema 56 e preservação conferidos.
- [x] Publicação main/READY, release e Livro-Raiz finalizados.


## 5. Publicação e preservação final

[PR #82](https://github.com/wesleialvessantos39/HortVitalMix/pull/82) integrado. SHA funcional **e1ec92b12476c83402730f8580f0bdfd97d7a872**, árvore **dd8b2ca74a29e98c42cd00cdd2295fb6a52fa5ef**, idêntica à validada localmente. Deployment **dpl_KEPq5SqkmNwA1qCpDJpfrmjxVeme**, **READY**, production/**main/pdx1**, build em aproximadamente **57 segundos**. Site: **https://hortvitalmix.vercel.app/checkout**.

Release funcional **t19-v56-e1ec92b** registrada somente após READY da SHA exata e validação do histórico. `verify:deploy` aprovou health/ready/config, schema **56** e release correspondente. Seis verificações reais de API — contexto, dispatcher, leitura de cotação/recibo e criação/confirmação sem login — retornaram **401 AUTH_REQUIRED**, JSON e requestId, sem gravar transações anônimas. A URL alternativa `/_hvm_api` continua sendo o transporte dos ambientes não canônicos; em produção o frontend mantém `/api`, como na T18, sem alteração de roteamento Vercel.

Agent-browser conferiu a página publicada sem login em **390/1440 px**, com conteúdo/controles corretos, sem overflow/erro JavaScript/overlay. A cesta automática do cabeçalho foi interceptada com resposta vazia na verificação publicada para evitar criar uma sessão nas tabelas T18 existentes; Auth/rotas checkout/configuração usados pela tela continuaram reais. O fluxo autenticado de negócio completo foi comprovado na história local com PostgreSQL real; não houve compra/reserva, login de cliente ou fixture de produto/estoque/upload em produção.

O catálogo publicado em Ariquemes manteve a foto real carregada, com prioridade **eager/high**, sem overflow ou erro JavaScript, reutilizando a implementação T18.

Logs **error/fatal** do deployment sem entradas na janela consultada de dez minutos. Após release/navegação, **64 relações anteriores**, excluindo somente `app_releases`, conservaram contagens e digests — incluindo a cesta T18, Auth, Storage, estoque e preços. A evidência registra snapshots antes/depois da migração e após publicação.

Segurança GitHub do PR aprovada; Supabase Preview do PR ignorado por prévias desabilitadas, Vercel da branch cancelada pela guarda main. O check de migrações da main conserva a limitação histórica de aliases físicos já documentada; o validador canônico do projeto aprovou as **62 migrations reais**. Nenhuma migração antiga ou histórico remoto foi reescrito.

Fechamento documental limitado a relatório/evidência/Livro-Raiz; a release corrente segue a SHA documental final da main somente após seu próprio READY, conservando o código funcional/schema/hash acima. A referência funcional identifica exatamente a implementação testada; `/api/ready` identifica a release corrente.

# MISSÃO DE ENGENHARIA — TRILHA 18

Cesta Multilojas e Montador **Monte seu HortiMix**, plano T12–T25, Volume 4. Entrega adicional: carregamento compartilhado das fotos.

## 0. Base preservada e fontes

- Livro-Raiz da main **af9fa2de633913a6a2d5561d86d0312531637539**, T01–T17 e correções homologadas, schema lógico **54**.
- PDF do proprietário **HortiVitalMix_Plano_Trilhas_T12-T25.pdf**, missão T18. Os exemplos T19/T20 enviados definem o formato, mas possuem escopo/numeração de schema diferentes do estado real. O PDF e a base real orientam esta implementação e as próximas trilhas.
- Repositório **wesleialvessantos39/HortVitalMix@main**; Supabase único **xipbsazvymkqqfmfegwu**; Vercel gratuita, publicação exclusivamente **main/pdx1**.
- Nenhuma migration anterior, dependência, lockfile, configuração Vercel, regra de autenticação ou tabela de negócio anterior foi substituída. Integrações anteriores recebem apenas a cesta e as melhorias comuns de imagens.

## 1. Escopo entregue — schema lógico 55

### 1.1 Banco e acesso

Migration criada pelo CLI **20261005210404_trilha18_carts.sql**, aplicada como **20261005212931**; alias físico registrado no validador. **61 migrations**, hash **e52b14f3195c5cdbd49a7e761bb486a2fbb8d8859837f1378d799569d033573a**.

- `app_carts`: UUID, session_id único, user_id opcional referenciando `app_users`, timestamps. Índice parcial único mantém uma cesta salva por conta, recuperável em outros aparelhos.
- `app_cart_items`: produto T14, loja T12, quantidade inteira 1–99, cinco cortes ou NULL, timestamps e exclusões CASCADE que preservam a governança histórica.
- `UNIQUE NULLS NOT DISTINCT (cart_id,product_id,cut_type)` impede duplicação também da porção sem corte. Índices cobrem as três FKs.
- RLS **ENABLE/FORCE** nas duas tabelas; `anon`, `authenticated` e PUBLIC sem privilégios. Sem policies de cliente, conforme exceção explícita da T18: resolução inteiramente pelo backend. `service_role` tem somente SELECT/INSERT/UPDATE/DELETE nas tabelas novas.
- Supabase real confirmou os grants/RLS. A comparação antes/depois da migration manteve **63 relações existentes** com contagens/digests idênticos, incluindo Auth, Storage, identidade, propriedades, preços e estoque. Evidência contém somente metadados/hashes em [TRILHA18_PRESERVACAO.json](TRILHA18_PRESERVACAO.json).
- Advisors: nenhum WARN/ERROR novo. As duas tabelas têm apenas INFO [RLS sem policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), esperado para tabelas deliberadamente exclusivas do backend sem grants de cliente.

### 1.2 Serviço, sessão e contratos

`CartService.ts`, `cartRoutes.ts`, `cartSession.ts` e contratos Zod estritos `shared/contracts/cart.ts`, nos três prefixos históricos `/v1`, `/api/v1`, `/_hvm_api/v1`.

- Sessão visitante é um UUID imprevisível emitido pelo servidor em cookie **hvm_cart HttpOnly/SameSite=Lax/Secure em produção**, com duração de 30 dias. A base T03 não possui cookie anônimo; tokens Auth anteriores continuam intactos.
- API não recebe cartId, userId, sessionId, storeId ou preço do cliente. A conta vem da sessão viva já validada e seu estado ativo é revalidado no banco. Credencial expirada retorna 401; administrador não usa a cesta pública.
- Todas as operações usam transação e **SET LOCAL ROLE service_role**, com travas por conta/sessão antes de buscar/criar a cesta. Duas adições iniciais da interface compartilham a emissão do cookie e são serializadas, evitando cestas distintas por corrida entre cards.
- Login público e importação de sessão esperam a fusão da cesta existente. Itens são agregados por produto/corte, somados até 99, mantendo as opções distintas; a cesta visitante fundida é removida na mesma transação. Repetição não duplica. Se houver indisponibilidade, preservam-se cookie/itens e o acesso posterior à cesta repete a fusão, sem interromper login legado.
- Logout limpa o cookie da cesta. Cookie de cesta já vinculada a outro titular é rotacionado; nenhum cliente herda uma cesta salva alheia.
- Adição exige produto publicado, categoria ativa, preço atual e gate público **hvm_store_private.store_is_visible T12**. `store_id` é resolvido pelo backend. Produto despublicado retorna 404 explícito; item anteriormente adicionado permanece removível, sinalizado indisponível e excluído do subtotal.
- Agrupamento por loja lê o preço T14 vigente, ignorando versões futuras, e o mínimo da regra T16 ou apresentação T12 quando ainda não há regra T16. Sem preço congelado ou cotação de frete.
- `commandId` e auditoria atômica tornam a repetição segura. O montador grava todas as porções em uma única transação; item inválido aborta o mix inteiro. Reutilização indevida da chave retorna 409.
- GET `/cart`; POST `/cart/items` e `/cart/mix`; PATCH `/cart/items/:id`; POST `/cart/items/:id/remove`. Origem protegida, IDs/quantidades/cortes/payloads estritos, metadados de dispatcher normalizados e erros identificados.
- Novas opções limitadas a 200 por cesta e 30 por mix. A fusão preserva opções pré-existentes mesmo se sua união exceder 200; continua possível reduzir/remover antes de incluir novas variantes.

### 1.3 Interface

- `/carrinho`: seções por produtor, preços atuais, subtotais e mínimos independentes, botões de quantidade/remoção, total dos alimentos, estado vazio/erro/carregamento e entrada na conta.
- Catálogo e loja: **Adicionar à cesta**, retorno acessível de sucesso/erro e contador no atalho desktop/mobile.
- **Monte seu HortiMix**: múltiplos alimentos/lojas/cortes com porções inteiras. O peso exibido vem de `netWeightGrams` T14; não inventa produtos ou porções fracionárias sem preço cadastrado.
- Resposta perdida mantém a chave e oferece **Confirmar alteração** antes de aceitar outro comando. A cesta lê alterações de preço/fotos em segundo plano, no foco/retorno e a cada 30 segundos, conservando a última resposta confirmada se a rede falhar.
- Layout e toque conferidos em **320/390/768/1440 px**. Sem checkout, botão de pagamento, pedido ou cupom antecipado.

### 1.4 Fotos em todos os pontos

- `MediaImage` atende carrosséis de produto/capa/destaque, catálogo do produtor, editor, miniaturas, retratos e cesta. Imagens próximas da área visível são antecipadas; visíveis/principais recebem prioridade alta e decodificação assíncrona. A próxima foto do carrossel mantém prioridade baixa.
- `mediaCache` reaproveita a URL válida de cada caminho imutável de produto/loja quando uma API em outra tela ou instância retorna outra assinatura. Isso permite reutilizar o download e a imagem decodificada. Cache em memória limitado a 512 entradas/5 min, sempre encerrado antes da expiração; falha permite renovar a assinatura. Documentos, dados de negócio e tokens de autenticação não entram nesse cache.
- Preconnect/DNS-prefetch para o Storage canônico e consultas/assinaturas/avatares independentes em paralelo no catálogo/destaques. Gates e buckets privados permanecem vigentes; nenhuma transformação paga.
- Upload comum de produto/loja: WebP adaptativo, máximo de 1280 px, alvo **240 KB**, compressão progressiva com redesenho da fonte original e reaproveitamento da preparação do mesmo arquivo. Mantidos formatos permitidos e limite final de 2 MB; nenhuma foto existente foi removida ou regravada.
- Baseline publicado: imagem de produto real com **50.574 bytes**, catálogo em aproximadamente **418 ms** e download **189 ms** naquela sessão de navegador. A queixa não reproduziu demora longa nessa amostra. O teste controlado comprovou prioridade imediata e **nenhum download adicional** ao renovar assinatura; imagem sintética >2 MB terminou <=240 KB. Latência de rede/Storage não possui garantia absoluta de tempo.

## 2. Fora de escopo

Checkout/cotação congelada, reserva/consumo de estoque, cupons, pedido, gateway/Pix ou acompanhamento T19/T20. A cesta é intenção: **CartService não chama o motor de estoque**. T12/T14/T15/T16/T17 permanecem as fontes dos módulos correspondentes.

## 3. Verificação e limites

- **28** testes novos de contratos/sessão/HTTP/cache; **18** testes T18 PostgreSQL reais de criação/fusão/concorrência, NULL, cortes, 99, preço, rollback, retry, isolamento, RLS/grants, exclusão e preservação de estoque.
- **1** história completa com React compilado, HTTP, cookies e PostgreSQL reais: visitante monta duas lojas, login público funde cesta salva de outro aparelho, recarga/segundo aparelho recuperam itens, logout isola, estoque continua intacto. Apenas Auth e Storage externos são adaptados no ambiente descartável.
- **12** cenários T18 de navegador: cesta/montador nas quatro larguras, recuperação de resposta perdida/erro e duas verificações das fotos.
- Regressão: **446** testes unitários/contratos, **146** PostgreSQL T12–T17/mídias em bases descartáveis separadas, **79** cenários anteriores de navegador T12/T14–T17. Suítes antigas deixam fixtures locais; por isso não foram tratadas como um único banco vazio compartilhado.
- TypeScript de produção, `npm run build`, manifesto, segurança do cliente/bundle e cold start ESM aprovados. Typecheck global dos testes conserva um erro anterior em `tests/unit/registrationBackground.test.ts:38` (`transform` vs `strip`), reproduzido na main base; nenhum erro novo de TypeScript permaneceu.
- Sem fixtures de conta, produto, estoque ou upload em produção. A verificação publicada da cesta pode criar somente a cesta vazia normal de visitante nas tabelas novas.

Comandos novos: `npm run test:t18:unit`, `test:t18:postgres`, `test:t18:story` e `test:t18:e2e`. PostgreSQL/história requerem `HVM_T18_LOCAL_DATABASE_URL` estritamente `127.0.0.1:55432/postgres` e as migrations aplicadas em banco descartável; história requer build anterior.

## 4. Checklist

- [x] Migration aplicada no projeto único; RLS ENABLE/FORCE e grants conferidos.
- [x] Sessão anônima/conta/fusão/concorrência e isolamento testados.
- [x] Cesta multilojas e pedido mínimo individual funcionais.
- [x] Montador com cortes e gravação atômica operacional.
- [x] Fotos compartilhadas/prioritárias e upload otimizado comprovados.
- [x] Schema 54 → 55, manifesto/hash/alias e Livro-Raiz sincronizados.
- [x] Regressão em banco/interface e preservação remota verificadas.
- [ ] Fechamento de publicação main/READY e release final: registro abaixo após confirmação.

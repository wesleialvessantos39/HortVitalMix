# Trilha 14 — Alimentos preparados e preços versionados

Implementação aditiva sobre `main@0d1486f757c6411b907323152895f01fe713d4d6`, T13 homologada, schema 48. Fonte normativa: missão T14, Volume 3, do plano T12–T25 fornecido pelo proprietário e Livro-Raiz vigente. Schema lógico 49, 54 migrations, hash `b73d77a039fa20dd25bb4abdf89e3f36349abb9e44d9c287d89bcf89a53e777e`.

## Comportamento

O produtor encontra **Meus produtos** na sua conta e em `/produtor/produtos`. Pode criar um rascunho em `/produtor/produtos/novo`, editar em `/produtor/produtos/:id/editar`, informar categoria, descrição, embalagem, peso líquido, unidade, validade e conservação, adicionar fotos e publicar/despublicar. O catálogo mostra rascunhos/publicados e preço vigente.

A primeira versão de preço é criada na mesma transação do produto. Alterar o preço cria outra linha em `app_price_versions`, incrementa a revisão e preserva integralmente as anteriores. O preço corrente usa `ORDER BY valid_from DESC LIMIT 1`, com avanço monotônico de timestamp. A resposta inclui o UUID da versão para os snapshots das futuras trilhas de compra. O editor converte reais para centavos com parsing decimal estrito, sem multiplicação de ponto flutuante.

A criação e publicação reutilizam `hvm_store_private.store_is_visible`, da T12: loja ativa, perfil verificado, confiança mínima 2 e elegibilidade territorial/cadastral vigente. Categoria ativa da T13 é obrigatória. Publicar sem foto principal retorna 422. Despublicar continua disponível após pausa da loja e dispensa confirmação de senha recente.

O catálogo público real aparece em `/produtos`, com busca e seleção de categoria existentes, e na vitrine `/produtores/:slug`. Mostra descrição, embalagem, peso, unidade, validade, conservação e preço. Apenas produtos publicados, de categoria ativa e loja elegível, entram na resposta. Revalidação a cada 30 segundos enquanto visível e ao recuperar foco. Não contém ações de compra, estoque, frete ou checkout.

## Banco, segurança e compatibilidade

- Migration canônica `20261004202124_trilha14_products_and_pricing.sql`, criada pelo Supabase CLI 2.117.0 e aplicada em `xipbsazvymkqqfmfegwu` como versão física `20261004210207`. Alias físico/canônico validado no histórico completo.
- Novas tabelas: `app_products`, `app_price_versions`, `app_product_media`; índices de loja, categoria, preço vigente e mídia principal única; novas funções somente no schema privado `hvm_product_private`.
- RLS ENABLE + FORCE nas três tabelas. `anon`/`authenticated` recebem somente SELECT sob policies; o titular pode ler seus rascunhos. A coluna privada `created_by_user_id` não é concedida a esses papéis nem exposta pelo contrato público. Nenhuma mutação direta pelo navegador.
- `service_role` recebe SELECT/INSERT nos preços, sem UPDATE/DELETE. Trigger bloqueia alteração/remoção direta de versões, inclusive pelo proprietário do banco. Exceção delimitada: cascata de exclusão operacional do produto/conta, quando o produto já deixou de existir.
- **Adequação ao Livro-Raiz:** a FK nova `app_products.store_id` usa ON DELETE CASCADE. O RESTRICT do exemplo bloquearia a exclusão operacional de conta v46 já homologada, pois loja/perfil/pessoa são removidos em cascata. O teste de exclusão real de `auth.users` confirma remoção do catálogo e enfileiramento de fotos. Exclusão de imóvel conserva produto/preços e oculta a vitrine, conforme governança anterior. Não foi modificado nenhum trigger anterior de exclusão.
- Criação, edição, preço, fotos e publicação exigem identidade real de produtor no backend, proteção de origem e revisão corrente. Escritas críticas usam a prova de autenticação recente existente. Confirmação de senha acontece na própria tela, preservando campos e retomando o mesmo comando.
- `expectedRevision` + lock transacional do produto rejeitam concorrência com 409. O formulário é preservado; recarregar é uma ação explícita. `commandId`, fingerprint e auditoria transacional impedem duplicação e replays com payload diferente; a autorização é revalidada também em replay.
- Eventos `product.created`, `product.updated`, `product.price_changed`, `product.published`, `product.unpublished`, `product.media_added`, `product.primary_media_changed` e `product.media_removed` reutilizam `app_audit_events`, seus snapshots redigidos e campos existentes.
- Bucket **privado** `product-media`: máximo 2 MB/foto, até seis fotos/produto, JPEG/PNG/WebP com assinatura binária compatível. Upload e URLs assinadas de 900 segundos somente pelo backend. Nenhum bucket público, Storage policy de escrita ou nova dependência. URLs ficam restritas ao projeto canônico, já permitido pela CSP existente.
- Foto removida/exclusão de conta entra na fila de limpeza Storage da T12. Rollback depois de upload enfileira somente objeto sem referência persistida. Nova tentativa usa caminho físico distinto, e replay de comando concluído não reenviará arquivo.
- Integridade de publicação também é validada por triggers diferidos: produto publicado requer preço e foto principal; troca da foto acontece atomicamente.

Nenhuma migration antiga, serviço de T01–T13, função/policy/trigger anterior, dependência, configuração Vercel ou fluxo de autenticação foi reescrito. Integrações limitam-se à montagem das rotas, navegação/catálogo e metadados de schema/histórico. Testes anteriores receberam ajustes de fixture: contagem pelo manifesto, compatibilidade da T13 com a tabela real de produtos, consulta vazia da vitrine T12 e as duas expectativas de placeholder da shell agora verificam a API de catálogo da T14. O teste de slogan seleciona o header móvel visível, sem mudança de interface.

## API

Prefixos existentes preservados: `/v1`, `/api/v1` e `/_hvm_api/v1`.

| Método | Rota relativa | Comportamento |
| --- | --- | --- |
| GET | /products | Público; filtros categoryId/storeSlug/search |
| GET | /producer/products | Catálogo próprio e elegibilidade |
| GET | /producer/products/:id | Produto próprio |
| POST | /producer/products | Criação + primeiro preço + auditoria |
| PATCH | /producer/products/:id | Informações, sem mudar preço |
| POST | /producer/products/:id/price | Nova versão de preço |
| POST | /producer/products/:id/publish | Publicar/despublicar |
| POST | /producer/products/:id/media/upload | Binário; revisão/commandId na query |
| POST | /producer/products/:id/media/primary | Troca atômica da foto principal |
| POST | /producer/products/:id/media/remove | Remove foto e enfileira limpeza |

Contratos estritos em `shared/contracts/product.ts`: pesos 1–50000 g, validade positiva, centavos inteiros positivos dentro de INTEGER, enums oficiais e identidade exclusivamente dos middlewares existentes. Nenhum payload aceita titular/loja/papel imposto pelo cliente. Não existe endpoint público de preço de rascunho ou DELETE de produto.

## Validação

- 56 testes de contratos, fronteira HTTP e montagem real: validações, centavos, papel, sessão, CSRF, revisão, limites binários e transportes.
- 18 testes PostgreSQL 17.6 com as 54 migrations: imutabilidade, rollback, auditoria, RLS, grants, titularidade, confiança, categoria, mídia, concorrência, replay, revogação e compatibilidade de exclusão. Também exercitam nova tentativa após rollback de upload sem reutilizar o caminho enfileirado.
- 22 testes PostgreSQL T12 e 20 T13 passaram com o schema novo.
- História completa com React compilado, Chromium, HTTP, middlewares e PostgreSQL reais: cria, muda preço conservando a linha anterior, rejeita publicação sem foto, envia foto, publica, consulta anonimamente, despublica e confere auditoria. Somente Auth/Storage externos são adaptados localmente; a configuração pública vem do PostgreSQL local.
- 16 testes de navegador T14 aprovados: 320/390/768/1440 px, criação/edição/preço/upload/publicação, cinco estados, sessão antiga, conflito com edição preservada, bloqueio de loja e isolamento de visitante. Os 41 casos dedicados T12/T13 também passaram; um reset transitório de conexão foi aprovado em repetição isolada.
- Suíte geral: 527 passaram, zero falha, 92 explicitamente ignorados por requererem configuração. Typecheck integral, build, verificação de segredos/bundle e inicialização da API sem `require(ESM)` aprovados.

As suítes de banco recusam URLs fora de `127.0.0.1:55432/postgres`. Não foram criados usuários, lojas, produtos ou arquivos fictícios no Supabase canônico. Evidências em `TRILHA14_REGRESSAO.json` e no Livro-Raiz.

A comparação ampla Chromium executou 203 casos na base (150 sucessos/53 falhas) e 219 na entrega (163 sucessos/56 falhas). Todas as 16 adições T14 passaram. Das quatro diferenças iniciais, três eram esperas assíncronas e passaram em repetição isolada tanto na base quanto na entrega, sem alterar produção. A outra verificava o placeholder antigo, substituído pela consulta real da T14; duas expectativas da shell foram adaptadas e aprovadas, incluindo erro com retry e catálogo vazio independente de falha de configuração. **Nenhuma regressão nova ficou sem resolução; a suíte ampla continua com falhas anteriores e não representa homologação integral de T01–T13.**

```sh
npm run test:t14:unit
npm run typecheck
npm run build
npm run verify:t12:store:runtime
HVM_T14_LOCAL_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run test:t14:postgres
HVM_T14_LOCAL_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run test:t14:story
HVM_PORTABLE_CHROMIUM=1 npm run test:t14:e2e
```

## Conferência do Supabase canônico

Histórico remoto validado: schema 49, 54 migrations e hash acima. As 49 relações anteriores (48 tabelas app e `auth.users`) mantiveram contadores e hashes idênticos antes/depois da migration. As tabelas T14 estão vazias, com RLS habilitada/forçada; nenhuma tabela pública sem RLS. Bucket privado e grants de coluna/preço conferidos remotamente. Nenhum achado novo no advisor de segurança.

O advisor de desempenho aponta três novas ocorrências de [policies permissivas para leitura pública e do titular](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies), seguindo a separação já usada na T12. As condições são indexadas e a identidade é avaliada por subconsulta escalar. Índices novos ainda sem uso constam como INFO enquanto o catálogo está vazio; nenhuma FK nova ficou sem índice. Os achados anteriores permanecem registrados na base.

Supabase Free único e Vercel Hobby, funções Serverless `pdx1`, deploy exclusivamente pela `main`, sem novo serviço pago. Estoque/lotes/reservas T15 e trilhas posteriores permanecem fora desta entrega.

# MISSÃO DE ENGENHARIA — TRILHA 17

Vitrine Pública, Descoberta Regional e Busca com Ranking — plano T12–T25, Volume 3.

## 0. Base homologada e fontes

- Livro-Raiz canônico: [LIVRO_RAIZ_HORTIVITALMIX.md](../LIVRO_RAIZ_HORTIVITALMIX.md), base T16/Localização, schema lógico **51**, main **cec122479d123016d5ea581041e5c5ec3bd121b1**.
- PDF enviado **HortiVitalMix_Plano_Trilhas_T12-T25.pdf**, missão T17. O exemplo T19/T20 define o formato da missão; o escopo implementado é o da T17 do PDF.
- Repositório: **wesleialvessantos39/HortVitalMix@main**. Supabase único: **xipbsazvymkqqfmfegwu**. Infraestrutura existente gratuita e Vercel/main/pdx1 preservadas, sem novos serviços ou dependências.
- Implementação aditiva: reutiliza lojas T12, categorias T13, produtos/preços T14 e Haversine T16. Serviços, migrations e regras históricas de frete/estoque/autenticação permanecem intactos. Shell recebe apenas a integração da descoberta nas rotas `/` e `/produtores`.

## 1. Escopo entregue — schema lógico 52

### 1.1 Banco e governança

Migration criada pelo CLI: **20261005131647_trilha17_discovery_favorites.sql**. Aplicada com versão física **20261005134716**; alias registrado no validador do histórico. **58 migrations**, hash **adb81e6a4b6407916b5a0dc057e47f9e79d184a5d5faf426dfcd336d148f4531**.

- `app_favorites`: UUID, `person_id → app_people(id) ON DELETE CASCADE`, `target_type` store/product, `target_id`, timestamp e unicidade por pessoa/tipo/alvo.
- RLS **ENABLE + FORCE**. `authenticated` tem somente **SELECT** com `person_id = (SELECT public.current_person_id())`. Nenhum grant para anon/PUBLIC. `service_role` tem somente SELECT/INSERT/DELETE, sem UPDATE/TRUNCATE/REFERENCES/TRIGGER.
- A política usa a coluna real `app_people.id`; o exemplo do PDF menciona uma coluna `app_people.person_id` inexistente na base homologada.
- Extensão gratuita `pg_trgm` existente em **extensions** reutilizada. GIN em `app_products.title` e GIN parcial em nomes de lojas ativas. Índice por pessoa/data cobre paginação de favoritos e a FK é coberta pela unicidade.

### 1.2 Serviço/API

`server/services/DiscoveryService.ts`, contratos estritos `shared/contracts/discovery.ts` e `server/routes/discoveryRoutes.ts`, nos três prefixos históricos `/v1`, `/api/v1`, `/_hvm_api/v1`.

- `GET /discovery/stores`: nome da loja ou título de produto publicado via ILIKE parametrizado; metacaracteres são texto literal. Categoria ativa e município ativo opcionais. Coordenadas devem vir em par; sem posição, referência **Ariquemes -9.9133/-63.0408**, reutilizada do contrato T16.
- Gate público **hvm_store_private.store_is_visible** da T12 reutilizado: loja ativa, produtor verificado, confiança elegível, imóvel aprovado e governança vigente. Ranking por distância integral ascendente, confiança descendente e UUID para desempate determinístico. Vinte lojas por página; distância nula fica no fim.
- DTO público contém somente loja, slug, nome, imagem HTTPS, município/UF, distância e verificação; não expõe pessoa, imóvel, GPS da sede, contato ou documento.
- `GET /favorites`: sessão/pessoa titular resolvidas pelo middleware e revalidadas no banco, filtros estritos e paginação. Alvos ocultos/excluídos não aparecem.
- `POST /favorites/toggle`: origem protegida; identidade nunca vem do payload. Transação com **SET LOCAL ROLE service_role**, serialização por pessoa, unicidade e auditoria atômica. O alvo precisa estar público para adicionar; um favorito ocultado pode ser removido.
- Dois comandos distintos alternam adicionar/remover. Reenvio do mesmo `commandId` recupera o resultado da auditoria sem repetir a alternância; reutilização por outro ator/alvo é 409. O frontend mantém o comando quando a resposta é incerta e resolve essa incerteza após uma leitura autoritativa.
- A descoberta executa transação **READ ONLY**; não chama lazy sweep de estoque nem emite cotação/frete. O acesso à vitrine usa o fluxo T12/T14 já existente.

### 1.3 Interface responsiva

`src/pages/public/HomeDiscoveryPage.tsx` nas rotas `/` e `/produtores`: busca própria de produtores/alimentos, categoria, região selecionada no componente Localização existente e posição opcional solicitada somente após clique. Distâncias são identificadas como linha reta e a referência pode voltar a Ariquemes.

Cards com imagem real existente ou indicação de ausência/falha da foto, distância, selo e link **Ver Produtos → /produtores/:slug**. Coração acessível com estado `aria-pressed`, área de toque >=44px, proteção contra clique concorrente e recuperação de erros. Visitante é encaminhado a `/entrar/consumidor`; titular consulta/salva/remove seus favoritos. Carregamento, erro e catálogo vazio são estados distintos; nenhum nome/produto de demonstração entra no app publicado.

A busca global de produtos, navegação de categorias T13 e seletor único de Localização mobile/desktop permanecem nos fluxos existentes. A fixture local T14 ganhou somente coordenadas opcionais, mantendo os padrões anteriores, para cadastrar o GPS antes da homologação do imóvel; nenhum guard histórico foi desativado.

## 2. Fora de escopo

Carrinho/Monte seu HortiMix T18, cupons, pedidos, checkout/Pix e acompanhamento T19/T20; alteração de frete, estoque, verificação ou cadastros anteriores. Nenhuma entidade de domínio adicional além de favoritos foi criada.

## 3. Verificação

- **40** testes de contratos/HTTP/montagem T17.
- **18** testes em PostgreSQL real local: vazio, ranking/distância/desempate, localização/categoria, texto literal, gate T12, privacidade do DTO, favoritos store/product, retry/concorrência, rollback, RLS A/B, grants, exclusão e páginas contíguas.
- **2** histórias com React compilado/HTTP/PostgreSQL reais: banco vazio sem fixtures em 320/1440px e salvar/remover/recarregar/link T12 em 390/1440px, incluindo toque real. Somente dependências externas Auth/Storage são adaptadas no ambiente descartável local.
- **18** cenários de navegador T17 em 320/390/768/1440px, incluindo visitante, erro/recuperação, resposta perdida, filtros, posição e paginação. Dados sintéticos ficam exclusivamente nestes testes locais.
- Regressão: **113** testes PostgreSQL T12–T16 e **99** cenários de navegador T07/T12–T16 passaram. Suíte geral: **646 passaram**, **165 ignorados** por configuração de integração ausente na execução geral; suites reais T17 e regressão PostgreSQL executadas separadamente.
- Build, typecheck de produção, cold start ESM, manifesto, segurança e ausência de segredos no bundle aprovados. O build acrescenta os 40 testes T17 aos gates existentes.
- [TRILHA17_PRESERVACAO.json](TRILHA17_PRESERVACAO.json): **58 tabelas anteriores**, incluindo identidade/negócio, mantiveram contagens/hashes antes/depois da migration; `app_releases` é tratado separadamente como metadado da publicação. Nenhum dado real foi usado como fixture.
- Advisors: nenhum novo aviso de segurança. Três índices novos tiveram apenas INFO de [índice ainda não utilizado](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), esperado antes do tráfego nas novas consultas. Avisos históricos não foram alterados fora da missão.

## 4. Checklist de entrega

- [x] Migration, pg_trgm e índices GIN aplicados no projeto canônico.
- [x] RLS ENABLE/FORCE, SELECT titular e mutações exclusivas do backend.
- [x] Busca geodésica/textual, favoritos e retomada de comando operacionais.
- [x] Home/Produtores responsivos com link T12 e vazio honesto.
- [x] Schema 51 → 52, manifesto/hash e histórico físico sincronizados.
- [x] Regressão T01–T16 e dados anteriores preservados.
- [ ] Fechamento main/produção: SHA e deployment READY registrados após publicação.

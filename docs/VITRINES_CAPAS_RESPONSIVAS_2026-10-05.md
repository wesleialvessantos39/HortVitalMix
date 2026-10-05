# Imóveis responsivos, fotos e capas das vitrines

Base: `wesleialvessantos39/HortVitalMix@4651fdb09d70f559aa7bdb0328e9fe0a471aecd7`, T01–T17, schema 53. Referências: Livro-Raiz, plano T12–T25 e quatro imagens enviadas para as telas de imóveis. Extensão solicitada pelo usuário, sem iniciar T18.

## Comportamento entregue

- **Imóveis rurais**: guia, cartões, progresso e ações seguem as referências em desktop e celular. No passo Documentos, envio/listagem ficam lado a lado no desktop; documento e dados/correções usam duas colunas. No celular, leitura e edição ficam empilhadas, com campos compactos e ações acessíveis. CSS restrito a essas telas; ações, validações e sincronização de correções anteriores preservadas.
- **Fotos dos produtos**: foto principal inicia o carrossel; outras fotos continuam em ordem. Slides automáticos a cada seis segundos, anterior/próximo, pausa, teclado e gesto horizontal. Reprodução pausa fora da tela, em aba oculta, sob foco/ponteiro e com preferência de movimento reduzido.
- **Fotos mais rápidas**: imagens visíveis priorizadas, próxima foto pré-carregada, assinatura privada reutilizada por até dez minutos e chamadas simultâneas agrupadas. Somente assinaturas de imagens entram no cache; publicação, aprovação, preço e disponibilidade continuam consultados. Vitrine carrega loja e produtos em paralelo.
- **Destaque regional na home**: produto, preço/unidade, nome e foto pública do produtor, loja e município. Clique abre a loja correspondente. Região escolhida filtra produtos; todas as regiões alternam por município ativo com `row_number()`, sem lista fixa de cidades. Paginação de 30 itens percorre o catálogo e retorna ao início; atualização em 30 segundos e ao voltar à aba. Sem produtos, estado vazio honesto. Mesmo destaque visível no desktop e celular.
- **Busca da home**: removidas a busca do quadro principal e a repetição no cabeçalho móvel da home; permanece “Buscar produtores ou alimentos”. Busca de outras páginas preservada.
- **Minha loja → Fotos e capa**: foto do produtor, nome público opcional, até seis fotos de capa e escolha entre fotos enviadas, produtos publicados ou ambos. Prévia responsiva; envio, substituição do avatar, remoção de capa, revisão e reautenticação integradas. Mudanças na capa preservam a apresentação ainda não salva. O nome civil do cadastro não é exposto automaticamente; sem nome público escolhido, usa-se o nome da loja.
- **Otimização de envio**: JPEG/PNG/WebP de até 15 MB preparados no navegador, até 1600 pixels no maior lado e 2 MB após preparação. WebP usado quando reduz peso; orientação/proporção preservadas. Alternativa por Image/FileReader para navegadores com limitação de ImageBitmap, compatível com a CSP existente. Retry usa a mesma imagem preparada e comando.

Não há garantia de carregamento instantâneo em qualquer conexão. Primeira visita depende da rede; pré-carregamento, redução de peso e reutilização de URLs evitam trabalho repetido.

## Banco, segurança e preservação

- Migration CLI `20261005191237_storefront_media_carousels.sql`, física `20261005194858`, aplicada exclusivamente em `xipbsazvymkqqfmfegwu`.
- Schema **54**, **60 migrations**, hash **f698b258308af10af2e1d193c908372660262167ef5c648f34e0e81742d847e3**. Manifesto, constante e alias físico sincronizados.
- Acrescenta `cover_mode` e `public_producer_name` à loja e `app_store_media`. Nenhuma migration anterior alterada; nenhum dado cadastral ou evidência documental migrado/removido.
- `app_store_media` com RLS ENABLE/FORCE, authenticated somente SELECT do titular, sem acesso anon; mutações por backend. Bucket privado `store-media`, até 2 MB, somente JPEG/PNG/WebP. Publicação segue o gate T12 existente.
- Comandos serializados por loja, revisão otimista, fingerprint dos bytes e auditoria existente. Retries não duplicam upload. Conta ativa, papel produtor vigente e titularidade conferidos antes de replay. Remoção/substituição agenda exclusão na fila existente; falha após upload agenda somente arquivo sem referência.
- Contratos antigos HTTP de loja permanecem sem os campos novos; `?media=1` opta pelo contrato estendido. Sem novas dependências, serviços pagos, transformação de imagens paga ou alterações na configuração main/pdx1/Hobby.
- Comparação de contagens e digests de **61 relações existentes** antes/depois confirmou preservação integral. Bucket novo separado da comparação dos buckets anteriores. [Evidência sem dados pessoais](evidence/storefront-media-preservation-2026-10-05.json).
- Advisors Supabase não encontraram problema novo em `app_store_media`; avisos anteriores permanecem fora do escopo: tabelas internas sem policies de cliente, helpers SECURITY DEFINER de RLS e proteção contra senhas vazadas. Referências: [RLS interno](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [helpers](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Verificações

- Suíte geral: **662 testes aprovados**, 191 casos externos/PostgreSQL sem configuração deliberadamente omitidos; estes não são contados como aprovação.
- **73 testes com PostgreSQL real**: T12 22, T14 18, T17 18 e fotos/destaques 15, executados em banco local descartável. Incluem alternância/seleção/paginação, localidade futura, aprovação/publicação atuais, privacidade, modos da capa, upload concorrente, conflitos, limite, MIME, avatar, exclusão, rollback, RLS e preservação.
- **10 testes novos de assinatura e guardas HTTP**: agrupamento, concorrência, renovação/falha, Auth, portal, CSRF, autenticação recente, body raw, parâmetros e compatibilidade.
- **103 cenários distintos de navegador aprovados**: T08 28, documentos 7, T12 17, T14 16, T17 17 e fotos/slides 18. Larguras 320/390/768/1440; T08 também confere seis etapas em oito larguras. Repetições focalizadas não somadas. O teste histórico do estado de carregamento usa liberação explícita da resposta, evitando depender de um intervalo de 500 ms.
- História nova com React compilado → HTTP real → PostgreSQL → loja pública → home regional, **1 caso aprovado**, com CSP de produção. Auth/Storage externos simulados exclusivamente localmente; APIs, contratos, transações e autorização reais. Confere foto, capa, nome, preço, persistência após recarga e abertura da loja correta.
- Typecheck, build completo com gates existentes, manifesto/hash, segurança, bundle sem segredos e cold start da API aprovados. Inspeção visual dos layouts, controles e ausência de overflow feita em navegador. Nenhuma fixture/conta/documento/foto/mensagem de teste criada em produção.

Publicação funcional e conferência da SHA/main/READY serão registradas após integração. A release corrente avança somente após READY.

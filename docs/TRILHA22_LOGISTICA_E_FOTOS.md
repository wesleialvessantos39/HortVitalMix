# Trilha 22 — logística e carregamento de fotos

Base: `main@73b3a2755062fdd8b8e9a09a09282d7fb2768a2f`, schema **59**, 65 migrations. Fonte: PDF **HortiVitalMix — Plano T12–T25**, Trilha 22, Volume 4. Implementação aditiva no repositório `wesleialvessantos39/HortVitalMix`, Supabase único **xipbsazvymkqqfmfegwu**. As 65 migrations homologadas permanecem byte a byte iguais.

## Logística

Schema lógico **60**, **66 migrations**, hash **f51d324f8310a1b60e19fd59e93dfc12605bf4dabc2cfb4f9b1d8183c0434096**. Uma migration adicional `20261007023213_trilha22_delivery_logistics.sql`, versão física **20261007025750** reconciliada por alias, três tabelas: `app_delivery_windows`, `app_delivery_allocations` e `app_delivery_proofs`. Todas têm RLS ENABLE/FORCE. Authenticated recebe somente SELECT sob policies: janelas do produtor titular, alocações dos envolvidos e **provas somente do comprador titular**. O backend retorna ao produtor apenas a existência da prova, sem revelar seus dados pessoais na consulta. Clientes não têm mutações nem EXECUTE dos helpers privados.

Janelas semanais têm início/fim, capacidade positiva (15 por padrão), pausa e revisão otimista. A capacidade é contada por data. Uma linha da janela é bloqueada com `FOR UPDATE` antes de contar e inserir; `COUNT(*) FOR UPDATE` do exemplo do manual seria SQL inválido. Trigger também impõe o limite às inserções privilegiadas. Reduzir capacidade abaixo das reservas ou mudar dia/horário com alocações futuras falha. Pausar não desfaz a promessa já reservada.

Alocar exige produtor ativo e titular, pedido online da loja em `ready_for_dispatch`, revisão atual, janela ativa, data não passada e dia da semana correspondente. Sair para entrega exige alocação. Registrar prova exige `out_for_delivery`, nome de 2 a 128 caracteres, notas até 500 e coordenadas opcionais em par dentro dos limites geográficos. Documento opcional recebe **somente três dígitos**, armazenados mascarados. Coordenadas são incluídas apenas pelo botão explícito do usuário; não há GPS contínuo.

Prova e transição T21 para `delivered` compartilham o mesmo `PoolClient` e transação. Chaves de comando externas e da transição interna são distintas e determinísticas: replay retorna a resposta anterior sem duplicar prova/evento/auditoria. Falhar depois do INSERT reverte tudo. Trigger impede entregar sem prova, e constraint diferida impede confirmar uma prova sem a etapa entregue. Provas e alocações são imutáveis.

A referência da alocação à janela usa `SET NULL`, com snapshot imutável de horário/fuso. Isso conserva a exclusão homologada de loja/conta, que `RESTRICT` bloquearia, e mantém a informação do comprador após a exclusão. A autoria da prova também admite apenas desvinculação por FK. Nenhum fato histórico T21 é reescrito nem provas antigas são inventadas.

O estado comercial, confirmação de recebimento/carência, caixa, reservas, devolução de estoque e reembolsos T20 permanecem separados da entrega física T21/T22. Registrar entrega **não libera repasse nem confirma pagamento**. Gateway real T20 segue inativo. T23/T24 não foram iniciadas.

## Telas e contratos

- `/produtor/loja/janelas`: grade semanal, criação/edição/pausa e ocupação por data; janela cheia aparece como lotada.
- `/produtor/pedidos`: agendamento de pedidos prontos e modal de prova obrigatório; opções sem vaga e confirmação sem nome ficam desabilitadas.
- `/pedidos/:id`: janela reservada e prova do comprador, junto da timeline e snapshots anteriores.
- GET/POST `/v1/producer/delivery-windows`, PATCH `/:id`; POST `/v1/producer/orders/:id/delivery-allocation` e `/delivery-proof`; GET `/v1/orders/:id/delivery`. Prefixos de transporte existentes preservados.

Schemas Zod estritos em `shared/contracts/deliveryLogistics.ts`. Sessão, produtor revalidado no domínio, origem protegida, `X-Command-Id`, optimistic revision e `private, no-store` em todas as APIs privadas. Retry incerto conserva a chave de comando na tela; conflitos pedem nova leitura.

## Fotos

O problema incluía o indicador opaco cobrindo o carrossel até `onLoad`, mesmo quando uma imagem já estava pronta, além de baixar originais de 1.000–1.195 pixels para áreas menores. A capa também esperava toda a consulta de produtos antes de aparecer.

O novo endpoint público `/v1/public-media/:kind/:id?width=320|640|1280` gera WebP com Sharp **0.35.5**, rotação EXIF e remoção de metadados, respeitando a resolução necessária. Só serve fotos de produtos publicados/categoria ativa/loja elegível ou mídias públicas de loja elegível; confere isso em SQL em cada acesso à origem. Não aceita URL arbitrária nem documentos privados. Os buckets permanecem privados, objetos originais e contratos de URLs assinadas não são modificados. Fotos particulares/legadas mantêm fallback autorizado.

URLs das variantes são estáveis por arquivo imutável, sem renovar tokens. Cache de navegador/CDN por cinco minutos, ETag e cache em memória limitado a 24 MiB. Dados/preços/sessões nunca entram nesse cache. A rota vem antes da sessão para evitar cookies de renovação no cache público. Duas conversões simultâneas e limite de pixels controlam memória/CPU do plano gratuito. Não há serviço pago, upload de derivadas nem consumo permanente adicional de Storage. Retirada de publicação pode levar até cinco minutos para refletir em uma cópia já cacheada, menor que o prazo anterior de assinatura de 15 minutos; na origem é imediata.

Pré-carregamento usa as mesmas variantes/tamanhos da tela, duas próximas fotos do carrossel e até 16 MiB de imagens decodificadas. Imagem `complete` com dimensões válidas é reconhecida antes da pintura. O aviso agora ocupa uma pequena área, sem encobrir a foto inteira. Capa/retrato aparecem assim que a loja responde; produtos seguem carregando independentemente.

Medição inicial em produção: 390 px, fotos visíveis entre **419–738 ms após montagem** (primeira abertura), originais de 1.000×1.000 e 1.195×896. Primeira foto da home em 3.419 ms desde navegação; esse total inclui APIs e não mede somente a foto. Tempos variam com rede/cache/catálogo. Nenhuma garantia de 1 ms de download é tecnicamente declarada. Medição final de produção será registrada após o deploy.

## Validação

Banco descartável PostgreSQL 17 com replay integral. **11 cenários T22** passaram: última vaga concorrente, capacidade rígida, revisão, idempotência, loja/dia/data inválidos, prova obrigatória, nome/coordenadas, rollback atômico, imutabilidade e RLS. **3 cenários de mídia** passaram com SQL real e compressor real: redução/resolução, reuso, ocultação com cache em memória e bloqueio de IDs/buckets indevidos.

**19 cenários T21** permanecem aprovados, inclusive finanças, estoque, erasure e estados terminais. Fixtures das duas verificações que entregam pedidos foram enriquecidas com os novos fatos obrigatórios; assertions anteriores conservadas. História completa de navegador compilado → HTTP → PostgreSQL → comprador verifica criação, reserva, prova, histórico, lotação e responsividade em **320/390/768/1440 px**, conservando recebimento financeiro e cancelamento anteriores.

TypeScript global/produção, build, scanner de segredos, cold start sem require(ESM) e npm audit de dependências de produção aprovados; **zero advisories** com Sharp 0.35.5. Rodadas finais de regressão e publicação constam na evidência de entrega, sem confundir cenários condicionais não executados com testes aprovados.

Regressões finais: **797 testes gerais aprovados / 317 condicionais não executados**, **99 SQL anteriores** (18 cesta, 25 checkout, 22 comércio, 15 mídias, 19 pedidos), **14 SQL T22/mídias**, uma história completa. **79 casos distintos de interface anterior** aprovados entre rodadas. Um teste de renovação de assinatura passou após instalar o relógio antes da montagem, preservando todas as assertions; um timeout de apresentação passou isolado sem mudança. Build/TypeScript/segredos/cold start/apenas-dependências de produção sem advisories aprovados.

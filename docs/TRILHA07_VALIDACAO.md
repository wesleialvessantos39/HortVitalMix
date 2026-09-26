# Validação técnica — Endereços urbanos avançados

**Execução:** T07-20260925-01  
**Data-base:** 2026-09-25  
**Status:** implementação completa no branch `trilha07-v11`; banco canônico migrado e validado com transações reversíveis; deploy da aplicação ainda não realizado.  
**Governança financeira:** somente recursos gratuitos de GitHub, Vercel e Supabase.

## 1. Fonte e não regressão

A implementação foi feita como evolução aditiva do estado vivo registrado no Livro-Raiz. A tabela `app_user_addresses`, o fingerprint SHA-256 da entrega anterior, a eleição do primeiro padrão, o `ProfilePrivacyService`, o hub `/conta`, o ViaCEP, o evento de sincronização do shell e a segregação entre endereço pessoal e imóvel rural foram preservados. Não foram criados `app_properties`, `app_orders`, buckets, PostGIS, wizard rural ou qualquer artefato dos módulos seguintes.

## 2. Banco canônico

- Projeto único: `xipbsazvymkqqfmfegwu`.
- Schema lógico: **29**.
- Histórico: **30 migrations**.
- Migration lógica: `20260925153500_trilha07_address_geocoding.sql`.
- Versão física aplicada pelo Supabase: `20260925192227_trilha07_address_geocoding`.
- Hash canônico: `500a5d5ff51d5608c07768a8b63f681328b37d1f3c99a19dd7ab5c612851689a`.
- Colunas aditivas: latitude/longitude `NUMERIC(10,7)`, acurácia, instruções de entrega, ativo e último uso.
- Índice de padrão: único somente para `is_default=true AND is_active=true`.
- Índice logístico: pessoa + ativo + último uso DESC NULLS LAST + criação ASC.
- Limite físico: trigger bloqueia o 11º endereço ativo com SQLSTATE `23514`.
- RLS: ENABLE + FORCE; quatro policies explícitas; `authenticated` só possui SELECT e `anon` não possui leitura.
- Fingerprint/touch/revision anteriores permanecem ativos.

### Prova SQL real sem resíduos

Foi executada transação `BEGIN ... ROLLBACK` no banco canônico cobrindo:

1. primeiro endereço ativo tornado padrão;
2. fingerprint SHA-256 preservado com normalização de espaços/case;
3. tentativa de segundo padrão ativo bloqueada pelo índice único;
4. dez endereços ativos aceitos e o 11º rejeitado por `23514`;
5. ausência física de `public.app_orders` tratada como zero pedidos abertos;
6. hard-delete no estado atual, sem `app_orders`;
7. eleição do substituto por `created_at ASC, id ASC`;
8. RLS ativo/forçado e leitura autenticada do próprio titular;
9. confirmação posterior de **zero resíduos** dos dados de teste.

## 3. Backend e contratos

### Contratos

`shared/contracts/addressAdvanced.ts` contém schemas estritos para criação, edição, troca de padrão e exclusão. Latitude e longitude são validadas em par e dentro dos limites geográficos. Campos extras são rejeitados.

### Serviço transacional

`server/services/AddressManagementService.ts` é a autoridade das mutações de endereço. `ProfilePrivacyService` não duplica mais CRUD de endereços.

Garantias:
- `app_people FOR UPDATE` serializa mutações por pessoa;
- alvo do endereço é travado com `FOR UPDATE`;
- `commandId` é usado para replay idempotente;
- fingerprint físico continua protegendo duplicatas;
- conflitos de revisão retornam 409;
- limite físico retorna 422 com mensagem humana;
- auditoria append-only ocorre na mesma transação e guarda somente metadados, passando por `redactPII`;
- listagem pública da conta filtra `is_active=true`;
- ordenação: `last_used_at DESC NULLS LAST, created_at ASC, id ASC`;
- remoção usa a FSM futura somente se `public.app_orders` existir; no estado atual a relation não existe e o caminho é hard-delete;
- quando futuramente houver pedido aberto, os estados preparados são `pending`, `confirmed`, `in_harvest` e `in_route`, acionando soft-delete.

### Geocodificação gratuita e resiliente

`server/services/GeocodingHelper.ts`:
- usa ViaCEP assistivamente;
- consulta OpenStreetMap/Nominatim no backend;
- timeout total da tentativa de geocodificação Nominatim: 3 s;
- no máximo uma repetição;
- repetição é espaçada dentro do orçamento de 3 s;
- User-Agent identificável do HortiVitalMix;
- pin manual enviado pelo cliente prevalece sobre geocodificação automática;
- falha externa retorna latitude/longitude nulas e `none`, sem bloquear cadastro.

## 4. Rotas

Foram preservados os aliases same-origin `/v1`, `/api/v1` e `/_hvm_api/v1`. As cinco operações canônicas de endereço são:

- GET `/account/addresses`
- POST `/account/addresses`
- PATCH `/account/addresses/:id`
- PATCH `/account/addresses/:id/default`
- DELETE `/account/addresses/:id`

As quatro mutações passam por `originProtection` e pela prova recente HMAC `hvm_reauth` já homologada anteriormente.

## 5. Interface

A tela existente `/conta/enderecos` foi estendida, sem criar hub paralelo.

Entregue:
- rótulos rápidos Casa, Trabalho, Sítio Pessoal e Comercial;
- campo privado de instruções de entrega;
- cards desktop e bottom sheet mobile;
- mapa OSM sem chave/API paga;
- localização atual via Geolocation API, sempre mediante permissão do navegador;
- pin manual arrastável;
- badge Padrão com ícone + texto + cor;
- aviso de limite de 10;
- endereços inativos ausentes da listagem;
- estados loading, ready, empty, recoverable error e conflict;
- evento `hortivitalmix:default-address-changed` preservado para atualizar o cabeçalho “Entrega para”;
- copy do produtor permanece explicitamente separado de imóvel/coleta/produção.

O CSS reutiliza os tokens oficiais `#143D24`, `#1B4D2E`, `#2E7D32`, `#E8F5E9`, `#E65100` e Inter. Há regras dedicadas para 320, 360, 768, 1024 e 1440 px, além de alvos de interação mobile de 48 px.

## 6. Testes dedicados

Foram adicionados exatamente **25 casos**:

- 9 contratos/unidade;
- 6 geocodificação;
- 5 HTTP;
- 5 navegador/E2E.

Cobertura: Zod strict, CEP, lat/lng, notes, rótulos, limite 10, fingerprint, timeout/retry, pin manual, 5 CRUD, prova recente, 409, 422, FSM soft/hard, geolocalização, sincronização do shell, limite visual e os cinco breakpoints.

Scripts:
- `test:t07:unit`
- `test:t07:e2e`
- `verify:t07:evidence`
- `verify:t07:free`

O E2E reutiliza `@sparticuz/chromium` já presente no projeto, sem download/serviço pago adicional.

### Estado da execução dos gates

O banco e as provas SQL foram executados de fato. A checagem estrutural equivalente ao `verify:t07:evidence` também foi conferida sobre os arquivos do branch e passou integralmente: cinco operações, quatro policies, FORCE RLS, sem escopo T08, sem dependência paga, sem workflow automático, Vercel main-only e build leve.

O ambiente de execução desta sessão não possui acesso de rede do runtime local para clonar o repositório/instalar as dependências, e por regra do projeto GitHub Actions permanece desligado. Portanto, **não se registra como fato a execução local de Vitest/Playwright/typecheck nesta sessão**. O gate `verify:t07:free` fica pronto para execução no Google Studio/ambiente local antes do merge. Isso impede uma falsa homologação operacional.

## 7. Free tier / deploy

- Nenhum Google Maps Platform.
- Nenhum Mapbox/token.
- Nenhum Twilio/Resend.
- Nenhum PostGIS.
- Nenhuma branch Supabase.
- Nenhum preview Vercel.
- Nenhuma automação GitHub em `push` ou `pull_request`.
- `vercel.json` continua liberando deploy somente da `main`.
- Build Vercel continua leve; a suíte T07 não foi adicionada ao `buildCommand`.
- CSP foi ampliada apenas para imagens de `tile.openstreetmap.org`.

## 8. Armadilhas fechadas

1. Pedido aberto: branch soft-delete preparada sem criar `app_orders`.
2. Zero padrão: primeiro padrão e substituto transacionais.
3. Mais de dez ativos: trigger `23514`.
4. Geocodificação travando cadastro: falha degrada para nulo.
5. Lat/lng invertidos/inválidos: limites e par no Zod/DDL.
6. Race no padrão: lock em `app_people` + endereço.
7. Mistura com imóvel rural: nenhum artefato de propriedade rural criado.
8. Dois padrões ativos: UNIQUE parcial composto.
9. Inativo em listagem: filtro `is_active=true`.
10. Notes vazando: RLS + backend + auditoria sem conteúdo bruto.
11. Duplicata: `commandId` + fingerprint SHA-256.
12. Shell dessincronizada: evento de padrão dispara atualização do cabeçalho.

## 9. Critério para homologação operacional

A aplicação só deve ser chamada de operacionalmente homologada após:

1. executar `npm run verify:t07:free` em ambiente com dependências instaladas;
2. corrigir qualquer falha encontrada;
3. revisar o PR do branch `trilha07-v11`;
4. fazer merge em `main`;
5. somente então permitir o deploy automático da `main` no Vercel Hobby.


## 10. Promoção concluída

A implementação funcional foi promovida pelo PR #49 para a `main` no commit `c3a09bea41f25da224ae4941c572021fab2f9918`.

Evidência pós-merge:
- GitHub confirmou o PR como mergeado;
- a integração Vercel do commit retornou `success` / `Deployment has completed`;
- `public.app_releases` foi atualizado somente depois desse sucesso, com `schema_version=29`, hash canônico da T07 e release `trilha07-v1-c3a09be`;
- nenhum workflow GitHub automático foi disparado;
- nenhuma branch preview Vercel foi criada;
- nenhum recurso pago foi habilitado.

Este apêndice registra a promoção. O commit documental que o contém não modifica o runtime; se ele próprio disparar um novo deployment de `main`, a release canônica deve apontar para o SHA desse commit somente depois de o novo deployment obter `success`.


## 11. Correção final do build Hobby

O fechamento da promoção confirmou e corrigiu uma divergência entre documentação e configuração: `typecheck:app` ainda constava no `buildCommand` da Vercel. O build de produção foi reduzido ao conjunto leve previsto para Hobby:

`migrations:verify -> security:check -> vite build -> check-bundle`.

O typecheck integral continua em `verify:t07:free`, junto da suíte dedicada T07. Nenhuma suíte pesada é executada automaticamente na Vercel e nenhum gatilho automático de GitHub Actions foi ligado.


## 2026-09-26 — Correção da conta administrativa e validação técnica da T07

- Minha conta e privacidade passa a integrar os menus administrativos e os atalhos do painel, com ícones, estados ativos e adaptação mobile/desktop. Administrador e Super administrador acessam `/admin/conta` e suas subseções dentro do shell administrativo.
- O hub do consumidor não apresenta mais Gerenciar meus endereços nem o segundo atalho de endereço acima dos cartões.
- O backend resolve a pessoa vinculada ao usuário autenticado também por `app_admin_principals`, sem aceitar person_id do cliente. Auditoria mantém o id e o papel do ator autenticado. Consulta real confirmou o vínculo administrativo existente e RLS ENABLE/FORCE de pessoas e endereços.
- Confirmação de senha para exportação usa o login do próprio portal. Login administrativo emite prova de autenticação recente vinculada ao usuário e à sessão. Navegação administrativa não usa a sessão pública obsoleta em memória.
- Corrigida a espera das recargas após salvamento e cancelamento de consultas ao sair da seção. Dados da conta são remontados quando muda usuário/papel.
- Validação: typecheck integral, manifesto schema 29/hash canônico, segurança e build aprovados; 21 testes T07 de contratos/rotas, 30 T05, 22 T06 e 13 cenários Playwright aprovados (11 de fluxo/layout e 2 de reautenticação administrativa). Layout de endereços verificado em cinco larguras; conta administrativa em 360 e 1440 px para ambos os papéis. Captura mobile inspecionada.
- Os cenários Playwright usam respostas controladas; não comprovam gravação autenticada em produção. O Chromium foi executado por extração local do pacote existente, sem serviço pago. O verificador auxiliar agent-browser não iniciou seu daemon; a validação visual foi feita com Playwright.
- Sem migration, projeto pago, preview Vercel ou GitHub Actions automático. Publicação pela integração Git da main. O registro app_releases deve ser sincronizado com o SHA publicado somente depois de READY, seguido de health/ready/config.

**Estado:** verificações técnicas da T07 aprovadas. A selagem operacional integral continua pendente de cadastro, edição, padrão e exclusão com contas reais autenticadas de produtor e consumidor na versão publicada. Não declarar esses testes reais como realizados, nem iniciar T08 com base somente em deploy READY.

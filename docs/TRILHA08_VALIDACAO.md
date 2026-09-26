# Trilha 08 — Onboarding do Produtor Rural e Cadastro de Imóveis Rurais

Data de implementação: 2026-09-26  
Branch: `trilha08-v11`  
Base funcional: correções T07 preservadas  
Estado: **implementada no código e pronta para homologação no Work; migration não aplicada em produção e testes não declarados como executados nesta sessão**.

## 1. Fonte normativa

Implementação baseada no Manual Mestre Técnico v11, Volume 3, Módulo 08, com as decisões posteriores do proprietário e o hardening já consolidado no Livro Raiz.

A adaptação principal em relação ao exemplo textual do Manual é deliberada: campos pertencentes às etapas 2–4 ficam `NULL` enquanto o imóvel está em `draft`, em vez de receber valores artificiais como `0.1`. A submissão exige completude real.

## 2. Introspecção anterior à implementação

A consulta ao Supabase real confirmou:

- schema lógico vigente antes da T08: **29**;
- histórico vigente: **30 migrations**;
- `app_properties` inexistente antes desta implementação;
- `app_orders` inexistente;
- `app_producer_profiles.property_name` já existe e representa o campo “Nome de seu imóvel” do cadastro inicial;
- `app_people.user_id` liga a identidade autenticada à pessoa;
- `app_producer_profiles.person_id` liga a pessoa ao perfil produtor;
- T07 mantém `authenticated` somente com SELECT em endereços e mutações pelo backend.

### Coexistência de nomes

`app_producer_profiles.property_name` **não foi renomeado nem reutilizado**.

A T08 introduz `app_properties.property_name` como o nome específico de cada propriedade/chácara cadastrada no módulo rural. Os dois campos coexistem por terem finalidades diferentes.

## 3. Banco — schema lógico 30

Migration aditiva:

`supabase/migrations/20260926190000_trilha08_rural_properties.sql`

Novo manifesto:

- schema lógico: **30**;
- migrations no repositório: **31**;
- hash canônico: `2a8994804e8af48902a745860e9aa1307788c1baa6ab7ec9b4e2eba874edcf0c`.

O algoritmo usado para calcular o hash foi validado contra o hash canônico anterior da T07 (`500a5d5f...`) antes de registrar o novo valor.

### Tabelas

#### `app_properties`
Entidade produtiva ligada a `app_producer_profiles.id`, com:

- identificação e registro opcional;
- área total e cultivada;
- setor rural, linha vicinal, município e UF;
- ponto da sede limitado à faixa de Rondônia;
- orientações de acesso;
- fonte hídrica;
- irrigação;
- status;
- etapa atual do wizard;
- revisão otimista;
- timestamps.

Campos das etapas posteriores podem permanecer nulos somente durante o rascunho. O constraint de submissão impede estado não-draft incompleto.

#### `app_property_boundaries`
Armazena Polygon GeoJSON sem PostGIS, com tipos:

- `perimeter`;
- `cultivated_plot`;
- `legal_reserve`;
- `app_preservation`.

#### `app_rural_activities`
Armazena atividade principal, sistema produtivo e existência de instalação de lavagem. `legumes_picados` exige `has_washing_facility=true`.

### Índices

- `ix_app_properties_producer`;
- `ix_app_properties_location`;
- índices auxiliares de propriedade nas tabelas filhas.

### Dois triggers definidos para `app_properties`

A ambiguidade do Manual sobre “2 triggers” foi resolvida assim:

1. `trg_app_properties_revision`: incrementa `revision` e `updated_at`;
2. `trg_app_properties_status_guard`: aplica transições de estado e impede edição direta de imóvel já verificado.

Não foi criado trigger de dados fictícios nem integração prematura com pedidos.

## 4. RLS e privilégios

As três novas tabelas usam:

- `ENABLE ROW LEVEL SECURITY`;
- `FORCE ROW LEVEL SECURITY`;
- leitura do próprio produtor;
- leitura de Administrador/Super administrador;
- policies explícitas de INSERT/UPDATE/DELETE com `false` para `authenticated`;
- `authenticated` recebe somente SELECT;
- mutações ficam exclusivamente no backend.

Não foi usada a policy literal `FOR ALL TO authenticated` do exemplo antigo do Manual.

## 5. Contratos

Arquivo:

`shared/contracts/ruralProperty.ts`

Inclui:

- enums canônicos;
- `GeoJsonPolygonSchema`;
- validação de anel fechado;
- coordenadas do GeoJSON dentro de Rondônia;
- `Step1IdentificationSchema`;
- `Step2DimensionsSchema`;
- `Step3WaterSchema`;
- `Step4ActivitySchema`;
- `Step5ReviewSchema`;
- `SaveWizardStepSchema`;
- `SubmitPropertySchema`;
- views tipadas.

A revisão esperada foi adicionada ao contrato como hardening do projeto para impedir sobrescrita concorrente.

## 6. Serviço de domínio

Arquivo:

`server/services/RuralPropertyService.ts`

Implementado:

- resolução de produtor pela sessão `app_people -> app_producer_profiles`;
- erro `PRODUCER_PROFILE_REQUIRED`;
- ownership obrigatório em todas as consultas;
- advisory lock transacional por imóvel;
- revisão otimista;
- `commandId` idempotente;
- auditoria append-only com `redactPII`;
- etapa 1 cria rascunho sem preencher etapas futuras;
- etapa 2 salva áreas e GeoJSON;
- etapa 3 salva água/irrigação;
- etapa 4 salva atividade e lavagem;
- etapa 5 valida completude e muda `draft -> submitted`;
- bloqueio de edição direta de imóvel verificado;
- lista e detalhe escopados ao produtor;
- endpoint de submit idempotente adicional.

## 7. Rotas

Arquivo:

`server/routes/ruralPropertyRoutes.ts`

Rotas:

- `GET /v1/producer/properties`;
- `GET /v1/producer/properties/:id`;
- `POST /v1/producer/properties/wizard/save-step`;
- `POST /v1/producer/properties/:id/submit`.

Todas passam por sessão e contexto Produtor. `originProtection` é aplicado e as mutações exigem prova recente `hvm_reauth`.

Nenhuma rota aceita `producerId` enviado pelo cliente.

## 8. Frontend

Arquivo principal:

`src/pages/producer/ProducerPropertiesPage.tsx`

Rotas de interface:

- `/produtor/propriedades`;
- `/produtor/propriedades/novo`;
- continuação de rascunho por `?id=<uuid>`.

Recursos:

- lista de propriedades;
- status visível;
- progresso 1–5;
- wizard em 5 etapas;
- autosave com debounce de 2 s para etapas 1–4 quando válidas;
- `localStorage` para resiliência offline;
- aviso de desconexão/reconexão;
- “Continuar mais tarde”;
- mapa OSM tátil sem chave paga;
- mapa rural inicia centralizado em Ariquemes;
- GeoJSON opcional no passo 2;
- validação de áreas;
- regra de lavagem para legumes picados;
- revisão final e compromisso;
- estados loading/ready/empty/recoverable-error/conflict;
- layout 320/360/768/1024/1440.

`OsmPinMap.tsx` foi generalizado com props opcionais de rótulo/centro sem alterar o comportamento padrão da T07.

`/conta/enderecos` continua sendo endereço pessoal. Produtor recebe um card separado “Imóveis rurais” na Minha conta.

## 9. Testes preparados

Total planejado: **32 casos**.

- 16 casos — `tests/unit/ruralPropertyContracts.test.ts`;
- 8 casos — `tests/integration/trilha08RuralPropertyRoutes.test.ts`;
- 8 casos — `tests/e2e/trilha08-rural-properties.spec.ts`.

Comandos:

- `npm run test:t08:unit`;
- `npm run test:t08:e2e`;
- `npm run verify:t08:evidence`;
- `npm run verify:t08:free`.

O gate completo inclui manifesto, typecheck, security check, 24 testes unit/integration, evidência estrutural, Vite/bundle e 8 testes de navegador.

## 10. O que NÃO foi executado nesta sessão

Por decisão do proprietário, fica para o ChatGPT Work:

- aplicar a migration T08 no Supabase real;
- reconciliar eventual timestamp físico gerado pelo Supabase;
- executar `npm run verify:t08:free`;
- inspecionar screenshots reais nos cinco breakpoints;
- homologar com conta Produtor real;
- promover PR/merge;
- aguardar deploy Vercel de `main`;
- atualizar `app_releases` somente depois do deploy READY do SHA exato.

Nenhum item acima é declarado como concluído antecipadamente.

## 11. Restrições preservadas

- nenhum Google Maps Platform;
- nenhum Mapbox;
- nenhum PostGIS;
- nenhum Twilio/Resend;
- nenhuma Supabase Branch paga;
- nenhuma preview Vercel;
- nenhum workflow automático em push/PR;
- `vercel.json` continua com build Hobby enxuto e deploy somente de `main`;
- T09+ não foi iniciada.

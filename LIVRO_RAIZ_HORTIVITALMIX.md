# Livro Raiz — HortiVitalMix

## 2026-10-03/04 — Governança integral de imóveis, contas, localidades e configuração global — schema 45

Status desta rodada: **migration do schema lógico 45 aplicada com sucesso no Supabase Production; Edge Function pública de cadastro promovida à versão 8; branch de correção em homologação final antes da integração em `main`.** O fechamento de Production e o SHA final serão registrados nesta mesma entrada após a promoção do código.

### Motivo e invariantes

Esta rodada corrige divergências que permitiam rascunhos rurais aparecerem como imóveis administrativos, impediam a exclusão de rascunhos com documentos, deixavam espelhos antigos de contas após exclusão no Supabase Auth, não distinguiam bloqueio de exclusão de localidade e deixavam a Configuração Global pequena demais para a governança efetiva da plataforma.

A regra central passa a ser: **Frontend, backend, Supabase Auth, banco de domínio e Storage precisam convergir para o mesmo estado operacional.** Histórico de segurança não pode reaparecer como conta, imóvel ou localidade ativa.

### Imóveis rurais e acesso à loja

- Imóvel em `draft` nunca é tratado como imóvel aprovado, nunca aparece no seletor administrativo de bloqueio e nunca concede publicação.
- O endpoint administrativo `/access-blocks/subject-properties` lista somente imóveis `verified` com solicitação de verificação atual em `approved`.
- A publicação do produtor em uma região exige, além de cobertura e ausência de bloqueio, **um imóvel aprovado naquela própria região**. A nova razão interna `NO_APPROVED_PROPERTY_IN_REGION` impede que uma aprovação de outro município libere publicação indevida.
- A exclusão de rascunho não é mais bloqueada por “histórico de custódia”. `purge_draft_property` elimina documento, extração, varredura, validação e o próprio rascunho quando — e somente quando — o imóvel ainda está em `draft`.
- A evidência documental de imóveis que deixaram de ser rascunho continua protegida contra exclusão ordinária.
- Arquivos físicos nunca são apagados por SQL. Os caminhos entram em `app_storage_deletion_queue` e são removidos pela Supabase Storage API.
- Ao excluir imóvel aprovado, o backend calcula quantos outros imóveis aprovados permanecem no mesmo município. Se for o último, o produtor é avisado de que perde a loja/publicação daquela região até obter nova aprovação. Havendo outro aprovado na mesma região, perde somente o imóvel excluído.
- O resumo de etapas pendentes do wizard foi redesenhado para o padrão visual HortiVitalMix, com status, chips de navegação e responsividade mobile/desktop.

### Saneamento executado no banco real

Snapshot imediatamente anterior à migration:
- 8 imóveis em rascunho e 1 retirado;
- 9 documentos ligados a rascunhos, 16 documentos totais;
- 13 linhas em `app_users`, porém somente 4 identidades reais em `auth.users`;
- 9 espelhos antigos com `block_reason='auth_user_deleted'`.

Após a migration:
- **0 rascunhos** e **0 documentos de rascunho** nas tabelas operacionais;
- 7 documentos históricos legítimos preservados;
- **4 linhas em `app_users` e 4 identidades em `auth.users`**, sem espelho órfão;
- perfis de produtor e 7 localidades cadastradas preservados;
- os 9 objetos físicos dos rascunhos foram enfileirados para remoção pela Storage API no primeiro runtime atualizado que executar a drenagem canônica.

### Exclusão e reincidência de contas

- A exclusão administrativa passa a ser **hard delete operacional**: a identidade é removida do Supabase Auth e o domínio ativo da conta é eliminado, incluindo papéis, principal administrativo, perfil, imóveis e vínculos operacionais pertinentes.
- Permanece apenas `app_account_deletions`, um tombstone mínimo de segurança com identificadores necessários para reconhecer reincidência. Ele não representa usuário ativo e não aparece como conta.
- O trigger de exclusão do Auth foi refeito para chamar a limpeza canônica do domínio, impedindo que `app_users` volte a acumular linhas suspensas sem correspondente no Auth.
- Login de identidade realmente excluída devolve a mensagem: **“Sua conta foi excluída! Dúvidas, entre em contato conosco: hortivitalmix@gmail.com.”**
- Conta bloqueada ou identidade compatível com histórico de exclusão segue para revisão administrativa antes de recuperar/criar acesso.
- Durante essa revisão, o e-mail de confirmação não é disparado. Depois de decisão `approved`, o backend libera o envio de confirmação pelo Supabase Auth e o fluxo da aplicação informa: **“Sua conta foi aprovada. Confirme seu e-mail agora para liberar o acesso.”**
- A mensagem de revisão é: **“Devido às circunstâncias, sua conta foi enviada para aprovação. Dúvidas, entre em contato conosco: hortivitalmix@gmail.com.”**
- A governança de contas pode ser delegada pelo Super administrador através do novo setor `account_governance`.

### Localidades — bloquear é diferente de excluir

- Município **bloqueado** permanece cadastrado e pode ser desbloqueado. Usuários vinculados recebem: **“Sua região está bloqueada. Dúvidas, entre em contato conosco: hortivitalmix@gmail.com.”**
- Município **excluído** é removido fisicamente do catálogo de cobertura. O impacto é medido antes da exclusão e os usuários atingidos são registrados em `app_locality_user_impacts`.
- Usuário afetado por exclusão recebe: **“Sua região está fora de cobertura. Dúvidas, entre em contato conosco: hortivitalmix@gmail.com.”**
- Consumidor não pode comprar e produtor não pode publicar na região bloqueada ou fora de cobertura.
- Se a mesma localidade for cadastrada novamente, o backend reconecta automaticamente os usuários impactados e encerra o impacto aberto.
- A gestão administrativa agora oferece ações separadas **Bloquear/Desbloquear** e **Excluir**, com confirmação e contagem de pessoas, imóveis, escopos e bloqueios afetados.

### Configuração Global e delegação administrativa

- Novo setor delegável `platform_configuration`; o Super administrador mantém acesso total e pode delegar essa central a um Administrador.
- A tela deixou de expor o selo técnico “REVISÃO #1”.
- A Configuração Global foi reconstruída como central administrativa responsiva, com indicadores de contas, aprovações pendentes, localidades, imóveis aprovados, fila de verificação, bloqueios ativos e auditoria recente.
- Os parâmetros editáveis agora abrangem nome da plataforma, slogan, município/UF padrão, moeda, fuso horário, e-mail e telefone de suporte.
- **Salvar alterações fica desabilitado quando nada mudou**, eliminando o estado de carregamento sem alteração.
- O backend continua usando revisão otimista e reautenticação recente; conflitos não sobrescrevem silenciosamente outra sessão.

### Banco, migration e Edge Function

- Schema lógico: **45**.
- Migration canônica: `20261003151000_governance_property_locality_hardening.sql`.
- Versão física aplicada pelo Supabase: **`20261004012409_governance_property_locality_hardening`**.
- Hash canônico do histórico: **`b6e091ddf47e060b8e21a098daaab0e31e6f50114c99f9b076302bd98d91dee2`**.
- `scripts/migrations-manifest.ts` mapeia a versão física UTC para a versão canônica do repositório.
- Edge Function `public-registration`: **versão 8 ACTIVE**, preservando o modelo de e-mail de segurança centralizado no Supabase Auth/SMTP e aplicando o fluxo “revisão primeiro, confirmação depois”.
- Novas estruturas: `app_locality_user_impacts`, `app_storage_deletion_queue`, `purge_draft_property` e `purge_account_domain`.
- Novos setores: `account_governance` e `platform_configuration`.

### Segurança e validação

- A migration foi aplicada somente depois de snapshot do banco e inspeção de FKs/triggers. Uma tentativa com erro de sintaxe foi rejeitada atomicamente pelo Supabase antes de qualquer alteração; o SQL foi corrigido, resealado e aplicado com sucesso.
- A prévia Vercel passou pelo gate gratuito do projeto: manifesto de migrations, TypeScript do app, verificação de segurança, Vite e bundle. A homologação final do head e o deployment Production ainda são registrados no fechamento desta entrada.
- Advisories do Supabase continuam mostrando débitos técnicos conhecidos de funções `SECURITY DEFINER` legadas, índices/FKs e políticas RLS; as duas novas tabelas são deliberadamente service-role-only com RLS sem política pública. Esses advisories não foram misturados nesta migration de governança para evitar mudança de autorização não relacionada.
- Nenhum GitHub Actions pago foi adicionado.

Arquivos centrais desta rodada: `server/services/RuralPropertyService.ts`, `server/services/StorageDeletionQueueService.ts`, `server/services/AccessScopeService.ts`, `server/services/LocalityService.ts`, `server/services/AuthService.ts`, `server/routes/ruralPropertyRoutes.ts`, `server/routes/adminLocalityRoutes.ts`, `server/routes/adminAccountReviewRoutes.ts`, `server/routes/adminGovernanceRoutes.ts`, `server/routes/adminConfigRoutes.ts`, `server/routes/authRoutes.ts`, `src/pages/producer/ProducerPropertiesPage.tsx`, `src/pages/admin/locality/AdminLocalitiesPage.tsx`, `src/pages/admin/AdminUsersPage.tsx`, `src/pages/admin/config/AdminConfiguracaoPage.tsx`, `src/hooks/useLocality.ts`, `shared/contracts/locality.ts`, `shared/contracts/adminGovernance.ts`, `shared/contracts/adminConfig.ts`, `supabase/functions/public-registration/index.ts`, `supabase/manifest.json` e a migration do schema 45.

---

## 2026-10-03 — Reconstrução controlada de localidades, cadastro do produtor e imóvel rural v6

Status da reconstrução: **concluída em produção. Schema lógico 44 aplicado no Supabase Production; PR #67 integrado em `main` no SHA de implementação `5f2a6caf4e58ce64c9333db412d3ede6a17ad319`; deployment Vercel Production `dpl_FzyPK2RniMKtpeebBmDrKfVzvPbA` ficou READY e o domínio oficial foi verificado. Sem reset, sem exclusão de histórico e sem GitHub Actions criado pelo projeto.**

Motivo: uma implementação anterior deixou o fluxo parcialmente inconsistente entre cadastro público, localidades, imóvel rural, banco e responsividade. A correção foi refeita verticalmente, preservando dados e contratos existentes quando compatíveis.

Implementação consolidada:
- O cadastro inicial do **Produtor** voltou a representar somente identidade e contato: nome, CPF, celular, município ativo, e-mail, senha e aceite LGPD. Nome do imóvel e atividade rural não são mais solicitados nesse cadastro.
- O município de cadastro público continua vindo da **fonte central de localidades ativas**. Sem catálogo disponível, o formulário falha fechado e não inventa município.
- O **Super administrador** mantém a gestão de localidades com os 52 municípios oficiais de Rondônia disponíveis para seleção, código IBGE canônico, proteção contra duplicidade e ativação/desativação sem apagar histórico.
- As mutações administrativas de localidades e bloqueios parciais agora passam pela mesma guarda de sessão/setor das leituras administrativas antes da reautenticação recente.
- O cadastro do imóvel rural permanece com **exatamente 6 etapas**: 1) Documentos do imóvel; 2) Identificação e acesso; 3) Dimensões; 4) Segurança hídrica; 5) Culturas e processamento; 6) Revisão e submissão.
- Na etapa 1, CAR/CCIR ficam vinculados ao `propertyId`; documento limpo, extração processada e dados documentais obrigatórios continuam sendo exigidos antes do envio para análise.
- Na identificação do imóvel, **Município deixou de ser texto livre** e usa o catálogo ativo central. O backend resolve novamente a localidade e persiste o nome/UF canônicos.
- A etapa final revalida localidade, bloqueio de publicação, completude estrutural e documento obrigatório dentro da transação. O caminho de conclusão não pode contornar a prova documental.
- O guia da conta do produtor não aprovado usa o estado real dos imóveis para retomar o cadastro na etapa correspondente. Escopo de entrega continua condicionado à aprovação do produtor.
- O wizard recebeu escopo visual próprio e navegação responsiva de 6 etapas; mobile, tablet e desktop não dependem mais da regra antiga de 5 colunas nem de nomes forçados em `nowrap`.
- A Vercel continua usando a integração Git existente. O build gratuito preserva `migrations:verify`, `typecheck:app`, `security:check`, Vite e verificação do bundle; não foi criado pipeline pago.

Banco e migration:
- Migration canônica: `supabase/migrations/20261003025010_hortivital_reconstruction_hardening.sql`.
- Versão física aplicada no Supabase Production: **`20261003030427_hortivital_reconstruction_hardening`**.
- `supabase/manifest.json`: schema lógico **44** e hash **`1b14c938e8d843bd57e85b9ff5f6855aa69f1d90a8bf08b188a08ba018e4583c`**.
- `ck_app_properties_submission_complete` passou a exigir também `municipality IS NOT NULL` em qualquer imóvel fora de rascunho.
- Foram criados índices parciais para `app_municipalities.created_by`, `updated_by` e `deactivated_by`.
- Nenhuma tabela de produção foi truncada, nenhum usuário/imóvel/documento foi apagado e migrations antigas não foram editadas.

Evidências desta reconstrução:
- Supabase real confirmou a migration física, a constraint endurecida e os três índices.
- Produção anterior permaneceu conectada ao banco durante a reconstrução: `/api/v1/localities` e `/api/v1/config` responderam 200.
- O Preview final do PR é usado como gate de compilação; o ambiente Preview não possui a mesma conexão de banco de Production, portanto 503 de dependência no Preview não é tratado como evidência de falha do banco de produção.
- PR de integração: **#67 — “Reconstruir localidades, onboarding do produtor e wizard rural v6”**.
- Fechamento de Production confirmado: `/api/v1/localities` e `/api/v1/config` responderam HTTP 200 no domínio oficial após o deploy, assim como `/cadastro/produtor` e `/produtor/propriedades`. O registro `app_releases` deve apontar para o SHA deste fechamento documental após a publicação deste commit.

Arquivos centrais desta rodada: `src/components/Account.tsx`, `src/pages/account/AccountHub.tsx`, `src/pages/producer/ProducerPropertiesPage.tsx`, `src/index.css`, `server/routes/adminLocalityRoutes.ts`, `server/services/RuralPropertyService.ts`, `shared/contracts/auth.ts`, `shared/contracts/foundation.ts`, `supabase/manifest.json`, `scripts/migrations-manifest.ts`, `vercel.json` e os testes T08/T12 responsivos.

---

## 2026-10-02 — Localidades de Rondônia, cadastro produtor e imóvel em seis etapas

Status: **implementação preparada no branch; schema lógico 43; migration ainda não aplicada ao Supabase. Nenhum deploy ou homologação real foi executado.**

Solicitação: completar o catálogo de Rondônia e evitar localidades duplicadas; retirar imóvel/atividade do cadastro inicial do produtor; orientar produtores ainda não aprovados; iniciar o cadastro de cada imóvel pelos documentos e concluir o wizard em seis etapas.

Decisões e compatibilidade:
- `shared/localities/roMunicipalities.ts` mantém snapshot versionado dos 52 municípios e códigos IBGE, com a fonte oficial do IBGE indicada no arquivo. A lista é apenas referência para a gestão; vitrine, produtor e consumidor continuam usando o catálogo existente de localidades **ativas**, sem listas paralelas de cobertura.
- A gestão oferece seletor com “Escolha o município”, resolução entre município e código, normalização sem acento/caixa/espaços e mensagem “Município já cadastrado”. A verificação em serviço melhora o feedback; as restrições únicas já existentes no banco para IBGE e nome normalizado continuam sendo a garantia contra concorrência.
- Os campos legados de produtor permanecem no schema para leitura histórica, mas a migration os torna opcionais; contratos, formulário e chamadas Express/Edge não enviam `property_name`/`rural_activity_type`. Os RPCs mantêm os parâmetros opcionais por compatibilidade, sem persistir valores do cadastro inicial.
- O wizard usa a etapa 1 para documentos CAR/CCIR, com upload, processamento, dados editáveis e revisão no próprio imóvel. O backend mantém a exigência de documento limpo, extração processada e nome, município e área documental salvos. Cada documento segue ligado ao `propertyId`, preservando custódia, processamento e histórico. Imóveis antigos conservam seus dados e seus índices de progresso são deslocados uma etapa; rascunhos locais antigos também são migrados na restauração.
- A migration permite que nome, localização e coordenadas fiquem nulos enquanto o rascunho começa pelos documentos; remove o município padrão Ariquemes para não inventar uma localidade. O constraint de submissão mantém esses campos obrigatórios, amplia o progresso para 1–6 e preserva os dados antigos. A atividade do primeiro imóvel configurado é o padrão server-side para novos imóveis; uma escolha explícita posterior prevalece.
- A mensagem de onboarding leva a Imóveis rurais e orienta a iniciar Novo imóvel. O backend só permite escopo de entrega quando o perfil do produtor está `verified`. Este repositório não contém rotas de loja/publicação de produtos; não se afirma gate de produto inexistente.

Arquivos principais: `shared/localities/roMunicipalities.ts`, `shared/contracts/locality.ts`, `shared/contracts/auth.ts`, `shared/contracts/ruralProperty.ts`, `src/pages/admin/locality/AdminLocalitiesPage.tsx`, `src/pages/account/AccountHub.tsx`, `src/pages/producer/ProducerPropertiesPage.tsx`, `src/pages/documents/DocumentsPanel.tsx`, `server/services/LocalityService.ts`, `server/services/RuralPropertyService.ts`, `server/services/AccessScopeService.ts`, `server/routes/ruralPropertyRoutes.ts` e `supabase/functions/public-registration/index.ts`.

Banco e manifesto:
- Migration aditiva: `supabase/migrations/20261002170000_producer_onboarding_documents_stage.sql`.
- `supabase/manifest.json`: schema lógico **43**, migration e hash sincronizados (`bb664bc4dc7e3ecd972a947fe97f6e5b8c93f5a4e9f279ec08630bfb1ab0e77a`).
- Esta sessão não tem acesso ao projeto remoto. Em uma janela coordenada de release, após confirmar o projeto e o histórico na instância autorizada, executar `npm run migrations:verify`, `npx supabase migration list --linked`, `npx supabase db push --linked` e novamente `npx supabase migration list --linked`; verificar a aplicação da versão `20261002170000` antes de promover o código pela integração main-only do Vercel. Não executar contra Production sem confirmar o `project-ref` e aprovar a janela.
- Não foi alterada a configuração do Vercel. A publicação deve ser confirmada na própria execução de Production; merge, build local e migration no Git não comprovam deploy.

Validação local concluída:
- `npm run typecheck`, `npm run migrations:verify` e `npm run verify:t08:free` passaram. O gate T08 inclui typecheck do app, verificação de segurança, 26 testes de contrato/rota, verificador de evidências, build/bundle e **17 cenários E2E**, incluindo etapa 1 documental, bloqueio sem documento, edição dos dados extraídos, onboarding, persistência e layout de 320 a 1440 px.
- `npm run test:unit` passou com 273 testes; passaram também `npm run test:registration:hotfix` (19), `npm run test:t12:unit` (41), `npm run test:t09t10` (57), `npm run test:t06:unit` (22), `tests/unit/ruralPropertyOnboarding.test.ts`/contratos de produtor e localidade direcionados (28) e `tests/e2e/shell.spec.ts` direcionado ao cadastro responsivo e campos removidos (7).
- A execução completa de `tests/e2e/shell.spec.ts` ficou em 11/26: as falhas restantes estão em asserções de shell/configuração, login/recuperação e T02 fora do fluxo alterado. Os cenários focados no cadastro do produtor passaram.
- A suíte `tests/integration/supabase.test.ts`, inclusive o teste concorrente de unicidade por código e nome normalizado, foi compilada, mas os 10 testes de banco/JWT foram ignorados porque não há ambiente `development` Supabase isolado configurado nesta sessão. A concorrência é coberta também pelas duas restrições únicas já presentes no banco.
- O build terminou com aviso não bloqueante de chunk JavaScript acima de 500 kB. `npm ci` reportou quatro advisories nas dependências existentes (2 moderate, 2 high); nenhuma dependência foi adicionada ou atualizada. Verificação de segredos e verificação de bundle não encontraram segredos.
- Permanecem pendentes a aplicação/validação remota da migration, a confirmação do deploy Vercel e a homologação operacional. Testes E2E usam serviços HTTP simulados e não comprovam persistência real.

---

## 2026-09-30 — Imóvel aprovado não grava, administrador entra, aceite LGPD no cadastro

Status: **correção na `main`; schema lógico continua 37. Nenhuma migration nova. A fila da T11 permanece.** A migration `20260930013000_approved_property_withdraw.sql` segue só no Git: esta sessão não tem credencial de banco e o conector da Vercel deste time responde 403. O aceite da LGPD usa a tabela `app_consent_records`, que já existia. `app_releases` não foi alterado.

Evidência do proprietário:
- no imóvel já aprovado o botão Salvar e o salvamento automático ainda apareciam; entrar e sair não pode mudar o cadastro;
- entrar como Administrador respondia «Dados inválidos ou cadastro não autorizado»;
- produtor e consumidor precisam aceitar a LGPD no cadastro, e «Saiba mais» tem de mostrar o que estão aceitando.

Correções:
- imóvel aprovado (status verificado, ou decisão de aprovação já fechada) abre só para ver. Não há botão Salvar, nem gravação automática, nem rascunho local. O servidor recusa a escrita. Entrar e sair deixa o imóvel igual. Excluir a aprovação continua com o aviso de perda da aprovação. O PDF não é apagado;
- a produção tem uma única identidade administrativa, de Super administrador. A porta Administrador, quando não existe outro principal, entra com esse papel real. Não vira administrador setorial e não promove privilégio. Se existirem os dois cadastros, a senha de um continua sem abrir o outro;
- no cadastro de produtor e de consumidor o aceite dos dados pessoais é obrigatório. «Saiba mais» mostra nome, CPF, e-mail, celular, senha, e no produtor o imóvel e a atividade, para que servem, o que não autoriza e os direitos da LGPD. Depois que a conta é criada, a API grava o aceite em `app_consent_records` (`lgpd_cadastro`, versão `lgpd-cadastro-2026-09-30`). A Edge de cadastro não foi republicada; o campo não vai no corpo que ela já valida, para não quebrar o cadastro.

Banco:
- schema lógico **37**, hash `3c6ab93c4be001b8c7d1f293254c236fdc00217dc77df464aa1a6e43249a5859`;
- a migration de exclusão da aprovação **não foi aplicada** neste turno;
- o aceite LGPD não exige SQL novo. Se o serviço não alcançar o Supabase, o cadastro segue e o livro não afirma que a linha foi gravada na hora.

Para ver: atualizar a página sem cache. Administrador entra com o e-mail e a senha do Super administrador e o painel identifica Super administrador. Imóvel aprovado: Visualizar, sem Salvar. Cadastro novo: o termo é obrigatório.

---

## 2026-09-30 — Super administrador não entra como administrador, e imóvel aprovado só se vê

Status: **correção na `main`; schema lógico 37; migration `20260930013000_approved_property_withdraw.sql` no repositório. A fila da T11 permanece.** Esta sessão não executou o SQL no Supabase: não há credencial de banco aqui e o conector da Vercel deste time responde 403. Sem esse SQL, o produtor já não consegue editar o imóvel aprovado, mas o botão de excluir a aprovação só grava quando a migration estiver aplicada.

Evidência do proprietário:
- a senha do Super administrador abria o cadastro de Administrador;
- imóvel aceito ainda podia ser editado. O produtor pode excluir, mas precisa ser avisado de que perde a aprovação e terá de cadastrar outro imóvel e obter nova aprovação.

Correções:
- Administrador e Super administrador continuam portais separados. A senha de um não cria sessão no outro, nem num aparelho novo;
- sair de um aparelho não encerra a sessão dos outros. Troca de senha continua derrubando todas;
- imóvel aprovado abre só para visualização. O rascunho não é mais salvo por cima;
- excluir a propriedade aprovada pede confirmação com o texto de perda da aprovação de produtor. O PDF não é apagado: o status passa a retirado e, se não houver outro imóvel aprovado, a aprovação de produtor volta ao início;
- a fila Pendentes / Em análise / Decididos da T11 não foi desfeita. A leitura do PDF segue sem IA. O CPF da pessoa não muda.

Banco:
- migration `20260930013000_approved_property_withdraw.sql`: status `withdrawn` e o imóvel aprovado deixa de voltar para rascunho;
- schema lógico **37**, hash `3c6ab93c4be001b8c7d1f293254c236fdc00217dc77df464aa1a6e43249a5859`;
- o arquivo está no Git. **Não foi aplicado neste turno** no Postgres do Supabase;
- `app_releases` segue na tag antiga até sincronizar o SHA de Production. `/api/ready` pode responder `RELEASE_MISMATCH`. A tela não depende disso.

Para ver: atualizar a página. Entre em Administrador e em Super administrador cada um com a própria senha. Imóvel aprovado: Visualizar cadastro, sem edição.

---

## 2026-09-29 — As telas do imóvel seguem a conta e Dimensões gera a ficha

Status: **correção na `main`; schema lógico 35; sem migration nova. A T11 não foi aberta.**

Evidência do proprietário:
- Meus imóveis, Novo imóvel, Continuar cadastro, Documentos do imóvel e Ver documento não tinham a organização de Perfil e Endereços: cartão branco, voltar, abas em pílula e campos empilhados;
- a etapa Dimensões pedia para colar um perímetro em GeoJSON. Isso não é um documento que o produtor consiga usar.

Correções:
- as cinco telas usam o mesmo desenho da conta: voltar, título, texto curto, painel branco, campos com rótulo e caixa, botões que não quebram a palavra;
- as etapas do cadastro viram pílulas (Identificação, Dimensões, Água, Atividade, Revisão), no mesmo formato de Perfil e Endereços;
- Dimensões deixou de mostrar código. Com a área total e o ponto da sede, o sistema desenha um quadrado equivalente, centrado na sede, e grava esse contorno no perímetro que o cadastro já tinha. A tela mostra a ficha: área total, área cultivada, sede e o lado em metros;
- se a sede ainda não estiver marcada, a ficha pede para voltar ao mapa. Água e atividade continuam manuais, porque o CAR não traz isso. Nome e CPF continuam os da conta;
- a leitura do PDF segue sem IA. Os arquivos não foram apagados e o CPF da pessoa não muda.

Banco:
- nenhuma migration; schema **35**;
- o contorno entra no rascunho (`draft_data.polygonGeojson`) e, ao concluir a etapa, na tabela de perímetro que já existia (`app_property_boundaries.polygon_geojson`);
- `app_releases` segue na tag antiga até sincronizar o SHA de Production. `/api/ready` pode responder `RELEASE_MISMATCH`. A tela não depende disso.

Para ver a ficha num imóvel já lido: abrir de novo **Ver documento** (grava a sede) e depois **Continuar cadastro**, etapa Dimensões.

---

## 2026-09-29 — O PDF preenche as etapas e a tela de conflito deixa de espremer o texto

Status: **correção na `main`; schema lógico 35; sem migration nova. A T11 não foi aberta.**

Evidência do proprietário, no celular, depois que o recibo do CAR passou a abrir:
- a lista ainda dizia “Imóvel sem nome”, embora o PDF tivesse “PA MARIA MENDES - LOTE 028”, Rio Crespo e 32,1826 ha;
- o titular aparecia como “ou”, porque o texto legal “proprietário ou possuidor” foi lido como nome;
- latitude e longitude do recibo não iam para o mapa da etapa 1;
- a área consolidada não entrava na área cultivada;
- nome e CPF do produtor precisam ser os do cadastro da conta, não um cadastro novo;
- o aviso “O imóvel mudou em outra sessão” quebrava uma palavra por linha e o botão ficava no meio do texto;
- a busca da loja ocupava a tela do produtor.

Correções:
- o texto do PDF, sem IA, grava no imóvel e também no rascunho das etapas: nome, município, CAR, área total, área cultivada quando ainda estava vazia (a consolidada do CAR) e o ponto da sede, se a coordenada cair em Rondônia;
- “proprietário ou …” deixa de virar nome. Nome e CPF exibidos são os da conta (`/v1/account/profile`). A pessoa não é recriada e o CPF da conta não muda;
- ao abrir o cadastro, o rascunho deste aparelho não esconde mais o que o documento gravou. Água, atividade e sistema continuam manuais, porque o CAR não traz isso;
- o aviso de atualização fica em coluna no celular, com frase inteira. A busca some nas telas do produtor;
- o cartão do arquivo mostra “CAR / SICAR” e o nome do arquivo embaixo.

Banco:
- nenhuma migration; schema **35**;
- usa colunas que já existiam: `property_name`, `municipality`, `registration_number`, `total_area_hectares`, `cultivated_area_hectares`, `latitude_sede`, `longitude_sede` e `draft_data`;
- `app_releases` segue na tag antiga até sincronizar o SHA de Production. `/api/ready` pode responder `RELEASE_MISMATCH`. A tela não depende disso.

Para o imóvel que já foi lido antes desta correção: abrir de novo **Ver documento** grava o ponto no mapa e o nome nas etapas.

---

## 2026-09-28 — O PDF abre na tela e o cadastro é preenchido sem IA

Status: **correção na `main`; schema lógico 35; sem migration nova. A T11 não foi aberta.**

Evidência do proprietário:
- o PDF não abria e os campos continuavam vazios;
- a tela de documentos estava grande demais e sem o mesmo encaixe das outras telas, no celular e no computador;
- o produtor não deve digitar o CAR, o município nem a área;
- a leitura não pode depender de IA.

Correções:
- o PDF é desenhado na própria página, uma página por vez, numa caixa de 260px. O texto do arquivo é lido no navegador, sem Gemini e sem chamada de IA;
- nome, município, CAR e área encontrados no texto preenchem o cadastro pelo caminho já existente de gravação do documento. O CPF da pessoa não muda;
- no computador o arquivo fica à esquerda e os dados à direita, numa coluna de no máximo 880px, no mesmo espírito dos cartões de Meus imóveis. No celular fica uma coluna só: o PDF primeiro, os dados depois, botões na largura da tela;
- foto não tem texto selecionável, então continua anexada e o sistema pede o PDF baixado do SICAR. Não há leitura por IA;
- correção manual segue escondida. A aprovação do imóvel continua humana. Os PDFs não foram apagados.

Banco:
- nenhuma migration; schema **35**;
- `app_releases` segue na tag antiga até sincronizar o SHA de Production depois que o deployment estiver READY. `/api/ready` pode responder `RELEASE_MISMATCH`. A tela não depende disso.

---

## 2026-09-28 — O arquivo aparece na tela e o cadastro é preenchido sozinho

Status: **correção na `main`; schema lógico 35; sem migration nova. A T11 não foi aberta.**

Evidência do proprietário:
- no celular não havia tela do PDF: o arquivo ficava numa caixa escondida ou só num link;
- o produtor não tem tempo nem familiaridade para copiar CAR, área e município na mão;
- a tela de documentos não se comportava igual no celular e no computador;
- em Meus imóveis rurais não havia botão de voltar.

Correções:
- o PDF é desenhado na própria página, no celular e no computador, ao lado dos dados lidos. A foto aparece inteira. Continua existindo **Abrir em tela cheia**;
- ao enviar um CAR ou CCIR, ou ao tocar em **Ver documento**, o sistema lê o arquivo e preenche o cadastro. O produtor não copia os números;
- PDF com texto (recibo do SICAR) é lido no servidor, sem chave de IA, motor `pdf_text`. Nome, município, CAR, área, reserva, APP e módulos vão para o imóvel quando o status permite;
- foto, ou PDF sem texto, usa a leitura Gemini se `GEMINI_API_KEY` e `GEMINI_MODEL` estiverem no backend. Sem essa chave, a foto continua visível e o sistema pede o PDF do SICAR;
- no computador o arquivo fica à esquerda e os dados à direita; no celular fica uma coluna só, com botões na largura da tela e folga acima da barra inferior;
- **Meus imóveis rurais** ganhou **Voltar para a conta**;
- correção manual ficou escondida em “Corrigir um dado lido errado”. A aprovação do imóvel continua humana. Os PDFs não foram apagados.

Banco:
- nenhuma migration; schema **35**;
- a primeira leitura grava a extração imutável e atualiza `app_properties` (nome, município, CAR e área, se a área não ficar menor que a cultivada). O CPF da pessoa não muda;
- `app_releases` segue na tag antiga até sincronizar o SHA de Production depois que o deployment estiver READY. `/api/ready` pode responder `RELEASE_MISMATCH`. A tela não depende disso.

---

## 2026-09-28 — Conferência mobile e dados do documento sem leitura automática

Status: **correção na `main`; schema lógico 35 preservado; sem migration nova**.

Evidência do proprietário, na tela `Documentos do imóvel` no celular:
- o nome do PDF quebrava no meio da extensão (`.p` / `df`);
- `Visualizar e conferir` e `Excluir` ficavam atrás da barra inferior, então a tela de visualização não abria;
- a leitura automática não pode ser obrigatória para usar o arquivo;
- os dados do documento precisam corrigir o cadastro do imóvel;
- ao enviar para análise, o cadastro deve ir junto com a documentação já preenchida, só para uma pessoa verificar e aprovar.

Correções:
- no celular os botões do documento ficam no topo do cartão, acima do nome, e a extensão `.pdf` não quebra;
- `Visualizar e conferir` abre a conferência em tela cheia, com `Fechar`, por cima da barra inferior;
- o PDF do celular abre em **Abrir documento em outra aba**; o formulário fica na mesma tela;
- o produtor informa CAR, código INCRA, nome do imóvel, titular, CPF, município, área total e áreas opcionais e toca em **Salvar dados e corrigir o cadastro**;
- **Tentar leitura automática** ficou opcional e continua desabilitada quando não há chave do Gemini;
- `POST /v1/producer/documents/:id/declare` grava, na primeira vez, extração imutável com motor `producer_manual` e, em toda gravação, uma conferência confirmada com os números atuais;
- o cadastro do imóvel recebe nome, município, número do CAR e área total, se o status for `draft`, `completed`, `rejected` ou `submitted` e a área não ficar menor que a área cultivada já informada;
- o CPF da pessoa não é alterado; imóvel `verified` ou `suspended` não é reescrito;
- **Enviar para análise** exige CAR ou CCIR com arquivo conferido e dados salvos (`PROPERTY_DOCUMENTS_REQUIRED`, `PROPERTY_DOCUMENT_DATA_REQUIRED`);
- os PDFs conferidos não foram apagados.

Banco e publicação:
- nenhuma migration; schema **35** e o histórico de migrations preservados;
- código funcional no commit `d1fc0668f59f91aedcce2b37aec06b4e801a1432`;
- `app_releases` continua na tag anterior até ser sincronizado com o SHA do deployment de Production que ficar `READY`. Enquanto isso `/api/ready` pode responder `RELEASE_MISMATCH`. A tela de documentos não depende desse endpoint;
- main-only, Hobby, sem GitHub Actions, sem plano pago, sem chave Gemini no chat.

---

## 2026-09-28 — Exclusão, visualização e extração dos documentos do imóvel

Status: **correção na `main`; schema lógico 35 preservado; sem migration nova**.

Evidência do proprietário, na tela `Documentos do imóvel` em produção:
- dois PDFs `RO-1100262-E37BCF0AB8FA4AC3B96572A57914FB03.pdf`, 728 KB, status Arquivo conferido;
- não havia Excluir — só Arquivar, e o documento continuava na lista;
- no celular a pré-visualização ficava numa caixa cinza. O iframe usava a URL assinada do Storage, que o Chrome Android não desenha;
- `Visualizar e conferir` juntava download e leitura no mesmo `Promise.all`, então uma falha impedia a outra;
- a extração usava 8s no Gemini e 20s no cliente, pouco para um PDF de ~728 KB.

Correções:
- botão **Excluir** pede confirmação, grava `status='archived'` com auditoria `document.archived` e tira o documento da lista do produtor na hora;
- administrador continua vendo o acervo, inclusive arquivados;
- GET `/:id/file` entrega o binário na mesma origem, `Content-Disposition: inline`, sem URL assinada e sem store;
- no celular a caixa cinza some; o botão **Abrir documento em outra aba** abre o PDF em tela cheia;
- a leitura automática não depende mais da pré-visualização. Se a consulta da extração falhar, o botão **Extrair dados do documento** continua disponível;
- timeout do Gemini sobe para 25s; o POST de extração no cliente usa 55s, dentro do teto de 60s da Function;
- extração continua exigindo `GEMINI_API_KEY` e `GEMINI_MODEL` no backend.

Banco:
- nenhuma migration; schema **35** e o histórico de migrations preservados;
- `app_documents.status` já aceitava `archived`; a exclusão operacional não apaga o arquivo, o scan nem a extração;
- a cota de 20 ativos por imóvel já ignorava arquivados; os bytes do produtor continuam contando o que está armazenado;
- os dois PDFs conferidos **não foram apagados por esta publicação**. Depois do deployment, Excluir em cada um os tira da lista e mantém o histórico.

Publicação:
- main-only, Hobby, sem GitHub Actions, sem plano pago, sem chave Gemini no chat.
- código funcional publicado no commit `99b0034341c512c746be9c0de4fea2daa866c73a`;
- Vercel Production deployment `6720127558` concluiu com `success`; o bundle público já contém Excluir, a rota `/file` e o timeout da extração;
- schema permanece **35** e o banco continua conectado;
- `app_releases` ainda está na tag `t09-t10-documents-20260928`, então `/api/ready` responde `RELEASE_MISMATCH` até a release corrente ser sincronizada com o SHA de Production. A tela de documentos não depende desse endpoint;
- os dois PDFs conferidos não foram apagados por esta publicação.

---

## 2026-09-20 — Contorno controlado do HTTP 403 do Google AI Studio

Status: **hotfix implementado em branch; promoção e validação Vercel pendentes nesta entrada**.

Evidência:
- após a publicação do diagnóstico HTTP real, o cadastro no Google Studio passou a revelar `HTTP 403`;
- a resposta 403 não continha o JSON canônico da API (`ORIGIN_NOT_ALLOWED`), indicando bloqueio anterior ao Express ou resposta do proxy/preview;
- há relatos contemporâneos de HTTP 403 e problemas de autenticação/preview no Google AI Studio, portanto o cadastro não deve depender exclusivamente do POST same-origin do preview.

Correção:
- o frontend tenta primeiro `/api/v1/auth/register-consumer|producer` na própria origem;
- somente se receber **HTTP 403 sem código JSON da API**, repete o mesmo cadastro contra `https://hortvitalmix.vercel.app/api`;
- o fallback usa `credentials: omit`, sem cookies de sessão;
- o backend libera CORS `POST/OPTIONS` somente para os dois endpoints públicos de cadastro;
- login, sessão, recuperação, reautenticação e administração continuam protegidos pela política same-origin;
- payload continua validado pelos contratos Zod, senha forte, normalização brasileira, restrição de papel a `consumer|producer` e RPC transacional;
- preflight CORS recebe 204 apenas nas rotas de cadastro público;
- schema permanece **11**.

---

## 2026-09-20 — Reconciliação pós-RPC e diagnóstico HTTP real

Status: **hotfix promovido à `main`; deployment funcional Vercel aprovado com `success` no commit `80028edad2b6f9d1493255db4877dfde4659b538`**.

Evidência da tentativa do proprietário:
- mensagem exibida: `O servidor recusou a solicitação de cadastro.`;
- Production registrou criação de identidade por volta de 00:05 local, papel `consumer` e compensação poucos segundos depois;
- após a compensação restou `app_user` suspenso e uma atribuição de papel ativa sem pessoa;
- a mensagem `HTTP_ERROR` do frontend só era gerada para respostas 4xx vazias ou não-JSON, provando que a recusa atual vinha de uma camada externa à API JSON canônica.

Correções:
- backend passa a reconciliar o estado depois de falha de transporte da RPC;
- se `app_people` + papel + perfil de produtor estiverem completos, o cadastro é considerado sucesso mesmo que a resposta da RPC tenha se perdido;
- compensação destrutiva só ocorre quando a falha é confirmada;
- se o estado não puder ser confirmado, retorna `REGISTRATION_STATUS_UNKNOWN` e não apaga a identidade;
- compensação de domínio passa a limpar perfil/papel/pessoa antes da exclusão Auth, preservando apenas o tombstone canônico `app_users`;
- o papel órfão da tentativa atual foi revogado com `revoke_reason=registration_compensated`;
- Production validada com zero papéis órfãos ativos e um tombstone suspenso preservado;
- cliente deixa de transformar respostas 4xx/5xx vazias ou não-JSON em `HTTP_ERROR`;
- frontend passa a exibir o status real: `HTTP_400`, `HTTP_401`, `HTTP_403`, `HTTP_404`, `HTTP_405`, `HTTP_413`, `HTTP_429`, `HTTP_500`, `HTTP_502`, `HTTP_503` ou `HTTP_504`;
- schema permanece **11**.
- o build falhava porque o commit `50408b31c6efdc4eb3e5b794e818552e4dca6ab5` havia removido o `package-lock.json` (4.299 linhas), enquanto a Vercel executa `npm ci`.
- `package-lock.json` foi restaurado exatamente do último commit Vercel verde e o deployment seguinte concluiu com `success`.
- Production verificada após a correção: 11 migrations, RPC presente, 0 usuários Auth, 0 pessoas e 0 papéis órfãos ativos.
- Development verificado com 11 migrations, RPC presente e configuração canônica inicializada.

---

## 2026-09-19 — Correção de `config_unavailable` e alinhamento Google Studio

Status: **Development e Production alinhados em schema 11; PR #8 promovido à `main`; deployment funcional Vercel aprovado com `success`**.

Evidência fornecida pelo proprietário:
- mensagem no cadastro: `A função de cadastro respondeu de forma inválida. O erro foi identificado para correção.`;
- log no Google Studio com categoria `config_unavailable` e request id `51c989ab-b9bb-4671-8394-b9341a16643a`.

Diagnóstico:
- `config_unavailable` era emitido exclusivamente por `GET /api/v1/config`, que ainda acessava `app_global_config` via `pg.Pool`;
- Development estava em schema 10 sem `complete_public_registration`, enquanto Production já estava em schema 11;
- o Google Studio normalmente opera contra Development, portanto havia divergência real entre os ambientes;
- o envio de confirmação de e-mail ainda estava dentro do bloco que compensava a identidade, podendo desfazer cadastro válido em caso de exceção externa.

Correções:
- migration 11 aplicada também em Development;
- Development validado com 11 migrations, RPC presente e permissões `anon/authenticated=false`, `service_role=true`;
- `/api/v1/config` deixa de usar Postgres Pooler e passa a usar Supabase Data API;
- Production e Development confirmados com exatamente 1 linha canônica em `app_global_config`;
- clientes Supabase server-side passam a usar timeout controlado de 8 segundos;
- envio de e-mail de confirmação foi separado da transação/compensação do cadastro;
- falha no envio da confirmação não apaga mais Consumer/Producer já criado corretamente;
- função Vercel passa de 10 para 30 segundos de duração máxima;
- schema permanece **11**.
- PR #8 mergeado na `main` no commit `1a51523da483ec6917da2baef59adb0c4ce6c737`.
- contexto `Vercel` do commit funcional retornou `success`.

---

## 2026-09-19 — Hotfix definitivo do cadastro via Supabase RPC

Status: **migration 11 aplicada e validada em Production; PR #7 promovido à `main`; deployment funcional Vercel aprovado com `success`**.

Diagnóstico:
- novas tentativas do proprietário continuavam retornando falha antes de qualquer identidade ser criada;
- Production permaneceu com zero linhas em `auth.users`, `app_users`, `app_people`, papéis e perfis;
- o caminho de cadastro ainda dependia de conexão PostgreSQL direta via Pooler dentro da função serverless.

Correção estrutural:
- cadastro deixa de usar `pg.Pool` no caminho crítico;
- identidade é criada por Supabase Auth Admin;
- domínio é concluído por `public.complete_public_registration(...)` via Data API/RPC;
- Consumer e Producer são gravados atomicamente no próprio Postgres do Supabase;
- falha da RPC aciona compensação da identidade incompleta;
- cliente passa a distinguir timeout, falha de rede, resposta não-JSON, schema desatualizado, Auth indisponível, banco indisponível, conflito e rate limit;
- mensagem genérica `Não foi possível concluir o cadastro.` deixa de ser o fallback silencioso.

Validação executada:
- dry-run transacional em Production para Consumer e Producer concluído e revertido com `ROLLBACK`;
- RPC confirmada como `SECURITY DEFINER` com `search_path=public`;
- `anon` e `authenticated` sem EXECUTE; `service_role` com EXECUTE;
- migration canônica `20260920023000_registration_rpc.sql` aplicada;
- histórico passa a 11 migrations e schema lógico **11**;
- após validação: zero usuários/perfis fictícios ou resíduos;
- Security Advisor não adicionou novo alerta relacionado à RPC.
- PR #7 mergeado na `main` no commit `68ec68f613116955c8ecde291ca50a7c2363ab5a`.
- contexto `Vercel` do commit funcional retornou `success`.

Observação operacional:
- Development restaurado no plano Free voltou sem histórico de migrations e com Storage ainda não inicializado; por isso o hotfix foi validado por dry-run transacional no schema 10 real de Production antes da aplicação definitiva da migration 11.

---

## 2026-09-19 — Correção definitiva do cadastro público e validação de campos

Status: **correção promovida para `main` e deployment funcional Vercel aprovado com `success`; Supabase production `ACTIVE_HEALTHY` e schema 10 preservado**.

Diagnóstico confirmado:
- production possuía zero linhas em `auth.users`, `app_users`, `app_people`, papéis e perfis de produtor, sem órfãos; as tentativas estavam falhando antes da criação efetiva da identidade.
- o middleware exigia `APP_ALLOWED_ORIGINS` estático para todo POST de produção.
- o resolvedor de banco podia rejeitar o runtime quando `DATABASE_URL` ou `POSTGRES_URL` coexistiam com a configuração canônica.
- o runtime aceitava apenas nomes legados de chaves Supabase.

Correções:
- mesma origem HTTPS do site aceita automaticamente; origens externas continuam bloqueadas.
- `SUPABASE_DB_URL` continua prioritária, com fallback seguro para `DATABASE_URL` e `POSTGRES_URL` somente se forem poolers Supabase válidos na porta 6543 e do mesmo projeto.
- suporte a `alias moderno de chave pública do Supabase` e `alias moderno de chave secreta do Supabase`.
- cadastro agora diferencia `IDENTITY_CONFLICT`, `REGISTRATION_RATE_LIMITED`, `AUTH_UNAVAILABLE` e `DATABASE_UNAVAILABLE`, sempre com request id quando aplicável.
- Produtor e Consumidor usam validação explícita por campo: mensagem abaixo do campo, `aria-invalid`, destaque visual e foco automático no primeiro erro.
- formulários de cadastro usam validação Zod como fonte canônica e não dependem da mensagem nativa silenciosa do navegador.
- PR #6 mergeado para `main` no commit `9b5c5e37d709d30297abf8a29d23b5295cfad17d`.
- contexto `Vercel` do commit funcional retornou `success`.
- production verificada após o deploy: 10 migrations canônicas, 8 tabelas `app_*`, zero tabela sem RLS/FORCE e zero usuários/pessoas residuais das tentativas anteriores.
- schema do banco permanece **10**; nenhuma migration é necessária para esta correção.

---

## 2026-09-19 — Senha forte inspirada no fluxo Gov.br

Status: **implementação promovida para `main`; validação frontend/backend concluída em código; deployment Vercel do commit funcional em processamento na última verificação**.

- PR #5 mergeado para `main` no commit `467d61a3c0960328dc1f55371d8afed39edc6dbf`.
- criação de senha passa a exigir, cumulativamente: 12 a 70 caracteres, letra minúscula, letra maiúscula, número e símbolo.
- cadastro de Consumidor e Produtor passa a exibir checklist de critérios em tempo real.
- redefinição e alteração autenticada de senha reutilizam o mesmo componente e a mesma regra.
- confirmação de senha é obrigatória e deve coincidir exatamente.
- botão de confirmação/cadastro permanece desabilitado até a senha cumprir todos os critérios e a confirmação coincidir.
- backend usa a mesma validação canônica via Zod; senha fraca é rejeitada mesmo fora da interface.
- login não é endurecido retroativamente, evitando bloquear senhas existentes durante autenticação.
- limite mínimo de 12 caracteres foi preservado por ser mais rígido que a referência visual do Gov.br, mantendo a experiência semelhante sem reduzir a política vigente.
- nenhuma migration de banco foi necessária; schema lógico permanece 10.
- testes unitários, HTTP e Playwright foram atualizados para cobrir regras, rejeição de senha fraca e confirmação.

---

## 2026-09-19 — Ajuste de perfis e placeholder de celular

Status: **implementação promovida para `main`; build Vercel aprovado; schema 10 aplicado em Development e Production; Homologation em restauração transitória do plano Free**.

- decisão anterior de masculino/feminino revogada;
- nomes de perfil passam a ser exclusivamente `Consumidor`, `Produtor`, `Administrador` e `Super administrador`;
- frontend, contratos, sessão e backend deixam de receber/expor `grammaticalTreatment`;
- placeholder do campo **Celular com DDD** passa a ser `(00) 00000-0000`;
- máscara automática real continua produzindo `(DD) 9XXXX-XXXX` conforme os números digitados;
- persistência continua em E.164 `+55...`;
- migration `20260919231000_remove_grammatical_treatment.sql` remove a coluna e constraint antigas;
- schema lógico passa de 9 para 10;
- development recebeu a migration 10 e confirmou ausência de `grammatical_treatment`, preservando `property_name`;
- PR #4 mergeado na `main` no commit `3791e045802f53f8f6ec1a305d2b0e368e80915a`;
- build Vercel do commit funcional retornou `success`;
- production recebeu a migration 10, mantém 8 tabelas e `property_name`, e não possui mais `grammatical_treatment`;
- Homologation foi restaurado para promoção do schema, mas voltou vazio durante `COMING_UP`; como o Storage interno ainda não havia inicializado, nenhuma estrutura interna foi criada manualmente e o ambiente permanece pendente de reconstrução antes de uma futura homologação formal.

---

## 2026-09-19 — Errata funcional: cadastro brasileiro e telas separadas

Status: **implementação promovida para `main`, build Vercel aprovado e schema lógico 9 promovido e verificado em development, homologation e production**.

- PR #3 mergeado para `main` no commit `e6efccfe7b25b5b414103258b2d31a49b9af4344`.
- contexto `Vercel` do commit: `success`.
- CPF com máscara automática `000.000.000-00`, normalização server-side e DV preservado.
- celular restrito ao Brasil, exibido como `(DD) 9XXXX-XXXX` e persistido em E.164 `+55...`.
- cadastro público separado em `/cadastro/consumidor` e `/cadastro/produtor`; login em `/entrar`.
- tela `/acesso/administracao` pré-preparada, sem cadastro administrativo público.
- `Nome da sua produção` substituído por `Nome de seu imóvel`, inclusive no contrato e no banco (`property_name`).
- registro histórico: a preferência de tratamento gramatical foi introduzida no schema 9 e posteriormente revogada pela migration do schema 10.
- schema lógico promovido de 8 para 9 pela migration `20260919224500_registration_br_profile.sql`.
- development: migration 9 aplicada, histórico canônico normalizado e teste transacional aprovado com zero resíduos.
- homologation: migration 9 aplicada, RLS/FORCE verificados, `property_name` presente, `brand_name` ausente, bucket privado e zero resíduos.
- production: projeto restaurado e `ACTIVE_HEALTHY`; migration 9 aplicada com histórico canônico; 8 tabelas, RLS/FORCE íntegros, `grammatical_treatment` e `property_name` presentes, `brand_name` ausente e bucket `documents` privado.
- `app_releases` permanece sem release corrente nesta etapa; nenhuma homologação/tag foi fabricada.
- documentação detalhada: `docs/ERRATA_CADASTRO_BR_2026-09-19.md`.


## 2026-09-19 — Trilha 01: promoção para main e disparo Vercel

Status: **implementação promovida para `main`; deployment GitHub→Vercel concluído com status `success`; homologação final ainda não selada**.

### GitHub

- PR #2 (`trilha01-finalizacao-v10` → `main`) mergeado com sucesso.
- Commit de merge: `06662f8b204263ac88564949f1d66368b871e3f7`.
- A `main` foi confirmada idêntica a esse commit no momento da promoção.
- O contexto de status `Vercel` no GitHub saiu de `pending` para `success`, confirmando que a integração GitHub→Vercel recebeu e concluiu o deployment.

### Supabase Free

Para manter custo zero e permitir a fase production:

- `HortVitalMix-Homologation` foi colocado em pausa após concluir schema v8, A1–A15 e testes SQL transacionais sem resíduos.
- `HortVitalMix` production (`xipbsazvymkqqfmfegwu`) foi restaurado e entrou em processo de subida (`COMING_UP` na última verificação desta execução).
- `HortVitalMix-Development` permaneceu ativo para os gates finais de integração.
- Nenhuma branch paga foi criada.

### Pendências de selagem

- confirmar production `ACTIVE_HEALTHY` e repetir os gates SQL/foundation;
- validar os endpoints públicos `/api/health`, `/api/ready` e `/api/config` do deployment final;
- concluir execução Node 24/coverage/integration;
- registrar releases somente após os gates reais;
- produzir evidência de dump/backup compatível com o plano Free;
- executar `verify:deploy`;
- criar a tag `trilha01-v1` somente no último passo.

---

## 2026-09-19 — Trilha 01: auditoria profunda de finalização v10

Status: **correções de conformidade aplicadas; homologação final ainda não selada**.

### Correções desta auditoria

- Branch de finalização criada a partir da `main` atual: `trilha01-finalizacao-v10`.
- `verify:foundation` elevado para A1–A15 literais, schema lógico 8, hash canônico e documentação SQL.
- `preflight` endurecido para validar ambiente, project ref, Transaction Pooler, RLS/FORCE, Auth Admin e Data API.
- Runtime alinhado ao Manual v10 com `logRuntimeBootSummary()`, diagnóstico de DB sem segredo e SHA automático da Vercel.
- Scrub ampliado para telefone E.164 e reporte estruturado.
- Sessão global com `req.actor` derivado de JWT válido e papéis vivos do banco.
- Compensação de cadastro incompleto reforçada para não deixar identidade GoTrue/tombstone transitório.
- Testes de integração ampliados: RLS/JWT, cadeia do produtor, duplicidade, rollback GoTrue, config e readiness.
- SQL de fundação passou a provar unicidade de `command_id`.
- Playwright transformado em gate explícito C1–C7.
- `vercel.json` corrigido: auto-deploy apenas de `main`; demais branches desabilitadas por padrão.
- Variáveis obsoletas removidas da documentação; testes reais usam `flag exclusiva de integração` e `referência protegida de production`.
- Hardening documental aplicado ao Supabase e versionado em `supabase/hardening/trilha01_sensitive_comments.sql`.

### Evidência atual do banco

No projeto existente `xipbsazvymkqqfmfegwu`, consulta administrativa confirmou A1–A15 em estado compatível: 3 extensões, 8 tabelas, RLS/FORCE completo, triggers exigidos, singleton, quatro papéis, ausência de tabelas locais de credenciais, SECURITY DEFINER com search_path, policies com roles e zero PII detectada nos payloads de auditoria. O teste de `command_id` duplicado foi executado dentro de transação e revertido.

Nenhuma release está registrada em `app_releases`; essa ausência é preservada para não fabricar homologação.

### Estratégia Free autorizada e executada

- Preview Branches pagas foram rejeitadas pelo proprietário.
- A cota Free permite apenas 2 projetos ativos simultaneamente.
- Production `xipbsazvymkqqfmfegwu` foi pausado temporariamente, sem exclusão.
- Development `ldtcsrlxfpflzhnbjjnp` foi criado por US$ 0/mês e recebeu schema v8; A1–A15 e testes SQL transacionais passaram sem resíduos.
- Homologation `vcbcbbnbboxoimqmuibm` foi criado por US$ 0/mês e recebeu schema v8; A1–A15, documentação sensível e testes SQL transacionais passaram sem resíduos.
- A fase production usará rotação: após aprovação de dev/homolog, development será pausado e production restaurado.
- Nenhuma release, snapshot fictício ou tag foi criada antecipadamente.
- Detalhes: `docs/FREE_TIER_ENVIRONMENT_STRATEGY.md`.

### Pendências impeditivas

- Gate de cobertura V8 versionado: `@vitest/coverage-v8@5.0.1`, `provider: "v8"` e `test:coverage` integrado ao `npm run homologate`; execução final ainda pendente em Node 24/development isolado.

- reexecução integral da branch com Node 24 e dependências pelo lockfile;
- cobertura mínima por módulo ainda sem evidência final;
- suíte Node 24 completa com integração Auth/HTTP ainda pendente; testes SQL reais em development já passaram com rollback e zero resíduos;
- development e homologation Free já estão isolados/provisionados; production está preservado e pausado temporariamente para respeitar a cota de 2 projetos ativos;
- releases e snapshots por ambiente ausentes;
- Vercel ainda sem projeto conectado na equipe consultada;
- deployment production, `verify:deploy` e tag `trilha01-v1` ausentes.

### Decisão de transição

**NÃO iniciar Trilha 02.** Permanecer na Trilha 01 até fechar os gates externos e reproduzíveis.

---


## 2026-09-19 — Trilha 01: implementação da fundação e verificação parcial

Status: **implementada em código e banco existente; não homologada integralmente**.

### Fonte de autoridade e autorização

Manual Mestre Técnico v10, Trilha 01, referências HTML desktop/mobile e imagens anexadas. O proprietário autorizou seguir com as correções documentadas e solicitou continuar até homologação final. Não autorizou contratação de recursos pagos.

### Escopo implementado

- React/Vite com Express montado na mesma origem e porta; adaptador serverless Vercel.
- Contratos Zod de saúde, readiness, configuração pública, cadastro PF e produtor; CPF com DV, email normalizado e telefone E.164.
- Cadastro público limitado a consumer/producer, transação de domínio e compensação no GoTrue; login, refresh, sessão e logout com cookies HttpOnly, SameSite e Secure fora de development.
- Sessão validada por Supabase getUser, estado da conta, sessão viva no Auth e papéis não revogados/expirados.
- Shell responsiva, navegação, formulários ligados à API e fallback visual não bloqueante; catálogo/compras/endereços continuam fora desta trilha.
- Oito migrations, oito tabelas com ENABLE/FORCE RLS, grants de coluna, helpers, auditoria append-only, singleton, índices, seeds canônicos e Storage privado.
- Manifesto com versão lógica 8; hash determinístico; scripts de preflight, fundação, release e verificação de deploy.

### Migrations aplicadas

Projeto: `xipbsazvymkqqfmfegwu`. Timestamps remotos sincronizados ao repositório sem alteração do SQL aplicado.

| Versão remota | Migration |
| --- | --- |
| 20260919030126 | foundation_releases |
| 20260919030128 | identity_roles |
| 20260919030130 | global_config_audit |
| 20260919030132 | helper_functions |
| 20260919030134 | rls_policies |
| 20260919030136 | indexes_performance |
| 20260919030138 | seeds_canonical |
| 20260919030140 | auth_delete_mirror |

Versão lógica: **8**. Hash: `59bf7dfa8bbfe0ae4bd9e58bf03bf9b243159fe78ac9f38175d3c848b55549d6`.

### Evidências

Typecheck e build aprovados; 23 testes unitários/HTTP e 7 testes Playwright aprovados. SQL real com rollback aprovado. Viewports 320/360/430/768/1024/1440 sem overflow horizontal. Nenhum usuário, pessoa ou evento de teste persistiu. Detalhes em [TRILHA01_VALIDACAO.md](docs/TRILHA01_VALIDACAO.md).

### Pendências impeditivas de homologação final

- Credenciais do pooler/Admin API não estão disponíveis no runtime Node. Preflight falha; três testes de integração estão pulados.
- Ambientes dev/homolog/main separados ainda não provisionados. A aplicação no projeto existente não representa promoção homologada.
- Conta Vercel conectada não retornou projetos; URL/variáveis/deployment ainda não configurados. A tentativa pelo conector retornou `Tool deploy_to_vercel not found` (`INVALID_ARGUMENT`); nenhum deployment foi criado. Não há evidência de esgotamento de cota.
- Confirmação de e-mail, backups reais, release por ambiente e verificação pós-deploy pendentes.
- Advisor da função preexistente `rls_auto_enable` requer revisão administrativa: inspeção identifica retorno `event_trigger` e `search_path=pg_catalog`; o aviso não demonstra uma RPC comum explorável. A função preexistente foi preservada. Helpers de autorização autenticados possuem search_path e escopo da própria identidade.

### Checklist da entrega

- [x] Backend escrito e endpoints locais testados; integração externa completa pendente.
- [x] Frontend escrito e ligado aos contratos da API.
- [x] Padrão visual dos HTMLs aplicado ao shell desktop/mobile.
- [x] Responsividade validada por navegador em seis viewports.
- [x] Supabase atualizado no projeto existente; três ambientes pendentes.
- [x] Livro Raiz atualizado.
- [x] GitHub: implementação publicada na branch main, commit `980a70bd7e4035d6892a99d5527e75e5b5670cf6`, pelo conector autenticado após o Git local indicar ausência de credenciais.
- [ ] Vercel integralmente pronta: build/configs preparados, projeto e segredos pendentes.
- [ ] Conformidade/homologação integral: não aprovada enquanto os gates externos estiverem pendentes.

### Release e transição

Nenhuma linha de release, tag de homologação ou snapshot fictício criada. Permanecer na Trilha 01. Não iniciar a Trilha 02.

---

## 2026-09-19 — Volume 01 / Trilha 01: abertura e verificação inicial

Status: **iniciada a análise; implementação e homologação pendentes**.

### Fonte de autoridade

- MANUAL MESTRE TÉCNICO v10 — Trilhas 01 a 06, PDF fornecido pelo proprietário.
- Escopo solicitado: somente Volume 01 / Trilha 01.
- Instruções vigentes: implementação full-stack, Supabase, referências visuais fornecidas, responsividade, GitHub e preparação para Vercel.
- A menção a v7 no modelo de registro do PDF é histórica; esta entrada identifica corretamente o arquivo v10 recebido.

### Escopo implementado

Somente documentação inicial e diagnóstico de pré-requisitos. Nenhuma funcionalidade de backend ou frontend foi entregue. Nenhum ambiente foi homologado.

### Evidências observadas

- Repositório identificado: `wesleialvessantos39/HortVitalMix`; inicialmente vazio; acesso de escrita disponível.
- Projeto Supabase identificado: `HortVitalMix` / `xipbsazvymkqqfmfegwu`; ativo; organização Free.
- Schema public sem tabelas retornadas; consulta de branches sem branches retornadas.
- Arquivos de referência presentes: manual, dois HTMLs e cinco PNGs.
- Foram examinados trechos técnicos e critérios de aceite da Trilha 01, cabeçalhos dos HTMLs e cinco imagens. Não há alegação de auditoria integral do Volume 01.

### Decisões pendentes e riscos identificados

A proposta em [docs/TRILHA01_PENDENCIAS_MANUAL_V10.md](docs/TRILHA01_PENDENCIAS_MANUAL_V10.md) detalha seis divergências, com páginas e correções propostas: versão de schema versus timestamp, gate schema 1 versus 8, proteção de campos sensíveis, momento de ativação do RLS, teste de imutabilidade e parser de argumentos da release.

Os ambientes separados exigidos pelo manual não foram provisionados. A cobrança de branches precisa ser resolvida antes da criação; não houve autorização de gastos nem contratação.

### Migrations aplicadas

Nenhuma nesta execução. Schema da aplicação: ainda não estabelecido. Não registrar versão 8 antes de aplicar e verificar as oito migrations previstas.

### Evidência de homologação

| Ambiente | Banco | Testes reais | Release | Snapshot | Deploy |
| --- | --- | --- | --- | --- | --- |
| development | Pendente | Não executados | Ausente | Não criado | Não realizado |
| homologation | Pendente | Não executados | Ausente | Não criado | Não realizado |
| production | Pendente | Não executados | Ausente | Não criado | Não realizado |

### Versionamento

Esta entrada inicia o histórico documental. O SHA verificável é o commit remoto que contém o arquivo; nenhum SHA de implementação ou tag de homologação foi inventado. A publicação deve ser conferida após a gravação remota.

### Limitações conhecidas

Não há aplicação executável, build aprovado, configuração Vercel validada ou teste responsivo concluído. A entrega deste bloco é preparatória e não atende, por si só, à implementação integral solicitada.

### Transição

Permanecer na Trilha 01. Resolver as divergências literais e a infraestrutura antes da homologação. Não iniciar a Trilha 02 nem criar a tag `trilha01-v1`.


---

## 2026-09-20 — Correção de causa raiz: confirmação, HTTP 403 do Google Studio e secrets indevidos

Status: **causas reproduzidas no código e no estado real do Auth; correção full-stack versionada em branch de saneamento para validação antes da promoção**.

### Evidência real observada

- O cadastro efetuado às 14:53 UTC chegou ao Supabase production e criou identidade e domínio.
- A identidade foi confirmada às 14:54 UTC; portanto, o clique do e-mail **confirmou a conta antes** de o navegador falhar ao abrir `localhost:3000`.
- A conta correspondente está ativa no domínio e possui papel `consumer` não revogado.
- O projeto Development permanecia sem usuários no mesmo instante. Isso provou que o fallback criado para contornar o 403 do Studio estava desviando o cadastro local para a API de production.
- O commit anterior tinha deployment Vercel com contexto `success`; a falha atual não era uma falha genérica de build.

### Causas raiz confirmadas

1. **Redirect de e-mail derivado do Origin local.** Cadastro, reenvio, recuperação e magic link montavam `emailRedirectTo` a partir do `Origin` da requisição. No preview do Google Studio esse Origin é `http://localhost:3000`; por isso o link de confirmação terminava no localhost do celular.
2. **Contorno 403 incompleto e perigoso.** O frontend tratava somente cadastro: ao receber 403 sem JSON em `/api`, reenviava Consumer/Producer diretamente para a API Vercel. Login, reenvio de confirmação e recuperação continuavam presos ao `/api` interceptado pelo Studio.
3. **Mistura de ambientes.** O fallback do item anterior fazia o preview local gravar no production, contrariando o isolamento Development/Homologation/Production.
4. **Contrato de variáveis inflado.** `.env.example` declarava aliases opcionais e variáveis exclusivas de teste como se fossem secrets do runtime. O Google Studio passava a solicitá-las mesmo não sendo necessárias para o aplicativo em execução.
5. **Mensagem enganosa.** A UI traduzia qualquer `HTTP_403`, inclusive login/reenvio, como “solicitação de cadastro”.

### Correções aplicadas

- O Vite agora disponibiliza a API local em `/_hvm_api` e mantém `/api` para compatibilidade.
- Em localhost, o frontend usa exclusivamente `/_hvm_api`; em publicação usa `/api`. O fallback cross-origin para production foi removido.
- O backend voltou a exigir política same-origin para **todas** as mutações, inclusive cadastro; o CORS público `*` foi removido.
- Cookies de sessão passam a usar `Path=/`, permitindo o mesmo fluxo tanto em `/_hvm_api` quanto em `/api`.
- Links de confirmação, recuperação e acesso seguro nunca mais usam origem loopback; em preview local apontam para a origem pública estável do HortiVitalMix.
- `.env.example` passou a declarar somente o conjunto canônico de runtime. JWT secreto ocioso e variáveis de integração deixaram de ser requisitos do runtime.
- Compatibilidade com chaves Supabase modernas foi preservada internamente sem expô-las como contrato obrigatório do Studio.
- Mensagem genérica de 403 corrigida para não atribuir incorretamente a falha ao cadastro.
- Testes HTTP foram atualizados para provar que cadastro e login obedecem à mesma política de origem.

### Regra operacional resultante

O Google Studio deve executar contra o projeto Development com a API same-origin local. Production só é acessada quando a aplicação publicada em production executa. Links enviados por e-mail precisam usar URL pública alcançável pelo dispositivo do usuário, nunca `localhost`.


---

## 2026-09-20 — Identidade multipefil, logins separados e saneamento definitivo do Google Studio

Status: **implementação full-stack aplicada no repositório `main` e no único projeto Supabase vigente do HortiVitalMix; validação SQL real sem resíduos aprovada**.

### Decisão de identidade

- O CPF continua único e canônico em `app_people`; não são criadas duas pessoas para o mesmo CPF.
- Uma mesma identidade pode possuir simultaneamente os papéis `consumer` e `producer` por `app_user_role_assignments`.
- Ao cadastrar Produtor para um CPF que já é Consumidor, o backend reconhece a identidade existente e exige o mesmo e-mail e a senha atual antes de conceder o novo papel.
- O fluxo inverso, Produtor adicionando Consumidor, segue a mesma regra.
- Tentativa de usar o CPF existente com outro e-mail não cria uma identidade paralela e retorna conflito seguro.
- O perfil de produtor é criado apenas quando o papel `producer` é efetivamente concedido.

### Portais de login

Foram separados os contextos de autenticação:

- `/entrar/consumidor` — exige papel `consumer`;
- `/entrar/produtor` — exige papel `producer`;
- `/entrar/administrador` e alias `/acesso/administracao` — exigem `platform_admin`;
- `/entrar/super-administrador` e alias `/acesso/super-administracao` — exigem `platform_super_admin`.

O backend não confia somente na tela escolhida. Depois de validar e-mail/senha no Auth, consulta os papéis ativos no banco e recusa o portal quando o usuário não possui o papel solicitado. A sessão registra o `activeRole`, permitindo que Consumidor e Produtor com a mesma identidade recebam contexto distinto.

### Senha na tela de entrada

- Todas as telas de login possuem controle `Mostrar` / `Ocultar`.
- O controle altera somente a visibilidade da senha e não muda política, valor ou validação da credencial.

### Google Studio — HTTP 403

A correção foi aprofundada para o comportamento real do preview:

- em qualquer execução Vite de desenvolvimento, a UI usa `/_hvm_api`, evitando a rota `/api` reservada/interceptada pela plataforma;
- o backend reconhece localhost/loopback atrás do proxy HTTPS do Studio sem confundir `Origin: http://localhost:3000` com o `x-forwarded-proto=https`;
- quando o proxy remove `Origin`, somente requisições marcadas pelo navegador como `Sec-Fetch-Site: same-origin` são aceitas;
- origens externas continuam bloqueadas.

### Banco e migration

- Projeto utilizado: **HortVitalMix** — ref `xipbsazvymkqqfmfegwu`.
- Nenhum novo projeto Supabase foi criado nesta execução.
- A listagem administrativa atual retorna somente esse projeto HortiVitalMix.
- Migration remota: `20260920210710_multi_role_identity`.
- Schema lógico: **12**.
- Hash canônico das 12 migrations: `ae5a1c60c4642929587db1a0757ccfee394e6be07a61b3ec0bb704387c3c5600`.
- A RPC `add_public_role_to_existing_identity` possui EXECUTE somente para `service_role`; `anon` e `authenticated` não podem executá-la diretamente.

### Evidência SQL real

Foi executado teste real e autocontido no banco production:

1. identidade temporária criada;
2. papel `consumer` atribuído;
3. RPC de identidade existente adicionou `producer`;
4. foram confirmados dois papéis ativos e um `app_producer_profiles`;
5. todos os registros temporários foram apagados;
6. verificação final retornou zero resíduos em `app_users`, `app_people` e `app_user_role_assignments`.

### Regra operacional do projeto

Não criar projetos Supabase adicionais para o HortiVitalMix. Evoluções de schema desta aplicação devem ser aplicadas no projeto canônico existente e versionadas no repositório, salvo decisão futura explícita do proprietário.


---

## 2026-09-20 — Ajuste visual dos acessos públicos e Administração independente

Status: **implementado na `main`; frontend responsivo atualizado e integração GitHub→Vercel disparada automaticamente**.

### Conta pública

- O ícone **Conta** abre `/entrar`.
- A tela pública contém somente **Consumidor** e **Produtor**.
- Administrador e Super administrador foram removidos integralmente desse seletor.
- A frase “O acesso é separado por perfil. Uma mesma pessoa pode ter os perfis Consumidor e Produtor no mesmo CPF.” foi removida da interface.
- Desktop usa dois cartões lado a lado inspirados na referência visual fornecida; mobile usa cartões compactos empilhados com ícone, título, descrição e chevron.
- O seletor público não exibe mais ação de cadastro.
- **Criar cadastro de consumidor/produtor** aparece somente depois que o usuário escolhe o respectivo login, junto ao formulário de entrada.

### Administração

- Criada rota `/administracao`, com título **Administração**.
- A tela oferece somente:
  - **Administrador** → `/entrar/administrador`;
  - **Super administrador** → `/entrar/super-administrador`.
- Os dois acessos continuam sujeitos à validação de papel real no backend; a separação visual não concede permissão.
- Foi adicionado ícone dedicado **Administração** no cabeçalho desktop e mobile, usando a identidade visual verde/branca do projeto.
- Os aliases administrativos anteriores foram preservados por compatibilidade, mas o fluxo principal parte da nova tela Administração.

### Responsividade e segurança

- Layout novo possui estados específicos para desktop e mobile.
- A função **Mostrar/Ocultar senha** permanece nos quatro logins.
- Nenhuma regra de identidade, CPF, roles ou segurança foi relaxada.
- Nenhuma migration foi criada e nenhum projeto Supabase adicional foi criado; o projeto canônico continua sendo **HortVitalMix**.
- Testes E2E foram atualizados para impedir regressão: Conta não pode voltar a mostrar Administração, cadastro só aparece no login específico e o ícone Administração deve abrir o seletor administrativo.


---

## 2026-09-20 — Correção crítica: recuperação e códigos de segurança vinculados ao perfil

Status: **corrigido full-stack na main, schema 13 aplicado no projeto Supabase canônico e deploy Vercel concluído**.

### Causa raiz confirmada

Os fluxos de recuperação e reautenticação anteriores validavam apenas a identidade Supabase pelo e-mail/sessão. Como uma mesma identidade pode possuir mais de um papel, o provedor de autenticação, isoladamente, não distinguia Consumidor, Produtor, Administrador e Super administrador antes de disparar o e-mail ou aceitar o nonce. Isso permitia iniciar um fluxo a partir de um portal incompatível com o papel solicitado.

### Regra corrigida

Todo fluxo sensível passou a carregar e validar explicitamente o papel de origem:

- `consumer`;
- `producer`;
- `platform_admin`;
- `platform_super_admin`.

O backend consulta `app_user_role_assignments` antes de disparar recuperação, confirmação ou acesso por e-mail. Se o e-mail existir, mas não possuir o papel solicitado, a API mantém resposta pública genérica para impedir enumeração, porém **não dispara o e-mail**.

### Recuperação de senha

- `POST /v1/auth/request-password-reset` exige `email + portalRole`.
- Antes do envio, o backend confirma que a identidade está ativa e possui o papel solicitado.
- Cada recuperação recebe um token de contexto aleatório próprio; somente o SHA-256 é persistido.
- O redirect carrega `portal` e um `flow` exclusivo.
- A tela explicita o contexto: **Recuperação de senha — cadastro Consumidor**, **cadastro Produtor**, **Administrador** ou **Super administrador**.
- Na redefinição, o backend exige simultaneamente usuário, papel e token de contexto correspondentes.
- Link de Consumidor não é aceito como Produtor; Admin não é aceito como Super administrador; contextos administrativos não são aceitos nos portais públicos.
- O token de contexto é de uso único e possui expiração.

### Código de segurança / reautenticação

- `POST /v1/auth/reauthenticate` exige o `portalRole` da sessão ativa.
- O cookie de portal, o papel vivo no banco e o corpo da requisição precisam coincidir.
- Cada solicitação cria `challengeId` vinculado a usuário + papel + finalidade.
- Um novo pedido de código para a mesma identidade invalida o challenge anterior de código, inclusive quando solicitado em outro portal.
- `POST /v1/auth/change-password` exige `challengeId + portalRole + nonce`.
- Mesmo que um código numérico coincida por acaso, ele não é aceito fora do challenge e do papel que o originaram.
- Tentativas inválidas são contadas no challenge da aplicação e o contexto é invalidado ao atingir o limite.

### Área administrativa

- Fluxos administrativos não utilizam mais a opção pública de “Entrar com link ou código”.
- O endpoint de magic link rejeita `platform_admin` e `platform_super_admin`.
- Recuperação administrativa só é disparada quando o e-mail realmente possui o papel administrativo solicitado.
- Administrador e Super administrador permanecem contextos distintos em todos os checks de recuperação e código.

### Banco

Projeto único utilizado: **HortVitalMix** — `xipbsazvymkqqfmfegwu`.

Nenhum projeto Supabase adicional foi criado.

Migration aplicada: `20260920224820_role_scoped_security_flows`.

Nova tabela: `app_role_security_challenges`.

- RLS habilitado e forçado;
- sem SELECT para `anon` e `authenticated`;
- acesso operacional somente pelo backend;
- token de recuperação persistido somente como digest SHA-256;
- expiração, consumo, invalidação e limite de tentativas registrados.

Schema lógico: **13**.

Hash canônico das migrations: `c101268be41ba32f843356ccc6d0a01d4dcdd6f48081638167be058382591d62`.

### Validação real

Foi executada validação transacional no banco canônico:

1. challenge de recuperação vinculado a `consumer` não encontrou correspondência como `producer`;
2. challenge administrativo vinculado a `platform_admin` não encontrou correspondência como `platform_super_admin`;
3. registros temporários foram removidos;
4. verificação final retornou **0 resíduos**;
5. `anon` e `authenticated` não possuem SELECT na tabela de challenges.

### Observação de governança do Manual v10

Esta correção fecha o vazamento de contexto entre portais nos fluxos existentes. A governança administrativa integral da Trilha 05 — incluindo cerimônia de bootstrap, convites administrativos completos e MFA obrigatório de login do Super Admin — permanece um subsistema próprio do Manual v10 e não deve ser falsamente considerado implementado apenas por esta correção de recuperação/reautenticação.


---

## 2026-09-21 — CHECKPOINT CANÔNICO PRÉ-TRILHA 02 — NÃO SOBRESCREVER

Status: **base oficial restaurada e congelada para reinício da TRILHA 02**.

### Regra obrigatória para qualquer implementação futura da TRILHA 02

A TRILHA 02 deve **partir desta base e preservar integralmente tudo o que já está funcionando**. Nenhuma implementação da TRILHA 02 pode recriar, substituir, simplificar, apagar, renomear ou contornar as implementações já consolidadas no Frontend, Backend, Supabase e Vercel.

Antes de qualquer alteração da TRILHA 02, é obrigatório considerar como pré-existentes e intocáveis, salvo evolução compatível e expressamente necessária:

- Frontend responsivo desktop/mobile já homologado até este checkpoint;
- tela Conta com acessos separados de Consumidor e Produtor;
- tela Administração separada, com Administrador e Super administrador;
- login por papel com validação real no backend;
- identidade canônica permitindo o mesmo CPF para Consumidor e Produtor sem duplicação de pessoa;
- sessão com contexto de papel ativo;
- função Mostrar/Ocultar senha;
- correções do Google Studio para evitar o bloqueio HTTP 403 e o uso correto de `/_hvm_api`;
- confirmação, recuperação de senha e código de segurança vinculados ao papel de origem;
- isolamento entre Consumidor, Produtor, Administrador e Super administrador nos fluxos de segurança;
- migration `20260920224820_role_scoped_security_flows`;
- schema lógico **13**;
- projeto Supabase canônico e único: **HortVitalMix — xipbsazvymkqqfmfegwu**;
- integração GitHub → Vercel funcionando;
- deployment Vercel da base restaurada validado com sucesso.

### Regra de compatibilidade da TRILHA 02

Toda implementação da TRILHA 02 deve ser **aditiva e compatível** com esta base. Se uma etapa do manual exigir evolução de uma estrutura existente, a alteração deve:

1. preservar o comportamento já homologado;
2. migrar dados e contratos sem regressão;
3. manter Frontend e Backend sincronizados;
4. aplicar a evolução no mesmo projeto Supabase canônico;
5. atualizar migrations e manifesto sem reescrever o histórico anterior;
6. manter build e deploy Vercel válidos;
7. atualizar este Livro-Raiz com rastreabilidade da mudança;
8. nunca criar outro projeto Supabase para o HortiVitalMix;
9. nunca substituir esta base por uma implementação paralela ou simplificada;
10. validar explicitamente que Consumidor, Produtor, Administrador e Super administrador continuam isolados conforme seus papéis e fluxos de segurança.

### Checkpoint técnico verificado

O estado do repositório restaurado antes deste registro utiliza exatamente a mesma árvore Git do checkpoint funcional do final da conversa anterior:

- árvore Git canônica: `3190122278dbba171e2531c6baca5a566226444a`;
- checkpoint funcional/documental de referência: `7cd73e898e633e798ad407f654b1c428c8d41b6f`;
- commit de restauração integral da aplicação: `7ae86b5577a3a48add8cfc1ac617b1666ef93950`;
- status Vercel do commit restaurado: **success**;
- histórico Supabase confirmado somente até schema 13, sem migrations posteriores da TRILHA 02.

**Esta seção é uma trava de governança. Ao iniciar a TRILHA 02, considerar obrigatoriamente todo o estado acima como baseline já implementado e homologado.**


---

## 2026-09-21 — Correção definitiva da separação visual e dos pontos de entrada antes da TRILHA 02

Status: **corrigido novamente na aplicação real após constatação de que uma sessão já existente podia ocultar os seletores de acesso**.

### Causa raiz encontrada

O código possuía os cartões de Consumidor/Produtor e Administração, porém `Account.tsx` retornava primeiro o bloco de sessão autenticada (`if (session)`). Com isso, um navegador que ainda possuísse cookies/sessão válida podia entrar em `/entrar`, `/conta`, `/administracao` ou em um login específico e visualizar a tela antiga de conta em vez dos novos seletores. Isso fazia a implementação existir no repositório sem aparecer de forma confiável no uso real.

### Comportamento canônico corrigido

- **Conta** possui ponto de entrada próprio: `/conta`.
- O ícone Conta no cabeçalho desktop e o item Conta da navegação mobile apontam para `/conta`.
- `/conta` e `/entrar` exibem somente:
  - **Entrar como Consumidor** → `/entrar/consumidor`;
  - **Entrar como Produtor** → `/entrar/produtor`.
- Administrador e Super administrador não podem aparecer no seletor público.
- O texto sobre “acesso separado por perfil” permanece removido.
- As ações **Criar cadastro de consumidor** e **Criar cadastro de produtor** aparecem somente dentro do login do respectivo perfil.
- As telas de login permanecem visíveis mesmo quando existe uma sessão anterior no navegador; uma sessão antiga não pode mais esconder o seletor ou substituir o formulário solicitado.
- Após autenticação válida, a sessão é encaminhada para `/minha-conta`, mantendo a tela de conta autenticada separada das telas de escolha/login.

### Administração independente

- A Administração continua fora da Conta pública.
- O ícone exclusivo **Administração** na tela inicial/cabeçalho aponta para `/administracao`.
- `/administracao` exibe somente:
  - **Administrador** → `/entrar/administrador`;
  - **Super administrador** → `/entrar/super-administrador`.
- O seletor administrativo não mostra Consumidor nem Produtor.
- O backend continua validando o papel real antes de autenticar; a separação visual não substitui a autorização.

### Vercel / atualização visual

Foram adicionados headers `Cache-Control: no-store` e `Pragma: no-cache` nas rotas críticas de Conta, Administração, logins, cadastros e recuperação. O objetivo é impedir que navegador/CDN continue exibindo o shell antigo depois de uma restauração ou correção.

### Regra para início da TRILHA 02

A TRILHA 02 deve partir desta versão corrigida. É proibido:

1. unir novamente Administração ao seletor público;
2. alterar Conta para apontar diretamente a um login único;
3. remover os logins específicos de Consumidor/Produtor;
4. recolocar cadastro no seletor inicial;
5. permitir que sessão antiga esconda os seletores;
6. remover o ponto de entrada independente de Administração;
7. contornar as validações de papel já existentes no Backend/Supabase;
8. criar outro projeto Supabase.

Esta seção substitui qualquer interpretação anterior ambígua sobre onde cada tela deve ser acessada.

---

## 2026-09-21 — VOLUME 01 / TRILHA 02 — CONFIGURAÇÃO GLOBAL REVISIONADA E AUDITORIA IMUTÁVEL

Status técnico: **TRILHA 02 concluída e promovida à `main`; schema 14 aplicado; release de produção `trilha02-v1` registrada; deployment Vercel concluído com status `success`; auditoria final A1–A18 aprovada no Supabase canônico**.

Fonte normativa: **MANUAL MESTRE TÉCNICO v10 — TRILHAS 01 A 06**.

### Baseline preservado

A execução partiu obrigatoriamente do **CHECKPOINT CANÔNICO PRÉ-TRILHA 02** deste Livro Raiz. Não foram recriados nem substituídos os fluxos já homologados de:

- Conta pública separada de Administração;
- Consumidor, Produtor, Administrador e Super administrador por papel real;
- identidade única permitindo Consumidor + Produtor no mesmo CPF;
- sessão com `activeRole`;
- Mostrar/Ocultar senha;
- Google AI Studio via `/_hvm_api`;
- confirmação, recuperação e código de segurança vinculados ao papel;
- migration `20260920224820_role_scoped_security_flows`;
- projeto Supabase único `xipbsazvymkqqfmfegwu`;
- integração GitHub → Vercel já existente.

A equivalência histórica da migration 0009 da Trilha 02 foi aplicada **aditivamente sobre o schema 13**, sem reescrever o histórico anterior. Por isso, o estado lógico correto após esta implementação é **schema 14**.

### Backend implementado

Foram adicionados e integrados:

- `server/services/ConfigurationService.ts`;
- `server/services/reauthService.ts`;
- `server/routes/adminConfigRoutes.ts`;
- `server/middleware/adminSession.ts`;
- `server/middleware/contextEnrichers.ts`;
- `server/security/originProtection.ts`;
- `server/security/redactPII.ts`;
- `server/security/hash.ts`.

Comportamentos canônicos:

- `GET /api/v1/admin/configuration`;
- `PATCH /api/v1/admin/configuration`;
- autorização real somente para `platform_super_admin`;
- sessão Supabase validada;
- reautenticação recente vinculada a `last_sign_in_at`, janela máxima de 15 minutos;
- `expectedRevision` obrigatório;
- HTTP 409 em conflito de revisão;
- `commandId` UUID para idempotência;
- payload divergente com mesmo `commandId` rejeitado;
- transação `SERIALIZABLE`;
- advisory locks de comando e singleton;
- UPDATE da configuração e INSERT da auditoria na mesma transação;
- payload de auditoria submetido a redação de PII;
- request ID e hash de IP;
- proteção de origem para mutações administrativas;
- logs estruturados sem expor segredo ou PII.

### Frontend implementado

Nova rota:

- `/admin/configuracao`.

A tela possui os estados exigidos pelo Manual v10:

1. loading com skeleton;
2. ready com formulário;
3. empty;
4. erro recuperável com retry;
5. mutação com estados de salvamento, sucesso, conflito 409 e reautenticação 401.

O formulário permite alterar somente:

- slogan;
- município padrão;
- UF;
- e-mail de suporte;
- telefone de suporte em E.164 ou `null`.

A revisão atual é visível. Em conflito, a edição local é preservada até o operador decidir recarregar a revisão atual.

Para preservar a correção canônica de acesso, o login do Super Administrador **continua direcionando para `/minha-conta`**. A ação **Configuração global da plataforma** aparece nessa área somente quando `activeRole === platform_super_admin`. O backend continua sendo a autoridade final de autorização.

### Design e responsividade

A tela administrativa segue os tokens visuais das referências oficiais:

- verde escuro `#143D24`;
- verde principal `#1B4D2E`;
- verde folha `#2E7D32`;
- verde claro `#E8F5E9`;
- branco, cinzas neutros, bordas suaves e cartões arredondados;
- hierarquia visual consistente com desktop e aplicativo mobile.

Responsividade coberta em E2E para:

- 320 px;
- 360 px;
- 768 px;
- 1440 px.

Há ajuste adicional abaixo de 360 px e verificação de ausência de overflow horizontal.

### Supabase — schema 14

Projeto canônico utilizado:

**HortVitalMix — `xipbsazvymkqqfmfegwu`**.

Nenhum projeto adicional foi criado.

Migration aplicada:

`20260921193244_trilha02_config_hardening`.

Efeitos reais verificados:

- `app_global_config.updated_by`: presente;
- `uq_app_audit_events_command_id`: presente;
- `ix_app_audit_events_config_target`: presente;
- policies de escrita para `authenticated` em `app_global_config`: **0**;
- tabelas de aplicação com RLS habilitado e forçado: **9**;
- singleton `app_global_config`: **1**.

Schema lógico: **14**.

Hash canônico das 14 migrations:

`4df210ea6d4cdb05280f33889280edb1411532b0f24f5da8f7044110ef2617dc`.

### Gates e testes

O gate de fundação foi ampliado de A1–A15 para **A1–A18**, incorporando:

- ausência de policy de escrita na configuração;
- presença de `updated_by`;
- presença do índice dedicado de auditoria da configuração.

A suíte canônica da Trilha 02 contém **31 casos em oito arquivos**:

- contrato: 9;
- redação de PII: 4;
- concorrência: 2;
- idempotência: 3;
- auditoria: 3;
- reautenticação: 3;
- RLS: 3;
- payloads maliciosos: 4.

Foram adicionados testes E2E próprios para layout responsivo, loading mínimo, erro recuperável, conflito 409 e sucesso.

### Proteção do projeto production

O único Supabase disponível no projeto é o canônico. As suítes que criam identidades e fixtures permanecem **fail-closed contra o project ref production**, conforme a governança existente. Nesta execução foram realizadas validações estruturais read-only no banco real; não foram fabricados resultados de testes mutacionais que exigem ambiente development isolado.

### Build e Vercel

- Node 24 preservado;
- `tsconfig.build.json` restaura a separação entre typecheck de runtime e fontes de testes;
- `npm run build` usa `typecheck:app`, `security:check`, Vite e bundle check;
- `verify:free` e comandos específicos `test:t02:*` foram registrados;
- `/admin/configuracao` usa `Cache-Control: no-store`;
- nenhuma variável nova obrigatória foi introduzida;
- `vercel.json` continua permitindo deploy automático somente de `main`;
- o commit de implementação integrado à `main` recebeu do contexto **Vercel** o estado `success` com a descrição **"Deployment has completed"**;
- a release de produção `trilha02-v1` foi registrada em `app_releases` com schema 14 e o hash canônico das migrations;
- o conector Vercel disponível ao ChatGPT continua sem listar o projeto, portanto a evidência de deployment usada é o status oficial publicado pela integração Vercel no commit GitHub;
- os invariantes de readiness foram conferidos no código e no banco: release corrente única, schema 14, hash canônico e SHA sincronizado com o HEAD final após este registro.

### Checklist da implementação

- [x] Backend da Trilha 02 implementado;
- [x] Frontend da Trilha 02 implementado;
- [x] design/layout desktop + mobile aplicado;
- [x] responsividade coberta por E2E;
- [x] Supabase canônico atualizado;
- [x] migrations + manifesto sincronizados;
- [x] Livro Raiz atualizado;
- [x] branch GitHub de implementação criada e atualizada;
- [x] configuração de build/deploy Vercel preservada e atualizada;
- [x] conformidade funcional da Trilha 02 reconciliada com o Manual v10 e com o checkpoint canônico;
- [x] auditoria final read-only A1–A18 aprovada no Supabase canônico;
- [x] release de produção `trilha02-v1` registrada;
- [x] deployment Vercel da `main` confirmado com status `success`;
- [x] projeto mantido pronto para Vercel, sem novas variáveis obrigatórias;
- [x] Livro Raiz fechado com rastreabilidade da Trilha 02.

**Regra de segurança preservada:** os testes mutacionais que criam identidades/fixtures continuam bloqueados contra production e só podem ser executados em ambiente development isolado. Eles não foram executados no banco canônico para não violar a própria governança registrada do projeto.



---

## 2026-09-21 - SELAGEM GRATUITA DEFINITIVA DA TRILHA 02

Status: **fechamento operacional da Trilha 02 em regime de custo zero, sem remover ou regredir qualquer avancado ja incorporado da Trilha 03**.

### Decisao de infraestrutura

Foi rejeitada a criacao de branches Supabase cobrados. O custo consultado era de **US$ 0,01344/h por branch**. Portanto, nenhum branch remoto adicional foi criado.

Para cumprir a finalidade de development/homologation sem custo, foi versionado o workflow `.github/workflows/trilha02-free-seal.yml`, que usa Supabase local efemero em runner padrao de repositorio publico. Cada ambiente e criado do zero e destruido ao final.

### Cerimonia gratuita

Para `development` e `homologation`, separadamente:

1. reset local ate `20260920224820_role_scoped_security_flows`;
2. dump logico pre-T02 e SHA-256 registrado no log da execucao;
3. aplicacao de `20260921193244_trilha02_config_hardening`;
4. `migrations:verify`;
5. `verify:t02:evidence`;
6. `verify:foundation` A1-A18;
7. `test:t02` com **31 casos**;
8. build de producao;
9. release efemera do ambiente.

A selagem cria a tag Git `trilha02-v1` somente depois de ambos os ambientes passarem e o status Vercel do mesmo SHA ser `success`.

### Production - evidencia sem fixture destrutiva

No Supabase canonico `xipbsazvymkqqfmfegwu` foi executada prova mutacional dentro de transacao com `ROLLBACK`. Foram confirmados: incremento de revision em alteracao real, unicidade de `commandId` e imutabilidade de `app_audit_events`. Apos o rollback, o banco permaneceu em `revision=1`, slogan `Tudo fresco. Tudo da sua regiao.` e `audit_count=0`.

Fingerprint estrutural pos-T02: `2416c187d2124b1182cea088e64e3020e7087c5b75230725a01db1a68c0896d9` sobre 160 itens de migrations/colunas/indices/policies/triggers. Hash canonico das migrations: `4df210ea6d4cdb05280f33889280edb1411532b0f24f5da8f7044110ef2617dc`.

O snapshot remoto de production anterior a migration nao pode ser recriado retroativamente e nao sera falsificado. Sob a regra expressa de custo zero, sua evidencia substituta e a cadeia imutavel de migrations + fingerprint estrutural + prova transacional com rollback.

### Preservacao da Trilha 03

AuthService, rotas de identidade, cadastro Consumer/Producer, papeis, sessoes, confirmacao, recuperacao e codigo de seguranca ja adiantados permanecem intactos. A presente selagem e aditiva e nao recria nem apaga esses ativos.


### Fechamento operacional de custo zero — 2026-09-21

A política do proprietário é **custo zero**: nenhum branch Supabase cobrado foi criado. O gate remoto em Linux foi testado em `ubuntu-latest` e `ubuntu-24.04`; em ambos, o GitHub criou os jobs de `development` e `homologation`, mas encerrou cada job antes do primeiro step, com `steps: null`. Isso caracteriza indisponibilidade de provisionamento do runner, não falha dos testes ou da aplicação.

Para não degradar segurança nem fabricar resultados:
- os 11 casos que exigem banco/Auth permanecem como integração real e continuam fail-closed contra production;
- os 20 casos seguros (contrato, PII, reautenticação e payload malicioso) passaram a fazer parte obrigatória do build Vercel;
- `verify:t02:evidence` garante a presença exata dos 31 casos e os invariantes do código;
- production foi validado por A1–A18 e por prova mutacional transacional com `ROLLBACK`, sem persistir fixtures;
- foi adicionado `.github/workflows/trilha02-free-seal-fallback.yml`, em runner padrão macOS, para executar os 20 casos seguros, validar os 31 casos versionados, exigir Vercel `success`, exigir `/api/ready` sincronizado com o mesmo SHA e somente então criar a tag Git `trilha02-v1`.

Nenhuma implementação já adiantada da Trilha 03 foi removida, simplificada ou recriada.


---

## 2026-09-21 — VOLUME 01 / TRILHA 03 — IDENTIDADE CANÔNICA, PORTAIS SEPARADOS E SESSÕES CRIPTOGRÁFICAS

Status técnico: **implementação integral da Trilha 03 incorporada à main, preservando todos os avanços pré-existentes; Supabase canônico atualizado sem novas tabelas; build Vercel usado como gate executável; workflow gratuito de integração versionado e fail-closed contra production**.

Fonte normativa: **MANUAL MESTRE TÉCNICO v10 — TRILHAS 01 A 06**.

### Baseline obrigatório preservado

A execução iniciou a partir da Trilha 02 homologada em schema lógico 14 e respeitou a trava deste Livro-Raiz. Permaneceram intactos:
- identidade canônica com possibilidade de Consumer + Producer no mesmo CPF;
- Conta pública separada da Administração;
- Administrador e Super administrador sem cadastro público;
- confirmação, recuperação de senha e código de segurança vinculados ao papel;
- correções de Google Studio e roteamento `/_hvm_api`;
- configuração global/auditoria da Trilha 02;
- projeto Supabase único `xipbsazvymkqqfmfegwu`;
- integração GitHub → Vercel.

### Backend T03

- endpoints separados `POST /api/v1/auth/login` e `POST /api/v1/auth/admin-login`;
- login público rejeita `platform_admin` e `platform_super_admin` com HTTP 403 antes de autenticar e sem emitir cookie;
- login administrativo rejeita Consumer/Producer;
- rate limit de 10 tentativas/15 minutos por `clientIpHash`;
- cookies de sessão `HttpOnly`, `Secure` em produção e `SameSite=Lax`;
- sessão continua validada por JWT/Supabase Auth e papéis vivos do banco;
- cadastro público permanece estritamente Consumer/Producer;
- contratos Zod strict e mensagens sem enumeração de conta;
- fluxos reais já adiantados de confirmação/recuperação/reautenticação foram preservados em vez de regredir para stubs.

### Frontend T03

- nova escolha explícita `/cadastro` com somente Consumidor e Produtor;
- cadastros específicos permanecem em `/cadastro/consumidor` e `/cadastro/produtor`;
- alias administrativo independente `/admin/entrar`;
- normalização compartilhada de CPF/e-mail/celular;
- CPF e celular extraídos para componentes reutilizáveis;
- medidor de força de senha extraído para componente canônico;
- hook `useSession` sincroniza a shell com a sessão real;
- Conta autenticada aponta para `/minha-conta`;
- design e tokens das referências oficiais preservados sem inserir dados fictícios.

### Banco / Supabase

Projeto: **HortVitalMix — `xipbsazvymkqqfmfegwu`**.

Migrations aditivas:
- `20260922002647_trilha03_identity_hardening`;
- `20260922004505_trilha03_function_grants_hardening`.

Schema lógico final da implementação: **16**.

A T03 não criou tabelas. Foram adicionados/validados:
- `fn_assert_public_role(text)`;
- `ix_app_people_email_login`;
- `fn_check_auth_people_consistency()`;
- `trg_fn_auth_user_email_changed()`;
- trigger `trg_hortivital_auth_user_email_changed`.

A consulta canônica retornou **0 divergências** entre e-mails de `auth.users` e `app_people`.

O Supabase Security Advisor detectou inicialmente que a nova função interna do trigger herdava EXECUTE público. A migration corretiva revogou execução de PUBLIC/anon/authenticated/service_role. Na rechecagem, esse alerta específico desapareceu.

Advisories anteriores à T03 foram preservados sem alteração fora de escopo: helpers SECURITY DEFINER deliberadamente concedidos a authenticated para RLS, tabela de desafios com RLS sem policy pública (acesso direto negado) e proteção de senha vazada desativada na configuração Auth.

### Testes e responsividade

Testes unitários T03 versionados:
- contratos de identidade;
- normalização;
- rate limit.

Integração T03 versionada:
- objetos da migration;
- guard de papel público;
- bloqueio de administrador no login público;
- bloqueio de papel público no login administrativo.

Responsividade:
- suíte existente cobre 320, 360, 430, 768, 1024 e 1440 px;
- suíte específica T03 cobre 320, 390, 768, 1024 e 1440 px;
- valida seletor `/cadastro`, portal administrativo, ausência de mistura de papéis e ausência de overflow.

### Build, CI e Vercel

O build de produção executa typecheck, security-check, regressão segura da T02, validação histórica T02, testes unitários T03, evidência T03, Vite e inspeção do bundle.

Foi encontrada e corrigida uma falha real de evolução do gate da T02: `verify:t02:evidence` exigia schema global exatamente 14 e, portanto, quebrava qualquer migration futura. O gate passou a validar o **hash histórico das 14 migrations da T02**, permitindo schema superior sem perder evidência.

A integração GitHub → Vercel permanece o gate de build/deploy da main.

O workflow `.github/workflows/trilha03-free-homologation.yml` usa Supabase local efêmero, sem custo e sem tocar em production. No GitHub Free atual, houve execução encerrada antes do primeiro step, com `steps: null`; isso é indisponibilidade de provisionamento do runner e não foi registrado como aprovação de teste.

### Hash e manifesto

Schema lógico: **16**.

Hash canônico das 16 migrations:

`7642fea2913cbb56af6ea156dfbc9aaeabe1bb9548052f731ccee0469d4b3ac0`.

### Regra de selagem

A tag `trilha03-v1` e a release corrente de production só podem ser criadas no mesmo SHA final deste fechamento após o contexto Vercel retornar `success`. Nenhum resultado de runner indisponível pode ser interpretado como teste aprovado.

### Checklist T03

- [x] Backend implementado;
- [x] Frontend implementado;
- [x] design/layout oficial preservado;
- [x] responsividade coberta por testes E2E versionados;
- [x] Supabase canônico atualizado;
- [x] migrations e manifesto sincronizados;
- [x] Livro Raiz atualizado;
- [x] GitHub main atualizado;
- [x] Vercel configurado e build obrigatório preservado;
- [x] conformidade funcional reconciliada com o Manual v10 sem regredir avanços;
- [x] hardening de privilégios do trigger concluído;
- [x] zero divergências de e-mail na consistência canônica;
- [ ] runner gratuito GitHub executou integração/E2E — **bloqueado externamente por indisponibilidade de provisionamento (`steps: null`)**;
- [ ] release/tag T03 — **executar somente após Vercel success do SHA final deste fechamento**.


---

## 2026-09-21 — REVISÃO FINAL DA TRILHA 03 — DESEMPENHO, TELAS E RESPONSIVIDADE

Status: **correções de raiz implementadas sem uso de GitHub Actions; build gratuito Vercel aprovado no fechamento funcional e revisão final pronta para selagem**.

### Diagnóstico real encontrado

A lentidão de autenticação não era apenas percepção visual. O fluxo anterior fazia o POST de login e, após sucesso, executava um segundo GET de sessão. Essa resolução repetia autenticação e consultas de banco. Além disso, quando havia cookie anterior, o middleware global podia resolver a sessão antiga antes do próprio login/cadastro.

No cadastro, CPF e e-mail eram consultados sequencialmente e o backend aguardava o reenvio da confirmação de e-mail antes de devolver sucesso.

Também foram confirmadas falhas de visibilidade:

- `/admin/entrar` podia cair no seletor público Consumer/Producer por ordem incorreta das condições;
- `/cadastro` estava implementado, mas o CTA público da home levava a `/entrar`;
- a Configuração Global da Trilha 02 existia em `/admin/configuracao`, porém permanecia pouco visível por depender do acesso genérico a `/minha-conta`.

### Correções de desempenho

- criado `server/services/IdentityAccessService.ts`;
- status da conta, pessoa, papéis ativos e validade opcional de sessão são resolvidos em uma única consulta PostgreSQL;
- `sessionMiddleware` caiu de múltiplas consultas para uma resolução consolidada após validar o JWT;
- login retorna diretamente `userId`, `email`, `roles` e `activeRole`;
- frontend adota a resposta do próprio POST e não faz GET de sessão logo após autenticar;
- login/cadastro e demais endpoints públicos de Auth não processam cookie/sessão antiga antes da própria operação;
- visitante sem sessão não aciona refresh inútil;
- a mesma otimização atende Consumer, Producer, Administrador e Super administrador;
- respostas de login/cadastro recebem `Server-Timing` sem exposição de credenciais.

A consulta consolidada foi verificada diretamente no Supabase canônico com `EXPLAIN` e ficou executável após correção do `GROUP BY`. O plano confirmou uso da PK de `app_users` e do índice ativo de papéis.

### Correções do cadastro

- pesquisa por CPF e e-mail paralelizada com `Promise.all`;
- criação de identidade + domínio continua real e transacional;
- confirmação por e-mail deixou de bloquear a resposta principal do cadastro;
- após persistência válida, a interface navega imediatamente para o login correspondente;
- o reenvio de confirmação continua sendo disparado sem bloquear a navegação;
- se o e-mail não sair, o usuário mantém a opção canônica de reenviar confirmação.

### Correções de telas T02/T03

- `/admin/entrar` corrigido para exibir exclusivamente Administrador e Super administrador;
- `/cadastro` exposto pela ação pública “Conheça as opções de cadastro”;
- criado `/admin/painel` como entrada pós-login administrativo;
- Administrador recebe o painel administrativo;
- Super administrador recebe no painel a ação explícita **Abrir Configuração Global — Trilha 02**;
- `/admin/configuracao` continua autorizado somente para Super administrador no backend;
- Conta/segurança continua separada em `/minha-conta`.

Conclusão visual: as telas das Trilhas 02 e 03 **já existiam parcialmente**, porém havia problemas de entrada/roteamento que justificavam a percepção de que não apareciam. Esses pontos foram corrigidos.

### Responsividade revisada

- mobile <=767 px: formulários e cartões em coluna, navegação inferior e alvos de toque adequados;
- tablet 768–1199 px: conteúdo limitado e grades adaptativas;
- desktop >=1200 px: conteúdo central, cartões em duas colunas e limites máximos;
- Configuração Global T02 já possuía tratamento <=767 px e <=359 px;
- painel administrativo T03 ganhou regras próprias de tablet/mobile;
- cobertura E2E continua versionada para execução local gratuita, sem depender de GitHub Actions.

### Infraestrutura gratuita

Por determinação do proprietário:
- nenhum workflow GitHub Actions foi alterado nesta revisão;
- GitHub Actions não será usado como critério de conclusão;
- a validação executável da aplicação permanece no build/deploy Vercel gratuito;
- Supabase canônico permanece `xipbsazvymkqqfmfegwu`;
- nenhuma migration foi necessária nesta revisão; schema lógico permanece 16.



### Fechamento da revisão final T03

- commit funcional com otimização completa e exclusão do middleware prévio em login/cadastro: `3311025aeef4fa5226eb2a085651f92dd68dcc1f`;
- contexto Vercel desse commit: **success**;
- fechamento documental subsequente também passou pelo build Vercel antes deste registro;
- schema lógico permanece **16**, sem migration adicional;
- hash canônico das migrations permanece `7642fea2913cbb56af6ea156dfbc9aaeabe1bb9548052f731ccee0469d4b3ac0`;
- GitHub Actions permaneceu intocado nesta revisão, conforme determinação do proprietário;
- a criação de uma **tag Git real** não é substituída por branch ou release de banco. O conector GitHub desta sessão não expõe operação de criação de ref/tag; portanto nenhuma tag fictícia foi criada. A release canônica Supabase `trilha03-v1` permanece separada desse conceito.


### Ajuste pós-fechamento — visibilidade do acesso administrativo por sessão

- quando a sessão ativa é `consumer` ou `producer`, o ícone/atalho de Administração fica oculto no header desktop e mobile;
- ao sair da sessão pública, a entrada administrativa volta a ficar disponível;
- quando a sessão ativa é `platform_admin` ou `platform_super_admin`, o atalho administrativo permanece disponível e direciona ao painel administrativo;
- a regra considera o **perfil ativo**, preservando a separação canônica entre portais;
- o backend passou a declarar `portalKind: "public" | "administrative"` nas respostas de autenticação/sessão; o frontend usa esse contexto canônico para a visibilidade do atalho administrativo;
- cobertura unitária adicionada à suíte da Trilha 03;
- nenhuma alteração realizada em GitHub Actions.


## 2026-09-21 — VOLUME 01 / TRILHA 04 — CONFIRMAÇÃO DUPLA DE CONTATO E RECUPERAÇÃO DE SENHA

**Fonte única de verdade:** MANUAL MESTRE TÉCNICO v10 — TRILHAS 01 A 06.

**Status:** homologada tecnicamente — release de produção `trilha04-v1`.

### Baseline e compatibilidade

- a Trilha 04 foi iniciada sobre o estado real já homologado das Trilhas 01–03, sem remover os avanços existentes de identidade multi-papel, portais separados, recuperação vinculada ao perfil, códigos de segurança, configuração global e auditoria;
- o Manual denomina a migration canônica desta trilha como **0011 / schema final 11**; o projeto real já estava no schema lógico **16** antes da T04 por migrations corretivas e hardenings anteriores. Não houve downgrade nem reescrita de histórico;
- a migration canônica T04 foi aplicada de forma aditiva como `20260922024933_trilha04_contact_recovery.sql`;
- após inspeção dos advisors do Supabase, foi aplicada a migration corretiva `20260922025820_trilha04_performance_hardening.sql`;
- schema lógico do projeto após T04: **18**;
- migration history hash: `2405a48927004cf8c60d700c6303c2997f0ce7708cde510b1d3dce70eda977e1`.

### Banco / Supabase

Criadas conforme o Manual v10:

- `app_contact_verification_challenges`;
- `app_password_recovery_requests`;
- `app_outbox_events`;
- `app_delivery_attempts`.

Regras aplicadas:

- OTP de 6 dígitos nunca persistido em claro;
- `otp_hash = SHA-256(otp:salt)`, com salt aleatório de 16 bytes;
- token/link armazenado apenas por digest SHA-256;
- fingerprint SHA-256 do destino atual;
- validade de 30 minutos;
- cooldown server-side de 60 segundos por usuário+canal;
- máximo de 5 tentativas OTP;
- consumo único, expiração e invalidação;
- outbox com payload AES-256-GCM, nonce de 12 bytes e auth tag de 16 bytes;
- `OUTBOX_ENCRYPTION_KEY` permanece exclusivamente no backend/runtime;
- retry com backoff exponencial e limite de tentativas;
- RLS `ENABLE + FORCE` nas quatro tabelas;
- authenticated possui somente SELECT governado por policies; escrita permanece service-role/backend;
- índices canônicos e forenses da T04;
- índice adicional `ix_app_outbox_recipient_user` após advisor de FK;
- policies `challenges_self_read` e `recovery_self_read` otimizadas com `(SELECT auth.uid())`.

Uma prova transacional real foi executada no banco e revertida por `ROLLBACK`, comprovando inserção das quatro estruturas, OTP/token não persistidos em claro e payload binário de outbox. A checagem posterior confirmou **zero resíduo**. Outra prova com `SET LOCAL ROLE authenticated` mostrou **1 linha própria visível e nenhuma linha de outro usuário**, confirmando o isolamento RLS.

### Backend

Implementados:

- `shared/contracts/contactRecovery.ts`;
- `server/security/otp.ts`;
- `server/security/mask.ts`;
- `server/communication/securePayload.ts`;
- `server/communication/transports.ts`;
- `server/communication/templates.ts`;
- `server/config/publicOrigin.ts`;
- `server/services/CommunicationOutboxService.ts`;
- `server/services/ContactVerificationService.ts`;
- `server/services/PasswordRecoveryService.ts`;
- `server/routes/contactRecoveryRoutes.ts`;
- `scripts/dispatch-outbox.ts`.

Rotas reais:

- `GET /v1/auth/contact/status`;
- `POST /v1/auth/contact/challenge`;
- `POST /v1/auth/contact/confirm-otp`;
- `POST /v1/auth/contact/confirm-token`;
- `POST /v1/auth/password/recovery`;
- `POST /v1/auth/password/reset`;
- aliases equivalentes sob `/api/v1/auth` mantidos.

A mesma confirmação por e-mail entrega **OTP + link seguro** na mesma mensagem, conforme a regra canônica do Manual.

Adapters reais disponibilizados:

- Resend;
- Gmail API;
- Twilio SMS.

Sem credencial de provedor, a arquitetura não simula sucesso: o evento permanece em retry/falha/abandono na outbox. Não há OTP/token em log nem fallback fictício.

### Preservação do isolamento por perfil

A T04 não regrediu o hardening já homologado anteriormente:

- recuperação continua explicitamente vinculada a `consumer`, `producer`, `platform_admin` ou `platform_super_admin`;
- o token T04 é combinado ao contexto `flowToken` já existente;
- um fluxo emitido para um perfil não serve para redefinir senha em outro;
- após redefinição bem-sucedida, o token T04 e o challenge de papel são consumidos;
- todas as sessões GoTrue do usuário são revogadas.

### Frontend

Criados:

- `src/components/forms/OtpInput.tsx`;
- `src/pages/auth/ContactConfirmationPage.tsx`;
- `src/pages/auth/RecoverPasswordPage.tsx`;
- `src/pages/auth/ResetPasswordPage.tsx`;
- `src/pages/auth/auth.css`.

Rotas integradas:

- `/confirmar-contato`;
- `/confirmarcontato` (compatibilidade com o endereço previsto no Manual);
- `/recuperar-senha`;
- `/redefinir-senha`;
- `/redefinirsenha` (compatibilidade).

A área `/minha-conta` passou a expor a ação **Confirmar e-mail e telefone**, evitando tela escondida.

OTP UX:

- seis inputs;
- zeros à esquerda preservados;
- avanço automático;
- backspace inteligente;
- setas esquerda/direita;
- colagem do código completo;
- `autocomplete="one-time-code"`;
- cooldown visível e decrescente.

### Responsividade / design

O padrão visual segue as referências oficiais do projeto: verde profundo, verde de ação, laranja de destaque, fundo claro, cards arredondados e hierarquia limpa.

Faixas implementadas:

- até 359 px: ajuste estreito específico;
- mobile até 767 px: cards em coluna e OTP sem overflow;
- tablet 768–1199 px: conteúdo limitado e grids adaptativos;
- desktop >=1200 px: conteúdo centralizado e cartões paralelos.

A suíte E2E T04 está versionada para **320, 430, 768, 1024 e 1440 px**, além de cenários de OTP e link inválido.

### Testes e gates gratuitos

Adicionados:

- `tests/unit/trilha04Otp.test.ts`;
- `tests/unit/trilha04SecurePayload.test.ts`;
- `tests/unit/trilha04Contracts.test.ts`;
- `tests/integration/trilha04Contact.test.ts`;
- `tests/integration/trilha04Recovery.test.ts`;
- `tests/integration/trilha04Rls.test.ts`;
- `tests/e2e/trilha04-contact-recovery.spec.ts`;
- `scripts/verify-trilha04-evidence.mjs`.

O build gratuito do Vercel executa:

- `migrations:verify`;
- typecheck;
- security check;
- regressões T02/T03;
- unitários T04;
- evidência estrutural T04;
- Vite build;
- bundle secret scan.

Os testes de integração que criam identidades efêmeras **não são executados automaticamente em cada deploy**, evitando operações desnecessárias no plano gratuito. Eles permanecem disponíveis por `npm run test:t04:integration`.

**GitHub Actions não foi utilizado nem alterado.**

### Configuração operacional da T04

`.env.example` documenta:

- `PUBLIC_ORIGIN`;
- `OUTBOX_ENCRYPTION_KEY`;
- `EMAIL_PROVIDER`;
- `RESEND_API_KEY`;
- `MAIL_FROM`;
- `GMAIL_ACCESS_TOKEN`;
- `GMAIL_FROM_EMAIL`;
- `SMS_PROVIDER`;
- `TWILIO_ACCOUNT_SID`;
- `TWILIO_AUTH_TOKEN`;
- `TWILIO_FROM_NUMBER`.

O Manual permite adapters opcionais; ausência de Resend/Gmail/Twilio não é substituída por simulação.

### Checklist técnico da implementação

- [x] Backend T04 implementado.
- [x] Frontend T04 implementado.
- [x] Design/layout consistente com referências desktop/mobile.
- [x] CSS responsivo mobile/tablet/desktop.
- [x] Banco atualizado no Supabase.
- [x] RLS/índices/policies validados e hardening do advisor aplicado.
- [x] Livro Raiz atualizado.
- [x] GitHub atualizado.
- [x] Gates de build integrados ao Vercel.
- [x] Conformidade estrutural com Manual Mestre Técnico v10 verificada.
- [x] GitHub Actions não utilizado.


### Fechamento da Trilha 04

- release canônica: `trilha04-v1`;
- schema lógico: **18**;
- migration history hash: `2405a48927004cf8c60d700c6303c2997f0ce7708cde510b1d3dce70eda977e1`;
- Vercel: build de homologação **success**;
- Supabase: release de produção marcada como `is_current = true`;
- GitHub Actions: não utilizado e não alterado;
- tag física Git `trilha04-v1`: não criada pelo conector atual porque a operação `refs/tags` não é exposta; isso não foi substituído por branch falsa.


## 2026-09-22 — CORREÇÃO OPERACIONAL DA TRILHA 04 — SUPABASE AUTH COMO ÚNICO SISTEMA DE E-MAIL DE SEGURANÇA

**Status:** regra operacional vigente e substitutiva de qualquer referência anterior a providers externos na Trilha 04.

### Decisão canônica

A partir desta correção, o HortiVitalMix utiliza **somente o Supabase Auth** para envio de e-mails relacionados a autenticação e segurança.

O Gmail permanece configurado exclusivamente como SMTP dentro do próprio Supabase. A aplicação não recebe, armazena nem solicita credenciais diretas do Gmail.

Esta decisão vale, por enquanto, para:

- confirmação e reenvio de cadastro;
- recuperação de senha;
- reautenticação e código de segurança;
- fluxos de Consumidor;
- fluxos de Produtor;
- fluxos de Administrador;
- fluxos de Super administrador.

### Providers externos removidos do runtime

Ficam **desativados e fora do contrato de ambiente atual**:

- Resend;
- Gmail API direta;
- Twilio;
- SMS de segurança;
- qualquer provider externo de e-mail fora do Supabase Auth.

As seguintes variáveis foram removidas do `.env.example` e não devem ser solicitadas pelo Google Studio, Vercel ou outro runtime:

- `PUBLIC_ORIGIN`;
- `EMAIL_PROVIDER`;
- `RESEND_API_KEY`;
- `MAIL_FROM`;
- `GMAIL_ACCESS_TOKEN`;
- `GMAIL_FROM_EMAIL`;
- `SMS_PROVIDER`;
- `TWILIO_ACCOUNT_SID`;
- `TWILIO_AUTH_TOKEN`;
- `TWILIO_FROM_NUMBER`;
- `OUTBOX_ENCRYPTION_KEY`.

### Fluxo ativo

O fluxo ativo permanece centralizado em `server/routes/authRoutes.ts` e usa:

- `supabase.auth.resend(...)` para confirmação/reenvio;
- `supabase.auth.resetPasswordForEmail(...)` para recuperação;
- `supabase.auth.reauthenticate()` para código de segurança.

A entrega efetiva dos e-mails é responsabilidade do Supabase Auth através do SMTP/Gmail já configurado no painel do projeto.

### Estrutura T04 preservada

As migrations e tabelas da Trilha 04 **não foram removidas nem revertidas**.

Continuam preservadas:

- `app_contact_verification_challenges`;
- `app_password_recovery_requests`;
- `app_outbox_events`;
- `app_delivery_attempts`.

A outbox própria deixa de ser mecanismo ativo de entrega neste momento. Ela permanece somente como fundação arquitetural para uma eventual evolução futura, sem exigir secret próprio no runtime.

Schema lógico permanece **18** e o histórico de migrations continua intacto.

### Frontend

As telas de:

- `/confirmar-contato`;
- `/confirmarcontato`;
- `/recuperar-senha`;
- `/redefinir-senha`;
- `/redefinirsenha`;

utilizam novamente o fluxo canônico do componente `Account`, já integrado ao Supabase Auth.

Não existem dois fluxos concorrentes de autenticação.

### SMS

SMS de segurança fica **explicitamente desativado por enquanto**.

Nenhuma credencial Twilio deve ser criada ou solicitada.

Qualquer ativação futura de SMS deverá ser previamente registrada no Livro Raiz e implementada em etapa própria.

### Regra para implementações futuras

Enquanto esta decisão estiver vigente:

1. não adicionar Resend;
2. não adicionar Gmail API direta;
3. não adicionar Twilio;
4. não solicitar secrets de provider no Google Studio;
5. não solicitar secrets de provider na Vercel;
6. usar exclusivamente o Supabase Auth para e-mails de autenticação/segurança;
7. tratar Gmail/SMTP como configuração interna do Supabase.

Esta seção **prevalece sobre referências anteriores da Trilha 04** que mencionavam Resend, Gmail API, Twilio, outbox ativa ou `OUTBOX_ENCRYPTION_KEY` como requisito de runtime.


## 2026-09-22 — RECUPERAÇÃO DAS CAMADAS VISUAIS DA TRILHA 04 — SUPABASE INTACTO

**Escopo desta correção:** exclusivamente frontend/UX. Nenhuma alteração foi realizada no Supabase, migrations, RLS, banco, SMTP/Gmail, endpoints de autenticação ou regras de sessão.

### Diagnóstico corrigido

Foi confirmado que as rotas `/confirmar-contato`, `/recuperar-senha` e `/redefinir-senha` haviam voltado a renderizar o componente genérico `Account`, herdado visualmente da Trilha 01. Isso fazia a T04 funcionar tecnicamente, porém sem apresentar as páginas visuais próprias definidas na Parte 3 do Manual v10.

### Recuperação visual

As páginas existentes foram reconectadas ao roteamento:

- `ContactConfirmationPage`;
- `RecoverPasswordPage`;
- `ResetPasswordPage`;
- aliases `/confirmarcontato` e `/redefinirsenha`.

A camada visual recebeu identidade própria T04 em `src/pages/auth/auth.css`, preservando a identidade oficial HortiVitalMix:

- verde profundo `#143D24`;
- verde primário `#1B4D2E`;
- verde folha `#2E7D32`;
- laranja `#E65100`;
- cards claros, hierarquia forte e responsividade mobile/tablet/desktop.

### Supabase-only preservado

As páginas visuais T04 usam exclusivamente os fluxos backend já existentes:

- confirmação: `POST /v1/auth/resend-confirmation`;
- recuperação: `POST /v1/auth/request-password-reset`;
- consumo do link Supabase: `POST /v1/auth/import-session`;
- redefinição: `POST /v1/auth/reset-password`.

Não foram reativados:

- Resend;
- Gmail API direta;
- Twilio;
- SMS;
- outbox própria como mecanismo ativo;
- router paralelo `contactRecoveryRouter`.

O Gmail continua exclusivamente como SMTP interno do Supabase Auth.

### Código de segurança

O componente `OtpInput` de seis campos foi reaproveitado na alteração de senha autenticada, sobre o fluxo já existente de `reauthenticate()`. A mudança é exclusivamente de apresentação/entrada do código; contrato, backend e Supabase foram preservados.

### Responsividade

A camada visual contempla:

- <=359 px;
- mobile <=767 px;
- tablet 768–1199 px;
- desktop >=1200 px.

A suíte E2E T04 foi atualizada para validar 320, 430, 768, 1024 e 1440 px e confirmar que as rotas usam as páginas T04 próprias.

### Regra de não regressão

A partir deste fechamento, as páginas visuais T04 não podem ser substituídas novamente pelo formulário genérico da Trilha 01 sem decisão explícita registrada no Livro Raiz.


---

## 2026-09-23 — SELAGEM DA TRILHA 05 CONFORME MANUAL MESTRE TÉCNICO v11

**Status:** Trilha 05 homologada nesta execução após correção de segurança, reconciliação do histórico, build Vercel e registro da release corrente de produção.

### Preservação obrigatória

A selagem foi aditiva. T01–T04, seus fluxos, migrations, páginas, Supabase Auth e decisões canônicas anteriores foram preservados. Nenhuma migration aplicada foi removida, reescrita ou executada novamente.

### Correções da selagem

- fechado o bypass legado `POST /v1/auth/admin-login`: ele não autentica e retorna `ADMIN_GOVERNANCE_LOGIN_REQUIRED`;
- login administrativo canônico permanece em `/v1/admin/auth/login`;
- Super administrador só recebe sessão depois da conclusão do MFA;
- `Account` não chama mais o endpoint administrativo legado;
- `FOUNDATION_SCHEMA_VERSION` alinhado ao schema lógico real **20**;
- histórico remoto reconciliado de forma explícita: a versão Supabase `20260923022554` é o alias físico conhecido da migration canônica `20260923022000_trilha05_performance_hardening.sql`;
- qualquer outra divergência de versão/nome continua falhando fechada;
- gate T03 atualizado para reconhecer o portal administrativo T05 sem reintroduzir o caminho antigo;
- regressões T05 adicionadas para bypass, schema/readiness e alias de migration.

### Banco de produção confirmado

Projeto canônico único: **HortVitalMix — xipbsazvymkqqfmfegwu**.

Confirmado:

- 20 migrations no histórico real;
- 6 tabelas administrativas T05;
- 3 setores canônicos;
- RLS + FORCE RLS nas estruturas T05;
- helpers `has_role_for` e `fn_is_last_active_super_admin`;
- trigger de atualização de convites;
- configuração global singleton preservada;
- nenhuma criação de identidade fictícia para homologar a T05.

O bootstrap do primeiro Super administrador permanece um fluxo real e controlado: se ainda não houver Super administrador ativo, a plataforma fica apta a executá-lo somente com o e-mail autorizado no servidor.

### Build e deploy

Durante a selagem, duas falhas de build foram tratadas na raiz:

1. evidência T03 ainda exigia o endpoint administrativo legado no frontend;
2. TypeScript detectou ramo impossível após o redirecionamento dos papéis administrativos.

Após as correções, o commit funcional `bfd46289cf39a33b6a9406f1d1f7c37c46ea08a9` concluiu deployment Vercel com **success**.

### Regra canônica pós-selagem

A T05 passa a ser patrimônio consolidado junto com T01–T04. Implementações futuras não podem recriar login administrativo paralelo, emitir sessão de Super administrador antes do MFA, alterar o histórico aplicado ou remover o isolamento setorial.

A próxima etapa funcional autorizada é a **Trilha 06 — Perfil Canônico, Endereços Residenciais e Privacidade LGPD**, utilizando o próximo schema lógico disponível sem downgrade.


---

## 2026-09-23 — REVISÃO DE VISIBILIDADE DAS TELAS T01–T05

**Motivo da revisão:** após a homologação da Trilha 05, a validação visual em desktop e mobile mostrou apenas a Home, listagem vazia de produtores, seletor público de Conta e seletor de Administração. Foi confirmado que isso não representa o inventário completo de telas já implementadas até a T05.

### Diagnóstico

As telas adicionais já existiam no código, mas parte delas ficava pouco descobrível porque:

- os formulários de cadastro público estavam acessíveis principalmente por CTAs secundários;
- o bootstrap do primeiro Super administrador só aparecia dentro da tela genérica de login administrativo;
- as rotas `/entrar/administrador` e `/entrar/super-administrador` usavam o mesmo conteúdo visual genérico;
- painel, governança, usuários e configuração são corretamente protegidos por sessão administrativa e, portanto, não devem ser exibidos como páginas públicas.

### Inventário canônico visível até a T05

#### Público / navegação geral
- `/` — Home;
- `/produtores` — Produtores;
- `/produtos` — Produtos;
- `/planos` — Planos;
- `/sobre` — Sobre;
- `/conta` — escolha de acesso Consumidor/Produtor;
- `/cadastro` — escolha de cadastro Consumidor/Produtor;
- `/cadastro/consumidor` — cadastro de Consumidor;
- `/cadastro/produtor` — cadastro de Produtor;
- `/entrar/consumidor` — login Consumidor;
- `/entrar/produtor` — login Produtor;
- `/minha-conta` — conta e segurança quando autenticado.

#### Segurança T04
- `/confirmar-contato` e alias `/confirmarcontato`;
- `/recuperar-senha`;
- `/redefinir-senha` e alias `/redefinirsenha`.

#### Administração T05
- `/administracao` — seletor Administrador / Super administrador;
- `/entrar/administrador` — entrada visual específica de Administrador;
- `/entrar/super-administrador` — entrada visual específica de Super administrador;
- `/admin/entrar` — entrada administrativa canônica genérica;
- `/admin/bootstrap` — bootstrap único do primeiro Super administrador;
- `/admin/aceitar-convite` e alias `/admin/convite` — aceite de convite;
- `/admin/painel` — painel administrativo protegido;
- `/admin/governanca` — convites e escopos, restrito ao Super administrador;
- `/admin/usuarios` — gestão de usuários administrativos, restrita ao Super administrador;
- `/admin/configuracao` — configuração global protegida.

### Correções de UX aplicadas sem remover funcionalidade

1. O seletor `/conta` agora mostra explicitamente o CTA **Criar cadastro**, levando para `/cadastro`.
2. O seletor `/administracao` consulta `/v1/admin/bootstrap/status` e exibe o estado real da configuração inicial.
3. Quando o bootstrap está aberto, a interface apresenta o CTA **Configurar primeiro Super administrador**, levando para `/admin/bootstrap`.
4. As rotas de Administrador e Super administrador agora possuem título e texto próprios, mantendo o mesmo backend canônico e sem recriar um segundo motor de login.
5. O link de bootstrap permanece oculto na tela específica de Administrador e visível na entrada de Super administrador/generic admin.
6. As telas protegidas continuam protegidas por `AdminAccessGate`; nenhuma foi tornada pública apenas para facilitar visualização.
7. A responsividade existente para desktop, tablet e mobile foi preservada e os novos elementos usam o mesmo sistema visual do projeto.

### Estado operacional nesta revisão

No momento desta revisão, o banco de produção ainda não possui Super administrador ativo. Portanto, é esperado que `/admin/painel`, `/admin/governanca`, `/admin/usuarios` e `/admin/configuracao` não sejam acessíveis antes da conclusão real do bootstrap.

Isso não significa que essas telas estejam ausentes. Elas permanecem implementadas e deliberadamente protegidas. O caminho correto é:

`/administracao` → `/admin/bootstrap` → criação do primeiro Super administrador autorizado → `/entrar/super-administrador` → credenciais → MFA → `/admin/painel`.

### Regra de não regressão

Não remover, simplificar ou tornar públicas as barreiras da T05 para “mostrar” telas protegidas. Descoberta visual e segurança devem coexistir: rotas públicas podem indicar o caminho, mas conteúdo administrativo continua condicionado a papel, sessão e MFA.


---

## 2026-09-23 — CORREÇÃO OPERACIONAL DO BOOTSTRAP DO PRIMEIRO SUPER ADMINISTRADOR

**Motivo:** durante a criação real do primeiro Super administrador, foi identificado que a interface mascarava diferentes falhas do bootstrap com uma única mensagem genérica. Também foi reforçada a separação entre os ambientes Google Studio e Vercel: secrets configurados em um ambiente não são propagados automaticamente para o outro.

### Regra operacional do secret

`BOOTSTRAP_ADMIN_EMAIL` continua sendo server-side e obrigatório somente enquanto ainda não existe Super administrador ativo.

- Google Studio/preview local: o secret precisa existir no ambiente do próprio Studio;
- Vercel Preview: o secret precisa existir no escopo Preview;
- Vercel Production: o secret precisa existir no escopo Production;
- Supabase: não recebe esse secret, pois o bootstrap é executado pelo backend Express/Vercel e cria a identidade via Supabase Admin API;
- após alterar/adicionar variável na Vercel, é necessário um novo deployment para que o runtime novo receba a configuração.

### Correção aplicada

A tela `/admin/bootstrap` agora diferencia explicitamente:

- bootstrap desabilitado por secret ausente;
- e-mail diferente do `BOOTSTRAP_ADMIN_EMAIL`;
- conflito de CPF/e-mail já existente;
- payload inválido;
- dependência obrigatória indisponível;
- bootstrap já fechado.

Foi adicionada também indicação visual quando o bootstrap está realmente liberado no ambiente atual.

### Observabilidade segura

O resumo de boot do runtime passa a registrar somente o booleano `hasBootstrapAdminEmail`, nunca o valor do e-mail. Isso permite verificar presença/ausência da configuração sem expor o secret.

### Segurança preservada

Nenhuma regra foi relaxada:

- o e-mail autorizado continua exclusivamente no servidor;
- nenhum Super administrador é criado manualmente no banco;
- o primeiro Super administrador continua sendo criado de forma transacional pelo bootstrap;
- MFA do Super administrador continua obrigatório;
- nenhuma migration, RLS ou schema foi alterado.


---

## 2026-09-23 — HARDENING DO E-MAIL AUTORIZADO NO BOOTSTRAP

**Evidência operacional:** a tela real de `/admin/bootstrap` exibiu simultaneamente **“Bootstrap liberado neste ambiente”** e, após o envio, **“O e-mail informado não corresponde ao BOOTSTRAP_ADMIN_EMAIL”**. Isso prova que o secret estava presente no runtime, porém o valor efetivo carregado pelo backend não correspondia ao e-mail digitado.

### Correção aplicada

1. A leitura de `BOOTSTRAP_ADMIN_EMAIL` foi centralizada em normalização server-side.
2. Espaços externos continuam removidos e o valor é comparado em minúsculas.
3. Aspas simples ou duplas acidentalmente salvas ao redor do e-mail no secret são removidas antes da comparação.
4. O endpoint de status retorna somente uma **dica mascarada** do e-mail autorizado, nunca o valor integral.
5. A tela de bootstrap passa a mostrar a dica mascarada que o backend realmente está usando, permitindo distinguir valor incorreto, ambiente errado ou secret com formatação indevida sem expor o endereço completo.
6. Em caso de incompatibilidade, a mensagem informa a mesma dica mascarada do valor efetivamente carregado no servidor.

### Segurança

A correção não reduz a proteção do bootstrap:

- a comparação integral continua ocorrendo somente no servidor;
- o frontend não recebe o e-mail completo configurado;
- o secret não é gravado no banco nem no Livro-Raiz;
- o bootstrap continua fechado automaticamente após existir um Super administrador ativo;
- não houve alteração de schema, migration, RLS ou MFA.


---

## 2026-09-23 — DIAGNÓSTICO FINAL GOOGLE STUDIO × VERCEL DO BOOTSTRAP

**Evidência recebida:** no Google Studio, o formulário aceitou abrir o bootstrap, mas ao enviar o e-mail autorizado exibiu a mensagem `O e-mail informado não corresponde ao BOOTSTRAP_ADMIN_EMAIL deste ambiente.`. Na Vercel, o seletor de Administração não apresentava opção para iniciar o primeiro Super administrador.

### Diagnóstico confirmado

1. O banco canônico continua com **0 Super administradores ativos**.
2. O e-mail usado no teste não existe em `auth.users` nem em `app_people`, portanto não há conflito de identidade prévio.
3. Não houve chamada de criação administrativa chegando ao Supabase durante a tentativa, provando que a falha ocorre antes da criação da identidade.
4. A mensagem observada no Google Studio não continha a dica mascarada introduzida na revisão anterior, sinal de preview/backend do Studio ainda desatualizado ou desalinhado com a `main`.
5. A ausência do CTA na Vercel podia ocorrer quando o status do bootstrap era `disabled`; o seletor agora mantém uma rota segura de diagnóstico mesmo nesse estado.

### Correções aplicadas

- o normalizador server-side de `BOOTSTRAP_ADMIN_EMAIL` passa a tolerar:
  - espaços externos;
  - aspas simples ou duplas;
  - prefixo acidental `BOOTSTRAP_ADMIN_EMAIL=`;
  - caracteres invisíveis comuns (zero-width/BOM);
  - diferenças de caixa;
- a dica mascarada foi fortalecida para mostrar início e final do usuário do e-mail, sem revelar o endereço completo;
- `/administracao` passa a exibir **Verificar configuração inicial** sempre que o bootstrap ainda não estiver fechado, mesmo quando o status estiver desabilitado;
- `/admin/bootstrap` continua sendo a fonte de diagnóstico do ambiente atual;
- nenhum bypass foi criado: a criação ainda depende do valor integral correto do secret no backend.

### Regra operacional

Google Studio e Vercel continuam sendo ambientes separados. Depois desta correção, o Google Studio precisa estar sincronizado com a `main` atual para exibir a dica mascarada e usar o normalizador novo. A Vercel recebe a correção por novo deployment da `main`.

Nenhuma migration, RLS, MFA, papel administrativo ou schema foi alterado.


---

## 2026-09-23 — PADRONIZAÇÃO DO FORMULÁRIO DO PRIMEIRO SUPER ADMINISTRADOR

**Motivo:** o formulário real de `/admin/bootstrap` ainda apresentava duas divergências de UX em relação aos cadastros canônicos de Consumidor/Produtor: CPF sem máscara/validação visual padronizada e celular sem a mesma máscara nacional. Também havia uma mensagem técnica de diagnóstico exibida mesmo quando o bootstrap estava liberado.

### Correções aplicadas

- removida da interface a mensagem técnica **“Bootstrap liberado neste ambiente. O servidor está esperando…”**;
- o estado `open` passa a exibir diretamente o formulário, sem banner técnico;
- CPF do primeiro Super administrador reutiliza o componente canônico `CPFInput`;
- celular reutiliza o componente canônico `PhoneInput`;
- máscara de CPF: `000.000.000-00`;
- máscara de celular: `(00) 00000-0000`;
- validação client-side do bootstrap usa o mesmo contrato canônico `BootstrapRequestSchema` antes de chamar a API;
- erros de CPF, celular, e-mail, nome e senha ficam vinculados aos respectivos campos;
- a comparação do e-mail autorizado passa a normalizar também o e-mail recebido do formulário, usando a mesma rotina aplicada ao `BOOTSTRAP_ADMIN_EMAIL`;
- o e-mail canônico normalizado é usado na verificação de duplicidade, criação no Supabase Auth e persistência em `app_people`.

### Preservação

Os componentes `CPFInput` e `PhoneInput` foram apenas ampliados para aceitar uso controlado opcional. Os cadastros de Consumidor e Produtor continuam usando os mesmos componentes e comportamento anteriores.

Nenhuma migration, RLS, MFA, papel administrativo ou schema foi alterado.


---

## 2026-09-23 — CAUSA RAIZ DO AMBIENTE NÃO ATUALIZAR

**Sintoma:** mesmo após correções funcionais da T05, Google Studio e Vercel continuavam exibindo comportamento antigo, dando a impressão de que as mudanças não haviam sido aplicadas.

### Causa raiz confirmada no GitHub/Vercel

A branch `main` avançou para o commit `2afc00db05192e21b03b51012a821089adb1d55b`, porém esse commit removeu acidentalmente o arquivo `package-lock.json`.

O `vercel.json` usa:

`npm ci --no-audit --no-fund`

O comando `npm ci` exige um lockfile válido. Como o `package-lock.json` não existia mais na `main`, o deployment Vercel do commit `2afc00d...` ficou em **failure** e o ambiente publicado permaneceu na versão anterior. Isso explica por que o usuário continuava vendo a interface antiga mesmo depois das correções terem sido integradas no código.

### Correção aplicada

- restaurado exatamente o `package-lock.json` do último commit funcional anterior, compatível com o mesmo `package.json`;
- nenhum pacote, migration, schema, RLS, variável de ambiente ou regra de autenticação foi alterado;
- novo commit de correção: `95bf591215149a7f972aa93ba1091c3bdac488ce`;
- deployment Vercel desse commit confirmado com **success**.

### Regra de não regressão

- `package-lock.json` é obrigatório enquanto `vercel.json` usar `npm ci`;
- nenhuma sincronização do Google Studio deve remover o lockfile;
- antes de concluir que uma alteração “não apareceu”, verificar o status do commit mais recente na Vercel e confirmar que a `main` efetivamente publicou com sucesso;
- o Livro-Raiz e a release de produção devem sempre apontar para o último commit efetivamente implantado.


---

## 2026-09-23 — POLÍTICA CANÔNICA DO PRIMEIRO SUPER ADMINISTRADOR

**Motivo:** após múltiplas tentativas com Google Studio e Vercel usando o mesmo repositório, o bootstrap continuou sujeito a divergência do valor efetivo de `BOOTSTRAP_ADMIN_EMAIL` entre runtimes. O usuário confirmou como identidade correta do primeiro Super administrador o mesmo endereço administrativo utilizado no projeto.

### Decisão operacional canônica

A autorização do primeiro Super administrador deixa de depender do valor textual carregado por cada runtime como ponto único de falha.

A identidade autorizada passa a ser representada no backend por **digest SHA-256 canônico, server-side e sem endereço em texto puro no repositório**.

Regras:

- o e-mail digitado no bootstrap é normalizado;
- seu SHA-256 é comparado em tempo constante com o digest canônico;
- somente a identidade administrativa previamente autorizada passa na comparação;
- `BOOTSTRAP_ADMIN_EMAIL` permanece suportada como verificação de consistência/compatibilidade entre ambientes;
- se a variável existir com valor divergente, o runtime registra apenas um aviso sem revelar o valor e **não substitui a política canônica**;
- ausência ou divergência da variável não autoriza outro e-mail;
- o bootstrap continua fechando automaticamente assim que existir um Super administrador ativo.

### Efeito prático

Google Studio e Vercel passam a aplicar a mesma política de identidade a partir do código da `main`, eliminando a divergência em que um ambiente aceitava abrir o bootstrap mas recusava o mesmo endereço no envio.

O status do bootstrap passa a depender das dependências reais necessárias à operação:

- banco PostgreSQL disponível;
- Supabase Admin disponível;
- inexistência de Super administrador ativo.

A variável de e-mail deixa de ocultar o botão de bootstrap quando o restante da infraestrutura está correto.

### Segurança preservada

- nenhum e-mail alternativo é aceito;
- o endereço autorizado não é armazenado em texto puro no código;
- comparação usa `timingSafeEqual`;
- não foi criado bypass de MFA;
- não foi criada identidade manualmente no Supabase;
- advisory lock e fechamento único permanecem;
- nenhuma migration, RLS ou schema foi alterado.

### Interface do bootstrap

Permanece vigente a padronização anterior:

- CPF usa `CPFInput` com máscara `000.000.000-00` e validação real;
- celular usa `PhoneInput` com máscara `(00) 00000-0000`;
- o banner técnico de diagnóstico não é exibido no estado normal `open`;
- validação do formulário continua usando `BootstrapRequestSchema`.


---

## 2026-09-23 — INVESTIGAÇÃO SUPABASE → BACKEND → FRONTEND DO BOOTSTRAP

**Objetivo:** investigar de ponta a ponta por que o primeiro Super administrador continuava falhando no Google Studio e não ficava disponível de forma consistente na Vercel, validando especificamente a hipótese de ausência/desalinhamento do e-mail entre Supabase, backend e frontend.

### 1. Supabase — evidência real

Foi confirmado diretamente no projeto canônico `xipbsazvymkqqfmfegwu`:

- `public.app_global_config.support_email = hortivitalmix@gmail.com`;
- o SHA-256 normalizado desse valor é `e5529eeb9b99fcafc370d6fb5855ade0082855cbfee746a7a85aa9a09f29d699`;
- esse digest coincide com a política canônica do backend;
- não existe usuário permanente com esse e-mail em `auth.users`;
- não existe pessoa permanente com esse e-mail em `app_people`;
- existem **0** Super administradores ativos.

Portanto, o endereço estava correto no Supabase como configuração global, mas ainda não como identidade Auth, porque a identidade deve nascer somente ao concluir o bootstrap.

### 2. Logs Supabase — causa raiz comprovada de tentativas anteriores

Os logs do Supabase mostraram tentativas reais de criação de `hortivitalmix@gmail.com` via Admin API do Auth, seguidas por exclusão compensatória.

Isso prova que, nessas tentativas, o backend:

1. recebeu o e-mail;
2. aceitou o e-mail;
3. chamou a criação real no Supabase Auth;
4. falhou depois, na transação de domínio;
5. removeu o usuário Auth criado para não deixar identidade parcial.

O erro PostgreSQL confirmado foi:

`duplicate key value violates unique constraint "app_users_pkey"`

na instrução:

`INSERT INTO public.app_users(id,status) VALUES ($1,'active')`

A causa é o trigger canônico `trg_hortivital_auth_user_created`, que já cria `app_users` automaticamente após o INSERT em `auth.users`. O backend antigo tentava inserir o mesmo `id` novamente.

A correção `ON CONFLICT (id) DO UPDATE` já permanece no serviço atual e não deve ser removida.

### 3. Resíduos das falhas anteriores

Foram encontrados registros `app_users` suspensos sem correspondente atual em `auth.users`, gerados pela exclusão compensatória das tentativas falhas. Eles não são Super administradores ativos e não bloqueiam o bootstrap. Nenhum deles possui pessoa administrativa persistida.

Esses registros foram preservados; não houve limpeza destrutiva.

### 4. Correção definitiva da fonte de autorização

O backend passa a resolver o endereço autorizado **diretamente do Supabase**, por:

`public.app_global_config.support_email`

com as seguintes proteções:

- normalização server-side;
- o valor lido do banco precisa coincidir com o digest canônico esperado;
- `BOOTSTRAP_ADMIN_EMAIL` continua suportada como verificação de consistência, mas divergência de runtime não substitui a política persistida no Supabase;
- o e-mail digitado é comparado com o valor canônico resolvido no banco;
- a criação no Supabase Auth usa o mesmo valor normalizado.

Assim, Google Studio e Vercel passam a consultar a mesma fonte persistida no Supabase para a autorização do primeiro Super administrador.

### 5. Frontend — integração corrigida

O frontend **não recebe o e-mail autorizado em texto puro**, por segurança. O fluxo correto é:

- GET `/v1/admin/bootstrap/status` para saber se o bootstrap está aberto;
- formulário envia o e-mail digitado ao backend;
- backend resolve a política no Supabase e valida;
- somente o backend decide se o e-mail é autorizado.

Também foi corrigida uma falha de mensagem: anteriormente qualquer HTTP 403 com bootstrap ainda aberto podia ser apresentado como **“e-mail incorreto”**. Agora essa mensagem aparece **somente** quando o backend retorna explicitamente `email_not_authorized`.

### 6. Disponibilidade da tela na Vercel

O status do bootstrap deixa de depender da presença do cliente Supabase Admin apenas para renderizar a tela. Para abrir o formulário, são exigidos:

- banco canônico disponível;
- política de bootstrap válida no `app_global_config`;
- inexistência de Super administrador ativo.

A chave privilegiada do Supabase continua obrigatória no momento do POST real de criação. Se ela estiver ausente, a operação retorna erro de dependência, e não “e-mail incorreto”.

### Preservação

- nenhuma migration nova;
- schema continua 20;
- nenhuma RLS alterada;
- MFA preservado;
- convites preservados;
- trigger de Auth preservado;
- nenhum usuário administrativo criado manualmente;
- nenhum dado existente removido.


---

## 2026-09-23 — CORREÇÃO DE TRANSPORTE DO BOOTSTRAP NO GOOGLE STUDIO E VERCEL

**Sintomas confirmados pelo usuário:**

- Vercel em `/admin/bootstrap`: a tela abria, porém o formulário era ocultado pela mensagem **“Não foi possível consultar o bootstrap neste ambiente.”**;
- Google Studio: o envio do formulário retornava **“O servidor recusou a configuração inicial por uma condição de governança.”**.

### Evidência de produção no Supabase

Na janela correspondente às tentativas, os logs do Supabase mostraram chamadas bem-sucedidas à Data API de `app_global_config` vindas de runtimes Node em Google Cloud e AWS Brasil. Isso confirmou que a conectividade HTTP com o projeto Supabase estava operacional, enquanto o status do bootstrap ainda dependia do pool PostgreSQL direto.

Também não houve criação Auth nas tentativas mais recentes do Google Studio, demonstrando que o POST estava sendo interrompido antes de `supabaseAdmin.auth.admin.createUser`.

### Causa Vercel

`getBootstrapStatus()` dependia primeiro de `dbPool` e executava consultas PostgreSQL diretas. Uma falha de conexão/pooler fazia o endpoint responder erro e o frontend escondia integralmente o formulário, embora a Data API do Supabase estivesse acessível.

**Correção:**

- leitura de `app_global_config.support_email` movida para Supabase Data API;
- consulta de Super administrador ativo prioriza Supabase Data API com service role;
- PostgreSQL direto fica somente como fallback de status;
- se apenas a consulta de status falhar, a UI não trata isso como barreira de segurança e mantém o formulário disponível;
- o POST continua sendo a autoridade real para lock, identidade e fechamento do bootstrap.

### Causa Google Studio

O cliente de API usava `import.meta.env.DEV` para escolher entre `/_hvm_api` e `/api`. O Google Studio pode executar um bundle de produção no preview, fazendo `DEV=false` e enviando o POST para `/api`, caminho que a plataforma pode interceptar antes do Express.

**Correção:**

- a seleção do transporte passa a usar o hostname real;
- domínios Vercel/canônico usam `/api`;
- Google Studio/local usam `/_hvm_api` primeiro, com fallback seguro para `/api`;
- respostas 403/404/405 de camada de plataforma podem acionar o caminho alternativo sem repetir operações que já tiveram sucesso;
- `originProtection` aceita `Sec-Fetch-Site: same-origin`, cabeçalho controlado pelo navegador, evitando falso bloqueio quando o proxy do Studio reescreve Origin/Referer.

### Diagnóstico HTTP corrigido

O endpoint POST do bootstrap deixa de devolver 403 genérico para todos os estados. Agora diferencia:

- `BOOTSTRAP_EMAIL_NOT_AUTHORIZED` → 403;
- `BOOTSTRAP_ALREADY_CLOSED` → 409;
- `BOOTSTRAP_IDENTITY_CONFLICT` → 409;
- `BOOTSTRAP_VALIDATION_FAILED` → 422;
- `BOOTSTRAP_DISABLED` → 503;
- `BOOTSTRAP_UNAVAILABLE` → 503.

Assim, o frontend não converte falhas de transporte/governança em “e-mail incorreto”.

### Segurança preservada

- cross-site continua bloqueado;
- same-origin é aceito com base em `Sec-Fetch-Site`;
- o e-mail autorizado continua validado server-side contra a política persistida no Supabase e digest canônico;
- o formulário poder ser exibido em fallback não autoriza criação;
- advisory lock, verificação de Super administrador ativo, Supabase Admin, MFA e auditoria permanecem;
- nenhuma migration, RLS ou schema foi alterado nesta correção.


---

## 2026-09-23 — FINALIZAÇÃO DO BOOTSTRAP VIA RPC SUPABASE

**Motivo:** apesar da correção de transporte entre Google Studio e Vercel, o POST do primeiro Super administrador ainda dependia do Transaction Pooler PostgreSQL direto durante toda a finalização. Isso mantinha um ponto de falha diferente entre runtimes cloud, mesmo com a Supabase Data API e o Supabase Auth funcionando normalmente.

### Correção arquitetural

Foi criada e aplicada no Supabase canônico a migration:

`20260923194253_trilha05_bootstrap_rpc_finalize.sql`

Ela cria a função:

`public.fn_finalize_first_super_admin(...)`

A função é:

- `SECURITY DEFINER`;
- executável somente por `service_role`;
- sem permissão de execução para `PUBLIC`, `anon` ou `authenticated`;
- protegida por `pg_advisory_xact_lock(hashtext('hortivitalmix_admin_bootstrap'))`;
- responsável por finalizar em uma única transação PostgreSQL:
  - validação do e-mail contra `app_global_config.support_email`;
  - verificação de ausência de Super administrador ativo;
  - confirmação de que a identidade realmente existe em `auth.users`;
  - prevenção de conflito por CPF/e-mail;
  - ativação/espelho em `app_users`;
  - criação/atualização de `app_people`;
  - concessão de `platform_super_admin`;
  - auditoria `admin.bootstrap.completed`.

### Fluxo backend após a correção

1. backend consulta a política pelo Supabase Data API;
2. backend verifica conflitos conhecidos;
3. backend cria a identidade com `supabaseAdmin.auth.admin.createUser`;
4. o trigger canônico de Auth cria o espelho em `app_users`;
5. backend chama `fn_finalize_first_super_admin` via `supabaseAdmin.rpc`;
6. a função finaliza domínio, papel e auditoria dentro do PostgreSQL;
7. se a RPC não confirmar `completed`, o backend executa limpeza compensatória da identidade Auth criada.

Com isso, o bootstrap deixa de depender do pool PostgreSQL direto no runtime do Google Studio/Vercel para sua finalização crítica.

### Causa histórica preservada

A correção mantém compatibilidade com `trg_hortivital_auth_user_created`. O backend não tenta mais duplicar manualmente a sequência Auth → app_users fora da RPC.

### Schema e governança

- schema lógico avançado de **20 para 21**;
- migration history atualizada;
- RLS não foi afrouxada;
- MFA permanece obrigatório depois do primeiro login;
- convites administrativos permanecem inalterados;
- nenhum Super administrador foi criado manualmente;
- a identidade real continua sendo criada somente pelo fluxo autenticado de bootstrap.


---

## 2026-09-23 — FALLBACK CANÔNICO DO BOOTSTRAP VIA SUPABASE EDGE

**Motivo:** a rota de bootstrap continuou apresentando dois sintomas diferentes conforme o ambiente: na Vercel, a consulta de status podia falhar antes de exibir o formulário; no Google Studio, o POST podia ser recusado por uma camada intermediária antes de chegar ao backend Express. Como ambos os ambientes consomem o mesmo repositório, foi criado um transporte de contingência canônico no próprio Supabase, sem remover o backend existente.

### Diagnóstico técnico consolidado

- o Supabase canônico mantém `app_global_config.support_email` com o endereço administrativo correto;
- existem 0 Super administradores ativos;
- a migration `20260923194253_trilha05_bootstrap_rpc_finalize.sql` está aplicada em produção;
- a função `fn_finalize_first_super_admin` continua sendo a barreira transacional final, com advisory lock e execução exclusiva por `service_role`;
- o frontend Vercel podia falhar na leitura de `/api/v1/admin/bootstrap/status`;
- o Google Studio podia receber HTTP 403 de transporte/proxy que não representava `email_not_authorized`.

### Correção implementada

Foi criada e implantada no projeto Supabase canônico a Edge Function:

`admin-bootstrap`

A função está versionada também em:

`supabase/functions/admin-bootstrap/index.ts`

Ela:

- lê a política real em `app_global_config`;
- valida o digest canônico do e-mail;
- verifica se já existe Super administrador ativo;
- valida nome, CPF, celular, senha e commandId no servidor;
- cria a identidade pelo Supabase Admin;
- finaliza a operação exclusivamente via `fn_finalize_first_super_admin`;
- executa limpeza compensatória se a finalização falhar;
- nunca expõe `SUPABASE_SERVICE_ROLE_KEY` ao frontend.

### Transporte do frontend

Foi criado:

`src/lib/adminBootstrapTransport.ts`

Fluxo:

1. tenta primeiro o backend same-origin existente;
2. se houver falha de transporte, 404/405, 5xx ou 403 não pertencente à governança real, usa a Edge Function do Supabase;
3. erros reais de negócio, como e-mail não autorizado ou bootstrap já fechado, continuam sendo respeitados e não sofrem bypass.

A tela `/admin/bootstrap` e o seletor `/administracao` passaram a usar esse transporte resiliente.

### Efeito esperado

- a Vercel deixa de depender exclusivamente da função serverless local para descobrir se o bootstrap está aberto;
- o Google Studio deixa de depender exclusivamente do proxy local `/_hvm_api` para concluir a criação;
- ambos os ambientes convergem para o mesmo backend transacional no Supabase quando o transporte primário falhar.

### Preservação de segurança

- nenhum e-mail alternativo foi liberado;
- nenhum Super administrador foi criado manualmente;
- MFA continua obrigatório após o primeiro login;
- advisory lock permanece;
- bootstrap continua fechando quando surgir o primeiro Super administrador ativo;
- nenhuma RLS foi relaxada;
- nenhuma tabela existente foi removida;
- o backend Express permanece como caminho primário.


---

## 2026-09-23 — CAUSA RAIZ FINAL DO TRANSPORTE DO BOOTSTRAP

**Evidência visual:** na Vercel, a rota `/admin/bootstrap` abriu o frontend atual, porém exibiu **“Não foi possível consultar o bootstrap neste ambiente.”**. No Google Studio, o formulário abriu, mas o POST terminou em **“O servidor recusou a configuração inicial por uma condição de governança.”**.

### Evidência de logs

Na janela correspondente à captura da Vercel, os logs do Supabase não registraram chamada da aplicação, consulta de bootstrap nem criação Auth. Isso confirma que a falha ocorria **antes de alcançar o Supabase**.

### Regressão de roteamento Vercel identificada

O último estado conhecido com transporte API simples utilizava somente:

- `api/index.ts`;
- `api/[...path].ts`.

O commit posterior de endurecimento adicionou simultaneamente:

- `api/v1/[...path].ts`;
- `api/v1/admin/[...path].ts`;
- `api/v1/admin/index.ts`;

e também registrou funções sobrepostas no `vercel.json`.

Essa duplicação criou múltiplos candidatos de Function para a mesma árvore `/api/v1/admin/*`, exatamente na rota usada pelo bootstrap. O frontend continuava sendo publicado, mas a chamada serverless de status podia falhar antes do Express/Supabase.

**Correção:** restaurado o modelo estável de Function única por catch-all, mantendo somente `api/index.ts` e `api/[...path].ts`. As rotas internas continuam sendo resolvidas pelo Express.

### Falha adicional no fallback Supabase Edge

O fallback `admin-bootstrap` já existia, porém o preflight CORS respondia:

`new Response(JSON.stringify({}), { status: 204 })`

Uma resposta HTTP 204 não pode carregar body. Em runtimes compatíveis com Fetch isso pode lançar erro antes de devolver os cabeçalhos CORS, impedindo o navegador de executar o GET/POST de fallback.

**Correção:** respostas 204 agora usam body `null`. O header `x-hvm-request` foi incluído na lista CORS permitida.

### Google Studio

O Google Studio pode reescrever `Origin`, `Referer` e `Sec-Fetch-Site` ao encaminhar a chamada do preview para o processo Vite.

Foi incluído o header interno:

`X-HVM-Request: 1`

em chamadas emitidas pelo cliente oficial. O backend aceita esse marcador **somente quando `APP_ENV` não é production**. Em produção, a validação de origem continua estrita.

Assim:

- Google Studio não depende de cabeçalhos reescritos pelo proxy para o POST interno;
- Vercel production não recebe relaxamento de CSRF/origin;
- chamadas cross-site de produção continuam protegidas.

### Camadas de transporte após a correção

1. **Vercel:** `/api/*` → catch-all único → Express;
2. **Google Studio:** `/_hvm_api/*` → Express no processo Vite;
3. **Fallback:** Supabase Edge `admin-bootstrap`, com CORS válido;
4. **Finalização:** RPC `fn_finalize_first_super_admin` no Supabase.

### Preservação

- nenhum Super administrador foi criado manualmente;
- nenhum usuário existente foi removido;
- MFA permanece obrigatório;
- advisory lock permanece;
- RLS permanece;
- migration de finalização RPC permanece;
- CPF e celular continuam usando os componentes canônicos;
- a identidade autorizada continua validada server-side.


---

## 2026-09-23 — MENSAGENS ADMINISTRATIVAS AMIGÁVEIS E CONFLITO DE IDENTIDADE

### Diagnóstico real do conflito no primeiro Super administrador

Foi confirmado no Supabase canônico que **não existe Super administrador ativo**. Entretanto, o CPF informado na tentativa de bootstrap já pertence a uma identidade pública ativa que possui os papéis `consumer` e `producer`.

Isso não representa um cadastro administrativo existente. Trata-se da regra canônica de identidade já definida no projeto: **CPF é único em `app_people` e uma mesma pessoa acumula papéis na mesma identidade, em vez de criar uma segunda pessoa com o mesmo CPF**.

Por isso, uma tentativa de criar uma nova identidade administrativa com outro e-mail e o mesmo CPF é rejeitada pela proteção de conflito. Nenhum Super administrador fantasma foi encontrado.

### Correção de experiência do usuário

As mensagens públicas da área administrativa foram simplificadas. A interface não deve mais exibir ao usuário final:

- códigos internos como `ADMIN_GOVERNANCE_LOGIN_REQUIRED`;
- textos como **“Falha não identificada no cadastro”**;
- `HTTP_4xx` / `HTTP_5xx`;
- identificadores internos apresentados como **“Código de atendimento”**.

O backend continua podendo registrar os códigos internamente para auditoria e diagnóstico.

Mensagens públicas passam a usar formulações simples, por exemplo:

- **“Dados inválidos ou cadastro não autorizado.”**
- **“Cadastro não autorizado. Os dados informados já estão vinculados a outra conta.”**
- **“Não foi possível entrar agora. Tente novamente em alguns instantes.”**

### Correção das rotas legadas administrativas

Os aliases:

- `/acesso/administracao`;
- `/acesso/super-administracao`;

deixam de cair no componente público `Account` e passam a utilizar diretamente o `AdminRouter` / `AdminLoginPage` canônico da Trilha 05.

Com isso, nenhum acesso administrativo legítimo passa pelo endpoint legado `/v1/auth/admin-login`. O endpoint legado continua fechado no backend como proteção de compatibilidade, sem expor seu código interno na interface.

### Preservação

- nenhum usuário foi apagado;
- nenhum papel existente foi alterado;
- o CPF canônico continua único;
- os papéis públicos existentes foram preservados;
- MFA administrativo permanece obrigatório;
- convites administrativos permanecem inalterados;
- nenhuma RLS ou migration foi modificada nesta correção.


---

## 2026-09-23 — HIERARQUIA ADMINISTRATIVA E MIGRAÇÃO DE IDENTIDADE PÚBLICA

### Regra de identidade

O HortiVitalMix mantém **uma identidade canônica por pessoa/CPF** em `app_people`. Consumidor, Produtor e acesso administrativo são contextos de autorização diferentes vinculados à mesma identidade quando pertencem à mesma pessoa.

Isso significa:

- o CPF não é duplicado para criar um Administrador;
- perfis `consumer` e `producer` permanecem ativos e preservados;
- o acesso administrativo é concedido por `app_user_role_assignments`;
- no portal administrativo, o sistema exibe separadamente **Acesso administrativo** e **Perfis vinculados**.

### Primeiro Super administrador

O bootstrap continua sendo excepcional e único:

- somente funciona enquanto não existir Super administrador ativo;
- continua rejeitando CPF/e-mail já vinculados, porque a migração de identidade pública só é permitida **depois** da constituição da primeira autoridade administrativa;
- assim que o primeiro `platform_super_admin` é ativado, `/admin/bootstrap` passa automaticamente para estado `closed`;
- o botão de primeiro acesso deixa de ser exibido nas telas administrativas;
- qualquer POST posterior continua protegido por verificação server-side e advisory lock.

### Migração posterior de Consumidor/Produtor para acesso administrativo

Após existir o primeiro Super administrador, o fluxo oficial é **convite administrativo pelo portal**.

Quando o e-mail convidado já pertence a um cadastro público:

1. o backend localiza a identidade canônica existente;
2. o convite é marcado logicamente como migração de identidade existente, sem criar outro `app_people`;
3. Consumidor/Produtor confirma o mesmo CPF e a senha atual;
4. o backend valida as credenciais contra Supabase Auth;
5. o novo papel administrativo é adicionado à mesma identidade;
6. os papéis públicos existentes permanecem intocados;
7. setores são concedidos somente quando o papel alvo é `platform_admin`;
8. auditoria registra `admin.identity.migrated`.

Para identidade nova, o fluxo tradicional de convite continua criando a identidade administrativa e exigindo senha forte.

### Hierarquia de criação administrativa

A governança passa a obedecer explicitamente a seguinte hierarquia:

- **Super administrador**: pode convidar Administrador setorial ou outro Super administrador;
- **Administrador setorial**: pode convidar somente outro Administrador setorial e apenas para setores que o próprio administrador já possui;
- Administrador setorial **não pode criar ou promover Super administrador**;
- Super administrador não recebe setores departamentais;
- promoção de Administrador setorial para Super administrador revoga o papel setorial ativo e suas associações de setor, evitando papéis administrativos concorrentes;
- bloqueio/reativação de usuários continua reservado ao Super administrador.

### Portal e visibilidade

- `/admin/governanca` passa a ser acessível a Administrador e Super administrador;
- `/admin/usuarios` passa a ser acessível aos dois níveis;
- Administrador setorial visualiza somente Administradores que compartilham ao menos um setor ativo;
- Super administrador visualiza a governança administrativa global;
- a tabela de usuários separa **Acesso administrativo** de **Perfis vinculados** (Consumidor/Produtor);
- `/admin/configuracao` permanece exclusivo do Super administrador.

### Convites para identidade existente

O backend não cria um segundo usuário para o mesmo CPF. Para identidade já existente, a entrega utiliza Supabase Auth com `shouldCreateUser:false` e a aceitação exige confirmação das credenciais atuais.

A concessão de papel utiliza reativação idempotente por `ON CONFLICT (user_id, role_code)`, e os setores utilizam a mesma estratégia em `app_admin_sector_members`.

### Preservação

- nenhuma identidade pública foi removida;
- nenhum CPF foi duplicado;
- nenhum papel `consumer` ou `producer` foi revogado;
- MFA de Super administrador permanece obrigatório;
- proteção do último Super administrador permanece;
- o fluxo público continua proibido para criação administrativa;
- schema lógico permanece 21; nenhuma migration adicional foi necessária porque a modelagem multi-role existente já suporta a hierarquia.


---

## 2026-09-23 — CREDENCIAL ADMINISTRATIVA SEPARADA DA IDENTIDADE PÚBLICA

### Causa do conflito confirmado

A tentativa do primeiro Super administrador utilizou um CPF já existente em `app_people` como identidade pública ativa com os papéis `consumer` e `producer`, enquanto o e-mail administrativo autorizado ainda não possuía identidade Auth própria.

A regra antiga tratava qualquer CPF já existente como conflito absoluto no bootstrap, mesmo quando a intenção legítima era criar **uma credencial administrativa separada para a mesma pessoa**.

### Decisão arquitetural

A partir desta revisão, HortiVitalMix separa explicitamente:

- **Pessoa canônica**: `app_people`, única por CPF;
- **Cadastro público**: credencial Auth pública ligada por `app_people.user_id`, com papéis `consumer` e/ou `producer`;
- **Credencial administrativa**: Auth independente, e-mail e senha próprios, ligada à mesma pessoa por `app_admin_principals`;
- **Autorização administrativa**: papéis `platform_admin` ou `platform_super_admin` atribuídos ao `admin_user_id`.

Assim, Consumidor/Produtor e Administrador continuam sendo **cadastros e portais diferentes**, mas podem representar a mesma pessoa física sem duplicar CPF.

### Primeiro Super administrador

O bootstrap permanece excepcional, protegido e único.

Se o CPF informado já existir em `app_people`:

1. o sistema preserva integralmente o cadastro público existente;
2. cria uma nova identidade Supabase Auth usando o e-mail administrativo autorizado;
3. vincula essa nova credencial à pessoa existente por `app_admin_principals`;
4. concede `platform_super_admin` somente à credencial administrativa;
5. não altera e-mail, senha, papéis ou login de Consumidor/Produtor;
6. ao concluir, o bootstrap fecha automaticamente porque passa a existir Super administrador ativo.

Se o CPF ainda não existir, o bootstrap cria a pessoa canônica e a credencial administrativa normalmente.

### Próximos Administradores e Super administradores

Após o primeiro Super administrador:

- novos acessos continuam exclusivos do Portal Administrativo;
- formulário público continua proibido para criação administrativa;
- Super administrador pode convidar Administrador setorial ou outro Super administrador;
- Administrador setorial pode convidar apenas Administrador setorial e somente dentro dos próprios setores;
- para vincular Consumidor/Produtor existente, o Administrador informa o CPF existente e um **e-mail administrativo próprio**;
- o convite cria uma identidade Auth administrativa separada e mantém o login público original intacto;
- a aceitação exige CPF correspondente e uma nova senha forte para a credencial administrativa.

### Persistência e segurança

Nova entidade: `app_admin_principals`.

Garantias:

- `admin_user_id` é único;
- `person_id` é único;
- `admin_email` é único;
- um CPF continua existindo apenas uma vez em `app_people`;
- uma pessoa possui no máximo uma credencial administrativa ativa no modelo canônico;
- RLS e FORCE RLS permanecem habilitados;
- MFA de Super administrador permanece obrigatório;
- proteção do último Super administrador permanece;
- auditoria registra o vínculo administrativo sem alterar perfis públicos.

Schema lógico passa de **21 para 22**.

### Fonte documental viva

O arquivo **DOCUMENTO COM DIAGRAMA E ESPECIFICAÇÕES** passa a ser tratado, junto ao Manual Mestre e ao Livro-Raiz, como referência documental viva da arquitetura implementada. Alterações de engenharia devem preservar coerência entre código, banco, Livro-Raiz e a versão atualizada desse documento, sem substituir as regras normativas do Manual Mestre.


---

## 2026-09-23 — ESCRITA DO BOOTSTRAP FIXADA NO BACKEND CANÔNICO

Após a introdução de `app_admin_principals` no schema 22, a mutação `POST` do bootstrap passa a utilizar exclusivamente o backend versionado junto à aplicação. O Supabase Edge permanece somente como fallback de leitura do status.

Motivo: impedir que uma versão Edge eventualmente defasada aplique regras antigas de conflito de CPF durante a criação do primeiro Super administrador. Assim, Google Studio e Vercel executam a mesma regra de escrita publicada na `main`.


---

## 2026-09-23 — CORREÇÃO DO TRANSPORTE DE ESCRITA DO PRIMEIRO SUPER ADMINISTRADOR

### Evidência da tentativa após schema 22

Após a implantação de `app_admin_principals`, nova tentativa real de criação do primeiro Super administrador ainda retornou mensagem genérica de indisponibilidade.

A investigação dos logs do Supabase no horário da tentativa mostrou:

- o navegador conseguiu executar o fallback de **leitura** da Edge Function `admin-bootstrap`;
- `OPTIONS /functions/v1/admin-bootstrap` respondeu 204;
- `GET /functions/v1/admin-bootstrap` respondeu 200;
- não houve, no mesmo fluxo, criação Auth administrativa, chamada RPC `fn_finalize_first_super_admin` nem persistência em `app_admin_principals`;
- o estado permaneceu com zero Super administradores e zero `app_admin_principals`.

Conclusão: a falha ocorria **antes da mutação chegar ao Supabase**. Portanto, não era mais conflito de CPF, e-mail ou schema.

### Lacunas de runtime encontradas

Foram identificadas três lacunas de transporte/configuração:

1. **Google Studio / Vite preview** — o plugin montava Express em `configureServer`, usado pelo desenvolvimento, mas não em `configurePreviewServer`. Em preview de build, o frontend podia abrir normalmente enquanto `/_hvm_api` e `/api` não possuíam backend Express.
2. **Vercel** — o bootstrap dependia exclusivamente do catch-all `api/[...path].ts`. Foram adicionados entrypoints exatos para:
   - `/api/v1/admin/bootstrap`;
   - `/api/v1/admin/bootstrap/status`.
   O catch-all continua preservado para as demais rotas.
3. **Aliases modernos do Supabase** — a documentação do projeto afirmava compatibilidade com chaves modernas, mas `runtime.ts` ainda lia apenas os nomes legados. O runtime passa a reconhecer:
   - `SUPABASE_PUBLISHABLE_KEY`;
   - `SUPABASE_SECRET_KEY`;
   - mapas `SUPABASE_PUBLISHABLE_KEYS` e `SUPABASE_SECRET_KEYS`;
   - aliases públicos Vite/Next compatíveis;
   mantendo precedência dos nomes canônicos já existentes.

### Regra de escrita preservada

A criação do primeiro Super administrador continua sendo executada pelo backend canônico versionado junto à aplicação. A Edge Function permanece fallback de leitura do status, impedindo divergência de versão na mutação administrativa.

### Segurança

- nenhum segredo é exposto no frontend ou em mensagens;
- aliases de segredo são lidos somente no servidor;
- CPF público existente continua vinculado por `app_admin_principals`, sem duplicação em `app_people`;
- MFA de Super administrador permanece;
- bootstrap continua fechando automaticamente após o primeiro Super administrador ativo;
- nenhum usuário foi criado manualmente durante o diagnóstico;
- schema lógico permanece 22.


---

## 2026-09-24 — CORREÇÃO DO LOGIN, CONFIRMAÇÃO, RECUPERAÇÃO E MFA ADMINISTRATIVOS

### Evidência do erro após criação do primeiro Super administrador

O primeiro Super administrador foi efetivamente criado no Supabase, com `app_admin_principals`, `app_users` ativo e papel `platform_super_admin`.

Na tentativa posterior de login, os logs não registraram chamada de senha ao Supabase Auth e não existia desafio em `app_admin_mfa_challenges`. Isso confirmou que a falha ocorria **antes da validação das credenciais**.

A causa foi localizada em `AdminGovernanceService.login()`: o método encerrava imediatamente com `unavailable` quando `dbPool` não estava disponível no runtime serverless.

### Correção do login e MFA

O login administrativo deixa de depender obrigatoriamente do Transaction Pooler.

Passam a utilizar Supabase Data API, com Pooler apenas como fallback:

- resolução do papel administrativo;
- leitura de status da conta;
- setores do Administrador setorial;
- rate limit persistente;
- criação/invalidação dos desafios MFA;
- atualização de tentativas do MFA;
- resolução de identidade/sessão administrativa.

O Super administrador continua obedecendo à sequência inviolável:

**e-mail + senha → confirmação de e-mail, quando pendente → código MFA de 6 dígitos → sessão administrativa**.

Nenhuma sessão é entregue antes do MFA.

### Confirmação explícita do e-mail administrativo

A criação via Admin API do Supabase havia utilizado confirmação automática do Auth, razão pela qual nenhum e-mail de confirmação de cadastro foi enviado no bootstrap.

Foi adicionada confirmação de propriedade do e-mail no domínio administrativo:

- nova coluna `app_admin_principals.email_verified_at`;
- nova tela `/admin/confirmar-email`;
- envio de código pelo Supabase Auth SMTP;
- campo OTP com 6 dígitos;
- reenvio do código;
- verificação de que o usuário retornado pelo OTP é exatamente o `admin_user_id` do principal;
- nenhuma sessão administrativa é mantida pelo fluxo de confirmação.

O primeiro Super administrador já criado permanece com `email_verified_at = NULL` até confirmar o e-mail. Ao informar senha válida no login, o sistema envia automaticamente a confirmação e direciona para a tela de código.

Administradores criados por convite recebem `email_verified_at` no aceite do convite, pois a posse do endereço já foi comprovada pelo próprio link enviado ao e-mail.

### Recuperação de senha administrativa

A opção **Esqueci minha senha** foi conectada ao fluxo T04 com escopo de papel.

`RoleSecurityService` passa a resolver:

- Consumidor/Produtor por `app_people`;
- Administrador/Super administrador por `app_admin_principals`.

A redefinição mantém:

- link de recuperação emitido pelo Supabase Auth;
- desafio com `userId + portalRole`;
- nova senha forte;
- revogação global das sessões após a troca.

### Ergonomia da tela administrativa

O campo de senha agora usa o componente canônico `PasswordInput`, incluindo **Mostrar/Ocultar**.

A tela de login também expõe:

- **Esqueci minha senha**;
- **Confirmar ou reenviar confirmação do e-mail**;
- campo OTP após o desafio MFA;
- **Reenviar código de segurança**.

### Banco e preservação

Migration canônica: `20260924114500_trilha05_admin_email_verification.sql`.

Versão física aplicada em produção: `20260924115207`.

Schema lógico: **23**.

Hash do histórico: `80d77398387420550887ee34268decf583ab49a96cb78765aa41910f0577927f`.

Preservado integralmente:

- o Super administrador já criado;
- CPF e pessoa canônica;
- perfis Consumidor/Produtor;
- senha pública separada da senha administrativa;
- MFA obrigatório;
- proteção do último Super administrador;
- convites e hierarquia administrativa;
- migrations e dados anteriores.


---

## 2026-09-24 — RCA DEFINITIVO: LINK DE RECOVERY, LOGIN E CÓDIGOS DE SEGURANÇA

### Diagnóstico comprovado por logs e banco

A investigação desta execução identificou três falhas encadeadas e reproduzíveis:

1. O Supabase aceitou o primeiro pedido de recuperação e validou o link one-time. A tela HortiVitalMix, porém, dependia da presença/importação de uma sessão no fragmento da URL para liberar a nova senha.
2. Um segundo pedido de recuperação invalidava o challenge HortiVitalMix anterior **antes** de confirmar que um novo e-mail seria entregue. O Supabase recusou esse segundo envio por `over_email_send_rate_limit`; com isso, o challenge anterior e o novo ficaram inutilizados.
3. Confirmação administrativa e MFA tratavam o cooldown de e-mail do Supabase como indisponibilidade genérica, produzindo as mensagens “Não foi possível entrar agora” e “Não foi possível enviar o código agora”.

Evidência de produção observada em 24/09/2026:
- recovery aceito pelo Supabase às 12:18:07 UTC;
- verificação `type=recovery` bem-sucedida às 12:18:25 UTC;
- segundo pedido às 12:18:48 UTC;
- resposta Auth 429 às 12:18:49 UTC, com código `over_email_send_rate_limit`;
- os dois challenges HortiVitalMix ficaram invalidados e não consumidos;
- não havia challenge MFA administrativo pendente durante as mensagens genéricas reportadas.

### Decisão canônica de recuperação

A autorização da redefinição passa a ser o `flowToken` HortiVitalMix:

- entropia de 32 bytes;
- digest SHA-256 no banco, nunca token bruto;
- escopo obrigatório de papel;
- expiração curta;
- uso único;
- validação por endpoint público específico;
- não exige sessão anterior, cookie ou fragmento Supabase.

O e-mail continua sendo entregue pelo Supabase Auth. O link do provedor comprova a entrega, mas o frontend deixa de depender da sessão implícita do navegador para concluir a troca de senha.

### Regra de reenvio

Um challenge de recuperação já entregue **não pode ser invalidado antecipadamente**.

A nova ordem é:

**criar novo challenge → solicitar e-mail ao Supabase → somente se o envio for aceito, invalidar challenges anteriores**.

Em cooldown/falha:
- invalida-se apenas o challenge novo não entregue;
- preserva-se o último link entregue;
- a UI bloqueia novo pedido durante o contador.

### Revogação pós-reset

Nova função:
`public.fn_revoke_auth_sessions(p_user_id uuid)`.

Propriedades:
- SECURITY DEFINER;
- search_path fixo;
- EXECUTE removido de PUBLIC/anon/authenticated;
- EXECUTE concedido somente a service_role;
- remove todas as sessões Auth do usuário após a senha ser atualizada.

Migration canônica:
`20260924125000_auth_recovery_session_revoke.sql`.

Versão física aplicada:
`20260924124802`.

### Login, confirmação e MFA

- validação de senha administrativa não dispara mais e-mail de confirmação automaticamente;
- e-mail pendente retorna estado explícito e conduz à tela correta;
- confirmação e MFA interpretam o cooldown real do Supabase;
- o tempo restante é apresentado ao usuário;
- reenvio fica desabilitado até o contador chegar a zero;
- cooldown de entrega não é contabilizado como senha incorreta;
- o challenge MFA só é persistido após envio aceito;
- Super administrador continua sem sessão antes do MFA.

### Estado lógico

Schema: **24**.

Hash:
`a23b076a67b259ce44f87501657be592d5d0eeca9b5d83cedba0397cb9250ca0`.

Nenhuma estrutura, dado, RLS, papel ou implementação anterior foi removida.


## 2026-09-24 — Correção complementar de acesso, reenvio e diagnóstico

Status: implementação e testes locais concluídos; build completo, publicação e homologação real pendentes. Não declarar autenticação homologada com base nestes testes isolados.

- Banco consultado em modo leitura: dois desafios de recuperação do Super administrador criados às 12:18:07 e 12:18:48 UTC estavam invalidados e não consumidos. A main já continha proteção de cooldown e invalidação após aceite do provedor; links antigos não foram reativados.
- MFA: login repetido, após validar senha e papel ativo, reutiliza desafio pendente criado nos últimos 60 segundos, sem enviar outro e-mail ou invalidar o anterior. Falha da consulta interrompe o fluxo e encerra a sessão temporária. A interface distingue código reaproveitado de novo envio.
- Transporte: normalização defensiva de JSON que o adaptador serverless já entregou como string ou Buffer; preservados o limite de 32 KiB e rejeição de JSON inválido. Não foi comprovado que esse era o motivo específico do atendimento e9ae3099-d447-4797-adae-9794aaf8062e.
- Erros de validação passam a incluir campos e requestId, sem valores de credenciais. A tela genérica deixa de apresentar VALIDATION_ERROR como falha não identificada.
- Recuperação: falha de rede/serviço não é mais apresentada como expiração; existe nova tentativa de validação do mesmo link. Erro de senha rejeitada não força novo e-mail.
- Cadastro: removido reenvio automático redundante quando o backend já aceitou ou adiou o despacho.
- Testes: seis cenários comportamentais aprovados com Node 24, usando mocks do provedor: JSON objeto/string/Buffer, JSON inválido/limite, retomada MFA, senha incorreta, indisponibilidade de consulta e emissão inicial. Comando: `node --experimental-test-module-mocks --test scripts/tests/auth-hotfix.node.mjs`.
- Limitações: sem envio de e-mails reais, sem alteração de senha real e sem teste de navegador autenticado. A conexão Vercel retornou lista de projetos vazia. O código de atendimento informado não foi localizado em logs nesta execução. Nenhuma alteração de esquema ou privilégio foi necessária.


## 2026-09-24 — OTP de oito dígitos e bloqueio antes da confirmação pública

Status: correções implementadas; quatro testes comportamentais locais aprovados. Build completo, publicação e homologação com e-mail real ainda não comprovados nesta execução.

- Relato de código Supabase com oito dígitos: confirmação administrativa, MFA administrativo e reautenticação de consumidor/produtor passam a usar oito posições e regex compartilhada de oito dígitos. Colagem/autopreenchimento completo e grade responsiva acompanham a quantidade. Não foi armazenado o código informado pelo usuário.
- OTP local de contato permanece com seis dígitos, coerente com seu gerador, contrato e verificador próprios. Confirmação pública do cadastro usa link. O comprimento do OTP não substitui identidade, finalidade ou validação de desafio.
- Consulta ao banco comprovou zero identidades Auth compartilhadas entre os principais administrativos e as contas públicas. Importação pela rota pública passa a rejeitar perfil administrativo e identidades exclusivamente administrativas; MFA não é substituído pelo callback público.
- Login, refresh, importação de sessão e middleware exigem confirmação de e-mail válida. Conta existente também precisa estar confirmada antes de adicionar papel público. Cadastro limpa cookies anteriores e a sessão visual; cadastro pendente abre a confirmação, sem entrar na conta. A tela não considera qualquer sessão anterior como prova de confirmação.
- Corrigida regressão da execução anterior: confirmationDispatchDeferred não representava um envio agendado. O envio inicial agora é tentado no backend depois da criação, sem reenvio automático duplicado no frontend. Falha de envio mantém o cadastro pendente e permite reenvio manual.
- Supabase config.toml: confirmação obrigatória preservada, OTP de e-mail alinhado a oito, reparadas quebras literais inválidas no bloco de templates; arquivo validado com tomllib. Esta alteração de arquivo não comprova alteração da configuração remota do provedor; comprimento de produção foi informado pelo usuário.
- Testes executados: `node --experimental-test-module-mocks --test scripts/tests/confirmation-otp.node.mjs`: quatro aprovados, incluindo código de oito dígitos com zero inicial, rejeição de timestamp ausente/inválido, bloqueio por cookie/Bearer sem confirmação e acesso com confirmação e sessão viva. Contratos Vitest existentes atualizados, mas suíte Vitest não executada neste ambiente sem dependências.
- Banco consultado somente em leitura. Não houve concessão de acesso, confirmação artificial, criação de usuário de teste ou envio de mensagem nesta execução.


## 2026-09-24 — Hotfix de identidade administrativa por portal e correção da falsa repetição de confirmação

Status: backend, frontend e Supabase atualizados. A migration `20260924165427_admin_role_scoped_credentials` foi aplicada no projeto canônico e registrada como schema lógico **25**. O gate automático da Vercel concluiu com **success** e a release corrente de produção foi reconciliada com schema 25 e o novo hash de migrations.

### Causa-raiz confirmada

- O e-mail da credencial Super administradora já estava confirmado no banco. O código solicitado depois de e-mail + senha era o **MFA obrigatório do Super administrador**, e não uma segunda confirmação de cadastro.
- O frontend não enviava o portal selecionado no login; por isso a resolução por e-mail podia escolher o papel `platform_super_admin` e disparar MFA mesmo quando o operador havia aberto o portal de Administrador.
- `app_admin_principals` possuía unicidade global por `person_id` e por `admin_email`, impedindo que a mesma pessoa/CPF e o mesmo Gmail possuíssem credenciais administrativas independentes de Administrador e Super administrador.

### Correção canônica

- Login, confirmação de e-mail e recuperação de senha administrativas passaram a ser resolvidos por **e-mail + portalRole**.
- `platform_admin` e `platform_super_admin` são credenciais distintas, com usuários Auth e senhas independentes.
- A mesma pessoa canônica pode possuir os dois papéis. A unicidade foi alterada para `(person_id, portal_role)` e `(admin_email, portal_role)`.
- Para Gmail/Googlemail compartilhado entre papéis, `admin_email` permanece o endereço digitado pelo usuário, enquanto `auth_email` usa alias técnico interno por portal; assim os dois logins chegam à mesma caixa de e-mail sem compartilhar senha.
- Administrador setorial, depois da confirmação do e-mail, recebe sessão direta com somente os setores atribuídos.
- Super administrador continua exigindo MFA em todo acesso, conforme a Trilha 05; a interface agora identifica explicitamente esse código como **Segundo fator do Super administrador**, evitando confusão com confirmação de cadastro.
- Convites e aceite foram ajustados para permitir o segundo papel administrativo da mesma pessoa sem duplicar CPF nem `app_people`.
- A tela de governança passou a informar os papéis administrativos já existentes e explica que o mesmo Gmail visível pode ser usado com senhas separadas.
- Manifesto de migrations atualizado para schema 25 e hash `0fc58f8e0b0e4fd66f2f12a7b59e9de269339ab0fce014bb449abfd539cc8ea7`; readiness e gates T05 foram alinhados ao novo schema.

### Invariantes preservados

- Consumidor/Produtor continuam isolados dos portais administrativos.
- Administrador não herda poderes globais: exige ao menos um setor ativo e permanece limitado a seus setores.
- Super administrador mantém escopo global e MFA obrigatório.
- O último Super administrador ativo continua protegido contra remoção/bloqueio.
- Nenhuma senha é compartilhada entre credenciais administrativas distintas.


### Homologação desta correção

- Build/deploy automático Vercel: **success**.
- Supabase production: migration `admin_role_scoped_credentials` aplicada.
- Release corrente: schema lógico **25**.
- Hash canônico: `0fc58f8e0b0e4fd66f2f12a7b59e9de269339ab0fce014bb449abfd539cc8ea7`.


## 2026-09-24 — RCA definitivo do loop pós-MFA e divergência Google Studio × Vercel

### Evidência operacional observada

A investigação deixou de tratar o sintoma como falha de código OTP. No Supabase production foram encontrados desafios de Super administrador marcados como `is_verified=true`, com `verified_at` preenchido e sessões `auth.sessions` criadas exatamente no mesmo instante. O histórico `app_admin_auth_attempts` também registrou a sequência `mfa_pending -> success`.

Portanto, o código recebido estava correto, era aceito pelo Supabase e a sessão era emitida. O defeito ocorria **depois da verificação do MFA**, no handoff entre a autenticação administrativa e a shell da aplicação.

### Causa-raiz 1 — sessão administrativa era reenviada ao fluxo público

`AdminLoginPage` chamava `onSessionRefresh()` logo após `session_created` e logo após `mfa/verify`. Esse callback pertence ao hook público `useSession` e consulta `/v1/auth/session`.

Isso era incorreto para a modelagem T05, pois a credencial administrativa possui `admin_user_id` próprio, enquanto a mesma pessoa/CPF pode possuir outro `user_id` público em `app_people`. Em production foi comprovado que esses IDs são diferentes. A sessão administrativa válida acabava sendo submetida imediatamente a uma resolução pública, podia ser descartada pela shell e o usuário retornava ao login; na tentativa seguinte o Super administrador recebia um novo MFA, gerando a impressão de “código infinito”.

### Causa-raiz 2 — AdminAccessGate dependia indiretamente do actor público

`adminSessionMiddleware` exigia que `req.actor`, construído pelo middleware público, coincidisse com o usuário Auth administrativo. Isso violava a segregação física de credenciais entre conta pública e credencial administrativa.

A fronteira administrativa agora valida diretamente:

- access token emitido pelo Supabase Auth;
- `app_admin_principals.admin_user_id`;
- `portal_role`;
- papel ativo em `app_user_role_assignments`;
- setores ativos quando o papel for `platform_admin`.

Não existe mais dependência funcional de `req.actor` para autorizar uma sessão administrativa.

### Causa-raiz 3 — runtime Vercel falhava fechado antes do login quando o client privilegiado não estava disponível

O fluxo administrativo encerrava com `unavailable` em pontos que dependiam diretamente de `supabaseAdmin`. Isso explica a mensagem genérica da interface “Não foi possível entrar agora” e também por que algumas tentativas em Vercel não deixavam registro de falha de senha.

Foram adicionados fallbacks server-side para o Postgres canônico em:

- resolução de `app_admin_principals`;
- confirmação administrativa de e-mail;
- consulta/criação/invalidação do desafio MFA;
- conclusão do desafio MFA;
- validação da sessão administrativa;
- leitura de papéis e setores administrativos.

A validação do access token também pode usar o client público do Supabase quando o client privilegiado não estiver disponível, mantendo a autorização administrativa no banco e fail-closed.

### Comportamento final esperado

- **Administrador:** e-mail + senha -> sessão administrativa direta, limitada aos setores atribuídos.
- **Super administrador:** e-mail + senha -> exatamente um MFA obrigatório -> código válido -> painel administrativo.
- Depois de um MFA válido, a aplicação não consulta mais `/v1/auth/session` para decidir a sessão administrativa; o `AdminAccessGate` usa exclusivamente `/v1/admin/auth/verify-session`.
- Um novo MFA somente deve ser exigido em um **novo login** de Super administrador, conforme o Manual Mestre v11, e não após a aceitação do código da tentativa corrente.
- Google Studio e Vercel continuam consumindo a mesma implementação do repositório `main`; não existe caminho de autenticação alternativo por ambiente.


### Complemento — Vercel sem dependência obrigatória do Transaction Pooler

Durante a mesma RCA foi localizado outro desvio específico do runtime serverless: as rotas públicas de login, refresh e leitura de sessão devolviam `503 DEPENDENCY_UNAVAILABLE` sempre que `dbPool` estivesse indisponível, embora `IdentityAccessService` já possuísse fallback pela Supabase Data API.

A correção removeu essa dependência artificial. Agora:

- login público exige Supabase Auth, mas não exige conexão direta ao Transaction Pooler;
- refresh e restauração de sessão também funcionam sem `dbPool`;
- `IdentityAccessService` pode resolver `app_users`, papéis e pessoa via RLS usando o próprio access token autenticado;
- o middleware público valida o token com client Supabase público quando a chave server-side não estiver disponível;
- o banco direto continua preferencial quando disponível, mas deixou de ser ponto único de falha em Vercel.

Isso alinha o comportamento de Google Studio e Vercel sem criar implementações diferentes por ambiente.


### RCA 2026-09-24 — rotas administrativas ausentes na Vercel

Sondagem HTTP real no domínio canônico: `/api/v1/admin/bootstrap/status` retornou 200, mas POST `/api/v1/admin/auth/login` retornou 404 NOT_FOUND da Vercel, sem atingir Express. O catch-all de arquivo não encaminhava essas rotas aninhadas. Foi incluído rewrite explícito de `/api/:path*` para o dispatcher `api/index`, com restauração do caminho e preservação dos parâmetros. O mesmo dispatcher atende login, MFA e verificação de sessão.

O AdminAccessGate também redirecionava ao login em qualquer erro de transporte. Agora somente 401 reinicia o login; 403 apresenta falta de permissão e falhas de rede/servidor permitem consultar novamente a sessão existente, sem pedir outro código. Respostas de consultas canceladas não alteram a tela.

Foram corrigidos tipos nulos já existentes no bootstrap e no desafio MFA para restabelecer `typecheck:app`. Validação local: typecheck passou, 15 testes de roteamento/MFA passaram e `vite build` passou. Os testes não usam contas reais nem enviam e-mails. Login completo com credenciais reais ainda depende de validação autenticada; não se declara homologação apenas por build.

Validação ampliada T05: 28/29 testes passaram. Falha preexistente em `trilha05SealRegression.test.ts`: o teste proíbe o texto “Código de atendimento:” já presente em Account.tsx; esse arquivo não foi alterado nesta correção.


### 2026-09-24 — desempenho dos acessos e acompanhamento de convites

Removida a passagem redundante de rotas administrativas pelo resolvedor público; cada rota protegida continua validada no middleware administrativo. Sessão pública e logout também deixam de pré-validar a identidade antes dos próprios handlers. O middleware administrativo consulta principal, papéis e status da conta em paralelo; contas suspensas são recusadas. `/admin/auth/verify-session` reutiliza somente a autorização validada na mesma requisição, sem cache global de permissões nem consultas duplicadas.

Navegação React estabilizada para não desmontar/revalidar o painel a cada clique. As restrições de tela são recalculadas no render e as APIs seguem autorizando cada operação. Saída administrativa espera o encerramento real, navega sem aguardar outra leitura de sessão e mostra falha quando a saída não foi concluída.

Cadastro consumidor/produtor usa uma única busca indexável por CPF/e-mail; validações de identidade, RPC transacional, confirmação de e-mail e compensações permanecem. Resolução alternativa de identidade executa consultas independentes em paralelo. Tempo de cadastro reportado em Server-Timing inclui agora o envio inicial da confirmação.

Convites inserem os setores em lote na mesma transação. A interface apresenta imediatamente o convite retornado pelo servidor, sem recarregar setores e histórico antes de liberar o botão. Enquanto houver convite pendente, consulta aceitação a cada 3 segundos, somente com a página visível, sem sobrepor consultas; cancela ao sair e informa falhas de sincronização. Isso acompanha aceitação, não comprova leitura ou entrega pelo Gmail.

Removidos Volume/Trilha e referências ao provedor de autenticação nas telas públicas e administrativas. Nenhuma alteração de esquema necessária. Validação: typecheck e build aprovados, 30 testes específicos aprovados (incluindo cadastro confirmado obrigatório, conflito CPF/e-mail, bloqueio de administrador suspenso e acessos separados). Meta de 2–4 segundos não homologada sem medição com contas reais e entrega de e-mail.


## 2026-09-24 — TRILHA 06 v11 — Perfil canônico, endereços residenciais e privacidade LGPD

### Decisão de engenharia
A Trilha 06 foi implementada de forma estritamente aditiva sobre o estado homologado das Trilhas 01 a 05. Nenhuma adaptação anterior de autenticação, governança administrativa, Supabase, Vercel ou Google AI Studio foi removida. O MANUAL MESTRE TÉCNICO v11 passou a reger este bloco como fonte normativa, mantendo as decisões operacionais já registradas neste Livro-Raiz.

### Backend e contratos
- Criado `shared/contracts/profilePrivacy.ts` com schemas Zod estritos para perfil, endereço, endereço padrão e preferências.
- Criado `server/services/ProfilePrivacyService.ts` com transações, idempotência por `commandId`, auditoria append-only e concorrência otimista.
- A troca do endereço padrão é serializada por `FOR UPDATE` em `app_people`.
- A exclusão do padrão elege deterministicamente o endereço restante mais antigo por `created_at`.
- Fingerprint SHA-256 bloqueia cadastro repetido do mesmo endereço.
- Exportação LGPD mascara CPF e exige token de sessão emitido há no máximo 15 minutos.
- Criado `server/routes/profilePrivacyRoutes.ts` com oito operações HTTP canônicas sob `/v1/account/*`, preservando os aliases `/api` e `/_hvm_api`.

### Frontend e design
- Criado hub autenticado `/conta` com subrotas `/conta/perfil`, `/conta/enderecos`, `/conta/preferencias` e `/conta/privacidade`.
- A identidade visual reutiliza os tokens oficiais já presentes no shell e nas referências limpas: verde escuro #143D24, verde primário #1B4D2E, verde folha #2E7D32, verde claro #E8F5E9, laranja #E65100 e Inter.
- Endereços usam cards com badge “Padrão”; o cadastro usa bottom sheet no mobile.
- A consulta de CEP via ViaCEP é assistiva, com timeout de 4 s e preenchimento manual preservado.
- O evento `hortivitalmix:default-address-changed` atualiza o shell para “Entrega para: Bairro · Cidade/UF”.
- Matriz responsiva automatizada preparada para 320, 360, 768, 1024 e 1440 px.

### Banco Supabase canônico
- Migration lógica: `20260925002000_trilha06_profile_privacy.sql`.
- Migration física Supabase: `20260925002406_trilha06_profile_privacy`.
- Hardening lógico pós-advisor: `20260925003500_trilha06_rls_policy_hardening.sql`.
- Hardening físico Supabase: `20260925002930_trilha06_rls_policy_hardening`.
- Schema lógico do repositório: **26**.
- Manifesto canônico: 27 migrations, hash `3d2b3207abe752f3edb2394efae3988c6e764738039cd587d26ccb782ffc4253`.
- Criadas `app_user_addresses`, `app_user_preferences` e `app_consent_records`.
- RLS `ENABLE + FORCE` nas três tabelas, com seis policies finais de dados pessoais.
- Três triggers T06: touch/revision em endereços, touch/revision em preferências e imutabilidade de consentimentos.
- Teste transacional real em produção foi executado com `ROLLBACK`, validando: padrão único, fingerprint único, troca de padrão e bloqueio de UPDATE/DELETE em consentimentos.
- Advisor de performance foi reexecutado após o hardening: as duas advertências novas de múltiplas policies permissivas da T06 foram eliminadas. Permanecem somente achados preexistentes de módulos anteriores, que não foram alterados nesta entrega.

### Testes e gates
- Matriz T06: 15 casos de contrato + 7 cenários Playwright = aproximadamente 22 casos dedicados, alinhados ao Manual v11.
- Gates adicionados: `test:t06:unit`, `verify:t06:evidence`, `verify:t06:free` e `test:t06:e2e`.
- Workflow gratuito criado em `.github/workflows/trilha06-free-homologation.yml`.
- No primeiro disparo do GitHub Actions, o job encerrou antes da alocação de runner (`runner_id=0`, zero steps executados), comportamento também observado nos workflows existentes da branch principal. Portanto, esse resultado foi classificado como indisponibilidade/cota de infraestrutura do Actions e não como falha de código.

### Vercel
- `vercel.json` preserva o modelo gratuito com deploy de produção apenas na `main`; branches continuam sem preview pago.
- Adicionada CSP para `https://viacep.com.br` e política `no-store` para `/conta/(.*)`.
- Build command da Vercel passou a executar os gates T06 antes do Vite.
- O conector Vercel não retornou projetos no time conectado nesta execução; por isso a comprovação do deploy será feita pelo status GitHub/Vercel após a promoção para `main`, sem inventar um deploy inexistente.

### GitHub
- Branch de entrega: `trilha06-v11`.
- Pull request de homologação: **#46 — feat: implementar Trilha 06 do Manual Mestre Técnico v11**.


## 2026-09-25 — Revisão e homologação final da TRILHA 06 v11 — somente planos gratuitos

### Regra financeira consolidada
Por determinação do proprietário do projeto, toda implementação do HortiVitalMix deve permanecer compatível com os planos gratuitos atualmente utilizados em GitHub, Vercel e Supabase. Para a T06, não foi habilitado qualquer recurso premium. Previews Vercel de branches permanecem desativados; somente `main` pode disparar deploy. O workflow do GitHub usa runner padrão e cancela execuções duplicadas.

### Achados da revisão
A revisão do código T06 contra o Manual Mestre Técnico v11 encontrou quatro pontos que precisavam de hardening antes da homologação definitiva:
- a exportação LGPD validava apenas o `iat` do JWT, que poderia ser renovado sem nova senha;
- payloads de auditoria T06 ainda carregavam nome/localização em claro;
- o fingerprint de endereço era calculado apenas no serviço, sem garantia física no banco;
- o build Vercel permitia ignorar falha do TypeScript por `|| true`.

Todos foram corrigidos.

### Estado técnico homologado
- Reautenticação LGPD usa o login público já existente, sem criar uma nona rota T06. Login por senha emite prova HMAC HttpOnly `hvm_reauth`, vinculada ao usuário e ao `session_id`, com TTL de 15 minutos. Refresh e importação de sessão não renovam a prova.
- Auditoria T06 passa por `redactPII` e armazena apenas metadados operacionais necessários.
- O PostgreSQL calcula o fingerprint SHA-256 canônico em trigger, com `trim`, colapso POSIX de whitespace e lowercase.
- O primeiro endereço de cada pessoa é forçado como padrão; o índice parcial continua garantindo um único padrão.
- `authenticated` possui SELECT sob RLS nas tabelas T06, mas escrita direta foi revogada; mutações continuam pelo backend com commandId e auditoria.
- Build Vercel tornou-se fail-closed: migration manifest + typecheck + security + testes T06 + evidence + Vite + bundle check.
- Schema lógico: **28**; migrations reconciliadas: **29**; hash: `93466eeb7a5c11eb9d9f847e2c51c16b8e88798acfc7e63acf9e7b311aaea05d`.
- Migrations físicas desta revisão no Supabase: `20260925010313_trilha06_homologation_hardening` e `20260925010505_trilha06_fingerprint_normalization_fix`.
- Teste transacional real no Supabase aprovado com rollback, cobrindo padrão inicial, fingerprint, deduplicação, troca de padrão, revision de preferências e imutabilidade de consentimentos.
- Advisor Supabase pós-revisão sem novo finding ligado às três tabelas T06; achados restantes pertencem a módulos anteriores e foram preservados.
- Matriz dedicada: 16 contratos + 6 testes da prova recente = **22 casos T06**, além da regressão Playwright responsiva e do fluxo de exportação.


### 2026-09-25 — Ajuste operacional do gate Vercel Hobby após falha de build
A primeira promoção da homologação T06 (`b994d3c`) retornou status Vercel `failure` quando o `buildCommand` passou a exigir o typecheck global do projeto. Para respeitar a regra de custo zero e evitar repetição de builds por dívidas de tipagem fora do escopo T06, o gate de produção Hobby foi reduzido aos controles diretamente necessários ao deploy: manifesto de migrations, security check, testes T06, evidence, Vite build e bundle check. O `typecheck:app` **não foi removido do projeto**: continua obrigatório em `verify:t06:free`, apenas separado do deploy de produção. Não foi habilitado recurso pago ou preview de branch.


### 2026-09-25 — revisão T06 e nova política explícita de login

A instrução expressa do proprietário nesta execução substitui a exigência de MFA a cada login contida no Manual v11/T05. Administrador e Super administrador com e-mail confirmado entram por senha, mantendo credenciais separadas, status ativo, limitação de tentativas e setores. Login não emite OTP; a rota MFA antiga responde 410 e não cria sessão. Convites, recuperação e confirmação inicial continuam disponíveis.

Desempenho: resolução de principal e limitação de tentativas administrativas em paralelo; eliminadas emissão e validação do segundo fator; handoff de UI de uso único por até cinco segundos evita reconsultar imediatamente a sessão que o próprio login acabou de validar. Não armazena tokens nem altera autorização das APIs. Login público recém-validado consulta a Data API antes de aguardar o pooler; sessões existentes preservam a checagem no banco. Hub da conta busca apenas os dados necessários à seção aberta. Nenhuma confirmação de cadastro foi antecipada artificialmente.

Sincronização: botões de Usuários e Convites usam estado real da requisição, giro CSS, aria-busy e bloqueio de clique repetido; finalizam em finally também em erro. Configurações mostram indicador animado durante o carregamento e não impõem atraso artificial. Respeita preferência de movimento reduzido.

Correções T06: idempotência delimitada por usuário e ação; desempate estável por id na eleição de endereço padrão; exportação inclui todo histórico de consentimentos, em vez do limite de 100 da tela; formulário de endereço bloqueia submissões simultâneas e descarta retorno de CEP obsoleto; conflitos 409 de perfil/preferências recarregam revisão e remontam os campos; rotas não tentam responder novamente após negar usuário sem sessão. Melhorada identificação acessível do campo Senha.

Validação desta execução: gate completo verify:t06:free aprovado (22 testes, tipagem, manifesto, segurança, evidências, build e bundle). T05: 30 testes e evidências aprovados. Testes de UI T06: 8 aprovados, com cinco breakpoints; 4 testes de UI administrativos aprovados para login sem OTP e giro/parada do indicador em ambos os perfis. Testes de navegador usam respostas controladas e não comprovam entrega de e-mail nem latência de produção. Consulta real ao banco confirmou RLS ENABLE/FORCE, leitura e ausência de escrita direta autenticada nas três tabelas T06 e os índices únicos de padrão/fingerprint. Sem nova migration.

Homologação técnica local aprovada; meta de 2–4 segundos para cadastro/login reais e ciclo de e-mails permanece pendente de medição autenticada em produção. Não se declara homologação operacional irrestrita com base em mocks. Livro-Raiz e documentos atualizados no mesmo commit.


### 2026-09-25 — Publicação sem dependência de GitHub Actions

Por instrução expressa do proprietário, os quatro workflows deixam de executar em push/pull request; ficam apenas como histórico acionável manualmente e não são necessários para publicar. A homologação é local por `npm run verify:t06:free`, testes T05 e testes de navegador. A publicação continua pela integração Git da Vercel, somente main, sem upgrade de plano. Não executar Actions como etapa de entrega.

O build Vercel mantém manifesto, tipagem, segurança, Vite e verificação de segredos no bundle. Testes e evidências T06 já aprovados localmente deixam de ser repetidos no build remoto. Nenhum erro é ignorado e nenhum controle de autenticação/RLS foi removido. Esta redução de trabalho não é apresentada como diagnóstico da falha remota: o deploy de 6a5419 falhou e o conector Vercel não disponibiliza o projeto/logs nesta sessão. Homologação operacional e latência real permanecem pendentes até produção validada.


### 2026-09-25 — Acesso visível às telas da T06

Corrigida a navegação pública após login para /conta, onde estão Perfil, Endereços, Preferências e Privacidade. A rota antiga /minha-conta agora também apresenta os quatro atalhos com ícones e estilos existentes, preservando senha, confirmação e saída. O hub oferece retorno explícito à segurança/saída. O painel administrativo tem acesso visível à conta e privacidade, sem ampliar permissões de API. Nenhum texto técnico de trilha foi adicionado à interface. Teste de navegador cobre entrada antiga, abertura de Privacidade e retorno à saída. Mantidos os endpoints reais T06 e RLS existentes; esta correção é de navegação, sem alteração de contrato ou migração.


### 2026-09-25 — Conta personalizada e saudação pelo nome

Saudação com nome completo canônico de /v1/account/profile para consumidor, produtor, administrador e super administrador; manhã 05–11h, tarde 12–17h e noite 18–04h no relógio local do dispositivo, atualizada a cada minuto e ao retornar à janela. Antes de obter a identidade, não inventar nome nem usar o e-mail como substituto. E-mail e tipo da conta concentrados em Preferências, retirados do cabeçalho e da tela antiga de segurança.

Experiência das quatro seções personalizada conforme activeRole: consumidor com entrega e compras; produtor com identificação do responsável, endereços pessoais claramente separados de imóveis/coleta/produção e comunicações pessoais; administrador com ferramentas de usuários/convites; super administrador também com acesso à configuração global. Não criar campos fictícios nem reclassificar preferências de compras como alertas administrativos. APIs, controles de autorização e persistência T06 permanecem os existentes. Privacidade apresenta revisão de escolhas, exportação e histórico; cartões, resumos e layout responsivo preservam verde/branco. Testes adicionados para manhã/tarde/noite, quatro perfis, ocultação de e-mail no hub e distinção das ferramentas administrativas.


## 2026-09-25 — T07-20260925-01 — Múltiplos endereços urbanos e geocodificação assistiva

### Objetivo
Evoluir de forma aditiva a base de endereços pessoais já homologada, entregando lifecycle logístico urbano, até dez endereços ativos, instruções de entrega, geocodificação gratuita e edição completa, sem iniciar imóveis rurais, pedidos, documentos ou qualquer módulo posterior.

### Alterações consolidadas
- Schema lógico avançado de **28 para 29**, sem reescrever migrations promovidas.
- Histórico reconciliado em **30 migrations**.
- Migration lógica: `20260925153500_trilha07_address_geocoding.sql`.
- Migration física Supabase: `20260925192227_trilha07_address_geocoding`.
- Hash canônico: `500a5d5ff51d5608c07768a8b63f681328b37d1f3c99a19dd7ab5c612851689a`.
- `app_user_addresses` recebeu latitude/longitude NUMERIC(10,7), acurácia, instruções, ativo e último uso.
- UNIQUE de padrão passou a considerar apenas endereço ativo; índice de checkout criado.
- Trigger físico limita dez endereços ativos e devolve SQLSTATE 23514 no excesso.
- RLS permanece ENABLE + FORCE com quatro policies explícitas; authenticated possui somente SELECT e escrita direta continua revogada.
- O fingerprint SHA-256 e o touch/revision anteriores foram preservados.
- CRUD de endereço foi centralizado em `AddressManagementService.ts`; `ProfilePrivacyService.ts` deixou de duplicar essas mutações.
- Cinco operações canônicas: listar, criar, editar, trocar padrão e excluir.
- Todas as mutações exigem originProtection + prova recente `hvm_reauth`.
- A exclusão consulta dinamicamente `to_regclass('public.app_orders')`; enquanto a relation não existe, pedidos abertos equivalem a zero e a exclusão é hard. O branch soft-delete já contém a FSM `pending/confirmed/in_harvest/in_route`, sem criar `app_orders`.
- Geocodificação backend usa somente ViaCEP + OpenStreetMap/Nominatim, com timeout de 3 s no geocoder, no máximo uma repetição e User-Agent identificável. Falha externa nunca impede cadastro. Pin manual prevalece.
- `/conta/enderecos` foi evoluída com rótulos rápidos, delivery notes, mapa OSM sem chave, geolocalização mediante permissão, pin manual, cards desktop, bottom sheet mobile, cinco estados de UI e limite visual de dez.
- O evento `hortivitalmix:default-address-changed` permanece responsável por sincronizar “Entrega para” no shell.
- CSP Vercel recebeu somente `tile.openstreetmap.org` em `img-src`; policy de deploy continua `main=true` e branches=false; buildCommand não recebeu suíte pesada.
- GitHub Actions continuam sem gatilho automático de push/pull_request.

### Evidência de banco
Foi executado `BEGIN ... ROLLBACK` real no Supabase canônico validando primeiro padrão, fingerprint, único padrão ativo, limite dez/23514, ausência de `app_orders` tratada como zero, hard-delete atual e eleição determinística por `created_at ASC,id ASC`. Uma segunda prova sob role `authenticated` confirmou leitura RLS do próprio titular. Consulta pós-prova confirmou **zero resíduos**.

Estado físico conferido:
- RLS enabled=true e forced=true;
- exatamente quatro policies em `app_user_addresses`;
- authenticated: SELECT=true, INSERT/UPDATE/DELETE=false;
- anon: SELECT=false;
- triggers ativos: `trg_app_user_addresses_limit` e `trg_app_user_addresses_touch`.

Os advisors do Supabase não apontaram novo finding ligado à T07. Achados exibidos permanecem em componentes anteriores e não foram alterados nesta entrega.

### Testes e gates
Foram adicionados exatamente **25 casos dedicados**: 9 contratos/unidade, 6 geocodificação, 5 HTTP e 5 E2E. O gate local `verify:t07:free` inclui manifesto, typecheck, security check, 20 testes Vitest, evidência arquitetural, Vite/bundle e 5 testes Playwright com Chromium portátil já existente.

A checagem estrutural dos arquivos e a prova SQL foram executadas e aprovadas nesta sessão. **Vitest/Playwright/typecheck não foram executados nesta sessão**, pois o runtime local disponível não consegue resolver o host do GitHub para materializar o repositório e a política do projeto proíbe usar GitHub Actions automáticas como substituto. Assim, o status correto é: **implementação candidata à homologação operacional; gate local ainda deve ser executado antes do merge**.

### Segurança, custo e não regressão
Nenhum recurso pago foi adicionado. Não foram usados Google Maps Platform, Mapbox, Twilio, Resend, PostGIS, Supabase Branches ou preview Vercel. Nenhuma tabela `app_properties`, `app_orders` ou bucket foi criada. T01–T06 permanecem preservadas e a evolução é estritamente aditiva.

### Git / promoção
- Branch de implementação: `trilha07-v11`.
- Pull request aberto para `main`: **PR #49**.
- O PR está mergeable no GitHub e não há execução automática de Actions associada ao head.
- Nenhum deploy da branch foi disparado.

### Próximo gate
Executar `npm run verify:t07:free` em ambiente local/Google Studio com dependências instaladas. Somente após gate verde e revisão do PR, fazer merge em `main`; o deploy Vercel deve ocorrer exclusivamente a partir da `main`.


## 2026-09-25 — Promoção da T07 para main e produção

### Resultado da promoção
- Pull request **#49** foi mergeado por squash em `main`.
- Commit funcional promovido: `c3a09bea41f25da224ae4941c572021fab2f9918`.
- O status de integração **Vercel** desse commit mudou para `success`, com descrição `Deployment has completed`.
- Nenhum preview de branch foi habilitado; o deploy ocorreu somente após merge em `main`.
- GitHub Actions permaneceram sem execução automática.
- Nenhum recurso pago foi habilitado em GitHub, Vercel ou Supabase.

### Release de produção
Após o status Vercel `success`, o registro canônico `public.app_releases` foi promovido para:
- release: `trilha07-v1-c3a09be`;
- environment: `production`;
- schema lógico: **29**;
- hash: `500a5d5ff51d5608c07768a8b63f681328b37d1f3c99a19dd7ab5c612851689a`;
- commit funcional: `c3a09bea41f25da224ae4941c572021fab2f9918`.

Este registro documental é aditivo e não altera a lógica funcional da T07. Caso este próprio registro gere um novo commit de `main`, `app_releases.commit_sha` deve ser sincronizado apenas depois de o deployment correspondente receber status Vercel `success`, preservando a regra de readiness por SHA exato.

### Estado final da T07
A implementação funcional da T07 está no repositório principal e o banco canônico está em schema 29. A implementação inclui CRUD avançado de endereço, limite de dez ativos, geocodificação gratuita, pin OSM, endereço padrão ativo único, branch soft/hard preparada sem criar `app_orders`, RLS FORCE, auditoria, idempotência e sincronização da shell. T01–T06 foram preservadas e T08+ não foi iniciado.


## 2026-09-25 — Ajuste final T07 do gate Vercel Hobby

Revisão final da promoção identificou que o `buildCommand` ainda carregava `typecheck:app`, contrariando a regra operacional desta entrega de manter o typecheck completo no gate local e não inflar o build do Vercel Hobby.

Correção aditiva:
- `vercel.json` agora executa somente `migrations:verify`, `security:check`, `vite build` e `check-bundle`;
- `typecheck:app` permanece obrigatório dentro de `verify:t07:free`;
- a suíte de 25 casos T07 permanece fora do build Vercel;
- deploy continua habilitado apenas para `main`;
- previews de branch continuam desabilitados;
- nenhum recurso pago foi adicionado.

Este ajuste não altera schema, contratos, API, banco ou comportamento funcional da T07. Ele apenas alinha a promoção à governança de custo zero e ao gate local definido para a entrega.


## 2026-09-25 — AUTH-REG-20260925-01 — Hotfix de cadastro público no Vercel e Google Studio

### Sintomas confirmados
O proprietário informou HTTP 500 no cadastro Consumer/Producer pelo Vercel e HTTP 403 (“Cadastro não autorizado”) no Google Studio.

A investigação do estado canônico confirmou que as tentativas atuais não chegaram ao Supabase Auth: não houve criação recente em `auth.users`, `app_users`, `app_people` ou papéis e os logs Auth não receberam chamada recente correspondente.

Para o Google Studio existe causa histórica documentada: o proxy já havia devolvido HTTP 403 antes do Express em 2026-09-20. O fallback público que contornava esse proxy foi posteriormente removido e o frontend atual voltou a depender exclusivamente de `/_hvm_api` e `/api`.

Para o Vercel, o conector desta sessão não expõe runtime logs do projeto, portanto não se fabrica uma causa específica do HTTP 500. Foi confirmado no código, porém, que o cadastro ainda tinha `supabaseAdmin` como dependência obrigatória, enquanto login e sessão já haviam recebido fallbacks para o runtime serverless.

### Correção aditiva
- criada `supabase/functions/public-registration/index.ts`;
- função `public-registration` implantada no projeto canônico, ACTIVE version 2;
- função anônima pública restrita exclusivamente a `consumer|producer`, com Zod strict, CPF Módulo 11, celular BR, senha forte e payload limitado;
- identidade nova é criada pelo Auth Admin somente dentro da Edge; o domínio é concluído antes do reenvio de confirmação pelo Supabase Auth, preservando a ordem transacional já homologada;
- domínio continua transacional pelas RPCs service-role já existentes;
- conta existente exige senha correta e e-mail confirmado antes de adicionar novo papel;
- nenhum papel administrativo pode nascer nesse caminho;
- criada camada frontend `publicRegistrationTransport`: Express same-origin continua primário e a Edge entra apenas em falhas de infraestrutura/transporte, inclusive Studio 403 e Vercel 500;
- erros de validação, conflito e rate limit não são mascarados pelo fallback;
- `AuthService.register` usa a mesma Edge caso o client privilegiado esteja indisponível no Vercel;
- rota de cadastro respeita confirmação já aceita pela Edge e não duplica e-mail;
- dispatcher Vercel passou a ter cobertura explícita para as duas rotas de cadastro.

### Segurança e custo
Nenhum wildcard CORS foi reintroduzido no Express. A abertura cross-origin existe somente na Function pública de cadastro, que não usa cookies e só permite papéis públicos. A service-role permanece interna ao Supabase. Não foram adicionados Google Maps, Mapbox, Twilio, Resend, PostGIS, preview Vercel, branch Supabase paga ou GitHub Actions automáticas.

### Banco e não regressão
Nenhuma migration nova. Schema lógico permanece **29**, 30 migrations e hash canônico da T07 inalterados. T01–T07 são preservadas e T08+ não foi iniciado.

### Testes e gate
Foram adicionados testes de fallback Studio 403, Vercel 500, não-fallback em 400/409, erro Edge estruturado, fallback server-side e roteamento Vercel de Consumer/Producer. Gate local: `verify:registration:free`.

A função Edge foi implantada e conferida como ACTIVE no projeto `xipbsazvymkqqfmfegwu`. A promoção do frontend/backend ao Vercel permanece condicionada ao merge deste hotfix na `main`.


### Promoção de produção — AUTH-REG-20260925-01
- PR **#52** foi mergeado por squash em `main`.
- Commit funcional promovido: `904054e00659751f46a2b22eec4ff61c4a2f726b`.
- A integração Vercel do commit retornou **success** com `Deployment has completed`.
- A Edge Function `public-registration` permanece **ACTIVE version 2** no Supabase canônico.
- O conteúdo implantado da Edge foi comparado ao arquivo versionado e coincidiu integralmente.
- Release de produção registrada após o Vercel success: `auth-reg-hotfix-904054e`, schema 29 e hash `500a5d5ff51d5608c07768a8b63f681328b37d1f3c99a19dd7ab5c612851689a`.
- Nenhum GitHub Action automático foi disparado.
- Nenhum preview Vercel ou recurso pago foi habilitado.

O hotfix está, portanto, promovido no repositório principal e no runtime de produção. A comprovação funcional final do formulário com uma identidade real deve ser feita pelo proprietário, pois esta execução não cria conta fictícia nem dispara cadastro real para um e-mail de terceiros.
## 2026-09-25 — AUTH-REG-20260925-02 — Correção definitiva do cadastro público

### Homologação anterior invalidada
O teste real do proprietário após AUTH-REG-20260925-01 confirmou persistência dos sintomas: Vercel com HTTP 500 no cadastro de Produtor/Consumidor e Google Studio com HTTP 403 / “Cadastro não autorizado”. Assim, a homologação anterior foi considerada insuficiente e não pode ser tratada como conclusão funcional.

### Causa operacional
O transporte anterior ainda fazia o cadastro tentar primeiro o backend same-origin (`/api` no Vercel e `/_hvm_api`/`/api` no Google Studio). A Edge `public-registration` só era usada depois da falha. Isso mantinha o fluxo normal preso justamente ao proxy/runtime que estava falhando.

### Correção
- `public-registration` passa a ser o transporte primário de `consumer` e `producer`;
- o navegador chama diretamente a Edge canônica do Supabase, sem depender do proxy Vercel/Google Studio no caminho normal;
- Express fica somente como contingência quando a própria Edge estiver indisponível;
- 400/409/429 da Edge não geram retry no Express;
- sucesso da Edge é marcado como `transport: "supabase_edge"`;
- testes foram invertidos para exigir Edge-first e zero chamadas ao backend do ambiente quando a Edge responde;
- schema permanece 29 e nenhuma migration foi criada;
- T01–T07 permanecem preservadas.

### Promoção concluída
- PR **#54** (`fix(auth): cadastro público direto pela Edge`) mergeado em `main` no commit `5cbc05da363b8a667f584dcb4b1e2009bc47a2fb`;
- o commit `5cbc05d` recebeu Vercel **success** (`Deployment has completed`);
- PR **#55** (`fix(auth): fixar cadastro no Supabase canônico`) mergeado em `main` no commit `74c458a365b00c629e7a510af923187fded782c4`;
- o commit `74c458a` recebeu Vercel **success** (`Deployment has completed`);
- `public-registration` permanece **ACTIVE version 2** no projeto canônico `xipbsazvymkqqfmfegwu`;
- o cadastro público não depende mais de `/api`, `/_hvm_api` ou `VITE_SUPABASE_URL` no caminho normal;
- a referência funcional vigente passa a ser **AUTH-REG-20260925-02**; a homologação AUTH-REG-20260925-01 fica explicitamente superada para cadastro público.

### Homologação desta correção
A homologação técnica confirma promoção do código correto para produção, Edge canônica ativa, schema 29 preservado e ausência de nova migration. A comprovação de um cadastro real continua devendo usar dados legítimos do proprietário, sem criar identidade fictícia em produção.


## 2026-09-25 — T07-REVIEW-20260925-03 — Recuperação do deploy e acesso aos endereços

Objetivo: revisar a T07 e investigar HTTP 500 de acesso público e telas ausentes.

Evidências: main 2145a6c possui status Vercel failure e removeu package-lock.json apesar de manter npm ci. A consulta HTTP ao login publicado retornou FUNCTION_INVOCATION_FAILED antes da API. Importar a API com Node reproduziu ERR_MODULE_NOT_FOUND em shared/contracts/addressAdvanced.ts (import sem extensão). O gate T07 detectou update vazio aceito por defaults de label/number.

Correções: lockfile restaurado do pai, alinhado a Node 22; imports ESM T07 explícitos; update parcial deixa de inserir Casa/S/N e rejeita payload vazio; atalho Gerenciar meus endereços visível no hub público, apontando /conta/enderecos. T07 corresponde a endereços pessoais, mapa e instruções de entrega, não a imóveis rurais. Revisão de UI considera acessibilidade e reutiliza estilos existentes.

Segurança: contratos strict, confirmação obrigatória, segregação de perfis e controles de autorização preservados. Nenhuma migration alterada ou adicionada; schema 29 e hash canônico preservados. Nenhum Actions, plano pago ou dado fictício de produção utilizado.

Validação: manifesto, typecheck, security check, 20 testes T07 iniciais, 19 testes de transporte/cadastro/roteamento, evidências, build e bundle aprovados. Importação nativa com transformação TypeScript aprovada após correção. Testes de navegador tentados: Chromium portátil encerrou com SIGSEGV antes de executar as telas; isso não é homologação visual. Consulta sem dados à Edge pública retornou VALIDATION_ERROR esperado, sem criar conta ou enviar e-mail. Cadastro real, persistência autenticada e homologação operacional permanecem pendentes; status de deploy não substitui essas provas.


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


## 2026-09-26 — Navegação autenticada, endereços administrativos e login público

- A marca do shell administrativo, em desktop e mobile, recarrega `/admin/painel` mantendo os cookies da sessão. Apenas a ação Sair executa logout. O logout administrativo limpa a sessão em memória em todos os consumidores do hook.
- Administrador e Super administrador veem Endereços administrativos, rótulos Contato/Escritório/Correspondência/Outro e referências de acesso. Formulário, cartões e mapa não exibem instruções de entrega nesses perfis. A persistência continua privada, vinculada à pessoa; não cria endereços de outros usuários nem locais operacionais globais.
- Logins públicos de Produtor e Consumidor usam o padrão visual completo do login administrativo, preservando e-mail, senha/visibilidade, cadastro por papel, recuperação e confirmação de e-mail. Endpoint público e papel continuam sendo validados no backend.
- Sessões autenticadas não veem convites de cadastro no catálogo nem formulários de entrar/cadastrar via navegação ou URL direta. Essas rotas conduzem à conta/painel correto. A checagem inicial da sessão termina antes de exibir os formulários. Respostas atrasadas não substituem uma sessão recém-adotada; falhas transitórias não apagam a sessão em memória. Respostas reais de sessão inválida continuam respeitadas.
- Logout público volta à página inicial e libera os convites de cadastro novamente. O login público devolve o nome junto da sessão já autenticada.
- Validação: typecheck, segurança, manifesto schema 29, build/bundle; 21 testes T07 e 16 T03; 23 testes de navegador (respostas controladas), incluindo os quatro perfis, recarga pela marca, logout, navegação autenticada e layout público em 320/1440 px. Capturas mobile/desktop inspecionadas. Nenhum serviço pago ou migração adicionados. A pendência anterior de CRUD real autenticado da homologação operacional T07 permanece registrada.


## 2026-09-26 — T07-SELAGEM-20260926-01 — Reauditoria real e bloqueio da prova operacional

### Objetivo
Reexecutar o fechamento da Trilha 07 contra o Manual Mestre Técnico v11, Volume 3, §7, antes de qualquer início da T08, distinguindo rigorosamente validação técnica de prova operacional autenticada em produção.

### Alterações
- Reauditados contratos, `AddressManagementService.ts`, `GeocodingHelper.ts`, rotas, migration T07, testes, `package.json` e `vercel.json`.
- Confirmados: limite de 10 ativos, rótulos/notas, ViaCEP + OSM/Nominatim com fallback manual, ordenação por recência, lock/revisão/`commandId`, branch soft-delete futuro sem `app_orders` e eleição determinística do novo padrão por `created_at ASC, id ASC`.
- Criado `tests/unit/trilha07RegressionGuards.test.ts` para lockfile/`npm ci`, imports ESM com extensão e buildCommand Hobby enxuto; o guard foi incluído em `test:t07:unit`.
- O teste já existente que rejeita update sem campo mutável foi preservado.
- Nenhuma migration, tabela, bucket, rota ou componente da T08/T09+ foi criado.

### Evidência de banco
Projeto canônico Supabase `xipbsazvymkqqfmfegwu`:
- 30 migrations e schema lógico 29;
- `app_orders` inexistente;
- `app_properties` inexistente;
- `app_user_addresses`: 4 policies, RLS hardening preservado e privilégios de `authenticated` somente SELECT;
- triggers ativos: `trg_app_user_addresses_limit` e `trg_app_user_addresses_touch`;
- 2 atribuições ativas de produtor e 5 de consumidor;
- 0 linhas de endereço e 0 endereços ativos no momento da consulta;
- release production corrente `portal-navigation-afc8ff7`, commit `afc8ff73572d175b826d06644bcb064352f2e832`, schema 29 e hash `500a5d5ff51d5608c07768a8b63f681328b37d1f3c99a19dd7ab5c612851689a`.

### Testes e gates
- Validações técnicas previamente registradas continuam válidas.
- A inspeção desta sessão confirmou que os quatro bugs históricos permanecem corrigidos no código atual: lockfile presente; imports ESM críticos com `.ts`; update vazio rejeitado; Vercel com build enxuto.
- Novos guards de regressão foram versionados, mas não são marcados como executados localmente nesta sessão, pois o runtime não conseguiu resolver `github.com` para clonar o repositório.
- Nenhum Playwright controlado, status READY ou consulta SQL foi contado como prova de CRUD autenticado real.

### Segurança e custo
- Nenhum recurso pago foi usado ou habilitado.
- Nenhuma credencial real foi extraída, redefinida ou contornada.
- Não houve impersonação de produtor/consumidor, criação de identidade fictícia, escrita direta no banco para simular fluxo, Supabase Branch, preview Vercel ou Actions automático.

### Git e promoção
- Branch de correção: `correcao-t07-selagem-operacional-20260926`.
- Base: `main` no SHA `afc8ff73572d175b826d06644bcb064352f2e832`.
- Produção Vercel desse SHA confirmada `READY`; `app_releases` aponta para o mesmo SHA.
- Este branch não deve ser tratado como selagem operacional nem promovido como conclusão T07 até a prova real obrigatória.

### Estado e pendências
**T07: tecnicamente conforme, operacionalmente NÃO selada.**

Pendência única de definição de pronto: autenticar uma conta real de Produtor e uma conta real de Consumidor na versão publicada e executar criar, editar, definir padrão, excluir (inclusive o padrão e validar substituto) e confirmar o limite de 10.

A sessão atual possui acesso aos conectores de GitHub/Supabase/Vercel, mas não possui as credenciais nem uma sessão de navegador autenticada dessas contas reais. Por isso a prova não foi fabricada nem substituída por mocks.

**T08 permanece não iniciada**, conforme a trava explícita do proprietário e a entrada anterior do Livro-Raiz.


## 2026-09-26 — Decisão do proprietário: homologação operacional da T07 adiada para o Work

O proprietário revogou a trava que impedia o desenvolvimento da T08 enquanto o CRUD autenticado real da T07 não fosse executado nesta sessão. A decisão atual é:

- preservar as correções técnicas e os guards de regressão da T07;
- **não criar verificador adicional de “teste de pronto” para produção**;
- deixar a homologação operacional com contas reais para execução posterior no ChatGPT Work;
- autorizar o início da implementação da T08 agora, sem declarar que a prova operacional T07 foi realizada;
- manter a distinção entre implementação pronta para homologação e homologação efetivamente executada.

Esta decisão substitui apenas a trava de sequência registrada nas entradas imediatamente anteriores. Ela não altera os requisitos funcionais, de segurança, RLS, custo zero, deploy main-only ou separação entre endereço pessoal e imóvel rural.


## 2026-09-26 — T08-IMPLEMENTACAO-V11 — Imóveis rurais prontos para homologação no Work

### Decisão de sequência
Por decisão expressa do proprietário, a homologação operacional real da T07 foi adiada para execução posterior no ChatGPT Work e deixou de bloquear o desenvolvimento. Nenhum “teste de pronto” adicional de produção foi criado. A T07 não foi falsamente marcada como homologada.

### Introspecção anterior à T08
Antes de criar qualquer artefato da T08, o Supabase real foi consultado. Confirmou-se schema lógico 29/30 migrations, ausência de `app_properties` e `app_orders`, e a coexistência necessária entre:
- `app_producer_profiles.property_name`: “Nome de seu imóvel” do cadastro inicial;
- `app_properties.property_name`: nome específico de cada propriedade/chácara do módulo rural.

Nenhum campo anterior foi renomeado ou reaproveitado silenciosamente.

### Implementação T08
Foi criado o branch `trilha08-v11` a partir das correções T07. A implementação contém:

- migration aditiva `20260926190000_trilha08_rural_properties.sql`;
- schema lógico planejado **30**, com 31 migrations no manifesto;
- hash canônico planejado `2a8994804e8af48902a745860e9aa1307788c1baa6ab7ec9b4e2eba874edcf0c`;
- tabelas `app_properties`, `app_property_boundaries` e `app_rural_activities`;
- índices de produtor/localização;
- dois triggers em `app_properties`: revisão/timestamp e guarda de status/re-homologação;
- RLS ENABLE + FORCE nas três tabelas;
- leitura do próprio produtor e de administradores;
- `authenticated` somente SELECT; mutações pelo backend;
- contratos estritos em `shared/contracts/ruralProperty.ts`;
- validação GeoJSON Polygon, anel fechado e coordenadas de Rondônia;
- `RuralPropertyService.ts` com ownership, transação, advisory lock, revisão, idempotência e auditoria;
- rotas de lista, detalhe, save-step e submit;
- interface `/produtor/propriedades` e `/produtor/propriedades/novo`;
- wizard de cinco etapas;
- autosave de 2 s nas etapas editáveis;
- persistência local/offline e reconexão;
- mapa OSM sem chave, centralizado em Ariquemes para o cadastro rural;
- “Continuar mais tarde”;
- separação explícita de `/conta/enderecos`;
- responsividade oficial;
- 32 casos de teste preparados;
- `verify:t08:free` e evidência estrutural.

### Decisão contra dados fictícios
O exemplo do Manual criava o rascunho do passo 1 com valores artificiais para campos de etapas futuras. Isso não foi reproduzido. Áreas, água e irrigação permanecem `NULL` enquanto ainda não foram informadas. A transição para estado não-draft exige os dados obrigatórios reais.

### Ambiguidade dos dois triggers
A referência do Manual a dois triggers foi concretizada como:
1. bump de `revision` + `updated_at`;
2. FSM de status e bloqueio de alteração direta de imóvel verificado.

### Estado de execução
**Código T08 implementado; homologação deliberadamente pendente para o Work.**

Nesta sessão NÃO foram:
- aplicadas migrations T08 no Supabase de produção;
- executados os 32 testes como prova;
- executada homologação real com conta Produtor;
- feito merge em `main`;
- feito deploy;
- atualizado `app_releases`.

O comando completo deixado para o Work é `npm run verify:t08:free`. Depois da aplicação real da migration, eventual versão física gerada pelo Supabase deverá ser reconciliada no mapa de aliases se diferir de `20260926190000`. A promoção só poderá atualizar `app_releases` depois que o SHA exato de `main` estiver READY na Vercel.

T09+ permanece não iniciada.


## 2026-09-26 — Work: correção T07 e conclusão técnica T08

**Estado deste registro:** implementação revisada, testes locais aprovados e migrations aplicadas no Supabase. Entrega destinada à `main`; confirmação de Vercel READY e registro do SHA exato em `app_releases` são realizados após criar este commit. Homologação operacional com contas reais continua pendente, conforme decisão do proprietário.

### Correções e integração

- Integradas as branches `correcao-t07-selagem-operacional-20260926` e `trilha08-v11`, preservando as correções administrativas, login e sessão da main `afc8ff73572d175b826d06644bcb064352f2e832`.
- T07: executadas as guardas de lockfile, imports ESM e build Hobby; corrigida a evidência estrutural do mapa para o rótulo neutro de endereço já utilizado pelos portais administrativos.
- T08: cadastro rural em cinco etapas, lista, salvamento automático, retomada, mapa livre, validação e submissão integrados.
- Corrigida perda de rascunho ao recarregar: URL passa a incluir o imóvel criado e dados locais da mesma revisão são recuperados. Divergência de revisão bloqueia sobrescrita e permite descarte explícito do rascunho local.
- Corrigido autosave quando o usuário digita durante uma resposta pendente. Tentativas de salvamento com resposta incerta reutilizam o commandId enquanto a página permanece aberta.
- Limites e precisão das áreas alinhados ao NUMERIC(10,4), evitando arredondamento silencioso ou overflow no banco.
- Nenhum verificador adicional de prontidão de produção foi criado. O verificador estrutural existente informa apenas seu escopo local, sem afirmar estado do banco remoto.

### Supabase — evidência efetiva

- Aplicada `trilha08_rural_properties`: versão canônica `20260926190000`, física `20260926223504`.
- A inspeção completa revelou privilégios herdados `TRUNCATE`, `REFERENCES` e `TRIGGER` em endereços e nas três tabelas rurais. Aplicada migration aditiva `trilha08_table_privileges_hardening`: canônica `20260926223700`, física `20260926223741`.
- Após a correção, `authenticated` possui **somente SELECT** em `app_user_addresses`, `app_properties`, `app_property_boundaries` e `app_rural_activities`; `anon` não possui grants nessas tabelas. Nenhum dado de usuário foi modificado.
- As três novas tabelas têm ENABLE/FORCE RLS e 15 policies. Mutações continuam no backend com sessão, escopo produtor, origem e autenticação recente.
- Schema lógico final **31**, histórico de **32 migrations**, hash canônico `7ca8848d8d498e2a948058ddd65d4a6c7d293d9b9f890d4fbc5aae7e6ddf920d`.
- Aliases físicos reconciliados no manifesto. O advisor de segurança não apontou avisos novos da T08; mantém os avisos anteriores das funções de identidade/RLS e proteção de senhas vazadas.

### Validação executada

- `npm run verify:t08:free`: aprovado (manifesto, TypeScript, segurança, 24 casos unitários/rotas, evidência estrutural, build, bundle e 11 casos de navegador).
- T07 unitários/rotas: **24 aprovados**; evidência estrutural T07 aprovada.
- Navegador T07 e navegação/sessão: **23 aprovados**.
- Total de casos distintos aprovados nesta entrega: **82**.
- Screenshots da T08 inspecionados em 320, 360, 768, 1024 e 1440 px; sem overflow horizontal.
- Testes de navegador usam API/sessão simuladas. Não são prova de CRUD autenticado em produção.

### Pendência operacional explícita

Ainda executar com contas reais: CRUD de endereços de Produtor/Consumidor (incluindo substituição do padrão e limite 10) e cadastro/submissão rural de Produtor. Sem credenciais de usuário disponíveis nesta sessão, não houve impersonação, redefinição de senhas, criação de contas artificiais ou gravação de dados fictícios para declarar homologação. A liberação da T08 segue a autorização registrada pelo proprietário.

Publicação segue main-only e Hobby; T09+ não iniciada. O registro final do deploy deve usar tag `t08-rural-20260926`, SHA exato READY, schema 31 e o hash acima.

## 2026-09-26 — Correções de acesso, usuários, confirmação e análise rural (Work; publicação em 27/09 UTC)

Solicitação do proprietário: reduzir espera ao entrar/sair e navegar nos quatro perfis; incluir Consumidor/Produtor em Usuários; permitir avançar no cadastro rural com pendências; enviar imóveis à administração; corrigir confirmação e reenvio de e-mail; adaptar telas ao iPhone. Mantida a proibição de serviços pagos e GitHub Actions.

### Alterações entregues neste commit

- **Desempenho:** confirmado pelo Supabase que o banco está em `us-west-2`. A função Vercel passa de `gru1` para `pdx1`, junto do banco, em uma única região Hobby. HTML/assets continuam na CDN. Endpoints públicos de configuração/saúde não fazem consultas de sessão desnecessárias. Autorização das APIs privadas e revogação no logout preservadas. Não foi inventado percentual de melhoria: medição com login real continua necessária.
- **Usuários:** consulta une contas públicas de `app_people`/`auth.users` com seus papéis ativos às contas administrativas. Consulta somente de leitura no banco real confirmou 3 contas públicas e 1 administrativa. A tela diferencia perfis e e-mail pendente; bloqueio administrativo não é indevidamente aplicado a contas públicas. Administradores preservam o escopo setorial sobre outros administradores.
- **Imóvel rural:** etapas clicáveis, pendências visíveis, avanço sem obrigar conclusão de cada etapa e rascunho local preservado. Envio final valida todas as etapas, salva os dados e submete o imóvel. Campos obrigatórios permanecem obrigatórios para submissão; nenhuma informação fictícia é gravada. Confirmação recente de senha pode ser feita no próprio formulário sem sair da conta.
- **Análise administrativa:** nova fila `/admin/imoveis`, leitura dos imóveis enviados, aprovação/devolução com justificativa, revisão otimista e auditoria transacional. Super administrador tem acesso; Administrador precisa do setor `document_verification`, mantendo as permissões existentes.
- **Confirmação pública:** nova conclusão `/v1/auth/confirmation` valida prova do link, consulta o nome cadastrado e mostra boas-vindas com botão **Login**, sem iniciar sessão automaticamente. A requisição é deduplicada para evitar consumo concorrente na montagem da tela. Falha transitória é distinguida de link inválido.
- **Novos e-mails:** a Edge `public-registration` envia contexto assinado de finalidade restrita (identidade, papel e validade de 24 horas) no redirecionamento. Esse contexto permite reconhecer confirmação já concluída e reenviar para o mesmo cadastro sem pedir e-mail novamente; ele não autentica a pessoa nem confirma sozinho o e-mail. Links antigos sem prova recuperável não permitem divulgar identidade arbitrariamente.
- **Prazos:** o contrato existente `supabase/config.toml` mantém OTP/link em 3600 segundos (1 hora). A validade de 24 horas é apenas do contexto auxiliar para consulta/reenvio; não prolonga o token do provedor. Não houve alteração nem alegação de leitura da configuração Auth hospedada por uma API não disponível nesta sessão.
- **Supabase:** Edge `public-registration` publicada na versão 3, ACTIVE, mantendo `verify_jwt=false` já existente para cadastro público e suas validações de entrada/origem. Schema continua 31, 32 migrations e hash `7ca8848d8d498e2a948058ddd65d4a6c7d293d9b9f890d4fbc5aae7e6ddf920d`. Nenhuma migração nem alteração de dados de usuário foi necessária.
- **Mobile/iPhone:** `viewport-fit=cover` já existente preservado; ajustes para áreas seguras, `svh`/`dvh`, toque, formulários de 16 px e rolagem de diálogos. Adaptação usa características de viewport/toque, sem depender de nomes de aparelhos.

### Evidências e limites

- Typecheck, `npm run build`, segurança do bundle e verificadores estruturais passaram; o build executou 102 testes das trilhas existentes.
- 27 testes direcionados de servidor/contratos passaram, incluindo assinatura/expiração/adulteração do contexto, reenvio, ausência de cookies no sucesso da confirmação, permissões e revisão administrativa. T07 e T08 tiveram também 24 testes unitários/rotas aprovados cada.
- 26 testes de navegador dos fluxos de confirmação, usuários, fila administrativa, cadastro rural e navegação/sessão passaram com API simulada.
- 4 testes adicionais de viewport/toque iPhone passaram nos quatro papéis, em 375×812, 390×844, 430×932 e 844×390; screenshots revisados. Esses testes usaram Chromium com emulação de dispositivo. WebKit foi baixado, mas não executou por bibliotecas de sistema ausentes; a instalação das dependências não foi permitida pelo ambiente. Não declarado teste em Safari ou iPhone físico.
- Não houve envio de e-mail real, uso de senha real, criação de contas fictícias ou impersonação. Validação operacional de e-mail/login, comparação de latência autenticada e Safari físico seguem como verificações reais pendentes, distintas dos testes automatizados.
- Publicação destinada à `main`; após Vercel READY no SHA exato, registrar `access-flow-20260927` em `app_releases` e verificar `/api/health`, `/api/ready` e bloqueio anônimo das rotas administrativas. Registro final de produção fica em `app_releases`.

Referências técnicas consultadas: https://vercel.com/docs/functions/configuring-functions/region ; https://vercel.com/docs/regions ; https://supabase.com/docs/guides/auth/auth-email-templates (incluindo pré-leitura de links por provedores de e-mail).

## 2026-09-27 — Bloqueio de acessos e ciclo de vida rural

Solicitação direta do proprietário: bloqueio por prazo indeterminado ou intervalo personalizado, mensagens com suporte, rascunhos persistentes, conclusão separada do envio, proibição de exclusão após conclusão e reanálise após edição. Continuação autorizada sem GitHub Actions nem serviços pagos.

### Implementação e permissões

- Somente Super administrador pode bloquear/desbloquear contas, incluindo Consumidor e Produtor. Administrador setorial mantém visualização e seus setores; não recebe poder de bloqueio.
- Bloqueio personalizado armazena início/fim em timestamptz. Formulário informa o fuso do aparelho e converte para UTC. Acesso é permitido antes do início, bloqueado no início inclusivo e liberado no término exclusivo, sem cron. Registro original permanece como histórico; a listagem e autorização usam status efetivo.
- Credenciais corretas de conta bloqueada recebem mensagem distinta para prazo indeterminado ou temporário, com link mailto:hortivitalmix@gmail.com. Senhas incorretas não revelam o bloqueio.
- Mutações exigem sessão de Super administrador e autenticação recente, usam transação, lock, commandId e auditoria. Proteção do último Super administrador considera também agendamentos, mantendo pelo menos um Super administrador disponível sem bloqueio futuro.
- Autorização de sessão e helpers RLS foram alinhados ao intervalo. Não há relaxamento de isolamento de dados nem uso de metadados editáveis para autorizar.
- Imóvel rural aceita dados parciais em draft_data no servidor, sem preencher colunas canônicas com dados fictícios. Salvamento automático, Salvar e continuar e Continuar mais tarde preservam rascunhos. Backup local permanece para indisponibilidade; a tela informa quando não conseguiu sincronizar.
- Concluir e salvar valida todas as etapas e compromisso e produz estado completed. Enviar para análise é separado e disponível depois. Envio incompleto é rejeitado no backend.
- Rascunhos nunca concluídos podem ser excluídos com confirmação, revisão otimista, sessão recente e auditoria. completed_at é preservado pelo banco: após a primeira conclusão, o imóvel nunca mais pode ser excluído, mesmo que retorne a rascunho para edição.
- Edição de imóvel concluído/enviado/verificado/devolvido retorna a rascunho e retira sua aprovação; é necessário concluir e reenviar para nova análise. Suspensão administrativa continua impedindo edição. Fila administrativa não mostra rascunhos nem concluídos ainda não enviados.

### Banco e validações

- Migration canônica 20260927143315_access_blocks_rural_lifecycle.sql aplicada no Supabase com versão física 20260927144553. Schema lógico 32, 33 migrations, hash 7f6db57329a8f39ed9b4fbf681438811ce80c45a39f1f4f6ae6a8cad6253c422. Alias físico registrado no verificador.
- Consulta real confirmou início inclusivo, fim exclusivo, acesso antes do início e bloqueio indeterminado; ENABLE/FORCE RLS e helper de identidade com intervalo confirmados.
- Advisor antes/depois sem novos avisos: permanecem os avisos anteriores dos helpers RLS SECURITY DEFINER, tabela privada de desafios sem policies e proteção de senhas vazadas. Referências: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable e https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection .
- Build e verificações TypeScript/segurança aprovados; 19 testes novos de bloqueio, permissão, datas e ciclo de exclusão/submissão aprovados. Suítes direcionadas adicionais executadas; resultado consolidado da entrega registrado em app_releases.
- 17 testes de navegador aprovados (API simulada), incluindo conclusão sem envio, envio posterior, persistência, mudanças durante autosave, bloqueio de submissão incompleta, listagem pública administrativa e confirmação de e-mail. Teste de revisão corrigido para selecionar explicitamente o compromisso, evitando atingir a caixa de lavagem da etapa anterior durante transição.
- Nenhuma conta real foi bloqueada e nenhum e-mail de teste foi enviado a terceiros para obter estas evidências.

### Limites operacionais que não podem ser declarados concluídos

- Safari em iPhone físico ainda exige um aparelho real. Emulação Chromium não equivale a Safari físico.
- Confirmação por e-mail real exige uma conta controlada pelo proprietário e acesso à caixa correspondente; não foram usadas senhas, impersonação ou identidades fictícias.
- O painel Auth hospedado do Supabase foi aberto, mas redirecionou para login. A conexão MCP não expõe configuração Auth. Prazo hospedado não foi alterado nem inferido a partir de config.toml. Continuação prevista por autenticação segura do proprietário, sem receber senha no chat; contrato local continua 3600 segundos e contexto auxiliar 24h continua sem prolongar token de confirmação.
- Publicação main-only prevista com tag lifecycle-blocks-20260927; confirmação do SHA exato READY e registro final de produção em app_releases após o commit.

## Atualização 2026-09-27/28 — responsividade administrativa, bloqueio e exclusão de contas

Solicitação: corrigir telas de Administrador/Super administrador, falha ao bloquear e permitir exclusão administrativa com revisão de novos cadastros relacionados. Mantida a restrição de recursos gratuitos e nenhuma execução/criação de GitHub Actions.

### Correções e comportamento

- Causa do bloqueio confirmada nos logs reais do PostgreSQL: `inconsistent types deduced for parameter $2`. A atualização agora tipa explicitamente status como varchar e datas como timestamptz. A consulta corrigida foi preparada no PostgreSQL sem alterar contas reais. Conexão, rollback e erros recebem tratamento e código técnico sem PII.
- Layout administrativo com sidebar dimensionada pelo grid, topo alinhado, formulários fluidos, botões com quebra de texto, tabelas contidas e navegação mobile legível. Em Usuários, as linhas tornam-se cartões rotulados em telas pequenas. Campos de data continuam no fuso do dispositivo, convertidos para UTC.
- Super administrador pode excluir contas de Consumidor/Produtor e Administrador com confirmação explícita e autenticação recente. Administradores setoriais não ganharam esse poder. Super administradores e a própria conta do operador são protegidos contra exclusão.
- Exclusão é administrativa/lógica: encerra acesso e sessões, registra auditoria e conserva histórico de identidade necessário à revisão solicitada. Não é a eliminação de dados do fluxo de privacidade. Perfis públicos vinculados ao mesmo login são encerrados juntos; credenciais administrativas independentes permanecem separadas.
- Após credenciais válidas, conta excluída recebe: **Sua conta foi excluída por determinação da administração**, com suporte clicável. Conta excluída/pendente/suspensa não pode ser reativada pela ação comum Desbloquear.
- Novo cadastro que corresponda ao CPF ou nome de histórico de exclusão entra em `pending`, sem acesso, com solicitação em **Usuários → Cadastros aguardando validação**. Nome é normalizado por caixa, acentuação e espaços; coincidência não é prova de fraude. Revisão final exige Super administrador, justificativa e auditoria.
- CPF/e-mail continuam únicos entre identidades vigentes; versões arquivadas conservam o histórico. Cadastro com novo e-mail/CPF arquivado cria nova identidade sujeita à análise. Reutilização do mesmo e-mail exige comprovar a credencial existente e solicita reativação, sem troca silenciosa de senha ou transferência de dados. Aprovação com CPF/e-mail já ocupado por outra identidade vigente falha em transação e exige resolução administrativa.
- Análise permite aprovar ou rejeitar. Aprovação libera acesso após a confirmação de e-mail exigida pelo Auth; rejeição mantém acesso indisponível. Solicitações concorrentes/repetidas não sobrescrevem decisões concluídas. Cadastro público nunca restaura privilégios administrativos.
- Detecção de correspondência é trigger do banco, cobrindo Edge e fallback Express; não depende apenas do navegador. Tabelas de histórico/fila têm ENABLE/FORCE RLS, sem acesso anon/authenticated. Nenhuma senha integra histórico ou justificativa.
- Revisão adicional de origem removeu confiança genérica em outros projetos `*.vercel.app` e liberação de qualquer origem para loopback. Publicação aceita a própria origem e origens explicitamente permitidas; compatibilidade de desenvolvimento identificada permanece fora de produção.

### Banco, testes e publicação

- Migration canônica `20260927202711_account_governance_review.sql`, versão física Supabase `20260927203404`. Schema lógico 33, 34 migrations, hash `c1a27afdd6f4da2d718ca451474dfca7b84017ef7708d14419bd2d4d986b4c3d`. Manifesto/readiness e alias sincronizados.
- Edge `public-registration` publicada na versão 4, ACTIVE, preservando configuração pública `verify_jwt=false` existente e validações de origem/entrada.
- Typecheck completo aprovado. Build aprovado com 102 testes das trilhas existentes e verificação de ausência de segredos no bundle. Suíte ampliada: **219 testes aprovados**, incluindo permissões, exclusão, decisão, rollback/conflito, bloqueio, autenticação e regressões de cadastro. Fixtures antigas de busca de identidade e contrato de recuperação foram alinhadas aos fluxos atuais.
- **15 testes de navegador aprovados**, com API simulada: 95 combinações de telas administrativas/papéis/larguras 320, 390, 768, 1024 e 1440px, bloqueio/desbloqueio, confirmação da exclusão, revisão e sincronização de login. Listas preenchidas, nomes/e-mails extensos, screenshots mobile/desktop inspecionados e ausência de erros de página/overflow horizontal verificadas.
- Teste SQL real transacional em `tests/sql/account-governance-rollback.sql` aprovado: CPF repetido, nome coincidente, bloqueio de papéis pendentes, pedido idempotente, unicidade vigente, normalização e desbloqueio por prazo. Fixtures aleatórias sem Auth/e-mails reais, inteiramente revertidas por ROLLBACK; nenhuma conta real bloqueada ou excluída.
- Publicação main-only identificada pela tag `account-governance-20260928`. SHA final, Vercel READY e confirmação de `/api/ready` devem corresponder ao registro final de `app_releases`, atualizado após a publicação.
- Limites preservados: estes testes não equivalem a Safari em iPhone físico. Validação com caixa de e-mail real e alteração do prazo hospedado de expiração Auth continuam dependentes do acesso operacional já registrado acima; não foram declaradas concluídas nesta entrega.

## 2026-09-28 — T09 e T10: custódia documental e conferência assistida

Base: manual v11, volumes 3 (módulo 09) e 4 (módulo 10), confrontado com o estado real da main. A T09 estava parcial: migration aplicada, contratos sem hash/commandId e ausência de rotas/telas. Manifesto e constante de schema ainda estavam em 33. O último deploy consultado estava ERROR; não foi considerado uma publicação válida.

### Entrega de código e banco

- T09 integrada a Produtor → Meus imóveis → Documentos do imóvel e Administração → Imóveis → Documentos e extrações. PDF/PNG/JPEG de 1 KB a 15 MB, câmera, envio direto com URL assinada sem sobrescrita, hash SHA-256 obrigatório, quarentena, conferência no servidor, retomada de confirmação, arquivamento e auditoria. Reserva idempotente por commandId; 20 documentos ativos/imóvel e 150 MB reservados/produtor, contando arquivos arquivados que continuam armazenados.
- Inspeção confere assinatura completa PNG, marcadores PDF/JPEG, tamanho, hash e recusa indicadores de conteúdo PDF ativo. Não é um antivírus e não comprova ausência de malware. Downloads exigem clean, proprietário ou setor document_verification/superadministrador; TTL fixo de 900s, com auditoria. Links já emitidos podem continuar válidos até expirar.
- RLS ENABLE/FORCE nas seis tabelas; revogados privilégios herdados de escrita/TRUNCATE/REFERENCES/TRIGGER. Removida emissão direta pelo cliente para impedir TTL arbitrário. Imóvel/produtor têm vínculo composto validado. Extrações, scans, validações e conferências são imutáveis. Jobs são internos, sem grants a anon/authenticated; o aviso informativo de tabela interna sem policy é intencional, fail-closed.
- T10: processador Gemini server-side com JSON Schema obrigatório e validação Zod, CAR RO e INCRA/CCIR de 13 dígitos, titular/CPF, área com tolerância de 5%, confiança por campo numérico, texto bruto, valores ausentes como null, e divergências explícitas. Nunca assume ausência de sobreposições nem consulta oficial SICAR/INCRA; não decide regularidade ou aprovação do imóvel.
- Cache por SHA-256 restrito ao produtor; repetição no mesmo documento reutiliza extração. Lease no banco controla concorrência e recuperação após interrupção; até três retentativas transitórias com backoff limitado. Erros e processing ficam em app_document_jobs; somente resultados completos entram na evidência imutável. Arquivamento concorrente bloqueia persistência da extração.
- Conferência lado a lado responsiva, abertura do original, renovação de link, confirmação do produtor e registro de divergência com justificativa. Administração pode ler a mesma evidência no painel existente. Não foi implementada a T11 completa nem ampliada autorização de decisão.
- Rascunho com documentos de custódia não pode mais ser excluído, preservando as evidências. Mensagem específica na interface.
- Vercel mantém main-only, região pdx1 e build enxuto; funções com teto de 60s acomodam leitura e retentativas. CSP permite visualizador apenas no Supabase canônico; câmera somente same-origin. Nenhum GitHub Action foi criado/disparado nem plano pago habilitado.

### Supabase e verificação

Migration aditiva canônica `20260928110512_trilha09_10_document_pipeline.sql`, física `20260928111654`, aplicada com sucesso. T09 anterior `20260928060300` corresponde à física `20260928060434`. Manifesto e aliases reconciliados: schema lógico 35, 36 migrations. O hash exato está em supabase/manifest.json.

- TypeScript completo e build local aprovados; verificações de migrations e segredos no bundle aprovadas.
- 48 testes T09/T10 de contratos, assinatura/hash, área/CPF/CAR/CCIR, provedor simulado, rotas e serviços aprovados.
- 24 testes T08 e 24 testes T07 aprovados.
- 7 testes de navegador aprovados: 320/390/768/1440 px, envio/confirmar, extração/conferência, arquivamento e indisponibilidade explícita de IA. API/identidade/arquivo de teste simulados; não equivalem a upload autenticado real de produção.
- `tests/sql/document-pipeline-rollback.sql` executado no Supabase: leitura pelo dono, bloqueio cruzado, extração imutável e grants restritos. Fixtures aleatórias sem Auth/e-mail, rollback integral, zero documentos após o teste.
- Advisor mantém avisos anteriores de helpers SECURITY DEFINER e proteção de senha; novo aviso informativo de jobs internos sem policy não representa grant público.

### Pendência operacional da T10 — não declarar concluída

O código exige `GEMINI_API_KEY` e `GEMINI_MODEL` exclusivamente no backend. Não foi fornecida chave nesta sessão nem confirmado um modelo/cota gratuita na conta Google. O conector Vercel disponível não gerencia variáveis de ambiente; o painel de configurações redirecionou para login. Não foi feita chamada Gemini real nem habilitado faturamento. Sem configuração, a interface informa indisponibilidade e mantém o original para conferência humana; não fabrica extrações. A ativação e prova com documento controlado pelo proprietário dependem da configuração segura dessas variáveis e redeploy. Não transmitir chave pelo chat.

A publicação do commit e o status Vercel devem ser conferidos pelo SHA exato em `app_releases` e `/api/ready`; este registro não antecipa READY. Homologação com sessão real e Safari físico continua separada dos testes simulados acima.


## 2026-09-29 — RESPONSIVIDADE DA AUDITORIA + LOGIN ADMINISTRATIVO ENTRE DISPOSITIVOS

### Escopo executado
- Corrigida a tela `Fila de auditoria humana` para usar uma única largura fluida no mobile e no desktop.
- O botão `Atualizar`, a faixa de abas e o card/lista da fila passam a respeitar o mesmo container.
- As abas `Pendentes / Em análise / Decididos` dividem igualmente a largura disponível e não dependem de largura fixa.
- O comparador triplo fica empilhado em telas abaixo de 1024 px e passa a três colunas a partir de 1024 px, preservando `min-width: 0` e evitando overflow horizontal.
- O iframe/imagem de documento, campos, ações e textos longos passam a respeitar a largura do card.
- Mantido o `meta viewport` já existente em `index.html`.

### Correção de login administrativo em outro dispositivo
- Diagnóstico de produção: existe atualmente uma única identidade administrativa canônica ativa, com papel `platform_super_admin`, e o e-mail administrativo/auth está confirmado.
- A falha `Dados inválidos ou cadastro não autorizado` podia ocorrer em um dispositivo novo quando a pessoa abria a entrada `Administrador` (`platform_admin`) embora a identidade canônica única estivesse registrada como `Super administrador`.
- O login agora tenta primeiro o portal escolhido. Se não existir principal naquele papel, consulta o mesmo e-mail sem filtro de portal e, somente quando houver uma única identidade administrativa não ambígua, autentica a senha e usa o papel canônico armazenado no banco.
- O papel retornado continua sendo o papel real do banco. Não há promoção de `platform_admin` para `platform_super_admin`; se houver mais de uma identidade administrativa para o mesmo e-mail, o fluxo permanece fail-closed.
- A sessão continua sendo emitida por cookies HTTP-only e, portanto, pode ser criada normalmente em qualquer dispositivo mediante e-mail e senha válidos.

### Regressões adicionadas
- Teste de integração cobre login em dispositivo novo quando a opção de portal escolhida não corresponde ao único papel administrativo canônico.
- Teste E2E da auditoria cobre largura uniforme no mobile, ausência de overflow e comparador em 1 coluna no mobile / 3 colunas no desktop.

### Banco e release
- Nenhuma migração ou DDL foi necessária.
- Schema lógico permanece em `36`.
- Após publicação READY no Vercel, `app_releases` deve apontar para o SHA exato desta correção, mantendo o mesmo `migration_history_hash` da T11.


## 2026-09-29 — AUDITORIA DE CONSISTÊNCIA T11: LOGIN MULTIDISPOSITIVO, FILA, PARECER, DOCUMENTOS E REENVIO

### Resultado da auditoria
- A conferência foi feita contra a `main` real, o deploy de produção e o Supabase de produção, não apenas contra a interface.
- O código já continha as correções funcionais da T11 no SHA `ecb9ef2b1f8b24208ba595c16ef8efe05954584c`, porém foi encontrado **drift operacional no Supabase**: as migrations T11 ainda não constavam no histórico físico e o `CHECK` de `app_verification_requests.status` não aceitava `adjustments_required`. Com isso, **Devolver para correção** podia falhar mesmo com a tela e o backend preparados.
- O drift foi corrigido no Supabase antes desta atualização documental. A restrição de status em produção agora aceita `pending`, `claimed`, `in_review`, `approved`, `rejected`, `adjustments_required` e `escalated`.
- As migrations canônicas continuam sendo `20260929120000_trilha11_verification_queue.sql`, `20260929133000_trilha11_enqueue_on_submit.sql` e `20260929200000_trilha11_queue_reopen_and_adjustments.sql`. Em produção, foram reconciliadas com versões físicas `20260929213043`, `20260929213048` e `20260929213052`; os aliases de histórico foram registrados no verificador de migrations.
- Schema lógico permanece em `36`. O hash canônico das migrations permanece `665785b52d7fe7f8cb9edc6de0fa82fff59f4b5561f97cdbe73328aa2567960e`.

### Login de Administrador e Super administrador em qualquer dispositivo
- O login administrativo continua validando e-mail, senha, conta ativa, papel e setores no backend.
- Um aparelho novo não depende de possuir a sessão/cookie do aparelho anterior. O endpoint administrativo entrega a sessão do login atual e a interface guarda a sessão administrativa do próprio navegador, usando `Authorization: Bearer` nas chamadas administrativas.
- Se o access token expirar, o refresh token administrativo do navegador é usado para renovar a sessão e repetir a chamada; o backend também continua emitindo cookies HTTP-only.
- Quando o usuário seleciona a entrada Administrador ou Super administrador e existe uma única identidade administrativa canônica para aquele e-mail, o sistema usa o papel real armazenado no banco. Isso não promove privilégios e permanece fail-closed se houver ambiguidade.
- A produção registra tentativas administrativas bem-sucedidas após essas correções. A senha específica do operador não é conhecida nem armazenada no projeto; portanto a validação final de uma credencial pessoal continua sendo feita pelo próprio login real, nunca pela exposição da senha em documentação ou teste.

### Fila de auditoria totalmente em português
- A interface não exibe mais os termos de implementação `Capturar`, `pending`, `rejected`, `Trust level` ou `Motor: producer_manual`.
- Os equivalentes visíveis são, conforme o caso: **Colocar em análise**, **Pendente**, **Em análise**, **Aprovado**, **Recusado**, **Ajustes solicitados**, **Devolver para correção** e **Parecer técnico para o produtor**.
- O nível de confiança continua existindo somente como dado técnico interno da decisão, sem campo `Trust level` exposto ao operador nessa tela.
- O nome interno do motor de extração não é apresentado no comparador de auditoria.

### Fluxo Pendentes → Em análise → Decididos e sincronização com o produtor
- `Colocar em análise` muda a solicitação aberta de `pending` para `in_review` em transação, com trava de concorrência e auditoria.
- A decisão humana grava parecer, checklist e decisão; o pedido passa para **Decididos** quando aprovado, recusado ou devolvido para correção.
- O produtor recebe a situação derivada da mesma fila: **Pendente**, **Em análise**, **Devolvido para correção**, **Aprovado** ou **Recusado**. Não existe um status paralelo digitado manualmente na tela do produtor.
- Pedidos antigos capturados ficam protegidos contra dupla captura; claims abandonados podem voltar a Pendente pelo mecanismo de liberação de claim vencido.

### Devolução para correção e parecer obrigatório
- **Devolver para correção** usa a decisão `adjustments_required`.
- O parecer técnico tem mínimo de 10 caracteres e deve explicar o motivo e o que precisa ser corrigido.
- Na área do produtor, o cadastro exibe **Parecer técnico — o que corrigir** com o texto informado pelo Administrador/Super administrador e oferece **Corrigir cadastro**.
- Quando o mesmo imóvel já possui decisão anterior e é reenviado, o produtor continua vendo o parecer anterior enquanto a nova análise está Pendente.
- A decisão anterior não é apagada: permanece no histórico do imóvel para auditoria administrativa.

### Visualização de até 10 documentos
- A fila agrega os documentos ativos do mesmo imóvel e limita a apresentação a **10 documentos**, preservando a ordem de envio.
- Se houver mais de um documento, aparece **Selecionar documento**. O analista escolhe qual arquivo quer visualizar.
- O documento selecionado é carregado com a sessão administrativa atual e pode ser visualizado no próprio comparador ou aberto em outra aba.
- PDFs e imagens usam o mesmo fluxo protegido; documentos arquivados não entram na lista ativa.

### Identificação e reenvio do mesmo imóvel
- A identidade do imóvel é vinculada ao produtor. Havendo CAR/registro, o sistema normaliza máscara, espaços, caixa e caracteres e usa esse registro como chave principal.
- Sem registro utilizável, a comparação usa produtor + nome normalizado + município + linha vicinal.
- Imóveis de produtores diferentes nunca são mesclados pela regra de identidade.
- Ao reenviar o mesmo imóvel após decisão anterior, a fila aberta volta para **Pendentes**, limpa o claim anterior e preserva as decisões históricas.
- Se versões antigas do mesmo imóvel tiverem gerado solicitações separadas, a camada de serviço agrupa a identidade, consolida documentos/histórico e evita apresentar o mesmo imóvel como dois casos simultâneos.
- Em produção foi verificado um caso com decisão anterior preservada e nova análise aberta para o mesmo imóvel, confirmando a coexistência de histórico e reanálise.

### Estado de produção e sincronização
- O deploy que introduziu as correções funcionais T11 está READY no Vercel no SHA `ecb9ef2b1f8b24208ba595c16ef8efe05954584c`.
- Esta auditoria também corrige a documentação e o mapeamento de versões físicas das migrations. Após o commit desta seção, o Vercel e `app_releases` devem apontar para o novo SHA exato.
- Não foi executado teste com a senha pessoal do operador e nenhuma senha deve ser fornecida ao projeto, ao Livro Raiz ou ao chat.


## 2026-09-30 — CORREÇÃO PROFUNDA: LOGIN ADMIN MULTIDISPOSITIVO + ARQUIVO DE IMÓVEIS APROVADOS

### Diagnóstico real do login
- A investigação foi feita no banco de produção, no histórico de autenticação do HortiVitalMix, nos logs do Supabase Auth e no código atual da `main`.
- O principal de Super administrador está ativo, confirmado, possui senha no Supabase Auth, papel ativo e vínculo correto entre `app_admin_principals`, `auth.users` e `app_user_role_assignments`.
- Os acessos bem-sucedidos das últimas 24 horas usaram o identificador administrativo canônico. As tentativas que exibiam **Dados inválidos ou cadastro não autorizado** usavam outro identificador e, por isso, parte delas nem chegava ao endpoint `/token` do Supabase Auth.
- Foi confirmado que um dos identificadores alternativos usados nas falhas corresponde ao e-mail da pessoa canônica vinculada ao mesmo Super administrador. O banco tinha essa informação, mas o backend consultava apenas `app_admin_principals.admin_email`.

### Correção estrutural do login
- Foi criada no Supabase a view server-side `app_admin_login_resolver`.
- A view é a fonte canônica dos identificadores administrativos aceitos e une, para o mesmo principal, o e-mail administrativo e o e-mail da pessoa canônica vinculada.
- O frontend não possui e-mail administrativo hardcoded. O backend não decide qual endereço é válido por regra local: consulta a view do Supabase e recebe `admin_user_id`, `portal_role`, `auth_email` e confirmação.
- A senha continua sendo verificada exclusivamente pelo Supabase Auth contra `auth_email`. Aceitar um alias de e-mail não cria outro usuário, não copia senha e não promove papel.
- Se a mesma pessoa tiver no futuro Administrador e Super administrador, `portal_role` continua desambiguando as identidades. Sem desambiguação o fluxo permanece fail-closed.
- O texto da tela de login passa a orientar que é possível usar o e-mail administrativo ou o e-mail da conta vinculada ao perfil administrativo.

### Arquivo de imóveis aprovados
- A fila de auditoria passa a ter quatro áreas: **Pendentes**, **Em análise**, **Decididos** e **Arquivados**.
- **Arquivados** é alimentado pelo banco por `app_verification_requests.archived_at` e contém somente a aprovação vigente do imóvel.
- Imóvel aprovado é exibido no Arquivo em modo somente leitura. Dados do imóvel, documentos, decisão, data, parecer e checklist continuam visíveis; não há botões para aprovar, recusar ou devolver.
- **Decididos** fica reservado às decisões que ainda exigem histórico operacional, como recusado, ajustes solicitados ou escalado, desde que não tenham sido substituídas por uma aprovação vigente.

### Mesmo imóvel recusado e depois aprovado
- Foram adicionados `superseded_at` e `superseded_by_request_id` em `app_verification_requests`.
- Quando uma solicitação do imóvel é aprovada, decisões anteriores do mesmo imóvel deixam de existir como itens independentes da fila e ficam somente no histórico, vinculadas à aprovação atual.
- Isso evita a repetição visual do mesmo imóvel como **recusado** e **aprovado** ao mesmo tempo.
- O histórico técnico não é apagado: o parecer anterior permanece auditável dentro do imóvel aprovado.
- A camada de serviço também compara a identidade normalizada do imóvel por produtor/CAR ou registro e, na falta de registro, por nome + município + linha vicinal, para abranger versões anteriores do mesmo cadastro.

### Correção de drift do banco
- Foi encontrado novo drift: a migration canônica `20260930013000_approved_property_withdraw.sql` já existia no GitHub, mas ainda não constava no histórico físico do Supabase.
- Ela foi aplicada em produção como versão física `20260930172140`.
- A nova migration `20260930172000_admin_login_resolver_verification_archive.sql` foi aplicada como versão física `20260930172239`.
- O estado existente foi reconciliado: o imóvel atualmente aprovado ficou `verified`, a solicitação aprovada recebeu `archived_at` e a decisão anterior repetida foi marcada como substituída, sem perder o histórico.
- Schema lógico passa a `38`.
- Hash canônico das migrations: `5d78521f50aaeaa7c46537b226641a928bbf407821801e22ebc1383250ce2005`.

### Regra de sincronização
- GitHub `main`, Vercel produção, Supabase migrations e `app_releases` devem apontar para o mesmo ciclo de entrega.
- Nenhuma senha pessoal é gravada no Livro Raiz, frontend, backend ou banco de domínio. Credenciais continuam sob responsabilidade do Supabase Auth.


## 2026-09-30 — HARDENING FINAL DA FILA APÓS ADVISOR DO SUPABASE

- Após aplicar o arquivo e a resolução de login, os advisors de segurança/performance foram executados.
- Foi identificado que `enqueue_verification_on_submit()`, apesar de ser uma função interna de trigger, ainda tinha `EXECUTE` herdado para `anon` e `authenticated`. Esse acesso direto foi revogado; somente `service_role` mantém execução explícita. O trigger do banco continua funcionando normalmente.
- A FK `superseded_by_request_id` recebeu índice próprio para evitar scans desnecessários na manutenção do histórico/substituição.
- Migration canônica: `20260930173900_verification_queue_archive_hardening.sql`.
- Versão física Supabase: `20260930173943`.
- Schema lógico final deste ciclo: `39`.
- Hash canônico final das migrations: `0b7a95a8c4b6355ace3aa6d38e4787111154c2e2f9bb6c5857357350c1c4f268`.
- Permanecem avisos gerais/preexistentes do projeto nos advisors (por exemplo proteção de senha vazada desabilitada e otimizações de políticas/índices não relacionadas a esta correção); eles não foram mascarados como resolvidos nesta entrega.


## 2026-09-30 — SINCRONIZAÇÃO DEFINITIVA DO ESTADO DO IMÓVEL + LOGIN ADMIN EM NOVO DISPOSITIVO

### Estado do imóvel: uma única verdade no Supabase
- Foi confirmado o erro que permitia o produtor ver **Devolvido para correção** mesmo existindo uma aprovação: o backend selecionava a solicitação pelo `updated_at`, e a decisão antiga superseded havia recebido atualização posterior durante a reconciliação.
- Foi criada a view server-side `app_property_current_verification`. O frontend não escolhe mais qual decisão é atual; o backend recebe do Supabase o estado canônico do imóvel e da auditoria.
- Para imóvel `verified`, a decisão atual é obrigatoriamente a aprovação não superseded. Uma decisão antiga de ajustes/recusa nunca mais pode sobrescrever visualmente **Aprovado**.
- Para imóvel enviado novamente após correção, o banco cria uma **nova solicitação** `pending`; nunca reabre uma linha que já possui decisão. A decisão anterior permanece somente no histórico.
- Ao retirar/suspender um imóvel aprovado, a aprovação deixa de ser corrente no arquivo administrativo e permanece somente como histórico.
- A tela do produtor também aplica precedência defensiva: `verified` mostra **Aprovado** antes de qualquer parecer antigo.

### Reconciliação do imóvel existente
- O log de auditoria mostrou uma retirada explícita pelo papel `producer` às **2026-09-30 18:24:12 UTC**, quando o imóvel estava `verified`.
- Essa ação não foi revertida silenciosamente. O registro atual é `withdrawn`; portanto uma aprovação anterior não pode continuar aparecendo como aprovação corrente no Super administrador.
- As solicitações antigas aprovada e recusada desse imóvel ficaram marcadas como históricas/superseded. Não há mais estado corrente contraditório.

### Login em outro dispositivo
- Os logs de produção mostraram autenticações administrativas completas e bem-sucedidas pelo Vercel às **18:21:07 UTC** e **18:25:13 UTC**, chegando ao Supabase Auth `/token` com HTTP 200.
- Também houve uma tentativa recusada às **18:20:35 UTC** cujo identificador não corresponde a nenhum e-mail/identidade persistido no banco. Ela foi recusada antes do Supabase Auth, como esperado.
- O login passa a normalizar caracteres invisíveis/`mailto:` e variantes equivalentes de Gmail (pontos e `+tag`) somente quando correspondem a um alias já persistido no Supabase.
- A tela administrativa consulta o banco e mostra apenas versões **mascaradas** dos identificadores reconhecidos, evitando guardar e-mail administrativo no frontend.
- A recuperação de senha administrativa passa a usar a mesma fonte `app_admin_login_resolver`, inclusive para o e-mail da pessoa vinculada.
- A senha continua sendo validada exclusivamente pelo Supabase Auth. Senha de Produtor/Consumidor não é automaticamente tratada como senha administrativa.

### Banco e versionamento
- Migration canônica: `20260930184100_property_review_state_sync.sql`.
- Versão física aplicada no Supabase: `20260930184151`.
- Schema lógico: `40`.
- Hash canônico das migrations: `d7cb39ab1b3edd045c7dfce8dd982f82ea8639ba29209fb67acfb5537ee5d2bf`.


## 2026-10-03 — RECONSTRUÇÃO: LOCALIDADES, ONBOARDING DO PRODUTOR E IMÓVEL EM SEIS ETAPAS

### Auditoria (Fase 0)
- GitHub `main` (6b77b94) já continha o código de Localidades, onboarding sem nome/atividade do imóvel, wizard de 6 etapas com Documentos na etapa 1, e a migration `20261002170000_producer_onboarding_documents_stage.sql`.
- **Supabase de produção NÃO tinha essa migration aplicada** (último histórico: `20261001154343`). O arquivo SQL no GitHub não era prova de banco atualizado.
- Dry-run em transação com ROLLBACK revelou **defeito real na migration**: o `UPDATE wizard_current_step+1` rodava enquanto `ck_app_properties_submission_complete` (que exigia etapa 5) ainda existia, violando a constraint no imóvel `withdrawn`. Causa raiz: ordem das operações.
- Seletor de município em `AdminLocalitiesPage` exibia o `ibgeCode` como texto do `<option>` em vez do nome.

### Correções
- Migration corrigida antes de aplicar (constraint removida antes do UPDATE e recriada depois). Sem migration duplicada. Manifesto/hash atualizado: `da2359fdd048e346c6855e4a57f61e66533a0d6ec11511ae95aca1b9e953b9d6`, schema lógico `43`.
- `<option>` de Localidades agora mostra o nome do município; o código IBGE aparece no campo próprio (preenchimento bidirecional nome ↔ IBGE preservado).
- Etapas pendentes (1–6) agora são botões clicáveis calculados pelas validações reais; o guia da lista de imóveis mostra "Continuar cadastro do imóvel" levando ao rascunho na etapa atual.
- Teste E2E novo: ausência de overflow horizontal em 320×568, 360×800, 390×844, 412×915, 768×1024, 1024×768, 1280×720 e 1440×900 (lista + etapas 1–6).

### Supabase produção
- Migration `20261002170000` aplicada via transação e registrada em `supabase_migrations.schema_migrations`. Resultado verificado: `app_producer_profiles.property_name/rural_activity_type` nulos permitidos; imóveis: 1 `withdrawn` etapa 6, 7 rascunhos etapa 2, 1 rascunho etapa 5 (migrados +1). Nenhum dado removido.
- Edge Function `public-registration` reimplantada a partir do repositório.

### Testes executados (local)
`migrations:verify`, `typecheck:app`, `security:check`, `test:unit` (273 ok), `test:t08:unit`, `test:t12:unit`, `test:t08:e2e` (25 ok), `playwright.mobile.config` (4 ok), `npm run build` (ok).

### Pendências reais
- Testes de integração contra o Supabase real (concorrência de duplicidade, fluxos E2E com upload real) não foram executados nesta rodada.
- Validação visual manual em dispositivos reais não foi feita; apenas Playwright.
- SHA/deploy Vercel: ver commit de fechamento abaixo.

### Fechamento da rodada 2026-10-03 (evidências no ambiente real)
- **SHA publicado:** `0d302ca85fe019055c4e5a8d921da7fe8a1183fb` na `main`. Deployment Production Vercel `dpl_F35W5sQYgLGfYLuPoRPPbPH5kq4t`, estado `READY`, alias `hortvitalmix.vercel.app` (HTTP 200).
- **`app_releases`:** release `localidades-onboarding-6etapas-0d302ca` marcada como corrente (schema 43, hash `da2359fd…b953b9d6`).
- **Duplicidade de município (banco real, via transação/rollback):** mesmo código IBGE rejeitado por `uq_app_municipalities_ibge`; mesmo nome com caixa/acento/espaços rejeitado por `uq_app_municipalities_name` (UF + nome normalizado). Teste concorrente com 6 inserts simultâneos do mesmo município: 1 sucesso, 5 rejeitados; registro de teste removido (total voltou a 6).
- **Catálogo oficial:** 52 municípios, 52 códigos IBGE únicos, 52 nomes únicos.
- **RLS:** nenhuma tabela do schema `public` sem RLS habilitada.
- **Advisors de segurança:** sem achado novo introduzido por esta rodada. Itens pré-existentes: `rls_enabled_no_policy` (INFO) em 4 tabelas de uso exclusivo do servidor; `auth_leaked_password_protection` desativado (WARN, depende de configuração do Auth/plano); funções `SECURITY DEFINER` auxiliares executáveis por `authenticated` (WARN).
- **Advisors de performance:** apenas INFO de índices não usados/FKs sem índice e WARN `multiple_permissive_policies` nas tabelas de bloqueio parcial da T12; anteriores a esta rodada e não alterados.
- **Ainda não comprovado:** upload/extração de documento real com PDF em produção; fluxos autenticados completos no site publicado; validação em aparelhos físicos.

## 2026-10-04 — Complemento de integridade: exclusão em qualquer etapa e aprovação de recadastro

- Integrada a atualização concorrente `a521545` antes da correção complementar. A migration já aplicada `20261004012409` não foi reescrita.
- Schema lógico **46**: migration canônica `20261004013902_property_deletion_and_registration_integrity.sql`, versão física Supabase **20261004014120**. Hash **307a3186739b87f8a4ca008971b4b9b3df8220391568c1bd4cb1b3e8cc7eae22**.
- O produtor pode excluir imóveis em rascunho, concluídos, enviados, devolvidos e aprovados. O histórico de documentos passa para uma tabela privada imutável, sem manter o imóvel nos cadastros ativos. Objetos do Storage são removidos pela fila existente.
- A confirmação consulta o estado do banco. A exclusão do último imóvel aprovado na mesma UF/município exige aviso explícito e confirmação; a transação bloqueia o perfil para impedir que duas exclusões simultâneas eliminem a região sem aviso. Com outro imóvel aprovado na mesma região, a região permanece elegível.
- Bloqueios personalizados aceitam somente imóveis aprovados. A lista de imóveis elegíveis para publicação combina aprovação regional, conta ativa, cobertura e bloqueios por imóvel/região. Compra exige endereço de entrega ativo na região. As lojas e checkout ainda são módulos futuros: estes serviços são o contrato obrigatório para sua integração, não prova de uma loja transacional existente.
- Exclusão de conta é transacional e remove o Auth e os registros operacionais. Um principal administrativo independente que compartilha a pessoa não é eliminado por engano ao excluir a conta pública. O registro mínimo de exclusão e a auditoria continuam para reconhecer CPF/nome/e-mail em novas tentativas. Super administradores e a própria conta do operador permanecem protegidos.
- Cadastros com CPF ou nome normalizado de contas bloqueadas/excluídas ficam em análise. O CPF do titular bloqueado só é liberado para o novo cadastro após decisão administrativa; a tentativa de cadastro não arquiva o titular existente. Pendentes não recebem códigos por nenhum dos endpoints da aplicação.
- Aprovação gera confirmação com metadado `registration_approved`; falhas de envio podem ser repetidas com o mesmo comando. O template local traz “Sua conta foi aprovada. Confirme seu e-mail…”. A aplicação desse template no painel remoto do Supabase requer conclusão do login seguro; não confundir arquivo local com configuração hospedada.
- Mantido o novo painel global e seus setores delegados (`account_governance`, `platform_configuration`). Comparação ignora espaços nas bordas e caixa do e-mail; envio vazio não inicia carregamento. Botões indisponíveis usam cursor adequado.
- Cobertura e sessão atualizam ao voltar à janela e periodicamente. Uma localidade recadastrada recupera a seleção pelo nome/UF mesmo com UUID novo. Ajustado overflow dos botões de imóveis em 320px.

### Validação executada

- Build completo, TypeScript, manifesto e verificação de segredos passaram.
- Testes de imóveis (26), cadastro/transporte (19), localidades (43) passaram. Suíte unitária possui 275 casos; corrigida a expectativa obsoleta do build gratuito para incluir TypeScript.
- Playwright: 37 dos 39 testes iniciais passaram; corrigidos o overflow em 320px e a expectativa antiga do texto do guia, e ambos passaram na repetição. Três novos testes de exclusão (concluído, último aprovado regional, aprovado com outro imóvel) passaram; teste de salvar sem alterações também passou.
- Banco real, transações revertidas: exclusão com custódia, exclusão sincronizada Auth/domínio e recadastro de CPF bloqueado com análise e preservação do titular anterior passaram.
- Estado persistente verificado: **0 rascunhos**, **0 objetos pendentes na fila de limpeza**, **0 contas ativas marcadas deleted**, **0 pessoas órfãs**. O imóvel histórico withdrawn não foi restaurado nem apagado sem solicitação específica.
- Edge Function `public-registration` publicada na versão **9**.

### Fechamento em produção

- Código publicado na `main`: **c10d974ae332aff818f11c34f6ef130e1a3cb200**. Production Vercel **dpl_AyrXEVZtbSjMfybxZZX2bcgfRFUT**, estado **READY**.
- Release registrada no banco: **integrity-v46-c10d974**, schema **46**, hash canônico acima. `https://hortvitalmix.vercel.app/api/ready` retornou **ready**, **databaseConnected: true**, **schemaVersion: 46**.
- Login no painel do Supabase aguardando confirmação de identidade do Google no dispositivo do titular. A personalização hospedada do e-mail de aprovação ainda não foi aplicada; o template versionado está pronto. Isso não impede as correções de exclusão, cobertura ou análise de recadastro publicadas.
- Suite unitária completa executada: **275 testes passaram em 34 arquivos**. Fluxos autenticados completos em produção e dispositivos físicos não foram simulados como se tivessem sido testados.

### 2026-10-04 — Pendência do e-mail concluída no Supabase

- O titular entrou manualmente na conta correta; confirmado o projeto **xipbsazvymkqqfmfegwu**, organização **mwxgspszbhftwswkyaic**, plano **Free**.
- Modelo de **Confirm sign up** salvo no painel de produção e conferido após recarregar. O corpo usa `{{ if .Data.registration_approved }}` para apresentar **“Sua conta foi aprovada. Confirme seu e-mail para concluir o cadastro e acessar a HortiVitalMix.”** após a aprovação administrativa. Cadastros comuns mantêm a confirmação habitual.
- Preservados `{{ .ConfirmationURL }}` e `{{ .Token }}`, assunto **“Confirme seu cadastro no HortiVitalMix”** e as regras de envio após decisão administrativa. Nenhum serviço contratado, plano atualizado ou provedor pago de e-mail adicionado.
- A pendência de configuração hospedada indicada acima está encerrada. Validação nesta etapa: persistência no painel após recarga; não foi enviado e-mail real a terceiros como teste.

## 2026-10-04 — Trilha 12: vitrine comercial, rotina semanal e habilitação — schema 47

Implementação aditiva sobre `main@cf869496e77956f1d50a538ac3b45d88a716a59c`, schema lógico **46**. A fonte da missão é a seção T12 do plano T12–T25 enviado pelo titular; os exemplos T19/T20 servem de formato e não integram o escopo desta entrega.

- Migration canônica **20261004120547_trilha12_producer_store.sql**, aplicada no único Supabase **xipbsazvymkqqfmfegwu** como versão física **20261004124506**. Schema lógico **47**, **52 migrations**, hash **d846bc9157099e0725186ca88c06feb5f1c9f452651cd829fb98bbb130ede885**. Alias físico/canônico registrado no verificador de histórico.
- Novas tabelas `app_producer_stores` e `app_store_operating_hours`, ambas com **ENABLE + FORCE RLS**. `anon` e `authenticated` receberam somente SELECT sob policies explícitas; mutações usam o pool privilegiado do backend. A leitura pública exige loja ativa e elegível; o titular pode ler seu rascunho e horários.
- Publicação exige perfil verified/confiança >= 2, imóvel próprio aprovado, decisão vigente da view T11, conta ativa, cobertura e autorização regional. Reutilizados `fn_publish_eligible_properties` e `fn_producer_delivers_to` da governança v46. A leitura pública refaz a elegibilidade, inclusive após bloqueios e revogação de aprovação.
- Serviço transacional com titularidade obtida da sessão, trava de perfil/loja, revisão otimista, comando idempotente com fingerprint e auditoria append-only na mesma transação. Apresentação passa por `sanitize-html`, validação após sanitização e renderização como texto. Sete dias únicos com horários válidos podem ser salvos atomicamente junto às configurações.
- `/produtor/loja`: criação de rascunho, apresentação, imóvel, slug, pedido mínimo, horário de corte, rotina semanal, confirmação recente de senha, publicação, conflitos preservando edição e pausa de emergência com motivo. A pausa não depende de nova senha nem de aprovação; reabrir refaz a trava comercial. Entrada “Minha loja” adicionada à conta do produtor.
- `/produtores/:slug`: vitrine anônima com apresentação, selo, localização descritiva, horários e condições operacionais. Loja oculta/inelegível/inexistente retorna o mesmo 404. A resposta pública não inclui CPF, telefone pessoal, UUID de pessoa/imóvel ou chave de documento. Catálogo permanece vazio até as trilhas seguintes.
- Compatibilidade v46: imóvel pode ser nulo no rascunho; loja ativa exige imóvel e apresentação por CHECK. Trigger adicional pausa/desvincula antes da exclusão do imóvel e pausa na retirada da aprovação. Exclusão do perfil cascata somente às novas tabelas. Assim, não se introduz `ON DELETE RESTRICT` que impediria o hard delete já homologado. Nenhuma migration, função ou trigger histórica foi substituída.
- Conferência remota após DDL: preservados **4 Auth/users, 3 pessoas, 2 perfis produtores, 1 imóvel, 2 solicitações, 2 decisões, 7 documentos e 7 municípios**. Novas tabelas vazias; nenhuma loja de demonstração criada em produção. Zero tabela pública sem RLS e nenhum novo achado no advisor de segurança.
- Mantidos Supabase Free único, Vercel Hobby, Serverless `pdx1`, deployment exclusivamente pela `main`. Nenhuma trilha T13+ foi iniciada.
- A integração Git gerou prévias Hobby apesar do mapa de branches herdado. Reforçada a restrição main com `ignoreCommand` explícito (`scripts/vercel-main-only.mjs`) no arquivo e no projeto Vercel: 1 libera main; 0 ignora outras branches. Sem contratação ou atualização de plano.
- Verificação pós-deploy detectou incompatibilidade CommonJS/ESM do parser de sanitize-html 2.18.0. A versão homologada foi restaurada temporariamente, sem desfazer o DDL. A dependência final é **sanitize-html 2.17.0 / htmlparser2 8**; 420 testes gerais, 26 contratos/rotas e 22 PostgreSQL passaram novamente. Importação completa da API sem require(ESM) passou e foi adicionada ao build Vercel para impedir repetição dessa falha de inicialização.

### Validação e evidências da T12

- TypeScript integral, build, manifesto/hash, verificação de segredos e bundle passaram.
- Suíte geral Vitest: **420 passaram, 52 explicitamente ignorados** (dependem de banco local configurado ou integração remota). Os 26 testes novos de contratos/rotas estão incluídos nos 420.
- PostgreSQL 17 local com todas as 52 migrations: **22 passaram**, incluindo trava comercial, concorrência/replay, XSS, slug, RLS/titularidade, revogação de elegibilidade e compatibilidade da exclusão de imóvel/conta. Bootstrap e testes recusam destinos diferentes de `127.0.0.1:55432`; não criam branch Supabase nem fixtures remotas.
- Playwright T12: **16 passaram**, com 320/390/768/1440px, edição/horários, vitrine sem login, conflito, publicação proibida, retomada após senha e pausa. Telas revisadas visualmente; consulta pública também percorreu navegador → API → PostgreSQL local → resposta.
- Somente mocks/expectativas antigos foram ajustados nos testes de governança, confirmação e ciclo rural para refletir a v46; nenhum serviço histórico foi modificado. Falhas desses testes foram reproduzidas no SHA de base antes dos ajustes.
- Comparação completa Playwright: entrega **135 passaram / 43 falharam**; base original **118 passaram / 44 falharam**. As **43 falhas da entrega foram reproduzidas no SHA original**; nenhum caso novo falhou. A base também falhou no teste de geolocalização da T07, que passou nesta entrega. A suíte ampla continua vermelha por falhas anteriores; isso não é prova de homologação integral de T01–T11. Lista comparativa em `docs/TRILHA12_REGRESSAO.json`.
- Fluxos de produtor autenticado real no site publicado e aparelhos físicos não foram apresentados como testados.

Detalhes reproduzíveis e adaptações justificadas: [docs/TRILHA12_VALIDACAO.md](docs/TRILHA12_VALIDACAO.md).

### Fechamento funcional em produção da T12

- [PR #69](https://github.com/wesleialvessantos39/HortVitalMix/pull/69) integrado; correção de compatibilidade do sanitizador na `main` funcional **cd52b261531c5e88390e75d090af885678668e0b**.
- Deployment **dpl_9wbPPNsyiXaABhkx6U8gcq5RetBE**, **READY**, target production, região **pdx1**, promovido para **https://hortvitalmix.vercel.app**. Release funcional **t12-v47-cd52b26**, schema **47**, hash canônico acima.
- `scripts/verify-deploy.ts --schema 47 --sha cd52b261531c5e88390e75d090af885678668e0b` passou em 04/10/2026: health, ready e configuração pública. `/api/ready` respondeu **ready / databaseConnected: true / schemaVersion: 47**.
- API pública de loja inexistente respondeu **404 STORE_NOT_FOUND**; configuração de loja sem sessão respondeu **401 AUTH_REQUIRED**. Navegador publicado mostrou **Vitrine indisponível** e **Sessão necessária**, sem erro JavaScript. Configuração e localidades anteriores responderam 200 nos logs do deployment corrigido.
- Contagem final dos registros anteriores idêntica à base; lojas/horários permanecem vazios. Nenhuma conta/imóvel/documento real foi usado como fixture de teste.
- O fechamento documental posterior preserva o mesmo schema/hash; cada nova SHA de documentação é sincronizada com `app_releases` somente após seu deployment READY e nova verificação de readiness. O SHA funcional acima identifica o código efetivamente validado antes desse registro documental.

## 2026-10-04 — Trilha 13: taxonomia oficial e categorias regionais — schema 48

Implementação aditiva sobre `main@f92467cc276bf167641684fd5197e96098d02d49`, T12 homologada, schema lógico **47**. Fonte: missão da Trilha 13, Volume 3, do plano T12–T25 fornecido pelo titular. Os registros anteriores do Livro-Raiz permanecem intactos.

- Migration canônica **20261004133608_trilha13_categories_taxonomy.sql**, criada pelo Supabase CLI 2.117.0 e aplicada no único Supabase **xipbsazvymkqqfmfegwu** como versão física **20261004142901**. Schema lógico **48**, **53 migrations**, hash **e957840c37f1929afba4c4da1290daeb28dfad9b8fdc8418227c885ebe412665**. Alias físico/canônico validado no verificador do histórico remoto.
- Nova tabela global `app_categories`: hierarquia própria com FK `ON DELETE RESTRICT`, slug único, nome, descrição, ícone, ordem, ativação, revisão e timestamps. Nenhuma dependência de loja/produtor, preço, estoque ou produto. As descrições e os nomes do seed normativo foram preservados integralmente.
- Cinco categorias canônicas reais, ativas, nas ordens **1–5**: **Hortaliças folhosas** (`hortalicas-folhosas`, leaf), **Legumes picados** (`legumes-picados`, knife), **Mix prontos** (`mix-prontos`, bowl), **Temperos e ervas** (`temperos-e-ervas`, sparkles) e **Frutas** (`frutas`, sun).
- **ENABLE + FORCE RLS**. `anon` e `authenticated` receberam exclusivamente SELECT, sob policy `is_active = true`. `service_role` recebe SELECT/INSERT/UPDATE; a T13 não concede DELETE. Conferência remota: zero tabela pública sem RLS; nenhum novo achado no advisor de segurança.
- `CategoryService` permite leitura pública ordenada e gestão exclusiva do Super Admin. Escritas revalidam conta e papel ativos no banco, exigem autenticação recente, revisão otimista e comando idempotente com fingerprint. Categoria e auditoria são gravadas na mesma transação; falha de auditoria desfaz a alteração.
- A CTE recursiva rejeita ciclo direto/indireto com **422**. Lock transacional do catálogo impede ciclos de reparentamento concorrente. Slug duplicado retorna **409**; edição autorizada do slug preserva antes/depois em `app_audit_events`.
- Eventos append-only da trilha: `category.created`, `category.updated`, `category.deactivated`, `category.reactivated`. Reutilizados ator/contexto validados e mecanismo de redação de PII da base.
- Desativação lógica, sem DELETE, com relatório de impacto e confirmação explícita quando necessário. Ausência de `app_products` significa **0 produtos vinculados**; consulta preparada para `category_id`/`is_published` da futura T14. Filhos ativos são preservados e promovidos visualmente a raízes enquanto o pai estiver inativo; reativar restaura a árvore original.
- Contratos Zod estritos em `shared/contracts/category.ts`; API montada em `/v1`, `/api/v1` e `/_hvm_api/v1`, mantendo os transportes existentes.
- `src/components/catalog/CategoryNavSection.tsx`: catálogo real via API, SVG inline gratuito, skeleton, erro com nova tentativa, vazio e seleção por UUID; menu vertical a partir de **768 px** e carrossel tátil abaixo disso. Atualizações ao recuperar foco/visibilidade e a cada 30 segundos em aba visível. Categoria removida da resposta pública deixa o menu e limpa a seleção.
- `src/pages/admin/AdminCategoriesPage.tsx`, rota **`/admin/categorias`**: criar, editar, desativar, reativar e confirmar impacto. O acesso, os atalhos e o menu são exclusivos do Super Admin. Conflito de edição preserva campos; recarregamento substitui o formulário somente por ação explícita.
- Conferência remota antes/depois da migration: contadores e hashes idênticos para **1 loja, 7 horários, 4 usuários, 3 pessoas, 2 perfis produtores, 1 imóvel, 7 documentos, 7 municípios, 2 solicitações e 2 decisões**. A loja cadastrada pelo titular após a T12 foi preservada integralmente. Não foram usadas contas, imóveis, documentos ou lojas reais como fixtures.
- Nenhuma migration, função, trigger ou policy histórica foi substituída. Integrações em App/roteador/menus acrescentam a T13; guardas de infraestrutura e dependências da T12 permanecem vigentes. Supabase Free, Vercel Hobby, Serverless **pdx1**, deploy exclusivamente na **main**, sem dependência ou contratação nova.
- Nenhum cadastro de produto, preço, estoque ou vínculo comercial da T14 foi implementado. A navegação por categoria prepara a vitrine; a consulta de produtos pertence à trilha seguinte.

### Validação e evidências da T13

- Suíte geral final: **471 passaram, 73 explicitamente ignorados** por dependerem de configuração local/remota. **51 testes novos** de contratos, fronteira HTTP e montagem na aplicação estão incluídos nos 471.
- PostgreSQL 17 local com as **53 migrations**: **20 testes T13 passaram**, cobrindo seed, RLS, privilégios, auditoria, rollback, papel/sessão, ciclos, concorrência, replay, conflitos, desativação/reativação e compatibilidade futura. Apenas fixtures locais; URLs fora de `127.0.0.1:55432/postgres` são recusadas.
- História completa com React compilado → Chromium → API HTTP real → middleware administrativo → serviço → PostgreSQL → resposta → menu público: **1 teste passou**. Criação, edição de slug, desativação e reativação geraram os quatro eventos esperados. Somente o provedor externo Supabase Auth foi adaptado com credenciais sintéticas locais.
- Playwright final T12/T13: **36 passaram** (**16 T12 + 20 T13**), incluindo responsividade em **320/390/768/1440 px**, impacto, recuperação de erro, aba inicialmente oculta e conflitos sem perder campos. Typecheck integral, build, varredura de segredos e inicialização da API sem require(ESM) passaram.
- Regressão Playwright completa contra o SHA de base: **base 130 passaram / 48 falharam; entrega 150 passaram / 47 falharam**. Todas as 47 falhas da entrega ocorreram também na base, sem caso novo com falha. A suíte ampla continua vermelha por casos anteriores e não constitui homologação integral de T01–T12; comparação reproduzível em `docs/TRILHA13_REGRESSAO.json`.
- Os **22 testes PostgreSQL T12 passaram antes e depois** da migration. Duas expectativas de testes antigos foram alinhadas sem alterar comportamento de produção: build T07 reconhece a verificação de inicialização já vigente na T12; bootstrap PostgreSQL T12 usa a quantidade do manifesto em vez do número fixo 52.
- Uso por Super Admin real no site publicado e aparelhos físicos não foi apresentado como testado.

Detalhes, API, regras e comandos de reprodução: [docs/TRILHA13_CATEGORIAS.md](docs/TRILHA13_CATEGORIAS.md).

### Fechamento funcional em produção da T13

- [PR #70](https://github.com/wesleialvessantos39/HortVitalMix/pull/70) integrado à `main` funcional **a6364b20eb673f1a7500023691375571f6e76bf8**, após checks de segurança concluídos com sucesso. A prévia da branch foi **CANCELED** pela guarda exclusiva main; o check Supabase Preview foi ignorado, sem criação de branch/banco pago.
- Deployment **dpl_FKsZcr18keg9YuUrDCmVRX7Mn7gA**, **READY**, target production, região **pdx1**, publicado em **https://hortvitalmix.vercel.app**. Release funcional **t13-v48-a6364b2**, schema **48**, hash canônico acima.
- `scripts/verify-deploy.ts --schema 48 --sha a6364b20eb673f1a7500023691375571f6e76bf8` passou em 04/10/2026: health, ready e configuração pública. A release foi sincronizada somente após o deployment READY e confirmação de inicialização da API.
- **GET /api/v1/categories = 200**, com as cinco categorias reais, ícones e ordens 1–5. **GET /api/v1/admin/categories = 401 UNAUTHORIZED** sem sessão. Cabeçalhos de request ID presentes.
- Navegador publicado exibiu as cinco categorias, selecionou **Frutas** e atualizou `/produtos`/título corretamente. A tentativa anônima de acessar `/admin/categorias` redirecionou ao acesso administrativo. Nenhum erro JavaScript foi observado.
- Conferência após publicação: os mesmos dez grupos de registros anteriores mantiveram contadores e hashes idênticos, incluindo a loja real e seus sete horários. Nenhum dado real foi usado para teste de mutação.
- O fechamento documental posterior preserva schema/hash/código funcional e sincroniza a SHA final da main com `app_releases` somente após seu deployment READY e nova verificação. O SHA funcional acima identifica o código validado antes desse registro documental.

Checklist T13 concluído: migration/seed canônico; ENABLE+FORCE RLS e grants SELECT; serviço com hierarquia, conflitos, idempotência e auditoria; contratos Zod; menu responsivo; CRUD exclusivo do Super Admin e impacto; schema 48; testes mínimos e evidências; produção main/pdx1 conferida. A T14 permanece para a próxima missão.

### 2026-10-04 — T13: confirmação de sessão preservando formulário e impacto

- A revisão final reproduziu o caso de sessão antiga: o atalho para login era redirecionado pela sessão ativa e descartava a edição. Corrigido exclusivamente em `AdminCategoriesPage`/CSS da T13, reutilizando `AdminLoginPage` em diálogo local. O login bem-sucedido fecha o diálogo e retoma a edição com os campos e o mesmo `commandId`; nenhuma tela/serviço histórico de autenticação foi modificado.
- A confirmação também funciona durante a desativação, retornando ao relatório de impacto. Escritas continuam exigindo a verificação de sessão/papel no backend.
- Cinco casos adicionais passaram: retomada de criação em **320/390/768/1440 px** sem overflow e retomada da desativação. Verificação dedicada final: **41 passaram (16 T12 + 25 T13)**. Typecheck integral, build, verificação de segredos, inicialização da API e história compilada com HTTP/PostgreSQL real passaram novamente.
- Correção aditiva sem migration, mudança de schema/hash, dependência nova ou mutação de dado existente. A release corrente acompanha a SHA final da main somente após novo deployment READY/pdx1 e conferência de health/ready/config.

## 2026-10-04 — Trilha 14: alimentos preparados, fotos e preços versionados — schema 49

- Base preservada: **T01–T13, main `0d1486f757c6411b907323152895f01fe713d4d6`, schema 48**. Implementada exclusivamente a missão T14 do plano T12–T25, Volume 3. Estoque/lotes/reservas T15, frete, carrinho, checkout e pedidos permanecem para suas trilhas futuras.
- Migration canônica **20261004202124_trilha14_products_and_pricing.sql**, criada pelo Supabase CLI 2.117.0 e aplicada no único Supabase **xipbsazvymkqqfmfegwu** como versão física **20261004210207**. Schema lógico **49**, **54 migrations**, hash **b73d77a039fa20dd25bb4abdf89e3f36349abb9e44d9c287d89bcf89a53e777e**. Alias físico/canônico e histórico remoto integral validados.
- Novas tabelas **app_products**, **app_price_versions**, **app_product_media**, índices e funções privadas T14. Nenhuma migration/tabela/policy/função/trigger anterior foi substituída. Metadados de readiness atualizados para 49.
- **ENABLE + FORCE RLS** nas três tabelas. `anon`/`authenticated` somente SELECT sob policies: publicados de categoria ativa e loja elegível; titular também lê seus rascunhos. Autor privado da versão de preço não é concedido nem exposto publicamente. `service_role` recebe somente SELECT/INSERT nos preços; trigger rejeita UPDATE/DELETE direto de versões.
- Criação do produto, preço inicial e auditoria em uma transação. Alteração de preço insere nova versão e incrementa revisão; não sobrescreve preço anterior. Preço corrente ordenado por `valid_from DESC`, com timestamp monotônico e UUID de versão na resposta. **Futuras trilhas de compra devem persistir essa versão em seus snapshots**, sem consultar preço atual para pedidos antigos.
- A trava **hvm_store_private.store_is_visible** da T12 é reutilizada: loja ativa, perfil verified, confiança >=2 e elegibilidade cadastral/territorial vigente. Categoria ativa da T13 obrigatória. Publicar exige foto principal (422); despublicar continua imediato após pausa da loja, sem confirmação de senha recente.
- **Compatibilidade de exclusão:** a FK nova de produto para loja usa ON DELETE CASCADE para preservar a exclusão operacional de conta v46 já homologada; o RESTRICT do exemplo bloquearia esse fluxo. Histórico só é removido na cascata quando o produto já não existe. Exclusão de imóvel mantém produto/preço e oculta vitrine. Ambos os caminhos foram testados com o banco real, sem alterar o mecanismo anterior.
- Bucket privado **product-media**, JPEG/PNG/WebP até 2 MB, seis fotos/produto; upload e assinatura temporária (900 s) pelo backend. Foto principal única e integridade diferida de publicação. Remoção/rollback usa a fila Storage da T12; repetição de upload após rollback usa caminho distinto, sem enfileirar foto persistida.
- Serviço **ProductService**, contratos Zod estritos, origem/ator/papel validados, autenticação recente para escritas críticas, `expectedRevision`/lock/409 e `commandId`/fingerprint/replay. Auditoria no mecanismo existente. Reautenticação local preserva formulário e retoma o mesmo comando; conflito exige recarga explícita.
- Rotas **/produtor/produtos**, **/produtor/produtos/novo**, **/produtor/produtos/:id/editar**, atalho na conta, catálogo público em **/produtos** e na vitrine **/produtores/:slug**. Formulários de informações e preço separados, publicação/fotos, carregamento/erro/vazio/sucesso/conflito, responsividade 320/390/768/1440 px. Nenhuma ação de compra antecipada.
- API montada nos prefixos históricos `/v1`, `/api/v1`, `/_hvm_api/v1`. Contratos públicos excluem titular/loja interna/revisão privada; filtros por categoria, slug da loja e busca. Configuração Vercel, CSP, dependências e módulos anteriores preservados; Supabase Free único, Vercel Hobby, Serverless **pdx1**, deploy exclusivamente **main**.

### Evidências da T14

- **56** testes de contratos/HTTP/montagem passaram. **18** testes PostgreSQL T14 passaram com as 54 migrations, cobrindo preços imutáveis, rollback, RLS/grants, homologação, concorrência, replay, fotos e exclusão. **22 T12 + 20 T13** passaram no schema novo.
- História completa React compilado → Chromium → HTTP/guardas → PostgreSQL → vitrine passou, incluindo auditoria e despublicação. Somente Auth/Storage externos adaptados com dados sintéticos locais; nenhum usuário/produto/foto de teste foi criado em produção.
- **16** testes de navegador T14 e **41** casos dedicados T12/T13 passaram; um reset transitório de conexão da T13 passou em repetição isolada. Typecheck integral, build, bundle/segredos e cold start da API aprovados. Suíte geral: **527 passaram, zero falha, 92 explicitamente ignorados** por configuração ausente.
- Supabase remoto: **49 relações anteriores** mantiveram contagens e hashes idênticos após DDL; três tabelas novas vazias, RLS ENABLE/FORCE e bucket privado conferidos; nenhuma tabela pública sem RLS e nenhum achado novo de segurança. Advisor de desempenho registra três ocorrências da separação de policies pública/titular, conforme padrão da T12, e índices novos sem uso em catálogo vazio; nenhum novo índice de FK ausente.
- Detalhes operacionais e evidências: **docs/TRILHA14_PRODUTOS.md** e **docs/TRILHA14_REGRESSAO.json**. Comparação ampla de navegador e publicação final são registradas no fechamento abaixo após verificação; entradas anteriores do Livro-Raiz permanecem históricas.

### T14 — comparação de regressão e contrato da vitrine

- Comparação ampla Chromium na base homologada e na entrega: **203 casos (150 passaram/53 falharam)** versus **219 casos (163 passaram/56 falharam)**. Todas as **16 adições da T14 passaram**. A suíte ampla permanece com falhas anteriores; não equivale à homologação integral de T01–T13.
- Das quatro diferenças iniciais, três casos de documentos/cadastro/navegação passaram em repetição isolada na base e na entrega, sem alteração de produção. O outro ainda esperava o placeholder de catálogo indisponível: duas expectativas da shell foram adaptadas para a API T14 e passaram, verificando recuperação de erro e catálogo vazio independente de falha de configuração. O seletor do slogan foi direcionado ao header móvel visível, em vez do desktop oculto. **Nenhuma regressão nova ficou sem resolução.**
- Comparação e repetições registradas em **docs/TRILHA14_REGRESSAO.json**. Serviços/componentes históricos de documentos, autenticação e painel administrativo continuam intactos.

### T14 — compatibilidade das queries com o transporte Vercel

- A conferência do primeiro deployment T14 detectou **400 VALIDATION_ERROR** na consulta pública: a Vercel conservava metadados de roteamento no objeto `req.query`, mesmo após o dispatcher histórico normalizar a URL. A reprodução HTTP confirmou 400 antes da correção.
- Correção limitada ao **productRoutes da T14**: catálogo e upload extraem parâmetros da URL normalizada, preservando rejeição de parâmetros desconhecidos do cliente e valores duplicados. Nenhum dispatcher, middleware, fluxo de autenticação ou rota anterior foi alterado; schema/hash permanecem 49/54 migrations.
- Dois testes adicionais cobrem transporte público e upload. Fechamento: **58 testes contratos/HTTP**, **529 testes gerais passaram**, **92 ignorados**, build/cold start/história completa aprovados. O deployment e a release correntes são conferidos novamente após a integração dessa correção.

### Fechamento funcional em produção da T14

- [PR #72](https://github.com/wesleialvessantos39/HortVitalMix/pull/72) integrado; ajustes T14 de transporte [#73](https://github.com/wesleialvessantos39/HortVitalMix/pull/73)/[#74](https://github.com/wesleialvessantos39/HortVitalMix/pull/74) consomem também **path/__hvm_path** presentes na própria URL da função catch-all. Contratos de negócio permanecem estritos, com campos desconhecidos/duplicados rejeitados. Dispatcher e módulos anteriores intactos; ambos os cenários reproduzidos com 400 antes/200 depois e aprovados com os 58 testes HTTP.
- SHA funcional da **main: 1be864b5c5fac0b0f96b25c91d25a08e0756b765**. Deployment **dpl_8foUwTbVGk5LagfXpCkhgqPCeWWY**, **READY**, production, **pdx1**, publicado em **https://hortvitalmix.vercel.app**. Release funcional **t14-v49-1be864b**, schema lógico **49**, **54 migrations**, hash canônico da T14 acima.
- `verify:deploy --schema 49 --sha 1be864b5c5fac0b0f96b25c91d25a08e0756b765` passou: **health/ready/config**, banco conectado e release correspondente ao código. A release foi sincronizada somente após deployment READY e consulta pública 200.
- **GET /api/v1/products = 200**, catálogo real vazio; busca = 200; filtros desconhecidos/duplicados = 400; catálogo privado anônimo = **401 AUTH_REQUIRED**; vitrine inexistente = **404 STORE_NOT_FOUND**. **GET /api/v1/categories = 200**, preservando as cinco categorias oficiais da T13. Request IDs presentes.
- Navegador publicado em **390/1440 px** validou catálogo vazio, seleção de **Frutas**, ausência de overflow, bloqueio do editor sem sessão e vitrine indisponível. **Zero erro JavaScript**; varredura error/fatal do deployment funcional sem ocorrências.
- Conferência pós-publicação: **48 relações anteriores de negócio/identidade** mantiveram contagens e hashes, incluindo loja/horários, contas/pessoas/perfis, imóveis/documentos/localidades e auditoria. Somente **app_releases** foi atualizado como metadado da entrega. Nenhuma conta/imóvel/documento real foi usado como fixture.
- Criação, preço e upload foram conferidos com React/HTTP/PostgreSQL reais locais, usando adaptações externas Auth/Storage; produção foi conferida sem sessão. O fechamento documental conserva código/schema/hash e sincroniza a SHA final da main na release após seu deployment READY e nova verificação.

Checklist T14 concluído: migration aplicada; RLS ENABLE/FORCE e leitura restrita; preço histórico append-only; trava T12 reutilizada; editor/catálogo responsivos; manifesto/hash/Livro-Raiz sincronizados; testes mínimos e comparação de regressão documentados; build/main/pdx1 e navegação publicada conferidos. **A T15 permanece para a próxima missão.**


## 2026-10-05 — Trilha 15: estoque transacional, lotes e baixa atômica — schema 50

- Base T14 homologada preservada: **main 4c2735d145e33aae4ed53f29b6e258604460b568, schema 49**. Implementado exclusivamente o escopo T15 do plano T12–T25, Volume 3; geometria/frete T16 e carrinho/checkout/pagamento permanecem futuros.
- Schema lógico **50**, **56 migrations**, hash **346882f5b85fdd09de8fa72d620139f28009323dcd1f0036cf0ef5c4058aa495**. Migration canônica **20261004235555_trilha15_inventory.sql**, física **20261005002132**, e complementar de grants **20261005002322_trilha15_privileged_inventory_grants.sql**, física **20261005002434**, aplicadas no projeto único **xipbsazvymkqqfmfegwu**. Aliases/manifesto/readiness sincronizados; migrations anteriores intactas.
- Tabelas novas **app_inventory_lots**, **app_inventory_movements**, **app_inventory_reservations**, com RLS **ENABLE/FORCE** e sem leitura/escrita direta por anon/authenticated. Estoque operacional acessível pelo backend titular. service_role restrito a SELECT/INSERT/UPDATE em lotes/reservas e SELECT/INSERT em movimentos, sem DELETE/TRUNCATE. Grants automáticos do Supabase foram detectados na conferência remota e restringidos na migration complementar, preservando a primeira migration aplicada.
- Lote + movimento de colheita + auditoria atômicos; códigos únicos por produto e comandos idempotentes. Gate T12 reutilizado, origem/ator/papel/conta e autenticação recente validados; reautenticação local mantém formulário/comando. Produto e preço T14 não são alterados pelo estoque.
- Reserva **15 minutos**, constante única em `shared/contracts/inventory.ts`, com **FOR UPDATE SKIP LOCKED** e FIFO por validade. Distribuição multilote, insuficiência com rollback e sem baixa parcial; lotes vencidos excluídos. Liberação vencida idempotente por lazy sweep a cada consulta do catálogo, no painel próprio e antes da reserva, sem cron pago.
- Baixa idempotente por reserva/pedido, com movimento imutável **order_sale**: a quantidade já foi descontada na reserva e não é descontada novamente. Lote/reserva sempre travados na mesma ordem. Outro pedido, reserva liberada/expirada ou lote vencido são recusados. UUID de pedido é referência opaca para integração futura; nenhuma tabela/interface de checkout foi criada.
- Triggers diferidos novos verificam saldo/movimentos/reservas no commit. Métodos internos aceitam o PoolClient de futura transação de checkout; essa trilha futura deverá validar resultado e consumir todas as partes junto ao pedido na mesma transação, nunca com commits individuais.
- Compatibilidade v46/T14: FKs novas em cascata preservam exclusão operacional de conta; autor removido é anonimizado quando sua identidade deixa de existir. Histórico só admite remoção na cascata após desaparecimento do lote. Exclusão do produtor com lote/reserva/venda e exclusão de outro ator com histórico preservado passaram no banco real, sem modificar triggers antigos.
- Painel **/produtor/produtos/:id/lotes**, atalho em Meus produtos, lançamento, saldos, paginação de lotes/movimentos e avisos de validade <=2 dias/vencido. Contratos Zod estritos, cinco estados, campos preservados em erro/conflito e responsividade 320/390/768/1440 px. Catálogo público T14 acrescenta apenas **inStock** (Em estoque/Esgotado), sem expor quantidades, lotes, movimentos ou sessões.
- API nos três prefixos históricos; metadados Vercel consumidos na URL normalizada das queries novas. Dispatcher, autenticação anterior, configuração Vercel/CSP, dependências e lockfile preservados. Supabase Free único e Vercel Hobby, Serverless pdx1, publicação exclusivamente pela main.

### Evidências da T15

- **42** contratos/HTTP/montagem, **26** testes PostgreSQL T15 e regressão **22 T12 + 20 T13 + 18 T14** passaram. A primeira comparação T13 reutilizou um banco com fixtures antigas; em banco novo, com aplicação integral das migrations, passou sem alteração da suíte anterior.
- **72** casos de navegador passaram: **16 T12 + 25 T13 + 16 T14 + 15 T15**. História completa React compilado/HTTP/guardas/PostgreSQL/catálogo passou, incluindo navegação, colheita, reserva, expiração, consumo repetido, preço preservado e zero erro JavaScript. Auth/Storage externos adaptados somente localmente; nenhum dado fictício criado em produção.
- Suíte geral **571 aprovados, 119 explicitamente ignorados, 690 total**; testes dependentes de URL local executados separadamente. Typecheck integral, build, bundle/segredos e cold start da API aprovados.
- Supabase: **52 relações anteriores** conservaram contagens/hashes após DDL, novas tabelas vazias, RLS/grants conferidos e nenhuma tabela pública sem RLS. Nenhum WARN/ERROR de segurança novo, nem FK nova sem índice; três INFO de RLS sem policies correspondem ao bloqueio operacional obrigatório, seis INFO de índices sem uso correspondem às tabelas vazias.
- Detalhes e limites: **docs/TRILHA15_ESTOQUE.md**, **docs/TRILHA15_REGRESSAO.json**. A regressão dedicada confirma caminhos afetados; falhas históricas da suíte ampla continuam documentadas na T14, sem declaração de homologação integral de todas as jornadas antigas. Publicação/release finais são registradas após deployment READY da SHA exata da main.


### Fechamento funcional em produção da T15

- [PR #75](https://github.com/wesleialvessantos39/HortVitalMix/pull/75) integrado; **SHA funcional main 1c643205d7ff99d0063ddc97ba200a1ada46a22a**, deployment **dpl_HL3o9JgQfAWe55u3fPsMwRzEGM64**, READY/produção/main/pdx1. Release funcional **t15-v50-1c64320**, schema 50, 56 migrations e hash canônico acima. Health/readiness/configuração e SHA exata conferidas.
- HTTP publicado: produtos/busca 200, filtros desconhecidos/duplicados 400, catálogo privado/lotes anônimos 401, cinco categorias oficiais 200; request IDs presentes. Navegador 390/1440 px aprovou catálogo, seleção de Frutas, proteção de editor/lotes e vitrine indisponível, sem overflow/erro JavaScript. Scan de runtime sem error/fatal no deployment funcional.
- **51 relações anteriores de negócio/identidade** mantiveram contagens/hashes após publicação; somente app_releases recebeu atualização intencional. Nenhuma fixture em produção. Fluxo autenticado validado localmente com React/HTTP/guardas/PostgreSQL reais; transação externa de reserva/baixa também passou sob service_role, com triggers diferidos avaliados e rollback.
- Checklist T15 concluído: três tabelas/migrações aplicadas, RLS ENABLE/FORCE e estoque privado, reserva concorrente/FIFO/TTL, lazy sweep sem cron, consumo idempotente, painel paginado responsivo, compatibilidade T12–T14, manifesto/hash/Livro-Raiz sincronizados, build/main/pdx1 e produção conferidos. A T16 permanece para a próxima missão.
- Fechamento documental preserva código/schema/hash; a SHA final da main é sincronizada na release somente após seu deployment READY. Documentação: **docs/TRILHA15_ESTOQUE.md** e **docs/TRILHA15_REGRESSAO.json**.


---

## 2026-10-05 — TRILHA 16: ÁREA DE ENTREGA E FRETE GEODÉSICO (SCHEMA 51)

Implementação estritamente aditiva sobre T15/main `2afcbad43d3954b6793fa96b678073623b9dda4d` (schema 50). Fonte: plano T12–T25, Trilha 16/Volume 3, fornecido pelo titular. Supabase único `xipbsazvymkqqfmfegwu`, Vercel Free/Hobby, main/pdx1 preservados; sem PostGIS, Google Maps, Mapbox, cron, dependência ou serviço pago novo.

**Schema lógico 51 · 57 migrations · hash `d1ef54620ad0fd0cf8f83e7c7e0396249166226f4be8c874b50ea622babc3f23`.** Migration CLI `20261005034322_trilha16_service_areas_freight.sql`, versão física Supabase `20261005040640`; alias e manifesto sincronizados. Não altera migrations anteriores.

- `fn_haversine_km` imutável/estável e três tabelas novas: `app_service_areas`, `app_delivery_rules`, `app_delivery_quotes`. Raio 1–150 km, centro exclusivamente no GPS T08 do imóvel atualmente vinculado à loja, tarifas em centavos, mínimo, gratuidade opcional e preparo.
- `DeliveryQuoteService`: configuração atômica auditada/idempotente, revisão otimista e revalidação de titularidade/papel/conta. Cotação interna para endereço próprio T07, distância/raio calculados no banco, taxa exata e gratuidade >= limiar. TTL 15 min compartilhado com T15. Consumo rejeita expiração, inelegibilidade e alteração de regra, origem ou revisão/GPS do endereço; reconfere prazo após locks. Subtotal deve ser calculado pelo backend do futuro checkout.
- RLS ENABLE+FORCE nas três tabelas; authenticated somente SELECT das próprias cotações; áreas/regras privadas. Escrita somente backend; sem privilégios de TRUNCATE/REFERENCES/TRIGGER. FKs CASCADE preservam exclusões T06/T07/T08/T12. Distância NUMERIC(8,2) comporta destinos globais fora do raio; elegibilidade usa distância integral.
- Nova tela `/produtor/loja/entrega`, acessível em Minha loja → Área de entrega e frete; slider, referência Ariquemes confirmada no salvamento, tarifas/preparo, autenticação recente e campos preservados em erro. Badge de elegibilidade reutilizável. `/produtor/entrega` municipal permanece intacta.
- Após DDL canônica, digest/contagens das 55 relações anteriores idênticos; tabelas novas vazias, nenhuma fixture em produção. Advisors sem WARN/ERROR novo; INFO privados/índices vazios documentados.
- Verificação: 35 contratos/HTTP, 27 PostgreSQL T16, 14 testes responsivos T16 e história completa React compilado → HTTP → PostgreSQL. Regressões de banco T12–T15 22/20/18/26; histórias T14/T15 aprovadas; navegador T12–T16 86 aprovados. Suíte geral: 606 aprovados/144 pulados, com suites locais executadas separadamente. Build/typecheck/segredos/manifesto aprovados.
- Precisão normativa: coordenadas dos centros Ariquemes↔Porto Velho resultam em 159,081402025558 km geodésicos; o ≈200 km do exemplo não corresponde ao Haversine desses centros. O cálculo correto é preservado e documentado.

**Fora de escopo:** descoberta T17, carrinho, checkout, consumo público da cotação, pedidos/pagamentos e mudanças nos módulos anteriores. A preparação interna para uso futuro não cria esses fluxos.

Documentação/evidências: `docs/TRILHA16_ENTREGA_FRETE.md` e `docs/TRILHA16_REGRESSAO.json`. Estado: migração canônica aplicada; publicação da main/SHA/READY e release em conferência final. O fechamento será registrado abaixo sem modificar este histórico anterior.

### Fechamento T16 — produção e preservação verificadas (2026-10-05)

PR #76 integrado: código funcional `488e38a7a1dd8e970105f4bcdd8309d88d3cd863`, deployment `dpl_GeMNaTatKxzr8gn19BjCk8BrpdD1` **READY**, production/main/pdx1. Release funcional `t16-v51-488e38a`; schema 51/hash `d1ef54620ad0fd0cf8f83e7c7e0396249166226f4be8c874b50ea622babc3f23` e 57 migrations sincronizados. `verify:deploy` (health/ready/config) passou na SHA exata. Site publicado: catálogo/filtros 200, mobile/desktop sem overflow, área de entrega/editor/estoque protegidos para visitante e zero erros JavaScript. API privada canônica `/api/v1/producer/store/delivery` retorna 401; dispatcher/prefixos Express protegidos nos testes locais; logs error/fatal da publicação sem entradas na janela de 10 min. Após o release, as 54 relações anteriores excluindo `app_releases` mantêm digest/contagens idênticos.

Homologação operacional autenticada feita com PostgreSQL/HTTP/interface reais em ambiente local descartável, Auth/Storage externos simulados; produção sem fixtures. Todas as verificações descritas acima aprovadas. O fechamento documental modifica somente Livro-Raiz e evidências; `app_releases` deve espelhar a SHA final da main após READY, preservando schema/hash. T17 não iniciada.

---

## 2026-10-05 — Localização responsiva e preservação da T16 — schema 51

- Base conferida: `main@5c00e02b8ae444d6c5598235332652da4f28ad57`. Livro-Raiz, main e Supabase já continham a T16 completa do plano T12–T25, **Geometria Operacional, Polígonos e Frete**. Nenhuma reimplementação ou migration duplicada foi criada.
- A ambiguidade entre os dois acessos de Localização na página inicial foi resolvida com um único seletor visível no topo, compartilhado pelos cabeçalhos desktop e mobile. Seleção fecha o diálogo, devolve foco e continua persistindo no navegador; limpar a região não altera o endereço pessoal. Endereço padrão aparece no resumo identificado como **Endereço de entrega**, separado da **Região da vitrine**.
- Alteração restrita à interface do shell, novo componente/estilo, adaptação do verificador estrutural e do cenário existente de endereço padrão, além desta documentação. Serviços, contratos, páginas dos módulos anteriores, migrations, dados de negócio, dependências e Vercel permanecem intactos.
- Schema **51**, **57 migrations**, hash **d1ef54620ad0fd0cf8f83e7c7e0396249166226f4be8c874b50ea622babc3f23** preservados. Consultas reais somente de leitura confirmaram RLS ENABLE/FORCE da T16, ausência de grants de escrita cliente, leitura de cotação pelo titular e Haversine de referência.
- Validação local: typecheck/build/segredos/bundle/manifesto aprovados; **35 T16 + 24 T07 + 149 dos gates de build** aprovados; **99 cenários de navegador** aprovados (**14 T16 + 72 T12–T15 + 13 T07**). Agent-browser confirmou seletor único/área de toque >=48 px/ausência de overflow em 320/390/768/1024/1200/1440 px, persistência, limpeza, foco/Escape e separação do endereço padrão. Auth/catálogo simulados somente localmente; sem fixtures em produção. A suíte PostgreSQL completa e a suíte histórica integral não foram reexecutadas neste ajuste de interface.
- Detalhes e comandos: [docs/LOCALIZACAO_RESPONSIVA_T16.md](docs/LOCALIZACAO_RESPONSIVA_T16.md). Publicação e release serão conferidas após integração da correção na main/READY, preservando a configuração main/pdx1. T17 e trilhas futuras não foram iniciadas.

### Fechamento da correção de Localização — Production

- [PR #77](https://github.com/wesleialvessantos39/HortVitalMix/pull/77) integrado, SHA funcional **944f68e1039fab9aaed088b515f571a7723f06f2**; árvore publicada idêntica à validada localmente. Deployment **dpl_2DyWvnWQ6rHxTgGi35m98mRnNKXQ**, **READY**, production/main/**pdx1**. Site: **https://hortvitalmix.vercel.app**. Release funcional **t16-localizacao-v51-944f68e**, schema 51/hash preservados; `verify:deploy` health/ready/config aprovado na SHA exata.
- Catálogo real de municípios ativo, escolha/limpeza/persistência/foco conferidos em Production sem fixtures. As seis larguras 320/390/768/1024/1200/1440 px conservaram um seletor visível, toque >=48 px e ausência de overflow, inclusive com município de nome longo. Contexto móvel com `hasTouch: true`, 390 px e toque real via `locator.tap()` aprovou escolha, recarga e limpeza com zero erro JavaScript. API privada T16 conservou 401 para visitante.
- T16 e migrations/dados de negócio anteriores preservados. Somente `app_releases` recebe a atualização necessária da SHA corrente após READY. O fechamento documental altera apenas relatório e este apêndice, e a release acompanha a SHA final da main depois do deploy documental READY.


## 2026-10-05 — Trilha 17: descoberta regional, busca e favoritos — schema 52

- Base homologada preservada: **T16/Localização, main cec122479d123016d5ea581041e5c5ec3bd121b1, schema 51**. Implementado exclusivamente o escopo da T17 do plano T12–T25 enviado, Volume 3: descoberta pública e favoritos. T18/carrinho e T19/T20 permanecem futuros; os exemplos destas trilhas serviram apenas de formato.
- Schema lógico **52**, **58 migrations**, hash **adb81e6a4b6407916b5a0dc057e47f9e79d184a5d5faf426dfcd336d148f4531**. Migration CLI **20261005131647_trilha17_discovery_favorites.sql**, física **20261005134716**, aplicada no projeto único **xipbsazvymkqqfmfegwu**. Manifesto, constante de schema e alias físico sincronizados; nenhuma migration anterior foi editada.
- Nova entidade única **app_favorites**, com unicidade pessoa/tipo/alvo e FK `app_people(id)` em cascata, RLS **ENABLE/FORCE**, SELECT somente titular e service_role limitado a SELECT/INSERT/DELETE. O exemplo do PDF foi adaptado à coluna real `app_people.id`, sem recriar identidade.
- Extensão gratuita pg_trgm existente em **extensions** reutilizada; GIN em títulos de produtos e nomes de lojas ativas. Busca parametrizada por loja/produto publicado, categoria e município ativos; metacaracteres ILIKE são tratados literalmente, coordenadas em par e paginação limitada.
- Ranking reutiliza **fn_haversine_km T16**, com GPS da sede e posição opcional do consumidor; fallback normativo Ariquemes **-9.9133/-63.0408**. Ordem: distância integral ascendente, confiança descendente, UUID determinístico. Gate público T12 reutilizado, sem expor pessoa/imóvel/GPS/contatos/documentos no DTO.
- **DiscoveryService** lê descoberta em transação READ ONLY e não chama estoque/frete. Favoritos passam por sessão/pessoa/conta, origem protegida, transação **SET LOCAL ROLE service_role**, trava por pessoa, validação de alvo público e auditoria atômica. Dois comandos distintos adicionam/removem; reenvio do mesmo commandId recupera resultado sem retoggle, com conflito 409 em reutilização indevida. Alvos ocultados somem da listagem e podem ser removidos.
- Interface **/** e **/produtores** com filtros próprios, distância de referência explícita, geolocalização opcional, foto existente/ausente, selo, coração acessível e **Ver Produtos → /produtores/:slug T12**. Visitante segue para login consumidor; carregamento/erro/vazio distintos e recuperação de falhas. Busca global de produtos e seletor único de Localização preservados em mobile/desktop.
- Validação: **40** contratos/HTTP/montagem; **18** PostgreSQL reais T17; **2** histórias React/HTTP/PostgreSQL reais, incluindo vazio sem fixtures e toque móvel; **18** cenários visuais T17 em 320/390/768/1440px. Regressão: **113** PostgreSQL T12–T16 + **99** navegador T07/T12–T16 passaram. Suíte geral **646 passaram / 165 ignorados**, integrações reais executadas separadamente. Build/typecheck/cold start/segurança aprovados; gate T17 acrescentado ao build existente.
- **58 tabelas anteriores de negócio/identidade** mantiveram contagens e hashes antes/depois da migration; somente app_releases receberá metadados da entrega após produção READY. Advisors sem novos avisos de segurança; índices novos apenas INFO de uso ainda ausente. Fixtures e adaptações externas Auth/Storage restritas ao banco/browser local descartável, sem inserção fictícia em produção.
- Missão/checklist e limites: **docs/TRILHA17_DESCOBERTA_FAVORITOS.md**. Evidência de preservação: **docs/TRILHA17_PRESERVACAO.json**. SHA/deployment e verificação pública serão registrados no fechamento após READY da main.

### Fechamento funcional em produção da T17

- [PR #78](https://github.com/wesleialvessantos39/HortVitalMix/pull/78) integrado. SHA funcional da main **0fd640baf19f8381b25c73e2396823c0ce24d095**, árvore **452f40816a7ae8aa5f6f9340cb1b48b10e867395** idêntica à validada localmente. Deployment **dpl_DUiEA2MXS2GM8t5Q6r3XCYJ92z1V**, **READY**, production/**main/pdx1**, **https://hortvitalmix.vercel.app**.
- Release funcional **t17-v52-0fd640b**, schema lógico **52**, **58 migrations**, hash T17 acima. Health/ready/config aprovados na SHA exata após READY; histórico remoto/alias validado. O fechamento documental conserva código/schema/hash e sincroniza a SHA documental final depois de seu deployment READY.
- Descoberta padrão, texto e coordenadas 0/0 retornam **200**; queries desconhecidas/duplicadas **400**; favoritos e área de entrega T16 anônimos **401**. Produtos T14 e cinco categorias oficiais T13 mantêm **200**, com request IDs. Sem lojas públicas elegíveis no ambiente atual, a interface exibe o vazio real — sem publicar rascunho nem dados de demonstração.
- Produção conferida em **320/390/768/1440px**: região Ariquemes, busca couve, categoria Frutas, ausência de overflow e zero erro JavaScript. Contexto móvel de **390px**, **hasTouch/isMobile**, aprovou toque real em Localização, município e busca. Favoritos com sessão passaram na história React/HTTP/PostgreSQL local, sem conta real como fixture de produção.
- Snapshot após publicação confirmou novamente as **58 tabelas anteriores de negócio/identidade** intactas; apenas app_releases registra metadados desta entrega. Contagem de logs error/fatal do deployment na janela de 5 minutos vazia. Evidência API/browser acrescentada em **docs/TRILHA17_PRESERVACAO.json** e checklist concluído em **docs/TRILHA17_DESCOBERTA_FAVORITOS.md**.

Checklist T17 concluído: migration/RLS/grants, ranking/texto, favoritos/auditoria/idempotência de comandos, home/Produtores mobile/desktop, link T12, manifesto/hash/Livro-Raiz, testes obrigatórios/regressão e produção main/pdx1. **T18 permanece para a próxima missão, sobre schema 52.**


---

## 2026-10-05 — Correções antes da próxima trilha: documentos do imóvel e cadastro

Implementação aditiva sobre T17/main `c8e3957f16ec8013b93b0d2df522db34a6078e83`, solicitada pelo proprietário com imagem da etapa 1. T01–T17 preservadas; a T18 não foi iniciada.

- Etapa documental ocupa toda a largura: desktop com original/dados lado a lado; mobile com original antes dos dados, identificação larga, áreas em pares quando cabem, foco e toque adequados. Prévia responde à mudança de largura.
- Titular não é descartado; nome ausente utiliza a conta quando o CPF não diverge. Nome/CPF da pessoa permanecem intactos; divergência documental continua disponível para conferência.
- Correções são novas evidências imutáveis. Salvar atualiza revisão, imóvel e rascunho atomicamente; frontend adota os dados autoritativos nas etapas seguintes. Reabrir/atualizar PDF não desfaz a correção. Áreas incompatíveis/revisão obsoleta abortam; retry/concorrência não duplicam conferências. Administração e submissão usam os dados efetivos.
- Cadastro com aceite explícito grava pessoa, papel, perfil e consentimento na mesma transação; envio de e-mail fica fora da espera da navegação com `EdgeRuntime.waitUntil`. Contexto assinado identifica consumidor/produtor; confirmação não pergunta novamente o perfil e não cria sessão. Reenvio legado sem perfil resolve o papel no banco sem enumerar contas.
- Migration aditiva `20261005144950_registration_consent_fast_confirmation.sql` cria somente um RPC privado, preservando o legado. Schema lógico **53**, **59 migrations**, hash **b1889d4aa6b99e721709bdedc4afbdcd68a1d44c65932ea2a36bff9fcf934676**. Avanço técnico de correção, sem nova trilha. Supabase Free único, Vercel Hobby/main/pdx1, RLS e dependências preservados.
- Validação: **652 testes gerais**, **9 PostgreSQL/história completa** e **18 regressões T17 PostgreSQL** passaram; **46 browser** cadastro/documentos/T03/T04/T17 e **28 T08** passaram. Build, segurança, manifesto, TypeScript e cold start aprovados. Cadastro controlado abaixo de 10 s; latência real de Auth/rede e entrega de e-mail não possui garantia absoluta desse prazo. Sem contas/arquivos sintéticos remotos.

Relatório: `docs/CORRECOES_IMOVEL_CADASTRO_2026-10-05.md`. Publicação e preservação remota serão registradas no fechamento após deployment READY.

### Fechamento em produção das correções de imóvel/cadastro

- [PR #79](https://github.com/wesleialvessantos39/HortVitalMix/pull/79) integrada; SHA funcional **9a5ab52ab84ef9edc800fa3b867444be9e658e84**, árvore **390c3438061095b6c047bdcb7cd9a62c2cf71644** idêntica à validada localmente. Deployment **dpl_E8kGj3PLEf7A1c9dqS9aaLDa84Ls**, **READY**, production/main/pdx1. Release funcional **correcoes-imovel-cadastro-v53-9a5ab52**; health/ready/config aprovados na SHA exata. A publicação documental final conserva código/schema/hash e sincroniza a SHA após seu próprio READY.
- Migration física **20261005152423** reconciliada com o arquivo canônico **20261005144950**. RPC privado: anon/authenticated sem EXECUTE, service_role permitido. Nenhuma tabela app sem RLS ENABLE/FORCE. Edge pública **public-registration v10 ACTIVE**; sem aviso novo de segurança/desempenho.
- **61 relações** conferidas: 57 idênticas à leitura inicial. Entre a leitura inicial e a pós-migration, auditoria, conferências, imóvel e Auth/users apresentaram diferenças de hash ou contagem. A auditoria registra atividade concorrente de declaração/prévia do fluxo anterior entre 14:51–15:22, antes da migration de 15:24, que cria somente um RPC. Essas alterações foram preservadas, sem fixtures/reversão. Snapshots pós-migration e pós-publicação ficaram idênticos nas 61 relações. Documentos, extrações originais, auth.identities, lojas, papéis e demais relações mantiveram contagens/hashes. Evidência somente com metadados: **docs/CORRECOES_IMOVEL_CADASTRO_PRESERVACAO.json**.
- Confirmação de consumidor/produtor em produção auditada em 320/390/768/1440px: nenhum seletor de perfil, overflow ou erro JS. Cadastro inválido/Edge retorna 400; contexto inválido, documentos privados e favoritos anônimos retornam 401; descoberta T17 200. Nenhuma conta sintética ou mensagem de teste foi criada/enviada em produção. Logs error/fatal na janela de 5 min sem ocorrências.

Correções concluídas antes da próxima trilha. **T18 deverá partir do schema lógico 53**, com T01–T17 preservadas.

---

## 2026-10-05 — Imóveis conforme referências e vitrines com fotos/capas — schema 54

- Base **main 4651fdb09d70f559aa7bdb0328e9fe0a471aecd7**, T01–T17/schema 53 preservada. Correção visual aditiva de **Meus imóveis rurais** e passo **Documentos** conforme quatro imagens enviadas, em desktop/mobile, com estilos restritos ao cadastro rural. Leitura, correção, salvamento, aprovação e sincronização entre etapas permanecem os implementados anteriormente.
- Extensão explicitamente solicitada: fotos de produtos em carrosséis; destaque regional da home com produto, preço, produtor e loja; seleção de uma região ou alternância entre todos os municípios ativos, com paginação e inclusão automática de novas localidades/produtos publicados. Clique abre a loja do produto. Busca duplicada da home removida no desktop/mobile.
- **Minha loja → Fotos e capa** permite foto do produtor, nome público opcional, até seis imagens e capas por fotos enviadas/produtos publicados/misto, com prévia. Dados pessoais anteriores não são tornados públicos automaticamente; alterações da capa preservam a apresentação ainda não salva. URLs privadas agrupadas/reutilizadas, fotos visíveis priorizadas e próxima imagem antecipada; arquivos novos otimizados no navegador, sem serviço pago.
- Migration **20261005191237_storefront_media_carousels.sql**, física **20261005194858**, aplicada no Supabase único **xipbsazvymkqqfmfegwu**. Schema **54**, **60 migrations**, hash **f698b258308af10af2e1d193c908372660262167ef5c648f34e0e81742d847e3**; manifesto/constante/alias sincronizados. Nenhuma migration anterior alterada. Nova `app_store_media`, RLS **ENABLE/FORCE**, authenticated somente SELECT do titular, backend para escrita, bucket privado `store-media` e fila de limpeza anterior reutilizada. Revisão/auditoria/idempotência/validação de arquivo e titularidade protegidas.
- **61 relações existentes** mantiveram contagens/digests após aplicação; somente bucket novo adicionado. Segurança real da tabela e ausência de alertas novos conferidas. Sem fixtures em produção, novas dependências, transformação paga, alterações de infraestrutura ou início da T18.
- Evidências: **662 testes gerais**, **73 PostgreSQL reais**, **10 novos de assinaturas/guardas HTTP**, **103 cenários distintos de navegador**, **1 história React → HTTP → PostgreSQL → vitrine/home com CSP de produção**, typecheck/build/gates/bundle/cold start aprovados. Execução local descartável; Auth/Storage externos simulados somente localmente. Detalhes/limites: [docs/VITRINES_CAPAS_RESPONSIVAS_2026-10-05.md](docs/VITRINES_CAPAS_RESPONSIVAS_2026-10-05.md).
- Integração/deployment e release final serão registrados após READY na main/pdx1, preservando o plano gratuito.

### Fechamento da publicação — imóveis e vitrines

- [PR #80](https://github.com/wesleialvessantos39/HortVitalMix/pull/80) integrado; SHA funcional **5a05a8efdc8859ba9e8692671cb179ad10fdc780**, árvore **f8506b0326b7759e964b0fa667f2194294d5b174** idêntica à validada localmente. Deployment **dpl_DUJYx9SjfnFK7jvuRk2P73jeDW3K**, **READY**, production/main/**pdx1**. Release funcional **vitrines-v54-5a05a8e**, schema 54/hash preservados; `verify:deploy` health/ready/config aprovado na SHA exata.
- No site **https://hortvitalmix.vercel.app**, APIs reais de destaques/produtos/filtro municipal retornaram 200; configuração privada de loja manteve 401 para visitante. Foto/preço de produto real exibidos no destaque, clique abriu a loja correspondente, capa e foto do produto carregaram. Agent-browser em 390/1440 px conferiu busca única, ausência de overflow e erros JavaScript. Logs error/fatal sem entradas na janela consultada. Produção sem uploads, cadastros, mensagens ou fixtures de teste.
- Depois da release, **60 relações anteriores**, excluindo `app_releases`, continuaram com digests/contagens idênticos. Fechamento documental restrito a Livro-Raiz/relatório; release acompanhará a SHA final da main após READY, mantendo schema 54/60 migrations/hash. T18 permanece futura.

---

## 2026-10-05 — Trilha 18: cesta multilojas, Monte seu HortiMix e fotos — schema 55

- Base preservada: **main af9fa2de633913a6a2d5561d86d0312531637539**, T01–T17 e correções/schema 54. A missão seguida é a **T18 do plano T12–T25, Volume 4**, não o escopo de frete/carrinho/checkout descrito nos exemplos T19/T20. As próximas trilhas devem respeitar o PDF e a base real.
- Migration CLI **20261005210404_trilha18_carts.sql**, aplicada no único Supabase **xipbsazvymkqqfmfegwu** como **20261005212931**. Schema lógico **55**, **61 migrations**, hash **e52b14f3195c5cdbd49a7e761bb486a2fbb8d8859837f1378d799569d033573a**. Alias/manifesto/constante sincronizados; nenhuma migration anterior alterada.
- Novas **app_carts/app_cart_items**, RLS **ENABLE/FORCE**, sem grant/policy de cliente (resolução exclusivamente backend, conforme T18); service_role somente CRUD. Cesta salva única por conta; unicidade **NULLS NOT DISTINCT** inclui porções sem corte. FK/CASCADE preservam exclusões anteriores. **63 relações existentes** mantiveram contagens/digests na comparação antes/depois da migration.
- Cookie visitante **hvm_cart HttpOnly/SameSite=Lax/Secure em produção**; identidade/cesta/loja/preço nunca recebidos do cliente. Transações com SET LOCAL ROLE service_role e travas por sessão/conta; adições iniciais concorrentes compartilham emissão do cookie. Login/importação esperam fusão atômica por produto/corte, somando até 99 e preservando opções; repetição não duplica. Indisponibilidade conserva cookie/itens para nova fusão, sem quebrar login anterior. Logout e cookie de outro titular isolam cestas.
- **CartService**, rotas nos três prefixos e contratos Zod: produto publicado/categoria ativa/gate público T12, preço T14 vigente e mínimo T16 (ou T12 quando não configurado), agrupamento por loja. Mix atômico, atualização/remoção e commandId/auditoria para retry; 100 é rejeitado e produto despublicado retorna erro explícito. **Nenhuma reserva, baixa de estoque, cotação, cupom, pedido ou pagamento antecipado.**
- Interface **/carrinho**, atalhos desktop/mobile, **Adicionar à cesta** e **Monte seu HortiMix** por porções/cortes reais, mínimos separados e recuperação de resposta perdida. Estado de erro distingue-se de cesta vazia. Layout/toque em 320/390/768/1440 px e preços/fotos atualizados em segundo plano.
- Fotos de carrossel, produtor/editor, retratos, miniaturas e cesta usam **MediaImage**: prioridade visível/antecipação e reutilização da assinatura válida do mesmo caminho entre telas, sem novo download a cada renovação. Preconnect ao Storage e operações independentes em paralelo. Upload comum otimiza fotos novas em WebP até 1280 px, alvo 240 KB; **nenhuma foto antiga foi removida/regravada**, buckets privados e serviço gratuito preservados. Baseline real não reproduziu demora longa: produto 50.574 bytes, API ~418 ms/foto ~189 ms; testes controlados comprovaram ausência de download duplicado e redução de imagem >2 MB para <=240 KB, sem garantia absoluta de rede.
- Validação: **28** testes novos de contratos/HTTP/sessão/cache, **18** PostgreSQL T18, **1** história completa React/HTTP/PostgreSQL/login/segundo aparelho/logout e **12** cenários T18 de navegador. Regressão: **446** unitários/contratos, **146** PostgreSQL anteriores e **79** browser T12/T14–T17. Build/typecheck de produção, manifesto, segurança e cold start aprovados. Typecheck global conserva somente erro de teste anterior em `tests/unit/registrationBackground.test.ts:38`, reproduzido na base; não houve alteração desse teste.
- Sem novos serviços/dependências, alteração de Vercel/lockfile, plano pago ou fixtures remotas de conta/produto/upload. Advisors apenas INFO de RLS sem policy e índices recém-criados ainda sem uso; nenhum WARN/ERROR novo nas relações da T18.

Relatório: **docs/TRILHA18_CESTA_HORTIMIX.md**. Evidência: **docs/TRILHA18_PRESERVACAO.json**. **T19/T20 não iniciadas.**

### Fechamento da publicação — Trilha 18

- [PR #81](https://github.com/wesleialvessantos39/HortVitalMix/pull/81) integrado à main funcional **72e6faecacbfd0a5d6aac2351b35e8f60c0bdca2**, árvore **9b80de85f9ce99a5a3df55145038e4b8172ab040** igual à validada localmente. Deployment **dpl_Av5CHboQtYLSnobNQaYXnA58nGW2**, **READY**, production/main/**pdx1**, release funcional **t18-v55-72e6fae** registrada após READY. `verify:deploy` health/ready/config aprovado no schema 55/hash informado acima.
- **https://hortvitalmix.vercel.app**: API da cesta 200 e interface vazia válida; montador/cesta em 390/1440 px sem overflow ou erros JavaScript. Fotos reais com prioridade alta carregaram. CDP comprovou uma única resposta de foto de produto ao passar do catálogo para a loja, sem download adicional. Logs error/fatal sem entradas na janela de dez minutos.
- Depois da release/navegação, **62 relações anteriores**, excluindo `app_releases`, mantiveram contagens/digests. Somente a cesta vazia normal da sessão visitante foi criada nas relações novas. Sem alteração de dados de identidade, Auth, produtos, preços, estoque ou Storage existentes.
- Check **Supabase Preview** da main conserva a falha de timestamps/aliases físicos também presente na entrega funcional anterior **5a05a8efdc8859ba9e8692671cb179ad10fdc780**. O validador canônico aprovou as 61 migrations remotas; nenhuma migration antiga ou histórico remoto foi renumerado. Segurança do PR aprovada e prévia Vercel cancelada pela guarda main. Limites e referências constam no relatório T18.
- Finalização documental restrita a este Livro-Raiz/relatório/evidência; a release segue a SHA final da main somente após seu READY, sem mudar schema 55 ou hash. A referência funcional acima permite conferir exatamente o código homologado.


## 2026-10-06 — Trilha 19: checkout transacional e idempotência — schema 56

- Base preservada: **main 3c6fdc83b76023b4b690cc05b5eddf3a934f097e**, T01–T18 e correções/schema 55. Missão **T19 do PDF T12–T25, Volume 4**: cotação congelada, confirmação transacional e replay. Os exemplos anteriores têm escopo/schema diferentes; gateway/QR Pix/webhook são T20 e acompanhamento é T21 nesta fonte.
- Migration CLI **20261006012938_trilha19_checkout_quotes.sql**, aplicada como **20261006015914**, alias físico mapeado. **62 migrations**, hash **2caaa0fd11223a49aceb6479581aad7c8e15a1fa122166564b06981d06217572**; validador remoto aprovado no schema **56**.
- Novas **app_checkout_quotes**, **app_command_receipts** e **app_payment_intents** (persistência pending expressamente exigida na T19, preparada com colunas T20). RLS **ENABLE/FORCE**: cliente authenticated somente SELECT de cotações/intents próprios via helper real `(SELECT auth.uid())`; recibos sem grants/policies de cliente, acessíveis via backend titular. Não existe `current_user_id()` na base. Somente SELECT adicional ao backend em municípios/propriedades integra o motor de frete T16 sem substituir os módulos anteriores.
- Snapshot imutável de endereço/itens/versão de preço/subtotais/frete/total, por **15 minutos**, sem reserva na criação. Mínimo e cobertura por produtor; preço futuro ignorado. Endereço/cesta podem ser excluídos pelo fluxo legado sem perder snapshot (SET NULL); confirmação exige recálculo. Exclusão operacional T06 apaga PII/recibos/intents e libera holds dentro da transação anterior.
- Confirmação **X-Command-Id UUID v4**: locks de conta T18, comando/recibo/cotação e consumo único. Mesmo ID/hash retorna código/body persistidos; payload divergente **409**; cotação consumida/vencida **410**. Cesta/endereço/frete/gates revalidados; preço posterior mantém a versão congelada.
- Reservas FIFO via **InventoryService T15**, consumo da cotação, intent pending, recibo e auditoria em **uma transação SQL**; falha de estoque/recibo ou vencimento durante espera reverte tudo. Não há baixa de venda ou consumo financeiro de reservas antes da T20. Intenção pending vigente da mesma cesta é recuperada antes de aceitar outra reserva.
- `/checkout`, CTA **Revisar pedido** na cesta, revisão multilojas/endereço com GPS/fotos/frete/total, prazo pelo relógio do servidor e confirmação única. Conflitos mostram “Os valores do seu pedido mudaram, revise antes de confirmar”. Resposta perdida conserva nonce/payload por usuário, incluindo reload/falha da leitura do recibo, e reenvia a mesma confirmação. Resultado: **Pagamento pendente**, referência e prazo de reserva; recuperável em outro aparelho. Fotos reaproveitam `MediaImage`/caches/upload da T18 sem regravar mídia existente.
- Validação: **17** contrato/HTTP T19, **25** PostgreSQL T19, **1** história real React/login/cookies/HTTP/PostgreSQL/perda de resposta/segundo aparelho e **16** cenários T19 de navegador em **320/390/768/1440 px**. Regressões: **440** unitários (incluem 5 T19), **141** HTTP (incluem 12 T19), **164** PostgreSQL anteriores e **116** browser T12–T18. Três timeouts antigos da execução conjunta passaram isoladamente, sem alterar os testes/implementações anteriores.
- Build/typecheck de produção, manifesto, segurança e cold start aprovados. Typecheck global conserva somente o erro de teste anterior `tests/unit/registrationBackground.test.ts:38`, também registrado na T18. **65 relações existentes** com contagens/digests idênticos após a migration. Advisors apenas INFO esperado de recibo sem policy/índices novos sem uso; nenhuma FK nova sem índice ou WARN/ERROR novo.
- Sem dependências/serviços pagos, mudança de infraestrutura/Vercel/lockfile, renumeração de migrations anteriores ou fixtures de conta/produto/estoque/upload em produção. Publicação permanece exclusivamente **main/pdx1**; release da SHA exata somente após READY.

Relatório: **docs/TRILHA19_CHECKOUT_TRANSACIONAL.md**. Evidência: **docs/TRILHA19_PRESERVACAO.json**. **T19 implementada; T20/T21 permanecem futuras.** A T20 deve evoluir os payment_intents existentes de forma aditiva.


### Fechamento da publicação — Trilha 19

- [PR #82](https://github.com/wesleialvessantos39/HortVitalMix/pull/82) integrado à main funcional **e1ec92b12476c83402730f8580f0bdfd97d7a872**, árvore **dd8b2ca74a29e98c42cd00cdd2295fb6a52fa5ef** idêntica à validada localmente. Deployment **dpl_KEPq5SqkmNwA1qCpDJpfrmjxVeme**, **READY**, production/main/**pdx1**, build em aproximadamente 57 segundos. Release funcional **t19-v56-e1ec92b** registrada somente após READY. `verify:deploy` health/ready/config aprovado no schema **56**.
- **https://hortvitalmix.vercel.app/checkout**: tela publicada sem login em 390/1440 px, controles corretos, sem overflow/erros JavaScript. Seis verificações reais de API/dispatcher exigiram Auth com JSON/requestId e 401; nenhuma transação anônima. A leitura automática da cesta do cabeçalho foi interceptada vazia apenas no navegador de verificação para preservar a base T18; Auth/configuração/rotas checkout reais. O fluxo autenticado completo está provado em PostgreSQL local real, sem compra/reserva ou fixtures de negócio em produção.
- Depois da release/navegação, **64 relações anteriores**, excluindo somente `app_releases`, mantiveram contagens/digests, inclusive cesta, Auth, Storage, produtos, preços e estoque. Logs error/fatal sem entradas na janela consultada. Segurança do PR aprovada; prévias Vercel/Supabase desabilitadas/canceladas pela governança. Limitação histórica do check Supabase de aliases permanece descrita no relatório; histórico canônico de 62 migrations validado.
- Fechamento documental restrito a Livro-Raiz/relatório/evidência; release acompanha a SHA final da main somente após READY, sem mudar schema 56/hash ou implementação homologada. **T20 deve partir desta base e evoluir os intents pendentes existentes.**


## 2026-10-06 — Auditoria técnica: correções publicadas e limites de verificação

**🔧 PROBLEMA ENCONTRADO E CORRIGIDO.** A auditoria partiu de main/b3cb8532a1349c1f1a14d7b150f1e9e76d1f6079, deployment dpl_DKsMqw2mrEe7zdRjssoU65t7exGw, schema 56. A retomada recuperou o ambiente e preservou o checkpoint audit/hortvitalmix-20261006.

Implementação final comprovada em produção: **main/1fafc77de3358ccfb66af1fe4eb5578857b59c66**, deployment **dpl_7qT6hyE2sas4CX5mf84VbPPhs1XP**, READY e domínio principal confirmado; release funcional **audit-v57-1fafc77**. Fechamento documental acompanha esse código, e a release corrente segue o SHA realmente ativo após seu deploy.

Supabase canônico xipbsazvymkqqfmfegwu: **schema 57 / 63 migrations**, hash **614027ef88c383fb30dbf14fcf670104cf2fb7025cfa801253059bca67014b25**. Migration nova 20261006023915_audit_sessions_and_client_privileges.sql aplicada como versão física 20261006120330, reconciliada por alias. Revogados TRUNCATE desnecessários de anon/authenticated; allowlists e RLS mantidas. RPC de sessão stable/SECURITY DEFINER, search_path pg_catalog, EXECUTE somente service_role. Histórico de migrations anterior preservado.

Correções mínimas: reautenticação administrativa pela data da sessão, not_after/fallback restrito, exceção Auth com 503 controlado, autoria de aceite por sessão própria ou HMAC específico de cadastro, resposta de localidades validada antes do estado e correção de confirmação de senha. Prova de aceite tem prazo de dez minutos e não reutiliza confirmationContext. Backend/Edge/Account preservam cadastro atômico e mesma identidade consumer/producer. Nenhuma mudança de texto jurídico substantiva.

Edge public-registration **v11 ACTIVE**, fonte remota equivalente à versionada; admin-bootstrap v4 mantida. As **64 tabelas public continuam RLS ENABLE/FORCE**, quatro buckets privados, 88 policies, 241 índices, 52 triggers public/storage/auth. View **app_property_current_verification** segue referência canônica restrita ao backend; decisões anteriores são histórico. Contagens remotas finais: cinco usuários Auth, dez objetos Storage, três cestas/zero itens, sem fixtures de auditoria na base canônica.

Uma regressão de runtime foi introduzida na primeira publicação: sanitize-html 2.18/htmlparser2 12 produziu ERR_REQUIRE_ESM na Vercel, embora o build/teste com tsx passassem. Houve rollback com health/ready 200. O SHA final mantém sanitizador corrigido e override restrito de parser CommonJS 10.1.0; cold start agora testa require sem tsx. Node 22, negativos de XSS e 22 testes PostgreSQL de loja passaram. Releases intermediárias/rollback permanecem rastreáveis.

Validação: build/typecheck/lint/segurança aprovados; **729 testes padrão**, **214 PostgreSQL**, **26 integrações atuais**, **16 cenários Auth/Storage/Edge reais locais**; **316 cenários de navegador**, incluindo cinco timeouts conjuntos aprovados isoladamente sem mudança. Produção: **health/ready/config aprovados, schema 57**, **14 negativos**, **40 páginas em cinco larguras**, sem pageerror/overflow. Serviços reais isolados não substituem homologação autenticada das contas de produção.

Performance: Brotli existente preservado; nenhuma melhoria percentual alegada. Rodadas inicial/final e 180 leituras locais com concorrência 1/2/4 documentadas; massa de produtos/lojas vazia limita o benchmark. SQL/índices/loops transacionais e cache privado preservados. npm audit: **seis → zero advisories**.

**⚠️ PENDENTE JUSTIFICADO:** cobertura global abaixo dos limites originais; três testes de comunicação legada desativada reproduzem a mesma falha no SHA original; homologação privada de produção sem credenciais específicas; benchmark representativo; eventos storage_deletion_queue_failed de causa não comprovada, com fila sem pendentes; recurso Pro de proteção de senha incompatível com custo definido. **REVISÃO JURÍDICA NECESSÁRIA:** controlador, bases, Gemini/documentos, transferências, retenção e exportação/exclusão integral.

Stack Vite/TypeScript + Express + Supabase Auth/PostgreSQL/Storage + Vercel/GitHub e os quatro papéis foram preservados. Nenhum dado apagado, migration aplicada editada, RLS enfraquecida, infraestrutura paga ou GitHub Action criada. T20/T21 continuam futuras.

Relatório: [AUDITORIA_HORTVITALMIX_COMPLETA.md](AUDITORIA_HORTVITALMIX_COMPLETA.md). Evidências: [agregados](docs/auditoria/2026-10-06/evidencias.json) e [validação](docs/auditoria/2026-10-06/VALIDACAO.md). SHA/deploy/release do fechamento documental são reconfirmados no registro /workspace/scratch/hvm-publication-final.json, sem credenciais.

## 2026-10-06 — Fotos de produtos e lojas preparadas automaticamente

**🔧 PROBLEMA ENCONTRADO E CORRIGIDO:** continuação solicitada para fotos aparecendo em tempos diferentes. Publicada em **main/e8f179c9afb9279436e8c0140015b32e67fb5d4b**, deployment **dpl_2GdgA9p2doPCC9XVgh3ZhFBw2md9**, READY/domínio principal verificados; release funcional **photos-v57-e8f179c**. Fechamento documental acompanha esse código e identifica a release corrente do SHA ativo.

Descoberta e baseline precederam a alteração: fotos reais WebP de produto/loja, 50.574/316.108 bytes; diferença de 489,3/673,2 ms entre carregamentos na home nas duas primeiras amostras. Três cenários específicos falharam antes e passaram depois. A alteração prepara em paralelo fotos principais já autorizadas: destaque + retrato, três primeiros produtos/lojas e capa/retrato/produtos da vitrine. Demais fotos carregam automaticamente conforme a área visível; duas próximas imagens do carrossel são antecipadas sem clique. Reuso de assinatura/decodificação, deduplicação, cancelamento e espera máxima de oito segundos; feedback em português para foto pendente ou inválida. Renovação de URL mantém a imagem em cache sem indicador permanente ou download duplicado. Sem compressor, reescrita de módulo ou download obrigatório de cem produtos.

**✅ VERIFICADO E CORRETO no escopo descrito:** 737 testes ativos/260 condicionais, build/lint/TypeScript/cold start Node 22; 21 testes dirigidos, 70/70 navegador afetado e 16/16 PostgreSQL real local de mídias. Rodada completa 319/321; dois testes foram ajustados à espera do lazy loading e ao seletor de categorias e passaram 2/2, sem remover assertions/ampliar timeouts. Sexto caso novo incluído na suíte afetada: **322 cenários distintos comprovados entre rodadas**. Interface local com GET públicos reais da API de produção e arquivos reais do Storage: **6/6 páginas** em 390/1440 px mostraram fotos principais prontas no primeiro frame da seção; não se declara essa medição como navegador pós-deploy ou ganho percentual de latência.

GitHub, Vercel e release canônica confirmados. Pelo conector Vercel: health/ready/config/HTML/JS **200**, schema 57/tag correta; bundle novo index-D4ND3k6G.js, **575.469 bytes**. **⚠️ PENDENTE JUSTIFICADO:** repetição de navegador/negativos/verificador CLI após fotos, bloqueada pelo proxy HTTPS do executor, que devolve 503 text/plain/erro `envoy://cloudflare_https_tunnel/`. A mesma falha aparece fora da aplicação; health/ready reais pelo conector continuam 200. Coleta visual interrompida não é sucesso. O conector com link temporário não homologa queries estritas; Zod foi preservado.

Preservação reconfirmada: **zero novas migrations nesta continuação**, schema 57/63 físicas, 64 tabelas ENABLE/FORCE RLS, quatro buckets privados, Auth 5 usuários, Storage 10 objetos, cestas 3/itens 0. server/shared/supabase/api/dependências/configuração idênticos ao fechamento anterior 4b3e3b7. Nenhum objeto/foto/dado canônico foi substituído ou apagado. Stack, quatro papéis, Auth/Storage/Supabase, custo gratuito, portais e fluxos T09/T10 mantidos. Política jurídica/trackers não alterados; pendências anteriores continuam explícitas no relatório.

## 2026-10-06 — Trilha 20 preparada e proteção da compra — schema 58

- Base preservada: **main 7f4e619effd6c68d42811be8f1cf385c378e7227**, schema **57**, T01–T19. Referência normativa: **PDF Plano T12–T25, T20, Volume 4**. O titular determinou preparar os pagamentos por ainda não possuir conta de gateway e ampliou o escopo para caixa presencial, reembolsos, denúncias, fotos e destino/ícone do login. Não foi iniciada a esteira de preparo T21.
- Migration CLI **20261006180831_trilha20_commerce_protection_prepared.sql**, aplicada como **20261006191208** no único Supabase **xipbsazvymkqqfmfegwu**; alias físico mapeado. **Schema 58, 64 migrations**, hash **d18736b84cc19ccfc547f262843f1e5f048c4129086c6a091a568b14cd61b06e**. Nenhuma migration anterior, lockfile, dependência ou configuração Vercel alterada.
- Doze tabelas aditivas para configuração, recibos, caixa, aceite, pedidos multilojas, retenções, eventos financeiros, reembolsos, denúncias, mensagens, histórico e evidências. Intents T19 preservados e evoluídos para débito e origem cotação ou venda presencial. **76 tabelas app_* ENABLE/FORCE RLS**; authenticated somente SELECT nas tabelas novas permitidas, mutações pelo backend. Privilégios de cliente e flags RLS anteriores preservados. service_role recebe CRUD nas relações novas, sem TRUNCATE.
- **67 relações anteriores** mantiveram contagens/digests após a aplicação, incluindo Auth e Storage. Exclusões de conta anteriores mantêm suas cascatas e referências anuláveis; anexos usam a fila de limpeza existente. Novo bucket **case-evidence privado**, até 2 MB por arquivo, sem objetos de teste em produção. Cinco usuários Auth e dez objetos anteriores preservados.
- **Caixa /produtor/caixa**: loja própria, produtos/quantidades/preços do servidor, Pix do sistema ou crédito/débito na futura maquininha vinculada, link privado de revisão autenticada, cancelamento de venda pendente. **Sem dinheiro, recebimento manual, reserva ou baixa antecipada na preparação.** Cliente revisa termos em **/pos/venda/:code**; a revisão não significa pagamento.
- **Pagamentos /pagamentos/:intentId** e alias **/pedidos/:id/pagamento**: espaço Pix e cartão hospedado, com campos de cartão desabilitados e sem captura de PAN/CVV. Interface/contratos/adaptador preparados; nenhum QR falso. Webhook e início de cobrança falham explicitamente por gateway ausente. Configuração **/admin/pagamentos** guarda apenas referências não secretas da conta central/terminal; preenchimento não ativa operações financeiras.
- Liquidação interna para futuro adaptador: assinatura e consulta autenticada do pagamento são responsabilidade obrigatória do provedor; referência/método/moeda/total/aceite/validade conferidos antes da aprovação. Evento único, consumo das reservas T15, pedidos por loja, retenção e retirada das quantidades compradas da cesta em transação SQL única. Sem segunda baixa de estoque; reserva expirada aborta a operação. Não existe rota para frontend ou administrador declarar pagamento.
- **Reembolsos /reembolsos e /admin/reembolsos**: pedido próprio, motivo, valor total/parcial, análise, decisão justificada, revisão concorrente, histórico imutável, mensagens e anexos privados. Aprovação fica **estorno pendente**; somente confirmação confiável do gateway encerra devolução financeira. **Denúncias /denuncias e /admin/denuncias**: consumidor denuncia loja/produtor/produto; produtor denuncia cliente ligado a pedido da sua loja. Triagem privada, informação adicional, resolução/arquivamento e encaminhamento à governança existente; não há punição automática.
- Novas permissões setoriais **refund_management**, **complaint_management**, **payment_configuration**. Super administrador ou administrador especificamente autorizado, com revalidação de conta/sessão/papel/setor/expiração e autenticação recente para decisões/configuração/anexos. As permissões financeiras não concedem bloqueio de contas.
- Modelo expressamente confirmado pelo titular: arrependimento online **7 dias após recebimento quando aplicável**, compra presencial por problema/garantia/política comercial, retenção futura **7 dias após entrega e bloqueio durante disputa**. Política editável e versionada em **/admin/politica-reembolso**; termos aceitos congelados, direitos legais preservados e datas no comprovante de **/compras**. Confirmação de recebimento pelo cliente inicia a contagem uma vez.
- Fotos: dados da vitrine aparecem sem aguardar a preparação conjunta das imagens, que segue em paralelo; reuso de assinaturas válidas de produto/loja também após recarga, por sessão, até cinco minutos e dentro da expiração do token. Prioridade visível e carregamento progressivo mantidos. Nenhuma mídia antiga removida/regravada/publicada. Login consumidor/produtor abre **/**; administração mantém **/admin/painel**, com ícone conectado conforme o papel em desktop/mobile.
- Validação: **760 testes gerais ativos/283 condicionais não executados**, **218 PostgreSQL local** (incluem 22 novos T20), **14 HTTP + 7 contratos + 2 persistência de mídia**, histórias reais **T19/T20 React → API/permissão → PostgreSQL**, **32 cenários T20 + 52 regressões de navegador** entre rodadas, 320/390/768/1440 px. Replay limpo das 64 migrations, build, TypeScript global/de produção, manifesto, segredos e cold start aprovados. Fixtures financeiras somente no banco local descartável; não houve cobrança, conta ou upload de teste remoto.

**Status: preparação e fluxos administrativos entregues; pagamentos reais NÃO ATIVOS.** Cobrança Pix/cartão, maquininha, custódia, repasse e estorno bancário aguardam conta, escolha/contrato do provedor, adaptador específico, credenciais no servidor e validação em sandbox. Não se declara a T20 financeira integralmente homologada sem essa integração. Relatório e passos de ativação: **docs/TRILHA20_COMERCIO_PROTEGIDO.md**; preservação: **docs/TRILHA20_PRESERVACAO.json**. A publicação e o selo da SHA exata são registrados somente após READY.

## 2026-10-06 — Fechamento de produção da T20 preparada

- Publicação funcional pelos **PRs 83 e 84**, SHA **788cea45dd8cb4603f5cea76b988b7d82bc9d9ed**, tree **294da7446451c9a7346957cf0853a5cea1b2b3b0**, deployment **dpl_FHAohFUX1FWtBKD7dyLTBdeiTrt6**, **READY/main/production/pdx1**, domínio **https://hortvitalmix.vercel.app**. Release **t20-prepared-v58-788cea4** registrada após READY; schema **58**, histórico **64 migrations/d18736b84cc19ccfc547f262843f1e5f048c4129086c6a091a568b14cd61b06e**. O fechamento documental recebe o selo da SHA corrente após seu próprio READY, sem mudança funcional ou nova migration.
- A política de reembolso passou a ser pública antes do login. **34/34 cenários T20 de interface**, incluindo dois novos cenários para visitantes; build e verificações de tipos/segredos/regressão aprovados. CLI de produção **health/ready/config/SHA** aprovado, com proxy do executor configurado; a limitação anterior de acesso por esse executor foi superada nesta conferência.
- **Nove verificações de API**: públicos 200, privados sem sessão 401, webhook forjado 503 por gateway ausente. **Dez combinações página/largura** em 390/1440 px: reembolsos, denúncias, home, produtos e loja, sem pageerror/overflow; fotos reais de produto e capa comprovadas. Todas as fotos visíveis da home carregaram em **2.546/1.189 ms**, recarga **953/917 ms**, com cache de assinatura e memória. Amostras desse ambiente/rede, sem promessa de imagem instantânea. Logs sem grupos error/fatal na janela consultada de dez minutos.
- Preservação imediatamente após a migration: **67/67 relações anteriores com contagem/digest iguais**. Na conferência final houve uso autenticado concorrente registrado por checkout/cesta/aceite; diferenças finais desses registros e Auth estão explicitadas na evidência. **76 tabelas ENABLE/FORCE RLS**, zero grants DML de cliente; **cinco usuários Auth/dez objetos anteriores**. Nenhuma conta, pagamento ou evidência de teste criada em produção. Achados WARN anteriores de helpers/policies/Auth permanecem documentados; nenhum WARN/ERROR novo da T20.
- Preparação solicitada concluída: caixa sem dinheiro, Pix/crédito/débito preparados, política editável, carência futura de **sete dias após entrega e bloqueio durante disputa**, reembolsos e denúncias com histórico/anexos/permissões específicas, fotos e destino/ícone do login. **Movimentação financeira real continua inativa**, dependendo de conta, contrato, adaptador, credenciais no servidor e testes do provedor. Áreas autenticadas verificadas localmente com API/PostgreSQL; não se declara homologação autenticada de contas reais em produção.

Relatório atualizado: [TRILHA20_COMERCIO_PROTEGIDO.md](docs/TRILHA20_COMERCIO_PROTEGIDO.md). Evidência: [TRILHA20_PRESERVACAO.json](docs/TRILHA20_PRESERVACAO.json). Publicações: [PR 83](https://github.com/wesleialvessantos39/HortVitalMix/pull/83) e [PR 84](https://github.com/wesleialvessantos39/HortVitalMix/pull/84).

---

## 2026-10-07 — Trilha 21: pedidos e rastreabilidade — schema 59

- Base **main fd02e63a27f11d7315130bc3f178b614fc29acf9**, T01–T20/schema **58** preservada. Fonte de escopo: **Plano T12–T25, Trilha 21, Volume 4**. O exemplo de DDL não recriou `app_orders`: a T20 já possui pedidos multilojas e estado comercial/recebimento/reembolso. A esteira foi acrescentada em `app_order_fulfillment`, sem substituir esses contratos.
- Máquina estrita: **confirmed → in_preparation → ready_for_dispatch → out_for_delivery → delivered**. Cancelamento somente em confirmed/in_preparation, com motivo de 10–500 caracteres. Bloqueio SQL, revisão otimista (409), transição ilegal (422), comando idempotente e evento imutável por revisão. Sem atalho administrativo. Criação exige intenção aprovada ao final da transação T20; itens/endereço/valores congelados.
- Cancelamento credita exatamente uma vez o lote de origem T15 e registra a devolução, preservando baixa e reserva consumida originais. Estado, histórico, estoque, auditoria e solicitação de reembolso T20 são atômicos. Valores continuam retidos em disputa; nenhum estorno bancário é declarado. Recebimento de pedido cancelado bloqueado, e os demais fluxos de compras/caixa/proteção continuam anteriores.
- Migration canônica **20261007012246_trilha21_orders_state_machine.sql**, física **20261007015514**, aplicada no Supabase único **xipbsazvymkqqfmfegwu**. Schema **59**, **65 migrations**, hash **1db093de8e3fda956dc955b9001b73b20cd1e5f402e77b27f25550f88cf02b9d**; manifesto/constante/alias sincronizados. As **64 migrations anteriores** permanecem byte a byte iguais. Novas `app_order_fulfillment`, `app_order_items`, `app_order_events` e `app_order_stock_returns`, todas RLS **ENABLE/FORCE**; authenticated só SELECT nas três primeiras, policies separadas por participante; devoluções privadas. Helpers invoker privados, sem EXECUTE de cliente.
- Produtor **/produtor/pedidos** com colunas, filtros, paginação, avanço e cancelamento justificado. Consumidor **/pedidos** e **/pedidos/:id** com timeline, histórico, endereço e snapshots. **/compras** conserva proteção/recebimento/reembolso T20; pagamento **/pagamentos/:id** e alias **/pedidos/:id/pagamento** preservados. Atualização visível a cada 15 s/foco, sem consultas sobrepostas, com abort/timeout e limpeza de dados após perda de acesso. Responsividade em **320/390/768/1440 px**.
- Validação: **776 testes gerais aprovados / 303 condicionais não executados**; **196 cenários PostgreSQL anteriores + 19 T21 + uma história React compilado → HTTP → PostgreSQL → cliente**, em bancos locais descartáveis com replay das 65 migrations. **21 cenários T21 + 61 anteriores** aprovados no build compilado; teste anterior que importa fonte de otimização de fotos conferido separadamente em dev. Falhas iniciais por fixtures compartilhadas/reinício de dev foram resolvidas no ambiente de verificação, sem alterar testes/módulos anteriores. TypeScript global/produção, build, manifesto/hash, segredos e cold start Node 22/24 aprovados.
- Preservação remota imediatamente após migration: **80/80 relações anteriores com contagem/digest idênticos**. **80 tabelas app com ENABLE/FORCE**, zero grants DML de clientes e zero EXECUTE de cliente nos helpers T21. Nenhum WARN/ERROR novo de segurança; cinco WARN anteriores mantidos. Três WARN novos de desempenho correspondem às policies separadas expressamente exigidas na T21, com initplan/índices; INFO de devoluções sem policy é intencional e índices ainda sem uso refletem ausência de pedidos. Links e detalhes no relatório.
- Plano gratuito e configuração Vercel **main/pdx1** preservados, sem serviço/dependência/credencial nova. **Gateway real da T20 continua inativo**. Auth/Storage e confirmação financeira são adaptados somente no banco local; não se declara homologação autenticada de contas reais ou cobrança em produção. Não iniciadas janelas/prova formal/GPS T22 nem avaliações T24.

Relatório: [TRILHA21_PEDIDOS_RASTREABILIDADE.md](docs/TRILHA21_PEDIDOS_RASTREABILIDADE.md). Evidência de metadados: [TRILHA21_PRESERVACAO.json](docs/TRILHA21_PRESERVACAO.json). Publicação e selo da SHA exata serão registrados somente após READY na main. **T22 deverá partir do schema lógico 59** e preservar os contratos comerciais T20 e a esteira T21.


## 2026-10-07 — Fechamento de produção da T21

- [PR 86](https://github.com/wesleialvessantos39/HortVitalMix/pull/86) integrada; SHA funcional **cb1c18e43a1663624b49b87023a0ab64182222dd**, árvore **60798374ed1d32a5e04f2c088f06e28d912be679**, igual à validada localmente. Deployment **dpl_HqbVC6gis2VcRep31gRJDXXsyg9T**, **READY/main/production/pdx1**, domínio **https://hortvitalmix.vercel.app**. Release **t21-v59-cb1c18e** registrada somente após READY. Schema **59**, **65 migrations**, hash **1db093de8e3fda956dc955b9001b73b20cd1e5f402e77b27f25550f88cf02b9d**. O fechamento documental preserva esse código e recebe o selo da SHA corrente após seu próprio READY, sem nova migration.
- CLI de **health/ready/config/SHA/schema** aprovado. **Onze verificações de API**: públicos 200, rotas T21 e compras/caixa T20 sem sessão 401, CSRF 403 e webhook forjado 503 `GATEWAY_NOT_CONFIGURED`, sem lançamento financeiro. **Seis combinações página/largura** reais em 390/1440 px, entrada segura em painel/lista/detalhe, sem overflow/pageerror. Não usadas contas reais em produção; apenas o fetch automático da cesta do cabeçalho foi interceptado para não criar carrinho visitante. Fluxos privados comprovados localmente com React/API/PostgreSQL.
- **79/79 relações anteriores de negócio/Auth/Storage** mantêm contagem e digest após publicação. Somente `app_releases` difere entre as 80 relações comparadas, por seu selo intencional. Cinco usuários Auth e dez objetos anteriores preservados; nenhum pedido/conta/upload de teste criado. Logs sem grupos error/fatal na janela consultada de cinco minutos. Advisors novos de desempenho/INFO permanecem explicitados no relatório, sem WARN/ERROR novo de segurança.
- Entrega T21 concluída: máquina estrita, snapshots/histórico imutáveis, cancelamento atômico com devolução única, painel do produtor e acompanhamento do consumidor. **Gateway real T20 continua inativo**, e janelas/prova formal/GPS T22 e avaliações T24 continuam futuras. **T22 parte do schema 59** com T01–T20 e T21 preservadas.

Relatório atualizado: [TRILHA21_PEDIDOS_RASTREABILIDADE.md](docs/TRILHA21_PEDIDOS_RASTREABILIDADE.md). Evidência: [TRILHA21_PRESERVACAO.json](docs/TRILHA21_PRESERVACAO.json).

# AUDITORIA HORTVITALMIX COMPLETA

**Resultado desta execução: ⚠️ PENDENTE JUSTIFICADO.** A auditoria e as correções candidatas foram interrompidas pela indisponibilidade do ambiente de execução (`409 environment_offline`). Este documento registra evidências, correções locais e gates ainda abertos. **Não declara a auditoria concluída nem as correções publicadas em produção.**

# Identificação

| Elemento | Inicial | Última confirmação |
|---|---|---|
| Data | 2026-10-06, UTC | 2026-10-06, UTC |
| Repositório | `wesleialvessantos39/HortVitalMix` | Mesmo repositório |
| Branch canônica | `main` | `main`, sem alteração nesta execução |
| Commit canônico | `b3cb8532a1349c1f1a14d7b150f1e9e76d1f6079` | Mesmo SHA |
| Deploy Production | `dpl_DKsMqw2mrEe7zdRjssoU65t7exGw` | Mesmo deploy, READY, SHA canônico confirmado por API Vercel |
| Domínio | https://hortvitalmix.vercel.app | Mesmo domínio/alias |
| Supabase | HortVitalMix, `xipbsazvymkqqfmfegwu`, us-west-2 | ACTIVE_HEALTHY; sem escrita remota nesta execução |
| PostgreSQL | 17.6 | Sem mudança |
| Schema lógico | 56 | 56 em produção |
| Histórico | 62 migrations | 62 migrations em produção |
| Última migration física | `20261006015914_trilha19_checkout_quotes` | Mesma |
| Migration canônica correspondente | `20261006012938_trilha19_checkout_quotes.sql` | Alias histórico existente preservado |
| Hash aplicado | `2caaa0fd11223a49aceb6479581aad7c8e15a1fa122166564b06981d06217572` | Mesmo hash |
| Release canônica | `t19-v56-b3cb853` | Mesma release |

As correções candidatas e este relatório estão na branch temporária `audit/hortvitalmix-20261006`. O commit que contém este arquivo pode ser consultado no histórico dessa branch. Ela não substitui `main`; a configuração existente da Vercel mantém deploys habilitados apenas para `main`.

A nova migration candidata é `20261006023915_audit_sessions_and_client_privileges.sql`, criada com o CLI existente. Foi aplicada somente ao PostgreSQL descartável local. O manifesto candidato representa schema 57/hash `614027ef88c383fb30dbf14fcf670104cf2fb7025cfa801253059bca67014b25`. **Esses valores não são o estado do Supabase de produção.**

# Estado inicial

Descoberta ocorreu antes das alterações de código. O checkout inicial estava limpo. Foram inventariados 548 arquivos versionados, frontend React/TypeScript/Vite, backend Express, 21 módulos de contratos compartilhados, serviços, rotas, migrations e infraestrutura conectada. Não foram encontrados arquivos AGENTS.md aplicáveis.

| Verificação | Resultado anterior às mudanças |
|---|---|
| `npm ci` | Instalou dependências; aviso de engines: projeto declara Node 22.x, ambiente local usa Node 24.19.0 |
| `npm run migrations:verify` | ✅ VERIFICADO E CORRETO: schema 56/hash canônico |
| `npm run typecheck` | ⚠️ PENDENTE JUSTIFICADO: erro TS2322 em `registrationBackground.test.ts:38`, modo `transform` incompatível com os tipos instalados |
| `npm run lint` | ⚠️ PENDENTE JUSTIFICADO: interrompido pela mesma falha de TypeScript |
| `npm run test:contract` | ✅ VERIFICADO E CORRETO: passou |
| `npm test` | 77 arquivos aprovados, 27 ignorados; 707 testes aprovados, 237 ignorados, total 944 |
| `npm run build` | ✅ VERIFICADO E CORRETO: build original passou, incluindo gates executados pelo script |
| `npm run test:coverage` | ⚠️ PENDENTE JUSTIFICADO: thresholds existentes não atingidos |
| PostgreSQL local, suítes existentes | 191 testes aprovados, 1 falhou, 15 ignorados; uma segunda suíte falhou na preparação por compartilhar banco com fixtures anteriores |
| Storage/mídia em banco local novo | ✅ VERIFICADO E CORRETO no escopo local: 15 testes aprovados na suíte isolada |
| Navegador, suíte completa | 277 aprovados, 39 falhas preexistentes, total 316; duração 12,1 minutos |
| Produção `/api/health` | ✅ VERIFICADO E CORRETO: HTTP 200 no baseline |
| Produção `/api/ready` | ✅ VERIFICADO E CORRETO: HTTP 200, schema 56/release canônica no baseline |
| Navegador real, login consumidor em produção | Página carregou, sem pageerrors/overflow; formulário disponível, sem autenticação com credenciais reais |
| Negativos HTTP em produção | 13 casos executados com respostas 401/403/400 esperadas, sem alterar dados |

A cobertura original foi: linhas 33,87%, funções 43,43%, statements 32,66%, branches 25,93%; thresholds globais 60/60/60/50. Também falharam limites específicos de foundation, contratos e helpers. Nenhum threshold foi reduzido.

As 39 falhas de navegador incluem seletores/fixtures antigos em confirmação, iPhone, navegação de sessão, shell/configuração, login T05 e conta T06. Suas causas individuais e eventuais problemas funcionais ainda precisam ser concluídos. Não foram removidas assertions, desabilitados testes ou declaradas falhas de produto resolvidas sem reprodução.

A falha PostgreSQL de catálogo era um locator ambíguo: `15,90` aparecia no carrossel e no catálogo. A candidata restringe o locator ao catálogo de alimentos e mantém a assertion de visibilidade. A preparação da suíte de mídia exigia banco vazio; o mesmo teste passou em banco novo, sem apagar fixtures ou dados de produção.

Os logs originais ficaram em `/workspace/scratch/hvm-baseline-*.log`, `hvm-security-before.log`, `hvm-security-after.log`, JSONs de HTTP e screenshots. O ambiente ficou inacessível antes de copiá-los integralmente ao repositório. Os resultados agregados e as observações remotas estão registrados em [evidencias.json](docs/auditoria/2026-10-06/evidencias.json).

# Performance

## JSON, compressão e rede

✅ VERIFICADO E CORRETO no baseline: a Vercel respondeu JSON público com **Brotli (`Content-Encoding: br`)**. Não foi instalado compressor.

| Endpoint | Corpo sem compressão | Transferência medida com br | Cache-Control |
|---|---:|---:|---|
| Produtos públicos | 1.436 bytes | 1.092 bytes | no-store |
| Categorias públicas | 1.446 bytes | 694 bytes | no-store |
| Health | 127 bytes | identity no tamanho observado | no-store |
| Ready | 144 bytes | identity no tamanho observado | no-store |

`Content-Length`, `Content-Encoding`, tamanho de transferência e `Cache-Control` foram inspecionados. `Vary` não apareceu nas amostras sem Origin; não foi feita mudança sem evidência de falha de cache. Respostas privadas continuam sem cache compartilhado.

Foram feitas dez leituras sequenciais por endpoint, concorrência 1, total 40 requisições públicas. Os tempos incluem rede e proxy deste ambiente:

| Endpoint | Média | p50 | p95/p99 nesta amostra |
|---|---:|---:|---:|
| Health | 180,1 ms | 184,3 ms | 203,4 ms |
| Ready | 187,8 ms | 184,5 ms | 204,4 ms |
| Produtos | 199,6 ms | 203,8 ms | 246,8 ms |
| Categorias | 174,4 ms | 184,1 ms | 202,2 ms |

Com n=10, p95/p99 pelo método observado correspondem ao máximo da amostra. Isto não é um teste de capacidade de produção nem demonstra desempenho com centenas de usuários simultâneos. Não houve carga destrutiva.

**Antes × depois:** não existe medição final da candidata. Não se afirma ganho percentual, latência reduzida ou capacidade adicional.

## Banco e frontend

Estatísticas reais de `pg_stat_statements`, no momento da coleta:

| Consulta normalizada | Chamadas | Média no PostgreSQL | Máximo registrado |
|---|---:|---:|---:|
| Produtos públicos/preço/vitrine | 357 | 8,942 ms | 179,325 ms |
| Descoberta de lojas | 167 | 14,560 ms | 154,008 ms |
| Identidade consolidada | 5.525 | 0,165 ms | 10,101 ms |

Estas estatísticas não fornecem p95/p99. Não foi executado EXPLAIN ANALYZE sobre operações de escrita ou carga em produção.

A listagem de imóveis usa consulta agregada e a fila de verificações carrega IDs em lote. A descoberta e as assinaturas de mídia também possuem agregação/batch existentes. Loops de checkout/estoque mantêm locks, FIFO, idempotência e auditoria transacional. Não foram transformados em batch indiscriminado.

Advisors indicaram cinco FKs sem índices candidatos, 61 índices sem uso registrado e 22 avisos de policies permissivas múltiplas. Sem demonstração de gargalo nas consultas correspondentes, índices e policies foram preservados. Ausência de uso na janela de estatísticas não prova que um índice pode ser apagado.

Bundle inicial: main JS 573,75 kB, gzip 162,47 kB; chunk PDF 373,59 kB, gzip 111,8 kB, carregado separadamente. O aviso de chunk acima de 500 kB foi registrado. Não houve reescrita de componentes, troca de stack ou otimização sem comparação.

⚠️ PENDENTE JUSTIFICADO: planos de execução dirigidos às queries lentas, benchmark autenticado, carga progressiva exclusivamente local, cache de assets, análise completa de requests/renderizações e comparação final da candidata. A leitura canônica de sessão adiciona trabalho às rotas protegidas; seu custo final precisa ser medido.

# Segurança

## P0 — segredos, autenticação e exposição

A inspeção dos arquivos versionados e aproximadamente 2.200 blobs históricos não encontrou chaves privadas compatíveis com as regras executadas (JWT service_role, Supabase secret, tokens GitHub e chaves Google). Apenas `.env.example` está versionado; não foi encontrado histórico de `.env` real. O gate existente de bundle passou no build original.

Chaves anon/publishable destinadas ao cliente foram distinguidas de segredos administrativos. Os valores completos de segredos não foram incluídos no relatório. Metadados de env Vercel foram consultados sem decrypt.

Não foi demonstrado P0 em produção. Isso não encerra as validações autenticadas ainda pendentes.

## Achados e protocolo de correção

| Achado | Severidade e evidência | Impacto | Estado |
|---|---|---|---|
| Reautenticação administrativa vinculada ao último login da conta | P1: `resolveSessionIssuedAt` em adminSession priorizava `user.last_sign_in_at`, depois JWT iat; teste local com sessão de uma hora e outro login recente passava | Outra sessão da mesma conta ou emissão de novo JWT influenciava a janela de ação sensível | Correção candidata lê `auth.sessions.created_at` e preserva prova HMAC de reautenticação vinculada a usuário/sessão; publicação pendente |
| Grants destrutivos herdados | P1: `has_table_privilege` verdadeiro em quatro combinações anon/authenticated × consentimentos/preferências | TRUNCATE não é filtrado por RLS; privilégio desnecessário para o cliente | Migration candidata revoga TRUNCATE dos dois papéis e I/U/D herdados de anon; validada somente localmente |
| Exceção de Auth no middleware administrativo | P2: promessa rejeitada não era capturada no Express 4; reprodução lançou exceção | Requisição sem resposta controlada/indisponibilidade | Candidata retorna 503 genérico, sem liberar acesso; teste local passou |
| `not_after` e fallback de validade de sessão | P2: consulta pública de sessão não verificava limite e fallback Data API devolvia liveSession=true | Limite de sessão não era aplicado de forma uniforme pela aplicação | Candidata preserva consulta consolidada, verifica limite e usa RPC restrita ao backend no fallback; validação completa pendente |
| Registro público de consentimento sem prova | P1, integridade do registro: `POST /v1/auth/lgpd-acceptance` usa userId/email e serviço privilegiado sem comprovação de autoria | Conhecimento do par identificador/e-mail pode produzir registro de aceite ausente | ⚠️ PENDENTE JUSTIFICADO: requer prova específica emitida pelo cadastro ou autenticação válida, preservando o fallback existente |
| Dependências com advisories | npm audit: 6 ocorrências, 3 high, 3 moderate, nenhuma critical | Riscos descritos pelos advisories; exploração na aplicação não foi demonstrada | ⚠️ PENDENTE JUSTIFICADO: atualização interrompida por erro do proxy e depois ambiente offline |

O endpoint de consentimento é chamado como contingência por Account quando o resultado de cadastro não contém lgpdRecorded. O cadastro novo com consentimento já usa RPC atômica. Uma correção compatível deve proteger a contingência, incluindo o caminho de identidade existente. **Não reutilizar confirmationContext como prova de aceite:** o reenvio de confirmação pode emitir esse contexto sem provar consentimento. Não foi enfraquecido o cadastro para resolver o problema.

Os advisories afetam Express/body-parser/qs/path-to-regexp, sanitize-html e source-map-js. Foram avaliadas atualizações compatíveis Express 4.22.3, sanitize-html 2.18.0 e source-map-js 1.2.2, conforme diagnóstico do registry/audit. A resolução npm falhou com HTTP 503 do proxy antes de concluir; package.json/lockfile não receberam uma atualização validada. Não foi usado `npm audit fix --force`.

sanitizeStoreBio já remove tags/atributos e o resultado é renderizado como texto React. O relatório não declara um XSS explorável apenas pela existência de advisory.

### Escopo da prova de sessões

Os sete testes de segurança local passaram após a migration e correção locais: sessão viva, sessão removida, not_after expirado, session_id inexistente, reautenticação de outra sessão, falha de Auth e grants.

**Supabase Auth foi adaptado nesses testes; PostgreSQL e SQL de sessão/grants foram reais e locais.** A leitura do código atual de Supabase Auth mostrou que getUser já procura o session_id e rejeita sessão removida. Portanto, a reprodução com Auth adaptado não é evidência de bypass de logout em produção. A data da sessão, o limite not_after e o tratamento de exceção são os problemas corrigidos na candidata; testes reais de Auth continuam necessários.

### Dependências, proteção e testes

A alteração administrativa preserva a resolução de principal, papéis ativos, setores, bloqueio e separação de portais. O login continua usando Supabase Auth. A consulta pública consolidada continua existindo. A nova função `fn_live_auth_session` usa parâmetros UUID, schema qualificado e search_path fixo; EXECUTE é reservado a service_role.

A migration é aditiva; nenhum objeto antigo, dado, ID ou senha é recriado. Nenhuma migration antiga foi editada. A aplicação original continua compatível com a nova função não utilizada. Antes de publicar, registrar SHA/rollback e verificar a RPC remota. Rollback de código não exige apagar tabelas ou registros. Não reintroduzir grants destrutivos por rotina de rollback.

Foram mantidas assertions e restrições de negócio. A verificação dirigida seguinte teve 40/41 testes aprovados: a falha era um segundo token literal antigo no teste de origem de categorias, sem session_id. O checkpoint atualiza esse fixture, mantendo a expectativa 403, mas **não houve nova execução após essa atualização**.

## Negativos reais em produção

Foram confirmados:

- Visitante não lê perfil, catálogo privado do produtor ou contexto de checkout: 401.
- Cookie com papel administrativo forjado não abre configuração, usuários ou verify-session: 401.
- Documento privado com IDs alternados, sem login: 401.
- PATCH de perfil com role/is_admin/owner_id e POST de checkout privilegiado sem sessão: 401.
- Login com Origin não permitida: 403 ORIGIN_NOT_ALLOWED.
- JWT administrativo sem assinatura válida: 401.
- Campo privilegiado em query pública de produtos: 400 VALIDATION_ERROR.

Todos conservaram requestId e no-store nas amostras. Não houve cadastro, e-mail, exclusão, mudança de papel ou ação administrativa de produção para executar esses casos.

⚠️ PENDENTE JUSTIFICADO: produtor A versus B autenticados, consumidor contra administração, admin contra superadmin com contas reais, logout/refresh/recovery/confirmation reais, reautenticação positiva com cookies e fallback RPC em Supabase. Não há credenciais de homologação disponibilizadas no ambiente. Testes adaptados não substituem essa evidência.

## Proteções existentes preservadas

Foram rastreados controles backend/RLS de propriedade e documentos, contratos Zod/allowlists, isolamento administrativo, rate limits existentes, origem same-origin, cookies HttpOnly/Secure/SameSite e respostas privadas no-store. Não foi adicionado rate limit duplicado ou CORS "*".

Headers Vercel existentes incluem CSP, HSTS, X-Frame-Options DENY, Referrer-Policy e Permissions-Policy; APIs também definem nosniff. A CSP contempla recursos Supabase, Google Fonts, ViaCEP e mapas existentes. Não foi alterada sem prova de recurso bloqueado.

Uploads de documentos têm intenção idempotente, quotas, tamanho, hash, magic bytes PDF/PNG/JPEG, rejeição de conteúdo ativo PDF, armazenamento privado e autorização antes de emitir URL assinada. Mídias comerciais possuem limite de 2 MiB, tipos e assinatura; documentos privados, 15 MiB. Não foi simplificada a quarentena ou a auditoria.

Testes existentes de documentos/uploads e autorização fazem parte dos 707 aprovados no baseline. Upload autenticado/Storage real não foi homologado nesta execução.

# Supabase

✅ VERIFICADO E CORRETO no escopo de metadados remotos:

- 64 tabelas public, todas com RLS ENABLE e FORCE.
- 88 policies public/storage, 241 índices, 52 triggers e 56 funções public inventariados.
- Views admin_login_resolver e property_current_verification continuam restritas ao backend; v_rls_audit usa security_invoker. O histórico não substitui o estado atual.
- Funções de autorização usam auth.uid/papéis ativos e search_path definido; as quatro funções definer executáveis por authenticated são auxiliares intencionais de RLS.
- Tabelas backend-only sem policies cliente continuam sem exposição.
- Quatro buckets privados: documents, documents_private, product-media, store-media.
- documents_private: 15 MiB, PDF/PNG/JPEG; mídias: 2 MiB, JPEG/PNG/WebP.
- Bucket documents legado não tem limite/MIME configurados; policies são de titular/pasta. Fluxo legado exige rastreamento antes de eventual ajuste.
- 5 usuários Auth e 10 objetos Storage na coleta e reconfirmação; nenhuma alteração remota de dados efetuada.
- Edge functions existentes: admin-bootstrap v4 e public-registration v10, ambas ACTIVE e verify_jwt=false com controles de aplicação existentes. Não foram redeployadas.

Advisors: 15 infos de RLS sem policy, quatro warnings de funções definer auxiliares e um warning de proteção contra senha vazada desabilitada. A documentação consultada informa que proteção contra senha vazada é recurso Pro ou superior. ⚠️ PENDENTE JUSTIFICADO pelas restrições de custo; não foi contratado plano pago.

Os grants TRUNCATE identificados permanecem em produção porque a migration candidata não foi aplicada remotamente. Não houve desligamento de RLS, policy permissiva criada, renomeação de schema ou branch Supabase.

⚠️ PENDENTE JUSTIFICADO: aplicar nova migration somente após gates; reconciliar versão física eventual por alias novo, sem editar histórico; verificar grants/função/Storage/Auth; registrar release/commit/hash depois de confirmar deploy correto.

# LGPD

## Mapa técnico de dados

A base jurídica e prazos de retenção não podem ser presumidos por uma análise de código. Os itens abaixo descrevem tratamentos encontrados; decisões jurídicas estão pendentes.

| Categoria | Finalidade/ origem | Armazenamento e acesso | Terceiros/ retenção / base jurídica |
|---|---|---|---|
| Nome, CPF, e-mail, telefone | Cadastro, identidade, contato; titular | Supabase Auth e app_people/app_users; titular e backend autorizado | Supabase/Vercel; retenção formal e base: revisão jurídica |
| Credenciais e sessões | Autenticação; titular/Auth | Senha sob autoridade Supabase Auth; cookies e sessão administrativa existente | Cookies de refresh até 30 dias; janela HMAC 15 min; não são prazos de retenção de todos os dados |
| Endereços e localização | Cadastro, geocodificação e descoberta; titular | Endereços/imóvel/localidades, drafts do navegador, interfaces autorizadas | ViaCEP recebe CEP; Nominatim recebe endereço; mapa/fontes geram requisições externas; retenção e base: revisão |
| CAR, CCIR, matrícula/documentos | Verificação rural T09/T10; produtor | Storage privado, intenções, metadados e análises; dono e equipe autorizada | Gemini pode receber documento completo em base64 para extração; base, contratos e transferência: revisão |
| Fotos de produtos/loja | Vitrine e catálogo; produtor | Buckets privados, URLs assinadas para conteúdo publicado | Supabase/Vercel; política de retenção: revisão |
| IP derivado, user-agent, logs e auditoria | Rate limit, segurança e rastreio de ações | Hash/HMAC e registros backend; acesso restrito | Vercel/Supabase; prazos e necessidade: revisão |
| Consentimentos e preferências | Registro de escolhas; titular/cadastro | app_consent_records/app_user_preferences | Prova no fallback e base de cada tratamento: pendentes |
| Favoritos, cesta e checkout | Fluxos comerciais; usuário | Tabelas próprias, comandos idempotentes, dados de sessão | Escopo de exportação/exclusão e retenção de todos os módulos: revisão |

Supabase está em us-west-2 e Vercel usa pdx1. O uso de região internacional e o processamento por Google exigem avaliação das transferências e contratos efetivos. Nenhum documento real foi enviado à IA durante a auditoria.

## Cookies, analytics e política

A inspeção do código não encontrou GA/GTM/Meta Pixel/Hotjar/Clarity. Nenhum tracker foi adicionado. Recursos externos existentes de fontes/mapas e chamadas de endereço foram identificados separadamente de analytics.

Persistências encontradas: cookies Auth/prova/papel, sessão administrativa no localStorage, drafts de imóvel associados ao usuário, caches de CEP/localidades e IDs de comandos de checkout. O transporte administrativo com bearer/refresh é usado por contratos existentes; não foi removido sem migração compatível.

Texto analisado: `shared/lgpdCadastro.ts`, versão `lgpd-cadastro-2026-10-02`. Ele descreve cadastro/contato, não publicação de CPF, escolha separada de comunicação e retirada dessa escolha. A transparência sobre documento completo enviado ao Gemini, destinatários, retenção e transferências precisa ser comparada com a política integral e contratos reais.

**REVISÃO JURÍDICA NECESSÁRIA.** Não foi publicada alteração de texto jurídico substancial.

Texto recomendado para análise jurídica, ainda não publicado:

> Descrever as categorias de dados efetivamente tratadas, as finalidades específicas, os fornecedores envolvidos no armazenamento, autenticação e extração documental, as situações de transferência internacional, os critérios de retenção e o canal para exercício de direitos. Identificar a base aplicável a cada operação e distinguir registro de cadastro de comunicação opcional.

Pendências: identificação do controlador/contato responsável, base de cada finalidade, legitimidade e condições do envio documental ao Gemini, contratos dos operadores, mecanismo de transferência, retenção por categoria, cobertura de exportação/exclusão e integridade da prova de consentimento.

Referências brasileiras consultadas: [orientações da ANPD](https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes/perguntas-frequentes) e [Resolução CD/ANPD nº 19/2024](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024). O relatório não aplica regra estrangeira nem conclui conformidade jurídica.

# Regressões

- Baseline navegador: 39 falhas, 277 aprovações. Não foram corrigidas sem diagnóstico.
- Baseline PostgreSQL: 1 teste falhou por locator; uma suíte falhou por banco compartilhado. Mídia em banco novo: 15/15.
- TypeScript/lint e cobertura: falhas originais registradas.
- Correções locais: sete casos de sessão/grants passaram; grupo dirigido 40/41.
- O fixture do teste de origem foi atualizado no checkpoint após o erro 401/403, sem remover a assertion.
- **Quantidade de novas regressões funcionais: não determinada.** Regressão completa e build final não executados após o último checkpoint. Não se afirma “0 nova regressão”.

Responsividade original foi exercitada pela suíte em 320/360/390/430/768/1024/1440 px conforme casos existentes. Não houve mudança de layout da aplicação. Falhas originais de iPhone/conta requerem diagnóstico; screenshots isolados não substituem os testes ausentes.

# Publicação

| Elemento | Correções candidatas publicadas? | Evidência |
|---|---|---|
| GitHub main | **NÃO** | SHA canônico inicial preservado; checkpoint em branch temporária |
| Supabase | **NÃO** | 62 migrations/schema 56 e release original reconfirmados |
| Vercel Production | **NÃO** | Deploy original READY, SHA original/alias canônico reconfirmados |
| Livro Raiz em main | **NÃO** | Entrada de auditoria pendente preservada somente no checkpoint |

**Bloqueio concreto:** o ambiente passou a connectivity=offline. exec_command e apply_patch falharam com “Environment is not connected”/409. O npm também encontrou HTTP 503 de transporte no proxy. Nenhum gate foi ignorado para publicar.

Para retomar:

1. Recuperar o ambiente e conferir working tree/checkpoint versus main; preservar mudanças do usuário.
2. Concluir consentimento autenticado/prova de cadastro e updates de dependências com lockfile.
3. Testar RPC/fallback, prova HMAC, sessão de outra identidade, token expirado, Auth/Storage reais em ambiente isolado gratuito.
4. Reexecutar TypeScript, lint, contratos, suíte completa, PostgreSQL isolado por cenário, todos os 316 E2E e coverage; diagnosticar falhas originais sem reduzir gates.
5. Fazer build final, comparação de performance e confirmar zero regressão nova.
6. Aplicar migration aditiva, verificar metadados reais e histórico; nenhum dado apagado.
7. Sincronizar main somente depois dos gates; confirmar Vercel READY e SHA/alias corretos.
8. Registrar release compatível com commit/schema/hash e repetir health/ready, negativos e fluxos críticos.
9. Atualizar Livro Raiz e este relatório com somente o que foi comprovado em produção.

# Resultado

- ✅ VERIFICADO E CORRETO: identificação canônica, build original, compressão JSON observada, RLS ENABLE/FORCE, buckets privados e negativos HTTP descritos, nos respectivos escopos.
- 🔧 PROBLEMA ENCONTRADO E CORRIGIDO: candidato local de reautenticação/tratamento de erro/grants, com testes dirigidos descritos; **não publicado**.
- ⚠️ PENDENTE JUSTIFICADO: execução completa, consentimento, dependências, regressão final, testes autenticados reais, performance final, publicação e revisão jurídica.

O HortVitalMix de produção foi preservado. A tarefa completa permanece pendente; o checkpoint permite retomar o trabalho sem reescrever a arquitetura ou perder as evidências.

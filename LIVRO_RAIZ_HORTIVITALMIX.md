# Livro Raiz — HortiVitalMix

## 2026-09-20 — Reconciliação pós-RPC e diagnóstico HTTP real

Status: **hotfix implementado em branch; promoção para main e validação Vercel pendentes nesta entrada**.

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
- suporte a `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY`.
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
- Variáveis obsoletas removidas da documentação; testes reais usam `HVM_INTEGRATION_ENABLED` e `HVM_PROD_PROJECT_REF`.
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

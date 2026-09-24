# Livro Raiz — HortiVitalMix

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

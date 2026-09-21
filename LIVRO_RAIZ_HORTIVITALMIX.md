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

# Volume 01 / Trilha 05 — Selagem contra o Manual Mestre Técnico v11

Fonte vigente: **MANUAL MESTRE TÉCNICO v11 — VOLUMES 1 A 4**, respeitando as decisões posteriores e canônicas do Livro-Raiz.

Status desta entrada: **HOMOLOGAÇÃO TÉCNICA DA TRILHA 05**. A release de produção é registrada somente após o commit final desta documentação concluir o deployment Vercel com sucesso e o banco confirmar o histórico real.

## Princípio de preservação

A selagem foi executada de forma aditiva. Nenhuma migration de T01–T04 foi removida, reescrita ou reaplicada. Nenhuma tabela administrativa da T05 foi recriada. O Supabase Auth continua sendo o provedor único para e-mails de autenticação e segurança.

## Histórico real e schema

Ao encerrar a T04 o projeto estava no schema lógico 18. A T05 acrescentou:

- `20260922200604_trilha05_admin_governance.sql`;
- `20260923022000_trilha05_performance_hardening.sql`.

O manifesto permanece com **schema lógico 20** e hash de histórico **8a898b8576bda959f53aaeea552f3039d9da099aaa8007536e5a697ae4530106**.

Em produção, a segunda migration foi aplicada pelo Supabase com a versão física `20260923022554`, mantendo o mesmo nome `trilha05_performance_hardening`. A validação passou a aceitar exclusivamente esse alias conhecido:

`20260923022554 -> 20260923022000`.

Isso reconcilia o histórico sem renomear migration aplicada, sem reaplicar DDL e sem mascarar outras divergências.

## Banco e segurança

Confirmado no projeto canônico de produção:

- 3 setores canônicos ativos: `document_verification`, `catalog_moderation`, `finance_ops`;
- 6 tabelas administrativas presentes;
- RLS e FORCE RLS nas 6 tabelas;
- `has_role_for` e `fn_is_last_active_super_admin` como SECURITY DEFINER com `search_path=public`;
- trigger `trg_app_admin_invites_updated_at`;
- token de convite persistido somente como digest SHA-256;
- MFA do Super administrador sob custódia do Supabase Auth;
- rate limit administrativo persistente;
- proteção do último Super administrador.

## Correção crítica da selagem v11

Foi identificado um caminho legado em `POST /v1/auth/admin-login` que ainda podia criar uma sessão administrativa pela infraestrutura anterior à T05.

A correção aplicada:

- o endpoint legado deixa de autenticar e responde `409 ADMIN_GOVERNANCE_LOGIN_REQUIRED`;
- todo login administrativo passa por `POST /v1/admin/auth/login`;
- o Super administrador continua sem receber sessão antes do MFA;
- o componente `Account` não referencia mais `/v1/auth/admin-login`;
- qualquer renderização acidental do fluxo legado administrativo redireciona para `/admin/entrar`;
- foram adicionadas regressões unitárias, estruturais e E2E para impedir a reintrodução do bypass.

## Readiness

`FOUNDATION_SCHEMA_VERSION` foi alinhado de 14 para **20**, que é o schema lógico efetivo após a T05. O endpoint `/ready` continua fail-closed e só retorna `ready` quando:

- existe release corrente para o ambiente;
- schema da release coincide com 20;
- hash da release coincide com o manifesto;
- em production, o `commit_sha` da release coincide com o commit da Vercel.

## Compatibilidade T03

A T03 continua exigindo separação entre portal público e administrativo. O gate antigo, porém, ainda esperava que o frontend chamasse `/v1/auth/admin-login`. Ele foi atualizado para reconhecer o `AdminRouter` e o motor T05 como implementação canônica, sem restaurar o caminho inseguro.

## Frontend

Rotas administrativas preservadas:

- `/admin/entrar`;
- `/admin/bootstrap`;
- `/admin/aceitar-convite`;
- `/admin/convite` como alias de compatibilidade;
- `/admin/painel`;
- `/admin/governanca`;
- `/admin/usuarios`;
- `/admin/configuracao`.

A responsividade permanece coberta para 320, 390, 430, 768, 1024 e 1440 px.

## Gates de build

O build Vercel da correção funcional concluiu com **success** no commit `bfd46289cf39a33b6a9406f1d1f7c37c46ea08a9`, após duas falhas de selagem diagnosticadas e corrigidas:

1. gate estrutural T03 desatualizado, ainda exigindo o endpoint legado no frontend;
2. narrowing TypeScript no fluxo público após a remoção do ramo administrativo.

Nenhuma das duas correções exigiu alteração de banco ou rollback.

## Checklist de homologação T05

### Banco
- [x] estruturas administrativas presentes;
- [x] RLS/FORCE RLS;
- [x] funções e trigger canônicos;
- [x] histórico remoto reconciliado sem reescrita;
- [x] schema lógico 20 preservado.

### Backend
- [x] bootstrap protegido;
- [x] login administrativo dedicado;
- [x] MFA obrigatório do Super administrador;
- [x] convites administrativos;
- [x] escopo setorial;
- [x] rate limit;
- [x] proteção do último Super administrador;
- [x] bypass legado fechado.

### Frontend
- [x] portal administrativo dedicado;
- [x] fluxo credenciais → MFA;
- [x] bootstrap e aceite de convite;
- [x] governança/usuários/configuração;
- [x] responsividade;
- [x] frontend legado sem chamada ao endpoint antigo.

### Operacional
- [x] migrations de produção confirmadas;
- [x] build Vercel funcional confirmado;
- [x] readiness alinhado ao schema 20;
- [x] Livro-Raiz atualizado nesta selagem;
- [x] release T05 registrada somente após o commit final de documentação estar em produção.

## Regra de não regressão

A partir desta selagem, nenhum fluxo pode criar sessão de `platform_super_admin` fora do motor `/v1/admin/auth/login` + MFA. O endpoint `/v1/auth/admin-login` existe apenas como compatibilidade defensiva e deve permanecer incapaz de autenticar.

A próxima implementação funcional é a **Trilha 06**, usando o próximo número lógico disponível e sem downgrade da história já aplicada.


---

## Adendo — credencial administrativa separada / schema 22

A revisão posterior da Trilha 05 identificou um conflito legítimo: o CPF do primeiro Super administrador já podia existir como Consumidor/Produtor. Para preservar a regra de CPF único sem misturar logins públicos e administrativos, foi criada a entidade `app_admin_principals`.

Estado canônico desta revisão:

- schema lógico **22**;
- migration canônica `20260924023000_trilha05_admin_principals.sql`;
- versão física aplicada pelo Supabase: `20260924023250`;
- o primeiro Super administrador pode ser vinculado a `app_people` existente sem alterar a credencial pública;
- e-mail e senha administrativos permanecem independentes;
- o bootstrap fecha automaticamente após a criação do primeiro `platform_super_admin`;
- novos acessos continuam sendo criados exclusivamente pelo Portal Administrativo;
- Administrador setorial continua limitado à própria hierarquia de setores;
- Super administrador mantém MFA obrigatório e proteção contra remoção do último acesso global.

O manifesto e o readiness passam a **schema 22**. As seções anteriores deste documento permanecem como registro histórico da selagem anterior e não devem ser interpretadas como downgrade do estado atual.


---

## Adendo — login administrativo, recuperação e confirmação / schema 23

A primeira tentativa de login do Super administrador já criado expôs uma falha de runtime distinta do bootstrap: o serviço de login retornava `unavailable` antes de consultar o Supabase Auth quando o Transaction Pooler não estava disponível no runtime serverless.

A correção desta revisão torna os fluxos críticos de autenticação administrativa resilientes à ausência do Pooler:

- papel administrativo e setores são resolvidos pela Supabase Data API, com Pooler apenas como fallback;
- rate limit e desafios MFA usam a Data API;
- a transição **senha → MFA por e-mail → sessão administrativa** permanece obrigatória para Super administrador;
- nenhuma sessão administrativa é entregue antes do código MFA válido.

Também foi concluída a ergonomia de segurança exigida pelas Trilhas 04 e 05:

- o login administrativo reutiliza `PasswordInput` e oferece **Mostrar/Ocultar senha**;
- **Esqueci minha senha** direciona para a recuperação com `portalRole` administrativo;
- `RoleSecurityService` reconhece `app_admin_principals`, portanto a recuperação funciona para a credencial administrativa separada;
- importação da sessão de recuperação e resolução de identidade possuem fallback via Data API;
- redefinição revoga globalmente as sessões pela sessão Auth validada;
- a tela `/admin/confirmar-email` oferece envio, entrada de OTP de 6 dígitos e reenvio;
- o primeiro Super administrador exige confirmação explícita do e-mail administrativo;
- novos administradores convidados têm o e-mail considerado confirmado no aceite do convite, pois a posse do endereço já foi comprovada pelo link de convite;
- após confirmação do e-mail, cada acesso do Super administrador continua exigindo um novo código MFA.

Migration desta revisão:

- canônica: `20260924114500_trilha05_admin_email_verification.sql`;
- versão física aplicada pelo Supabase: `20260924115207`;
- schema lógico: **23**;
- hash canônico: `80d77398387420550887ee34268decf583ab49a96cb78765aa41910f0577927f`.

As seções históricas anteriores permanecem como registro das selagens precedentes e não representam downgrade do estado corrente.


---

## Adendo — RCA definitivo de Recovery + Login + MFA / schema 24

Em 24/09/2026 foi executada análise de causa raiz com evidência direta do Supabase Auth e das tabelas de desafios. Não se tratava de um único defeito de interface.

### Evidência temporal confirmada

- 12:18:07 UTC — `POST /auth/v1/recover` retornou **200** e o primeiro e-mail de recuperação foi aceito pelo Supabase.
- 12:18:25 UTC — o link de recovery foi validado pelo Supabase (`type=recovery`) e houve login implícito bem-sucedido.
- 12:18:48 UTC — um segundo pedido de recuperação invalidou o challenge anterior antes de comprovar a entrega de um novo e-mail.
- 12:18:49 UTC — o Supabase recusou o novo envio com **429 / over_email_send_rate_limit**, informando espera restante.
- consequência: o challenge antigo já estava invalidado e o novo foi invalidado porque o e-mail não saiu; o usuário ficou sem qualquer link HortiVitalMix válido.
- ao reutilizar o link Auth one-time, o Supabase registrou `One-time token not found`, comportamento esperado de um token já consumido.

### Correção do recovery

O `flowToken` HortiVitalMix passa a ser a autorização canônica da redefinição:

- 32 bytes aleatórios;
- persistência somente do SHA-256;
- escopo por `userId + portalRole`;
- validade curta;
- consumo único;
- validação pública sem sessão prévia;
- redefinição de senha via Supabase Admin API somente depois da validação do flow.

A tela de redefinição deixa de exigir `access_token` e `refresh_token` no fragmento do navegador. Isso também torna o fluxo resiliente a scanners de e-mail que consomem links one-time do provedor antes do usuário.

No reenvio, o challenge anterior só é invalidado **depois** que o Supabase aceita o novo e-mail. Se houver cooldown ou falha de entrega, o link anterior permanece válido.

### Revogação de sessões

Foi criada `public.fn_revoke_auth_sessions(uuid)`, SECURITY DEFINER, com EXECUTE exclusivo para `service_role`. A função remove as sessões GoTrue do usuário após a troca de senha; refresh tokens associados são eliminados pelo relacionamento de banco já existente.

Migration canônica: `20260924125000_auth_recovery_session_revoke.sql`.
Versão física no Supabase: `20260924124802`.

### Correção do login e dos códigos de segurança

O login não tenta mais enviar confirmação de e-mail dentro da validação de senha. Uma senha válida com e-mail administrativo ainda pendente retorna o estado explícito `email_confirmation_required`.

Os envios de confirmação e MFA passam a reconhecer `over_email_send_rate_limit` e o tempo restante informado pelo Supabase. A UI apresenta contador e bloqueia reenvio prematuro em vez de converter o cooldown em “serviço indisponível”.

O desafio MFA continua sendo criado somente depois de o e-mail ser aceito pelo Supabase. Nenhuma sessão de Super administrador é entregue antes do OTP válido.

### Estado lógico

Schema lógico: **24**.

Hash canônico do histórico:
`a23b076a67b259ce44f87501657be592d5d0eeca9b5d83cedba0397cb9250ca0`.

Esta revisão é aditiva e preserva integralmente as Trilhas 01–05, o Super administrador existente, papéis, RLS, convites e dados já persistidos.

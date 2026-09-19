# Supabase Setup — Volume 01 / Trilha 01

## Topologia

São necessários três ambientes independentes:

- `development`
- `homologation`
- `production`

Cada ambiente usa credenciais próprias para URL, anon key, service role, JWT secret, project ref e pooler. Não compartilhar chaves entre ambientes.

## Postgres

Usar o pooler transacional na porta 6543 pela variável canônica `SUPABASE_DB_URL`.

Formato:

`postgresql://postgres.<ref>:<senha>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1`

Placeholders como `base`, `host`, `hostname`, `localhost` e aliases de production são rejeitados pelo runtime.

## Migrations

A Trilha 01 possui 8 migrations, em ordem:

1. `foundation_releases`
2. `identity_roles`
3. `global_config_audit`
4. `helper_functions`
5. `rls_policies`
6. `indexes_performance`
7. `seeds_canonical`
8. `auth_delete_mirror`

A versão lógica final é **8**. O timestamp do arquivo não é gravado no campo inteiro `schema_version`.

## RLS

Todas as tabelas `public.app_*` devem permanecer com RLS e FORCE RLS. Policies possuem roles explícitos. A Data API autenticada recebe apenas os privilégios de coluna previstos para autoatendimento.

## Auth

`auth.users` é a identidade canônica. O trigger de criação espelha em `app_users`; o trigger de deleção preserva o tombstone e invalida a autorização.

## Storage

Bucket `documents`:

- privado;
- leitura e insert para o proprietário autenticado;
- primeiro segmento do path deve ser o `current_person_id()`;
- sem UPDATE/DELETE nesta trilha.

## Segurança

A função de infraestrutura `public.rls_auto_enable()`, quando existente, não pode ser executável por `PUBLIC`, `anon` ou `authenticated`. O hardening correspondente está versionado em `supabase/hardening/`.

## Backups

Quando snapshot nativo não estiver disponível, usar dump de schema e dados canônicos apenas. Nunca exportar `auth.users` ou `app_people` para evidência de homologação.

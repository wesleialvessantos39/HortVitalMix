# Supabase — configuração e estado verificado

Projeto existente: `HortVitalMix` (`xipbsazvymkqqfmfegwu`). Oito migrations da Trilha 01 estão aplicadas e o manifesto mantém **schema lógico 8**.

> Este projeto isolado ainda não representa, sozinho, os três ambientes development, homologation e production exigidos pelo Manual v10.

## Variáveis de runtime

| Variável | Escopo | Regra |
| --- | --- | --- |
| `APP_ENV` | servidor | `development`; Vercel deriva preview/production por `VERCEL_ENV` |
| `SUPABASE_PROJECT_REF` | servidor | Ref do ambiente correspondente |
| `SUPABASE_URL` | servidor | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | servidor | Chave pública |
| `VITE_SUPABASE_URL` | cliente | Mesma URL pública |
| `VITE_SUPABASE_ANON_KEY` | cliente | Chave pública; nunca service/secret |
| `SUPABASE_SERVICE_ROLE_KEY` | segredo servidor | Admin API e compensações |
| `SUPABASE_DB_URL` | segredo servidor | Transaction Pooler, porta 6543, usuário `postgres.<ref>` |
| `SUPABASE_JWT_SECRET` | servidor | Opcional enquanto validação usar SDK/JWKS |
| `APP_IP_PEPPER` | segredo servidor | 32+ caracteres hexadecimais |
| `OUTBOX_ENCRYPTION_KEY` | segredo servidor | 64 hex; obrigatória a partir da Trilha 04 |
| `APP_ALLOWED_ORIGINS` | servidor | CSV de origins exatas para mutações |
| `HVM_INTEGRATION_ENABLED` | testes | `true` apenas em development isolado |
| `HVM_PROD_PROJECT_REF` | testes | Ref de production para o guard de segurança |

Não usar `APP_COMMIT_SHA`: na Vercel o SHA é obtido de `VERCEL_GIT_COMMIT_SHA`. Não usar os nomes obsoletos `RUN_SUPABASE_INTEGRATION` ou `SUPABASE_TEST_PROJECT_REF`.

## Migrations

Histórico canônico:

1. `20260919030126_foundation_releases.sql`
2. `20260919030128_identity_roles.sql`
3. `20260919030130_global_config_audit.sql`
4. `20260919030132_helper_functions.sql`
5. `20260919030134_rls_policies.sql`
6. `20260919030136_indexes_performance.sql`
7. `20260919030138_seeds_canonical.sql`
8. `20260919030140_auth_delete_mirror.sql`

Não modificar migrations aplicadas. O hardening documental de comentários sensíveis está em `supabase/hardening/trilha01_sensitive_comments.sql`; ele é idempotente e não altera schema_version.

## Estado do banco verificado em 2026-09-19

- 3 extensões canônicas presentes.
- 8 tabelas `app_*`.
- RLS habilitado e FORCE RLS em 100% das tabelas.
- 4 papéis canônicos.
- singleton `app_global_config` com exatamente 1 linha.
- triggers exigidos de auditoria, criação/deleção Auth e revisão de config presentes.
- nenhuma tabela local de senha/sessão.
- nenhuma função SECURITY DEFINER da aplicação sem `search_path`.
- nenhuma policy da fundação sem role explícita.
- nenhum padrão de PII detectado em payloads de auditoria.
- tabelas, funções e colunas sensíveis exigidas com comentários.
- `app_releases` ainda sem release homologada.

## Auth e Storage

- GoTrue é a fonte de identidade/senha; não há credencial local.
- Cadastro público limita-se a consumidor/produtor.
- Bucket `documents` é privado.
- SMTP/templates públicos de Auth pertencem ao Supabase. Convites/MFA administrativos pertencem à Trilha 05 e não devem ser antecipados na Trilha 01.

## Advisors

A revisão atual do Security Advisor retorna quatro WARNs referentes a `current_person_id()`, `has_role()`, `is_any_platform_admin()` e `is_platform_super_admin()` executáveis por `authenticated`. Isso é intencional no desenho RLS da Trilha 01: as funções derivam identidade de `auth.uid()`, possuem `SECURITY DEFINER` com `search_path` fixado e não são executáveis por `anon`.

O aviso anterior de `rls_auto_enable()` foi endurecido por ACL e não aparece na revisão atual.

## Ambientes

A promoção final continua bloqueada enquanto não existirem credenciais/recursos isolados para development, homologation e production. Não representar três ambientes por três linhas no mesmo banco.

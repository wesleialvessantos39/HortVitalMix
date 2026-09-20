# Supabase — configuração e estado verificado

## Estratégia de ambientes sem custo

Por determinação do proprietário em 2026-09-19, **Preview Branches pagas não são utilizadas**. A execução usa projetos Supabase independentes com credenciais próprias, documentados em [FREE_TIER_ENVIRONMENT_STRATEGY.md](FREE_TIER_ENVIRONMENT_STRATEGY.md).

| Ambiente | Projeto | Ref | Estado |
| --- | --- | --- | --- |
| development | HortVitalMix-Development | `ldtcsrlxfpflzhnbjjnp` | ACTIVE_HEALTHY |
| homologation | HortVitalMix-Homologation | `vcbcbbnbboxoimqmuibm` | ACTIVE_HEALTHY |
| production | HortVitalMix | `xipbsazvymkqqfmfegwu` | pausado temporariamente para liberar a segunda vaga Free |

A rotação Free preserva isolamento e ordem de promoção, mas é uma errata operacional em relação à topologia de Preview Branches do Manual v10.

## Variáveis de runtime

| Variável | Escopo | Regra |
| --- | --- | --- |
| `APP_ENV` | servidor | `development | homologation | production` |
| `SUPABASE_PROJECT_REF` | servidor | Ref do ambiente correspondente |
| `SUPABASE_URL` | servidor | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEY` | servidor | Chave pública; aceita formato legado ou moderno |
| `VITE_SUPABASE_URL` | cliente | Mesma URL pública |
| `VITE_SUPABASE_ANON_KEY` | cliente | Chave pública; nunca service/secret |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` | segredo servidor | Admin API e compensações; aceita formato legado ou moderno |
| `SUPABASE_DB_URL` | segredo servidor | Transaction Pooler preferencial, porta 6543 |
| `DATABASE_URL` / `POSTGRES_URL` | segredo servidor | Fallback aceito somente se for Transaction Pooler Supabase válido e do mesmo project ref |
| `SUPABASE_JWT_SECRET` | servidor | Opcional enquanto validação usar SDK/JWKS |
| `APP_IP_PEPPER` | segredo servidor | 32+ caracteres hexadecimais |
| `OUTBOX_ENCRYPTION_KEY` | segredo servidor | 64 hex; obrigatório a partir da Trilha 04 |
| `APP_ALLOWED_ORIGINS` | servidor | Origins adicionais; a própria origem HTTPS da requisição é aceita automaticamente |
| `HVM_INTEGRATION_ENABLED` | testes | `true` somente em development |
| `HVM_PROD_PROJECT_REF` | testes | Sempre `xipbsazvymkqqfmfegwu`; impede integração contra production |

## Migrations

Histórico canônico, aplicado em development e homologation:

1. `20260919030126_foundation_releases.sql`
2. `20260919030128_identity_roles.sql`
3. `20260919030130_global_config_audit.sql`
4. `20260919030132_helper_functions.sql`
5. `20260919030134_rls_policies.sql`
6. `20260919030136_indexes_performance.sql`
7. `20260919030138_seeds_canonical.sql`
8. `20260919030140_auth_delete_mirror.sql`

Não modificar migrations aplicadas. O hardening documental `supabase/hardening/trilha01_sensitive_comments.sql` é idempotente e não altera schema_version.

## Evidência dos bancos

Development e homologation confirmam:

- 3 extensões canônicas.
- 8 tabelas `app_*`.
- RLS + FORCE RLS em todas as tabelas.
- triggers de auditoria, Auth create/delete e revision/config presentes.
- singleton global com uma linha.
- quatro papéis canônicos.
- zero tabela local de credencial/sessão.
- zero função SECURITY DEFINER sem `search_path`.
- zero policy da fundação sem role explícita.
- zero PII detectada nos payloads de auditoria.
- zero pendência de comentário em tabelas/colunas sensíveis.
- bucket `documents` privado.
- `app_releases` sem release inventada.
- fixtures SQL executadas em transação e revertidas; zero resíduos.

## Security Advisor

O Advisor sinaliza os helpers `current_person_id()`, `has_role()`, `is_any_platform_admin()` e `is_platform_super_admin()` por serem `SECURITY DEFINER` executáveis por `authenticated`.

O desenho é intencional nesta Trilha: essas funções são usadas pelas policies RLS, derivam identidade por `auth.uid()`, possuem `SET search_path=public`, e `anon` não recebe EXECUTE. O alerta fica documentado e não será “corrigido” de modo a quebrar as policies.

## Estado de homologação

Banco de development e banco de homologation passaram os gates SQL executados nesta sessão. A homologação integral continua condicionada aos gates de aplicação/runtime, Vercel, releases e evidências operacionais.


## Robustez do cadastro em produção

Após diagnóstico de falhas repetidas no cadastro público em 2026-09-19, o runtime foi endurecido para evitar indisponibilidade causada apenas por nomes de variáveis da plataforma:

- a própria origem HTTPS do site é reconhecida automaticamente para mutações same-origin;
- origins externas continuam bloqueadas;
- `SUPABASE_DB_URL` continua preferencial;
- `DATABASE_URL` e `POSTGRES_URL` podem ser usados como fallback somente quando apontam para Transaction Pooler Supabase na porta 6543 e para o mesmo `SUPABASE_PROJECT_REF`;
- uma variável inválida não bloqueia outra configuração válida disponível;
- chaves modernas `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY` são aceitas como fallback às chaves legadas;
- erros de cadastro diferenciam conflito de identidade, rate limit, Auth indisponível e banco indisponível;
- nenhuma URL, senha ou chave é exposta nas respostas.

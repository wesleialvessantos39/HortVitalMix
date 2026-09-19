# Supabase — configuração e estado verificado

Projeto existente: `HortVitalMix` (`xipbsazvymkqqfmfegwu`). Organização Free. Oito migrations aplicadas nesta execução, com nomes/timestamps locais sincronizados ao histórico remoto em `supabase/manifest.json`.

## Configuração necessária no runtime

| Variável | Escopo | Conteúdo |
| --- | --- | --- |
| `SUPABASE_PROJECT_REF` | servidor | Ref do ambiente correspondente |
| `SUPABASE_URL` | servidor | URL HTTPS do projeto |
| `SUPABASE_ANON_KEY` | servidor | Chave pública do projeto |
| `VITE_SUPABASE_URL` | público | Mesma URL, no ambiente correspondente |
| `VITE_SUPABASE_ANON_KEY` | público | Chave pública; nunca service role |
| `SUPABASE_SERVICE_ROLE_KEY` | segredo servidor | Admin API e compensação de cadastro |
| `SUPABASE_DB_URL` | segredo servidor | URL PostgreSQL do Transaction Pooler, porta 6543 |
| `SUPABASE_JWT_SECRET` | segredo servidor | Reservado pelo manual; validação atual usa SDK getUser |
| `APP_IP_PEPPER` | segredo servidor | Segredo aleatório com ao menos 16 caracteres |
| `APP_ALLOWED_ORIGINS` | servidor | Origens completas autorizadas, separadas por vírgula |
| `APP_COMMIT_SHA` | servidor | SHA implantado; Vercel fornece VERCEL_GIT_COMMIT_SHA |

Não enviar segredos por chat, não usar `VITE_` para credenciais privilegiadas e não versionar `.env`. O gerenciador conectado permite administrar SQL, mas não fornece automaticamente a senha do pooler nem a service role ao processo Node.

## Ambientes

O projeto atual recebeu a fundação sem registro de release. Isso **não** configura os três ambientes requeridos. A promoção `dev → homolog → main` permanece pendente de provisionamento e credenciais separadas. Não tratar três linhas ou três schemas no mesmo projeto como isolamento de Auth/Storage. Nenhum recurso pago foi contratado.

## Auth e Storage

- GoTrue gerencia senhas; não há tabela local de credenciais ou sessões.
- Configuração local: JWT 3600 segundos e confirmação desativada para development.
- No ambiente de produção: Site URL da implantação efetiva, redirects exatos, confirmação ativada e refresh token rotativo. Essas opções remotas ainda não foram verificadas/configuradas pelo conector.
- SMTP/entrega de confirmação exige configuração posterior; não considerar envio de e-mail homologado. A base de cadastro não cria administradores.
- Bucket `documents` privado, acesso por usuário e pasta do `person_id`. Serviço de URL assinada com TTL 900s preparado; UI de documentos pertence às próximas trilhas.

## Advisors

RLS ativado e forçado nas oito tabelas. Advisors identificam os quatro helpers SECURITY DEFINER autenticados previstos no manual: escopo derivado de auth.uid, search_path fixo e sem execução anon. Também identificam `public.rls_auto_enable()`, função já existente da plataforma, como executável; sua revisão administrativa permanece registrada, sem alterar mecanismo preexistente fora do escopo.

Avisos de performance: índices sem uso em banco novo e policies permissivas separadas de proprietário/admin previstas no manual. Não indicam falha de isolamento; devem ser acompanhados com carga real.

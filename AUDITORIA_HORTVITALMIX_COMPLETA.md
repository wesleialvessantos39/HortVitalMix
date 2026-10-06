# AUDITORIA HORTVITALMIX COMPLETA

**🔧 PROBLEMA ENCONTRADO E CORRIGIDO:** correções mínimas publicadas na arquitetura existente, com migration aditiva, testes e verificação real de produção. **⚠️ PENDENTE JUSTIFICADO:** cobertura, legado inativo, homologação autenticada de produção, observação operacional Storage e revisão jurídica. Serviços reais locais, infraestrutura de produção e testes adaptados são distinguidos neste relatório.

# Identificação

Data: **2026-10-06, UTC**. Repositório: **wesleialvessantos39/HortVitalMix**. Branch: **main**. Domínio: https://hortvitalmix.vercel.app. Supabase: **HortVitalMix / xipbsazvymkqqfmfegwu**.

| Elemento | Inicial | Final da implementação auditada |
|---|---|---|
| Commit | b3cb8532a1349c1f1a14d7b150f1e9e76d1f6079 | **1fafc77de3358ccfb66af1fe4eb5578857b59c66** |
| Deploy funcional | dpl_DKsMqw2mrEe7zdRjssoU65t7exGw | **dpl_7qT6hyE2sas4CX5mf84VbPPhs1XP**, READY; SHA e domínio principal confirmados |
| Release funcional | t19-v56-b3cb853 | **audit-v57-1fafc77** |
| Schema lógico / migrations físicas | 56 / 62 | **57 / 63** |
| Última migration física | 20261006015914_trilha19_checkout_quotes | **20261006120330_audit_sessions_and_client_privileges** |
| Arquivo canônico correspondente | 20261006012938_trilha19_checkout_quotes.sql | **20261006023915_audit_sessions_and_client_privileges.sql** |
| Hash aplicado | 2caaa0fd11223a49aceb6479581aad7c8e15a1fa122166564b06981d06217572 | **614027ef88c383fb30dbf14fcf670104cf2fb7025cfa801253059bca67014b25** |
| PostgreSQL / região | 17.6 / us-west-2 | Preservados |
| Vercel / Node | Hobby, produção pdx1, Node 22.x | Preservados; validação local adicional em Node 22.23.3 |

O SHA final acima identifica o **código auditado e testado em produção**, antes do fechamento exclusivamente documental. O commit que contém este relatório identifica o fechamento no histórico Git; a release corrente acompanha o SHA efetivamente ativo da main depois de seu deploy. A confirmação final é exportada em /workspace/scratch/hvm-publication-final.json, sem segredos. Essa distinção evita atribuir ao arquivo seu próprio SHA antes da criação do commit.

Checkpoint preservado: audit/hortvitalmix-20261006, SHA ccb0539f9b6bb2f390de5a6309207bf30386987c. A retomada recuperou os logs e concluiu correções após a indisponibilidade inicial do ambiente. A branch temporária não substitui main.

# Estado inicial

A descoberta precedeu alterações. Checkout inicial limpo; inventário de 548 arquivos versionados, 21 módulos de contratos, rotas, middlewares, serviços, páginas, migrations, Supabase, Vercel, GitHub e Livro Raiz. Não havia AGENTS.md aplicável.

| Verificação | Baseline | Após correções |
|---|---|---|
| TypeScript / lint | TS2322 em registrationBackground, modo transform; lint parava no mesmo erro | **✅ VERIFICADO E CORRETO**, Node 22; fixture usa strip compatível com os tipos instalados |
| Build / gates de segurança | Aprovados | **✅ VERIFICADO E CORRETO**, build completo em Node 22, sem reduzir gates |
| Contrato de configuração | Aprovado | 9 testes aprovados |
| Suíte padrão | 707 aprovados, 237 condicionais ignorados, total 944 | **729 aprovados**, 260 condicionais ignorados, total 989; 79 arquivos aprovados/29 condicionais |
| PostgreSQL | 191 aprovados, 1 falha de locator, 15 ignorados; outra preparação exigia banco vazio | **214 cenários** de 19 suítes comprovados em bancos locais isolados; um caso de tempo passou na reexecução inalterada |
| Integração Supabase atual | Condicionada à infraestrutura | **26/26**, Auth/PostgREST/PostgreSQL reais locais |
| Novos fluxos e negativos reais | Ausentes | **16/16**, GoTrue, PostgreSQL, Storage e Edge Deno reais locais |
| Navegador existente | 277 aprovados / 39 falhas / 316 | 311 aprovados / 5 timeouts conjuntos; os mesmos cinco passaram isolados, sem alteração: **316 cenários comprovados** |
| Produção health / ready | 200 / 200, schema 56 | **200 / 200, schema 57**, release do SHA publicado |
| Verificador original de deploy | Baseline público confirmado | Health, ready e config aprovados pelo proxy do ambiente de auditoria |
| Negativos HTTP de produção | 13 esperados | **14/14**, incluindo consentimento sem prova |
| Navegador real de produção | Login consumidor verificado | **40/40**, oito rotas em 320/390/768/1024/1440 px |

Os 260 testes condicionais foram exercitados separadamente: 214 PostgreSQL, 16 novos de serviços reais, 26 de integração atual e quatro de comunicação legada. Destes quatro últimos, um passou e três falharam também no **checkout original inalterado**: SUPABASE_AUTH_ONLY_DELIVERY. A arquitetura atual usa Supabase Auth/SMTP; outbox desativado não foi reintroduzido para satisfazer testes obsoletos.

**⚠️ PENDENTE JUSTIFICADO — cobertura:** baseline linhas 33,87%, funções 43,43%, statements 32,66%, branches 25,93%; final **34,19% / 43,83% / 32,96% / 26,57%**. Permanecem abaixo de 60/60/60/50 e de limites específicos: foundation 28,57%, contratos 96,45%, helpers 4,19%. A coleta final passou seus 729 testes e falhou nesses critérios. Nenhum threshold foi reduzido.

Mapa preservado: foundation/configuração/releases; identidade/Auth; confirmação/recuperação; governança, bootstrap, convites/MFA; conta/privacidade; endereços/geocodificação; propriedades; documentos T09/T10; localidades/lojas/horários; categorias; produtos/preços; estoque; entrega; descoberta; cesta T18; checkout T19. T20/T21 continuam futuras. Quatro papéis, portais separados e mesma pessoa consumer/producer foram mantidos.

# Performance

## JSON, rede e cache

**✅ VERIFICADO E CORRETO:** JSON público já usa Brotli na Vercel; compressor não foi acrescentado. Rodadas inicial/final: dez leituras sequenciais por endpoint, concorrência 1, quarenta requisições por rodada, com a rede/proxy deste ambiente.

| Endpoint | Média inicial → final | p50 inicial → final | p95/p99 inicial → final | Corpo / transferência inicial → final |
|---|---:|---:|---:|---|
| Health | 180,1 → 186,1 ms | 184,3 → 185,28 ms | 203,4 → 229,37 ms | 127 bytes identity, preservado |
| Ready | 187,8 → 205,1 ms | 184,5 → 207,73 ms | 204,4 → 282,50 ms | 144 → 146 bytes identity; release mudou |
| Produtos | 199,6 → 234,6 ms | 203,8 → 215,77 ms | 246,8 → 536,43 ms | 1.436 bytes; Brotli 1.092 → 1.094 bytes |
| Categorias | 174,4 → 179,9 ms | 184,1 → 157,70 ms | 202,2 → 292,50 ms | 1.446 bytes; Brotli 694 bytes, preservado |

Taxa de erro em ambas: **0**. Com n=10, p95/p99 são o máximo observado; há variabilidade de rede/inicialização e nenhum isolamento do custo por camada. **Não se demonstra ganho, capacidade adicional ou causalidade para o aumento observado.** Nenhuma otimização de latência é declarada.

JSON: Content-Encoding br em produtos/categorias; sem Content-Length nas amostras comprimidas; no-store; Vary ausente nas amostras sem Origin. JS/CSS efetivamente referenciados pelo HTML de produção: HTTP 200, ETag, X-Vercel-Cache HIT, public/max-age=0/must-revalidate. HTML sensível e APIs conservam no-store. Cache privado compartilhado não foi acrescentado.

## Banco, frontend e carga

pg_stat_statements inicial: produtos 357 chamadas/média 8,942 ms/máximo 179,325 ms; lojas 167/14,560/154,008 ms; identidade 5.525/0,165/10,101 ms. Esses agregados não fornecem p95. EXPLAIN de leitura confirmou uso do índice da fila Storage.

Agregação de imóveis, verificações por IDs em lote, descoberta e assinatura de mídias em batch foram rastreadas. Loops de checkout/estoque preservam locks, FIFO, idempotência e auditoria. Sem gargalo medido que justificasse mudança, SQL/transações/SELECTs internos/policies/índices foram mantidos. Avisos iniciais de cinco FKs sem índice, 61 índices sem uso registrado e 22 policies múltiplas não autorizam alterações indiscriminadas.

Bundle local inicial → final: main **573,75 → 573,89 kB**, gzip **162,47 → 162,51 kB**; PDF **373,59 kB**, gzip **111,80 kB**, separado. Warning acima de 500 kB permanece. Asset principal real de produção: 573.935 bytes; envs públicas de build podem alterar o hash em relação ao build local.

Carga exclusivamente local: **180 leituras**, três rotas, concorrências 1/2/4, vinte amostras por cenário, **0 erros**. Em concorrência 4, p95 produtos/categorias/lojas: 18,9/5,4/8,7 ms. Produtos/lojas retornaram conjuntos vazios de 15/84 bytes; categorias 1.446 bytes. Valida estabilidade nesse cenário, **não capacidade representativa de produção**.

**⚠️ PENDENTE JUSTIFICADO:** benchmark autenticado e com massa representativa, planos dirigidos às consultas relevantes, custo de sessão por camada e análise quantitativa de renderizações/bundle. Usuários cadastrados não equivalem a simultâneos.

# Segurança

## P0 e segredos

Nenhuma falha P0 de credencial ou bypass em produção foi demonstrada. Busca em arquivos e aproximadamente 2.200 blobs históricos não encontrou os padrões pesquisados de JWT service_role, Supabase secret, tokens GitHub ou chaves privadas Google. É uma busca delimitada, não garantia universal. Apenas .env.example está versionado. Valores privados não constam nos documentos; anon/publishable foram reconhecidas como públicas. Metadados de env Vercel conferidos sem expor valores; gates de fonte/bundle aprovados.

## Problemas corrigidos

| Problema / severidade | Evidência e impacto | Correção mínima / dependências | Teste / comparação |
|---|---|---|---|
| P1 — janela administrativa vinculada à conta | last_sign_in_at de outro login influenciava sessão antiga | auth.sessions.created_at canônico; sessão/user vinculados; prova HMAC/principal/setores/bloqueios mantidos | Auth/PostgreSQL reais: outro login não concede janela; reautenticação vinculada restaura autorização |
| P1 — grants destrutivos desnecessários | Quatro combinações anon/authenticated × consentimentos/preferências tinham TRUNCATE; RLS não filtra TRUNCATE | Migration revoga TRUNCATE e I/U/D herdados de anon; allowlists de colunas preservadas | **Quatro true → quatro false** no banco canônico; exploração HTTP de TRUNCATE não foi demonstrada |
| P1 — autoria de consentimento | Endpoint privilegiado aceitava UUID/e-mail sem comprovação de autoria | Sessão própria validada ou HMAC do cadastro vinculado a UUID/e-mail/política/10 minutos; backend/Edge/Account compatíveis | Prova válida/expirada/alterada/outro titular/replay idempotente; produção sem prova **401 CONSENT_PROOF_REQUIRED** |
| P2 — validade uniforme de sessão | Consulta ignorava not_after; fallback Data API afirmava sessão viva | Consulta consolidada preservada; RPC fn_live_auth_session restrita ao backend; indisponibilidade fecha acesso | not_after, UUID falso, logout/adulteração reais; anon/authenticated sem EXECUTE |
| P2 — exceção assíncrona de Auth | Rejeição do SDK não capturada no Express 4 | Captura e 503 genérico, sem liberar acesso ou stack | Casos de erro/regressão administrativa aprovados |
| P2 — resposta inválida de localidades | HTTP 200 com {} chegava ao estado; tela chamava municipalities.find | Contrato Zod existente antes do estado; feedback preservado | Teste de resposta malformada e navegador |
| P2 — correção de confirmação de senha | Captura interferia no onChange controlado | password/confirmPassword usam seu onChange existente | Cenário original de correção/cadastro aprovado; igualdade mantida |
| P2 — advisories | Seis ocorrências: três high/três moderate | Express 4.22.3, sanitize-html 2.18.0, source-map-js 1.2.2 e resolução compatível; sem fix --force | **6 → 0 advisories**, gates e negativos de sanitização aprovados |

HMAC de consentimento tem propósito distinto de confirmationContext, que não autoriza aceite. Emissão após cadastro autorizado com escolha explícita, ou adição de função pública com senha validada. Não cria sessão/privilégio. Cadastro atômico e identidade consumer/producer comprovados na Edge Deno real.

Supabase getUser já verifica sessão no Auth. Testes com Auth adaptado não provam bypass de logout em produção; esse P0 não é declarado. Testes reais distinguem remoção, data de criação, not_after e disponibilidade.

Rollback: checkpoints/SHAs preservados; código reversível; migration aditiva compatível com código anterior; backup Edge v10 recuperado/comparado. Nenhuma migration aplicada editada, DROP, remoção de dados ou grant destrutivo reintroduzido.

## Regressão de runtime da primeira publicação

Commit intermediário **133f50c6b707dbd17b41af03f90c62f7b21a7256**, deployment **dpl_79yMBFAJXy7VcQcpiGGnYmCfxYzq**: build aprovado, mas API FUNCTION_INVOCATION_FAILED. Logs reais Node 22: **ERR_REQUIRE_ESM**, sanitize-html 2.18 requeria htmlparser2 12. O teste com tsx ocultava a incompatibilidade.

Rollback restaurou deploy inicial, health/ready 200 e release anterior, mantendo migration aditiva/histórico. Override **somente sob sanitize-html**, parser **htmlparser2 10.1.0 CommonJS**, preserva patches 2.18. Parser 12 permanece apenas como dependência de tipos de desenvolvimento.

Cold start agora exige require puro sem tsx antes de importar API. Antes do ajuste falhou com o mesmo erro; depois passou em Node 22.23.3. Negativos de URI javascript, SVG SMIL e fechamento textarea/xmp com barra passaram; **22 testes PostgreSQL de loja** passaram. Deploy corrigido testado por acesso autenticado da Vercel antes de promoção; no domínio principal, health/ready/catálogo e 14 negativos aprovados. Registros intermediários/rollback conservados. A primeira publicação não é declarada sem regressão.

## Controles e testes negativos

Backend/RLS validam identidade, papel, titularidade e ações; Zod/allowlists limitam escrita. SQL auditado usa parâmetros; req.body não vira update irrestrito. Papéis públicos não acessam administração; admin não executa função exclusiva de superadmin nos cenários reais locais. IDs alternados, metadata/cookies, campos privilegiados, token adulterado/ausente, origem indevida, MIME/upload inválidos e repetição/idempotência exercitados.

Produção: visitante não lê perfil, produtos privados, checkout/documentos; cookies/JWT falsos não abrem administração; escrita privilegiada sem Auth negada; Origin externa 403; query privilegiada 400; consentimento sem prova 401. **14 respostas esperadas**, requestId/no-store. Não substituem IDOR entre contas reais de produção.

Rate limits existentes, same-origin/CSRF, HttpOnly/Secure/SameSite, isolamento de login/MFA, logs redigidos e CSP/HSTS/nosniff/framing/referrer/permissions preservados. Sem rate limit duplicado, CORS aberto ou tracker. Interface permanece em português.

# Supabase

**✅ VERIFICADO E CORRETO**, no escopo canônico verificado:

- **64 tabelas public RLS ENABLE/FORCE**, 88 policies public/storage, 241 índices, 52 triggers public/storage/auth; funções public 56 → **57**, acréscimo da RPC de sessão.
- **63 migrations/schema 57/hash** validados pelo repositório contra histórico remoto; alias físico novo registrado em scripts/migrations-manifest.ts, sem editar migrations antigas.
- RPC stable/SECURITY DEFINER, search_path pg_catalog, schemas qualificados; EXECUTE anon/authenticated false, service_role true; sessão fictícia zero linhas.
- View **public.app_property_current_verification** mantida: anon/authenticated sem SELECT, backend autorizado. Imóvel/solicitação atual seguem canônicos; decisões anteriores permanecem histórico.
- Quatro buckets privados: documents, documents_private, product-media, store-media. Documents_private 15 MiB/PDF/PNG/JPEG; mídias 2 MiB/JPEG/PNG/WebP. Documents legado sem limite/MIME configurados preservado para compatibilidade.
- Uploads existentes: intenção/autorização, tamanho/hash/magic bytes, validação de conteúdo ativo quando aplicável, quotas/quarentena e URL assinada autorizada. Aprovação/reanálise/bloqueio/arquivamento/exclusão auditável preservados.
- Auth/Storage reais locais: quatro papéis, sessão, confirmação/recuperação/senha/logout, URL assinada privada, outro titular e MIME. Credenciais sintéticas, sem envio de dados pessoais reais.
- Edge public-registration **v10 → v11 ACTIVE**, fonte remota igual à versionada; admin-bootstrap v4 preservada. verify_jwt=false já existente com controles internos mantido.
- Contagens finais remotas: **5 usuários Auth, 10 objetos Storage, 3 cestas/0 itens**. Sem identidades/upload/cesta/checkout de auditoria na base canônica; nenhum dado excluído.

**⚠️ PENDENTE JUSTIFICADO:** proteção Supabase contra senha vazada desabilitada, recurso Pro segundo a documentação consultada; custo gratuito preservado. Auxiliares definer e tabelas backend-only sem policies confrontados com grants/uso, sem abertura de acesso.

**⚠️ PENDENTE JUSTIFICADO — operação:** logs corrigidos incluíram storage_deletion_queue_failed em inicializações. Código da manutenção igual ao original. Consulta remota: índice usado, backend com SELECT/UPDATE, **dez registros históricos concluídos, zero pendentes/last_error**; dez objetos Storage preservados. Causa não comprovada. Reprocessamento destrutivo não executado; observação não declarada corrigida.

# LGPD

## Mapa técnico

| Categoria | Finalidade/origem | Armazenamento/acesso | Terceiro, retenção, base |
|---|---|---|---|
| Nome/CPF/e-mail/telefone | Cadastro/identidade/contato; titular | Auth, app_people/app_users; titular/backend autorizado | Supabase/Vercel; prazo/base por finalidade: revisão |
| Credenciais/sessões | Autenticação; titular/Auth | Senha no Supabase Auth; cookies/transporte administrativo existente | Refresh cookie até 30 dias, HMAC recente 15 min; não definem retenção de toda a conta |
| Endereço/localização/propriedade | Cadastro/geocodificação/entrega/descoberta | Tabelas, drafts vinculados ao usuário | ViaCEP recebe CEP, Nominatim endereço, mapas/fontes requisições; retenção/base: revisão |
| CAR/CCIR/matrícula/documentos | Verificação T09/T10; produtor | Storage privado/intenção/metadados/análise; dono/equipe autorizada | Gemini pode receber documento integral base64; legitimidade/contrato/transferência/retenção: revisão |
| Fotos loja/produto | Catálogo/vitrine; produtor | Buckets privados, URLs de conteúdo publicado | Supabase/Vercel; retenção: revisão |
| IP derivado/user-agent/log/auditoria | Segurança/rate limit/rastreio | Hash/HMAC e registros restritos | Vercel/Supabase; prazo/necessidade/base: revisão |
| Consentimento/preferências | Escolhas do titular | app_consent_records/app_user_preferences | Integridade corrigida; base dos tratamentos não presumida |
| Favoritos/cesta/checkout | Fluxos comerciais | Tabelas/comandos idempotentes | Cobertura integral de exportação/exclusão/retenção: revisão |

Supabase us-west-2, Vercel pdx1 e Google exigem análise das transferências/contratos efetivos. Nenhum documento real enviado à IA. Auth/perfil mantidos separados; senha não duplicada em tabela própria.

## Cookies, analytics e política

Busca não encontrou GA/GTM/Meta Pixel/Hotjar/Clarity. Cookies Auth/prova/papel, transporte administrativo legado no localStorage, drafts, caches CEP/localidade e comandos de checkout mapeados. Contrato administrativo preservado para compatibilidade.

Documento analisado: shared/lgpdCadastro.ts, **lgpd-cadastro-2026-10-02**. Texto cadastro/contato, CPF não publicado, comunicação opcional/retirada preservado. Alteração nesse arquivo é campo técnico de prova, sem mudança jurídica.

**REVISÃO JURÍDICA NECESSÁRIA:** controlador/canal de direitos; base por finalidade; transparência/necessidade de Gemini; contratos de operadores; transferência internacional; retenção por categoria; exportação/exclusão integral.

Recomendação preparada, **não publicada como nova política**: descrever categorias/finalidades reais, fornecedores de armazenamento/autenticação/extração, transferências, critérios de retenção e canal de direitos; separar comunicação opcional de cadastro e identificar base por operação. Registro íntegro de aceite não demonstra conformidade de todos os tratamentos.

Referências brasileiras: [ANPD — perguntas frequentes](https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes/perguntas-frequentes) e [Resolução CD/ANPD nº 19/2024](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024).

# Regressões

| Grupo | Encontradas | Corrigidas / estado |
|---|---:|---|
| Navegador inicial | 39 | Fixtures/seletores antigos e dois defeitos funcionais rastreados; 316 cenários comprovados, incluindo cinco reexecuções inalteradas |
| PostgreSQL locator/preparação | Um teste/uma preparação | Locator delimitado ao catálogo; bancos isolados preservam fixtures; 214 cenários comprovados |
| TypeScript/lint | Uma causa | Corrigida; aprovados |
| Runtime introduzido | **1** | **1 corrigida**, rollback + parser compatível + cold start corrigido |
| Introduzidas conhecidas abertas | **0** | No escopo testado; sem declaração de homologação privada integral |
| Cobertura | Globais/específicos | **⚠️ PENDENTE JUSTIFICADO**, anterior |
| Comunicação legada | Três de quatro | **⚠️ PENDENTE JUSTIFICADO**, reprodução igual no SHA original |
| Manutenção Storage | Eventos de log | **⚠️ PENDENTE JUSTIFICADO**, causa não comprovada/fila sem pendentes |

Assertions preservadas, sem desativar testes ou ampliar timeouts. Fixtures seguem headings/rotas/contratos de revisão/idempotência e fila canônica atuais. Responsividade local inclui iPhone/conta/administração/módulos; produção **40 páginas em cinco larguras**, sem pageerror/overflow. 401 esperados de sessão de visitante registrados separadamente de erros JavaScript; navegador de produção sem API mockada.

**⚠️ PENDENTE JUSTIFICADO:** login/ações privadas positivos, IDOR entre titulares e MFA administrativo positivo em produção com credenciais específicas. Auth/Storage/Edge reais isolados não declaram contas privadas de produção homologadas. Não foram criadas identidades ou compras de teste canônicas.

# Publicação

| Elemento | SIM/NÃO | Evidência |
|---|---|---|
| GitHub | **SIM** | Correções main; SHA funcional final 1fafc77de3358ccfb66af1fe4eb5578857b59c66; fechamento exclusivamente documental |
| Supabase | **SIM** | Migration 20261006120330, 63/schema 57/hash, grants/RPC/Storage verificados; Edge v11 fonte equivalente |
| Vercel | **SIM** | dpl_7qT6hyE2sas4CX5mf84VbPPhs1XP READY, SHA/alias principal, health/ready/config e negativos aprovados |
| Livro Raiz | **SIM** | Entrada sincronizada neste fechamento com implementação comprovada/pendências; histórico preservado |

Depois do deploy documental, SHA ativo/release e smoke são reconfirmados e exportados no registro de encerramento. Alterações de release são rastreáveis; registros anteriores permanecem. Nenhum workflow GitHub Actions, serviço pago, branch Supabase, stack paralela ou banco substituto criado.

Evidências: [evidencias.json](docs/auditoria/2026-10-06/evidencias.json), [protocolo de validação](docs/auditoria/2026-10-06/VALIDACAO.md). Logs recuperados em /workspace/scratch/hvm-*.log; agregados incluem hashes/comandos/limites sem credenciais.

# Resultado

- **✅ VERIFICADO E CORRETO:** arquitetura preservada; build/typecheck/lint; compressão; RLS/grants/RPC/buckets no escopo verificado; smoke/negativos/responsividade descritos.
- **🔧 PROBLEMA ENCONTRADO E CORRIGIDO:** autoria de consentimento, janela administrativa, validade/erro de sessão, privilégios destrutivos, localidades/edição de senha, dependências/incompatibilidade de runtime; publicadas e testadas.
- **⚠️ PENDENTE JUSTIFICADO:** cobertura, legado inativo, operação Storage, benchmark representativo, homologação privada de produção, senha condicionada a plano e revisão jurídica. Nenhuma conformidade integral ou melhoria percentual declarada sem prova.

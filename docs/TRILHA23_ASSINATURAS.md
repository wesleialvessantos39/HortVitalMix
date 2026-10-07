# Trilha 23 — assinaturas e monetização rural

Base homologada: `main@fe4525eb34229fcfc9f1bc44aac04729dcd5feda`, T22/schema **60**, 66 migrations. Fonte normativa: **HortiVitalMix — Plano T12–T25, Trilha 23, Volume 5**, junto do Livro-Raiz. Repositório `wesleialvessantos39/HortVitalMix`; único Supabase **xipbsazvymkqqfmfegwu**. Nenhuma implementação da T24.

## Banco e preservação

Schema lógico **61**, **67 migrations**, hash **c8f8ddd88a2d037dbe28d83c6266f756eafeeed9c4a98e405f1f800dc051ee7d**. Migration adicional **20261007104345_trilha23_subscriptions.sql**, aplicada como versão física **20261007113436**, reconciliada no verificador de histórico. As **66 migrations anteriores estão byte a byte preservadas**.

Cinco tabelas novas: `app_plans`, `app_subscriptions`, `app_trial_grants`, `app_recurrence_schedules` e `app_billing_cycles`. Todas têm **RLS ENABLE/FORCE**. Planos ativos são públicos; assinaturas, recorrências e ciclos são privados ao titular; trial é legível pelo seu produtor. Clientes recebem somente SELECT, sem INSERT/UPDATE/DELETE/TRUNCATE ou EXECUTE nos helpers privados. Mutações revalidam identidade e papel no backend. Plano administrativo usa a capacidade existente `payment_configuration` e autenticação recente nas alterações.

O vínculo financeiro acrescenta uma coluna nullable e UNIQUE `billing_cycle_id` a `app_payment_intents`, como terceira origem explícita. A constraint continua exigindo exatamente uma origem: cotação T19, venda presencial T20 ou ciclo T23. As linhas antigas recebem NULL e conservam o mesmo comportamento; nenhum lançamento anterior é convertido em assinatura. A liquidação de ciclo usa um ramo específico antes da conversão de compras: não cria pedidos, não consome estoque, não abre alocações T22 nem libera os holds de pedidos T20.

Após a migration, as **87 relações anteriores de negócio/Auth/Storage conservam contagem e digest**. A comparação de `app_payment_intents` exclui somente a nova coluna nullable para comparar todos os valores antigos. Os três produtores existentes receberam seu primeiro trial na nova tabela; seus perfis antigos não foram atualizados. Zero planos comerciais, assinaturas, recorrências ou faturas de teste em produção. Cinco usuários Auth, dez objetos Storage e os dados/fotos anteriores preservados.

## Trial, recorrência e planos

Trial gratuito de **30 dias exatos**, concedido automaticamente no INSERT de perfil T08, com backfill dos perfis existentes no lançamento. Repetir o cadastro/grant não muda as datas. A chave antirrenovação derivada da identidade normalizada tem UNIQUE e permanece privada; as datas e a política são imutáveis, e `is_converted` só avança. Não é uma alegação de anonimização: a chave pseudônima é restrita e conservada para impedir a renovação.

Há adaptações necessárias ao DDL ilustrativo do manual: `ON DELETE CASCADE` no grant apagaria a evidência que deve impedir um segundo trial; por isso o perfil usa SET NULL, e uma recriação com a mesma identidade pode apenas reassociar o grant antigo. RESTRICT em usuário/pessoa/ciclo impediria a exclusão homologada T06; esses vínculos usam CASCADE, removendo os dados da assinatura e mantendo somente o registro privado antirrenovação. Ambos os fluxos foram verificados com PostgreSQL real.

Contratação valida o público e o papel ativo, endereço próprio ativo/geolocalizado, loja elegível, produtos publicados da mesma loja e janelas T22 ativas correspondentes ao dia. A quantidade de dias distintos corresponde à frequência configurada (1–7 entregas para consumidor; zero para produtor). Plano, endereço e janela recebem snapshots. Editar/inativar o plano impede novas contratações, sem reprecificar ou invalidar contratos anteriores.

Pausa é permitida para assinatura ativa e dura até **14 dias corridos**, calculados pelo servidor. Não altera períodos nem faturas existentes. Retomar antes do prazo conserva a data limite e rejeita nova pausa dentro dela. Depois do prazo, a leitura deriva estado ativo e a recorrência volta a estar efetiva, sem cron pago. Cancelar desativa a recorrência, mantendo os ciclos já registrados; não inventa reembolso nem altera o pedido comercial T20.

Janelas são **preferências de recorrência**, não reservas de capacidade. Cada entrega precisa de pedido confirmado e agendamento pela loja nos fluxos existentes. A cesta guarda referências de produtos; não cria automaticamente pedidos, preços de produtos ou promessas de entrega nesta trilha.

## Pix por ciclo

`runBillingCycle` é acionado manualmente pela rota protegida do titular. A transação bloqueia a assinatura e a UNIQUE `(subscription_id, cycle_index)` impede duplicidade. Períodos são semanais, quinzenais ou mensais, com ajuste de fim de mês e manutenção do dia âncora. O ciclo vigente pendente ou ainda não vencido é reutilizado. Plano gratuito registra ciclo pago de valor zero sem payment_intent.

`PaymentService.createPixIntent` reutiliza **o mesmo gateway/interface T20**, sem outro provedor ou serviço pago. A cobrança tem valor do snapshot contratado; datas do trial são respeitadas. O intent, recibo determinístico e estado `requested` são persistidos **antes** de chamar o provedor. Duas requisições concorrentes fazem uma única tentativa externa. Falha com resultado desconhecido conserva `uncertain`; retries não geram uma cobrança substituta e exigem reconciliação. Um crash após a gravação do pedido de criação também conserva o intent para reconciliação, protegendo contra débito duplicado.

Webhook e confirmação seguem a verificação T20 de assinatura, referência, valor, expiração, política aceita e evento idempotente. Aprovação marca ciclo pago/assinatura ativa, preserva pausa vigente ou cancelamento e registra conversão do trial do produtor. A tela de pagamento existente exibe o ciclo e redireciona para as assinaturas após confirmação. Compras antigas conservam suas rotas e recebimento/carência/reembolso/repasse.

**Gateway real T20 permanece inativo**, como na base homologada. Plano pago em produção não cria fatura nem QR fictício quando a conexão está ausente: a API responde `GATEWAY_NOT_CONFIGURED` e a UI explica a indisponibilidade. O fluxo Pix foi comprovado com gateway de teste somente no banco descartável. Não houve cobrança real, troca do adaptador, novas credenciais, serviço de billing ou cron pago.

## Telas e operação

- `/assinaturas` e `/planos`: catálogo do consumidor, escolha de loja/endereço/cesta/dias e janelas, com entrada segura para visitante. Card de acesso ao clube do produtor sem misturar seus planos.
- `/produtor/assinaturas`: catálogo próprio do produtor; `/assinaturas/minhas`: contratos do público da sessão, pausa/retomada/cancelamento, ciclo manual e histórico.
- Banner do trial inserido nos painéis T08/T12 e conta do produtor, com contagem regressiva e acesso aos planos; identidade da sessão controla sua montagem.
- `/admin/assinaturas`: operador configura identificador, nome, descrição, preço, período, frequência, loja e ativação. A revisão otimista e os comandos idempotentes protegem edição/retry; autenticação recente usa o componente administrativo existente.
- `/pagamentos/:id`: tela T20 reaproveitada para Pix do ciclo, política e polling; suas compras anteriores continuam com o comportamento homologado.

O usuário escolheu **configurar nomes/preços depois no painel administrativo**. Não foram inventados planos, valores ou benefícios comerciais. Para planos do consumidor, a loja precisa estar elegível e ter produtos/janelas configurados; planos do produtor têm zero entregas e nenhuma loja vinculada.

Contratos Zod estritos em `shared/contracts/subscription.ts`; APIs privadas têm sessão, revalidação no domínio, proteção de origem, `X-Command-Id` e `private, no-store`. Middleware administrativo é limitado às novas rotas, sem interceptar as anteriores. UI tem labels, estados de erro/resultado, confirmação de cancelamento, comandos conservados em resultado incerto e layout de 320 a 1440 px.

## Validação

**9 testes de contratos/rotas T23**, **20 cenários PostgreSQL T23** e **uma história completa React compilado → HTTP → PostgreSQL** aprovados. Os cenários cobrem trial repetido/exclusão/recriação, datas imutáveis, contratação idempotente, vínculos entre lojas e usuários, plano inativo com snapshot existente, pausa e retomada, ciclo concorrente, gateway ausente, tentativa Pix incerta, liquidação idempotente sem pedidos/estoque, cancelamento, RLS, papéis/bloqueios, edição administrativa e exclusão T06.

A história completa configura os planos pelo painel administrativo, contrata e pausa/retoma sem alterar a fatura, cria o Pix via interface T20 e confirma o mesmo webhook duas vezes. O consumidor retorna à assinatura ativa com uma única tentativa no provedor; o produtor vê trial e catálogo separados. Responsividade verificada em **320/390/768/1440 px**; preços dessa história existem somente no banco descartável.

Regressões: **806 testes gerais aprovados / 339 condicionais não executados**; **114 SQL anteriores** (18 cesta, 25 checkout, 22 comércio, 15 mídias de vitrine, 19 pedidos, 11 logística e 4 mídias públicas). **79 casos distintos de interface anterior** aprovados entre rodadas: 72 na rodada inicial e 7 em retry isolado por limites de tempo durante execução concorrente. Não foram alteradas assertions nem testes antigos para produzir esse resultado.

TypeScript global/produção, build, manifesto/histórico remoto, scanner de segredos/bundle e cold start sem require(ESM) aprovados. Dependências e lockfile preservados; **zero advisories de dependências de produção**. A região pdx1 e o deploy exclusivo da main continuam na configuração existente; runtime Node já homologado, sem conversão dos módulos para outro runtime.

Advisors após migration: **5 WARN de segurança e 25 WARN de desempenho anteriores**, zero WARN novo. Sete índices novos ainda sem uso são INFO esperados sem assinaturas reais. Avisos anteriores: [helpers executáveis](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) e [policies permissivas](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies). Não foram modificadas policies/helpers anteriores nesta trilha. Os oito grants anteriores REFERENCES/TRIGGER de consentimentos/preferências permanecem; zero INSERT/UPDATE/DELETE/TRUNCATE para clientes.

## Publicação

[PR 90](https://github.com/wesleialvessantos39/HortVitalMix/pull/90) integrado: **main/b124ea576e16dbec6e28d9c3ec4409bf360b622e**, deployment **dpl_BVhyAMLpVhF91sk39E1sXt8Nsq9f**, **READY/main/production/pdx1**, domínio **https://hortvitalmix.vercel.app**. Release **t23-v61-b124ea5** registrada somente depois de READY/alias/health 200. CLI de health/ready/config/SHA/schema aprovado; **18 verificações HTTP**: públicos 200, privados sem sessão 401, origem externa 403 e webhook com gateway ausente 503 sem lançamento.

**20 combinações página/largura** de `/assinaturas`, `/planos`, `/produtor/assinaturas`, `/assinaturas/minhas` e entrada administrativa em **320/390/768/1440 px**, sem overflow/pageerror. Catálogos exibem a preparação de planos, como escolhido pelo usuário; a entrada administrativa redireciona o visitante ao login. Os fluxos autenticados completos foram comprovados no banco descartável, sem autenticar contas reais em produção.

Fotos T22 reais: produto **15.966 bytes** e retrato da loja **69.254 bytes** a 640 px, exatamente os tamanhos anteriores. WebP e ETag/304 mantidos, cache público por cinco minutos e nenhum Set-Cookie. Nenhuma alteração adicional no carregamento de mídia, nos originais ou nos buckets. Logs de produção sem grupos error/fatal na janela consultada de cinco minutos.

Depois da publicação funcional, **83/87 relações inteiramente idênticas**. Diferenças restritas ao selo intencional de `app_releases` e atividade de autenticação: uma nova sessão, um novo registro administrativo de login e metadados de `auth.users` atualizados. Os **27 registros de sessão e 190 tentativas administrativas anteriores conservam o digest**; os cinco usuários Auth e os dados de negócio/Storage anteriores permanecem. Foi observado login bem-sucedido e atualização de `last_sign_in_at` no período; essa atividade não foi usada como teste privado nem modificada para ajustar a comparação. Nenhuma conta, pedido ou cobrança de teste foi criada.

Este fechamento documental conserva integralmente código/schema/preços/gateway e recebe seu próprio deploy/selo da SHA corrente após READY. A consulta da release atual identifica a SHA efetivamente ativa, inclusive depois do fechamento; os dados acima registram a publicação funcional verificada.

Evidência consolidada: [TRILHA23_PRESERVACAO.json](TRILHA23_PRESERVACAO.json). **T24 deve partir do schema 61**, preservando T01–T23 e as fotos/logística T22.

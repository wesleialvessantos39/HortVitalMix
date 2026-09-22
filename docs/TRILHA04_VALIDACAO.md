# Volume 01 — Trilha 04 — Validação Técnica

Fonte normativa: **MANUAL MESTRE TÉCNICO v10 — TRILHAS 01 A 06**.

## Escopo canônico

Trilha: **Confirmação Dupla de Contato e Recuperação de Senha**.

A estrutura de banco criada na T04 permanece preservada integralmente. A política operacional atual de entrega, porém, foi simplificada para respeitar a infraestrutura gratuita já configurada pelo proprietário:

**todo e-mail de autenticação e segurança é enviado exclusivamente pelo Supabase Auth, utilizando o SMTP/Gmail configurado dentro do próprio projeto Supabase.**

Não existe envio direto pela aplicação via Resend, Gmail API ou Twilio.

## Política operacional atual

Ativo agora:

- Supabase Auth como único serviço de autenticação e entrega de e-mails de segurança;
- SMTP/Gmail configurado no próprio painel do Supabase;
- confirmação/reenvio de cadastro por `supabase.auth.resend(...)`;
- recuperação de senha por `supabase.auth.resetPasswordForEmail(...)`;
- reautenticação/código de segurança por `supabase.auth.reauthenticate()`;
- isolamento por perfil Consumer, Producer, Administrador e Super administrador preservado.

Desativado por enquanto:

- Resend;
- Gmail API direta pela aplicação;
- Twilio;
- SMS de segurança;
- provider externo de e-mail;
- outbox própria como mecanismo ativo de entrega.

A estrutura de outbox permanece no banco apenas como fundação arquitetural prevista pela T04 e possível evolução futura. Ela não exige variável de runtime e não participa do fluxo ativo atual.

## Variáveis removidas do runtime

As seguintes variáveis **não pertencem mais ao contrato de ambiente da aplicação**:

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

O projeto não deve solicitá-las no Google Studio, Vercel ou outro runtime da aplicação.

## Banco

Migrations T04 preservadas:

1. `20260922024933_trilha04_contact_recovery.sql`;
2. `20260922025820_trilha04_performance_hardening.sql`.

Schema lógico permanece **18**.

Hash do histórico:
`2405a48927004cf8c60d700c6303c2997f0ce7708cde510b1d3dce70eda977e1`.

Estruturas preservadas:

- `app_contact_verification_challenges`;
- `app_password_recovery_requests`;
- `app_outbox_events`;
- `app_delivery_attempts`.

Nenhuma migration foi revertida ou removida.

## Backend ativo

O fluxo utilizado pela aplicação está em `server/routes/authRoutes.ts`.

Confirmação/reenvio:

- valida identidade e perfil;
- usa `supabasePublic.auth.resend({ type: "signup", ... })`;
- mantém resposta pública invariável para evitar enumeração.

Recuperação:

- valida identidade e perfil;
- cria o contexto de recuperação por papel já homologado;
- usa `supabasePublic.auth.resetPasswordForEmail(...)`;
- o e-mail é entregue pelo Supabase Auth através do SMTP configurado no projeto.

Reautenticação:

- usa `client.auth.reauthenticate()`;
- o código de segurança é enviado pelo Supabase Auth.

O router paralelo criado inicialmente para providers externos não é mais montado em `server/app.ts`.

## Frontend ativo

As rotas de segurança voltaram a utilizar o componente canônico `Account`, que já estava integrado ao Supabase:

- `/confirmar-contato`;
- `/confirmarcontato`;
- `/recuperar-senha`;
- `/redefinir-senha`;
- `/redefinirsenha`.

Isso evita duas implementações concorrentes para a mesma autenticação.

## Supabase / Gmail

A aplicação **não recebe credenciais do Gmail**.

O Gmail é tratado como configuração interna do Supabase SMTP. A aplicação conhece apenas o Supabase e usa a API de Auth. Assim:

- não existe `GMAIL_ACCESS_TOKEN` no projeto;
- não existe `GMAIL_FROM_EMAIL` no projeto;
- não existe senha SMTP do Gmail no GitHub, Google Studio ou frontend;
- alterações futuras de SMTP devem ser feitas no Supabase, não no código da aplicação.

## SMS

SMS de segurança está **desativado por enquanto**.

Nenhuma variável Twilio deve ser configurada. Quando o projeto decidir ativar SMS em etapa futura, a decisão deverá ser registrada no Livro Raiz antes de qualquer implementação.

## Responsividade

As telas canônicas de conta/segurança continuam dentro do shell responsivo já homologado para mobile, tablet e desktop.

## Gates

O gate T04 agora verifica explicitamente:

- uso de Supabase Auth para confirmação;
- uso de Supabase Auth para recuperação;
- uso de Supabase Auth para reautenticação;
- ausência das variáveis de providers externos;
- ausência do router paralelo T04 no runtime;
- compatibilidade dos aliases de segurança;
- preservação das quatro estruturas de banco T04.

GitHub Actions continua fora do critério de execução.

## Checklist corrigido

- [x] Banco T04 preservado.
- [x] Supabase Auth definido como único serviço de e-mail de segurança.
- [x] Gmail mantido apenas dentro da configuração SMTP do Supabase.
- [x] Resend removido do runtime.
- [x] Gmail API direta removida do runtime.
- [x] Twilio removido do runtime.
- [x] SMS desativado.
- [x] Variáveis extras removidas do `.env.example`.
- [x] Preflight não exige chave de outbox.
- [x] Frontend usa o fluxo canônico Supabase.
- [x] Livro Raiz atualizado.
- [x] GitHub Actions não utilizado.

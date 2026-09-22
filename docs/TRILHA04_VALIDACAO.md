# Volume 01 — Trilha 04 — Validação Técnica

Fonte normativa: **MANUAL MESTRE TÉCNICO v10 — TRILHAS 01 A 06**.

## Escopo canônico

Trilha: **Confirmação Dupla de Contato e Recuperação de Senha**.

Regra central implementada: **um único e-mail de confirmação contém OTP de 6 dígitos + link seguro por token**.

A implementação preserva os avanços anteriores do projeto e não substitui fluxos reais por simulação.

## Banco

Migrations:

1. `20260922024933_trilha04_contact_recovery.sql` — implementação aditiva da migration 0011 do Manual;
2. `20260922025820_trilha04_performance_hardening.sql` — hardening após advisor Supabase.

O projeto partia do schema lógico 16; por isso a T04 fecha em schema lógico **18**, sem rebaixar ou reescrever histórico.

Hash do histórico:
`2405a48927004cf8c60d700c6303c2997f0ce7708cde510b1d3dce70eda977e1`.

Tabelas:
- `app_contact_verification_challenges`;
- `app_password_recovery_requests`;
- `app_outbox_events`;
- `app_delivery_attempts`.

Todas possuem RLS habilitado/forçado conforme o escopo. Escrita permanece exclusivamente server-side.

## Segurança

- OTP gerado por `randomBytes`, nunca `Math.random`;
- OTP de seis dígitos e salt de 16 bytes;
- verificação com `timingSafeEqual`;
- token opaco de 32 bytes;
- OTP e token persistidos somente como SHA-256;
- fingerprint SHA-256 do contato;
- TTL 30 min;
- cooldown 60 s;
- máximo de 5 erros OTP;
- payload da outbox cifrado AES-256-GCM;
- retry exponencial, limite de tentativas e estado `abandoned`;
- recuperação com resposta pública genérica;
- recuperação preserva vínculo explícito com o portal/papel;
- reset consome token e challenge de papel;
- sessões GoTrue são revogadas globalmente após reset.

## Backend

Serviços reais implementados para:
- status e emissão de confirmação;
- confirmação por OTP;
- confirmação pública por token;
- pedido de recuperação;
- redefinição;
- outbox cifrada;
- dispatch de lote;
- Resend;
- Gmail API;
- Twilio.

O dispatcher CLI está disponível por:
`npm run outbox:dispatch`.

## Frontend

Telas próprias:
- confirmação de contato;
- recuperação;
- redefinição.

A confirmação fica visível na área `/minha-conta`.

OTP:
- 6 inputs;
- paste;
- avanço automático;
- backspace inteligente;
- setas;
- one-time-code;
- cooldown.

## Responsividade

CSS versionado para:
- <=359 px;
- <=767 px;
- 768–1199 px;
- >=1200 px.

E2E versionado em:
- 320 px;
- 430 px;
- 768 px;
- 1024 px;
- 1440 px.

## Provas realizadas no Supabase canônico

Foi executada prova transacional com `ROLLBACK`:
- challenge inseriu corretamente;
- recovery inseriu corretamente;
- outbox inseriu corretamente;
- delivery attempt inseriu corretamente;
- OTP não estava em claro;
- token não estava em claro;
- payload de outbox foi aceito como binário;
- consulta posterior confirmou zero resíduo.

Foi executada prova RLS com dois usuários efêmeros dentro de transação:
- usuário autenticado enxergou exatamente **1** challenge;
- `only_self = true`;
- nenhuma linha de outro usuário ficou visível;
- transação revertida.

## Advisors

Após o hardening T04:
- removido o alerta T04 de FK sem índice da outbox;
- removidos os dois alertas T04 de `auth.uid()` por linha.

Avisos restantes pertencem a estruturas anteriores ou são índices novos ainda sem tráfego; nenhum índice canônico T04 foi removido.

## Gates

`npm run build` inclui:
- migrations manifest/hash;
- typecheck;
- security check;
- regressão T02;
- regressão T03;
- unitários T04;
- evidência T04;
- Vite build;
- secret scan de bundle.

Integração real:
`npm run test:t04:integration`.

E2E:
`npm run test:t04:e2e`.

Nenhum GitHub Actions foi utilizado ou alterado.

## Checklist

- [x] Feature Backend
- [x] Feature Frontend
- [x] Banco / migrations / RLS
- [x] Outbox cifrada
- [x] OTP + link na mesma confirmação
- [x] Recuperação anti-enumeração
- [x] Isolamento por papel preservado
- [x] Design desktop/mobile
- [x] Responsividade mobile/tablet/desktop
- [x] Unit tests
- [x] Integration tests versionados
- [x] E2E versionado
- [x] Livro Raiz
- [x] GitHub
- [x] Build Vercel
- [x] Sem GitHub Actions

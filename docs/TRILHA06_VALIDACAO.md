# Trilha 06 — Validação do Manual Mestre Técnico v11

Escopo: perfil canônico, endereços residenciais de entrega, preferências e privacidade LGPD.

## Invariantes implementados

- app_user_addresses é exclusivamente residencial e não possui vínculo com imóvel rural.
- Um único endereço padrão por pessoa é garantido por índice parcial único.
- O primeiro endereço cadastrado torna-se padrão.
- A troca do padrão é serializada por FOR UPDATE em app_people.
- Ao excluir o padrão, o endereço restante mais antigo é eleito de forma determinística.
- Endereços repetidos são bloqueados por fingerprint SHA-256.
- Preferências usam revisão otimista.
- Alterações de consentimento de marketing geram histórico append-only com versão de política e hash de IP.
- Exportação LGPD exige autenticação emitida há no máximo 15 minutos e mascara CPF.
- ViaCEP é apenas assistivo, com timeout de 4 segundos e edição manual sempre disponível.
- RLS é ENABLE + FORCE nas três tabelas novas.

## Rotas HTTP

1. GET /api/v1/account/profile
2. PATCH /api/v1/account/profile
3. GET /api/v1/account/addresses
4. POST /api/v1/account/addresses
5. PATCH /api/v1/account/addresses/:id/default
6. DELETE /api/v1/account/addresses/:id
7. GET /api/v1/account/preferences
8. PATCH /api/v1/account/preferences

A exportação usa GET /api/v1/account/profile?export=1, preservando oito operações canônicas do módulo.

## Frontend e responsividade

O hub autenticado /conta direciona para /conta/perfil, /conta/enderecos, /conta/preferencias e /conta/privacidade. A gestão de endereços usa cards com badge “Padrão” e bottom sheet em smartphone. O evento hortivitalmix:default-address-changed sincroniza o cabeçalho da aplicação.

A suíte Playwright valida 320, 360, 768, 1024 e 1440 px sem overflow horizontal.

## Banco canônico

Migration lógica: 20260925002000_trilha06_profile_privacy.sql.
Migrations físicas aplicadas pelo Supabase: 20260925002406_trilha06_profile_privacy e 20260925002930_trilha06_rls_policy_hardening.
Schema lógico do repositório: 26.
Hash do manifesto: 3d2b3207abe752f3edb2394efae3988c6e764738039cd587d26ccb782ffc4253.

## Gates

- npm run test:t06:unit
- npm run verify:t06:evidence
- npm run verify:t06:free
- npm run test:t06:e2e

# Volume 01 / Trilha 05 — Validação contra o Manual Mestre Técnico v10

Fonte única de verdade: **MANUAL MESTRE TÉCNICO v10 — TRILHAS 01 A 06**.

Status deste documento: **implementação corrigida em branch; homologação final depende do build/deploy da main**.

## Compatibilidade com o histórico real

O Manual denomina esta etapa como migration 0012/schema 12. O projeto já estava no
schema lógico 18 ao encerrar a Trilha 04. A Trilha 05 foi aplicada sem downgrade:
- `20260922200604_trilha05_admin_governance.sql`;
- `20260923022000_trilha05_performance_hardening.sql`.

Assim, o número lógico real avança para 20 migrations, preservando todo o histórico.

## Banco e segurança — evidência já executada

- 3 setores canônicos ativos: `document_verification`, `catalog_moderation`, `finance_ops`.
- 6 tabelas administrativas presentes.
- RLS habilitado e FORCE RLS nas 6 tabelas.
- `has_role_for` validado por prova transacional.
- `fn_is_last_active_super_admin` validado por prova transacional.
- Papel público em convite rejeitado por constraint.
- Prova transacional terminou sem resíduos.
- Advisor pós-hardening: nenhuma FK não indexada nas tabelas T05 e nenhuma política
  permissiva duplicada em `app_admin_sector_members`.
- Alertas restantes do Advisor referem-se a estruturas anteriores ou a índices
  recém-criados ainda sem uso estatístico; nenhum deles autoriza remover proteção.

## Backend entregue

- Bootstrap único com advisory lock e `BOOTSTRAP_ADMIN_EMAIL` server-only.
- Login separado para `platform_admin` e `platform_super_admin`.
- Super Admin nunca recebe sessão antes do MFA.
- MFA via Supabase Auth e desafio HortiVitalMix de 10 minutos / 5 tentativas.
- Rate limiting persistente: janela 15 min, bloqueio após 10 falhas por e-mail ou IP.
- Convite: token de 32 bytes, somente digest SHA-256 no banco, validade 24h.
- Emissão de convite serializada por advisory lock.
- Aceite com `SELECT ... FOR UPDATE` para impedir corrida/reuso.
- Setores materializados antes da ativação e copiados no aceite.
- Proteção do último Super Admin no bloqueio.
- `requireSuperAdmin` e `requireRecentAuth` de 15 minutos.
- Supabase Auth permanece o único mecanismo de e-mail de autenticação/segurança,
  conforme decisão canônica posterior à redação original da T04.

## Frontend entregue

Rotas:
- `/admin/entrar`;
- `/admin/bootstrap`;
- `/admin/aceitar-convite` (canônica);
- `/admin/convite` (alias de compatibilidade);
- `/admin/painel`;
- `/admin/governanca`;
- `/admin/usuarios`;
- `/admin/configuracao`.

UX:
- transição credenciais → MFA;
- gate por papel e suporte a escopo setorial;
- diálogo “Saiba mais” com fechamento por botão, backdrop e Escape;
- sidebar desktop, navegação mobile e layout adaptativo;
- identidade visual das referências: verde profundo, verde de ação, laranja e
  superfícies claras/arredondadas.

Viewports versionados em E2E: 320, 390, 430, 768, 1024 e 1440 px.

## Checklist do Manual

### Bloco A — Banco
- [x] A2 migration canônica aplicada.
- [x] A3 três setores canônicos.
- [x] A4 seis tabelas administrativas.
- [x] A5 RLS habilitado e forçado.
- [x] A6 `fn_is_last_active_super_admin`.
- [x] A7 `has_role_for`.
- [ ] A1/A8: numeração literal 12 não é aplicada por downgrade; gate de foundation será
  registrado após build/deploy final sobre o histórico real.

### Bloco B — Backend
- [x] Implementação estrutural B1–B13 presente em código.
- [x] B8 corrigido para 10 falhas.
- [ ] Prova HTTP integral no deployment final pendente.

### Bloco C — Frontend
- [x] Implementação responsiva C1–C7 versionada.
- [ ] Execução Playwright no deployment final pendente.

### Bloco D — Segurança
- [x] D1–D7 cobertos por contratos, armazenamento por digest, origin protection,
  gates server-side e bootstrap sem divulgação do e-mail autorizado.

### Bloco E — Operacional
- [x] E1 snapshot lógico pré-T05 registrado sem fabricar backup físico.
- [ ] E2 release T05 ainda não marcada.
- [ ] E3 deploy READY ainda não confirmado.
- [ ] E4 verify:deploy ainda não executado contra a main final.

A homologação só será marcada após esses itens operacionais reais.

# Volume 01 / Trilha 05 — Snapshot lógico pré-migração

Data da reconstrução: 2026-09-22.

O plano Supabase Free não fornece, neste fluxo, um snapshot físico retroativo de um
instante que já passou. A migration canônica da Trilha 05 já havia sido aplicada
quando esta auditoria foi retomada. Para preservar a exigência de rastreabilidade
sem fabricar evidência, o estado pré-T05 foi reconstruído exclusivamente a partir
da release canônica T04 registrada antes da migration T05.

## Baseline imediatamente anterior

- Release: `trilha04-v1`
- Ambiente: `production`
- Commit: `c7e98b65096f035fe6711ccc892bce56c77785d5`
- Schema lógico real: **18**
- Migration history hash: `2405a48927004cf8c60d700c6303c2997f0ce7708cde510b1d3dce70eda977e1`
- Estado: release corrente antes da promoção da T05.
- Transporte de e-mail de segurança: Supabase Auth; Gmail apenas como SMTP interno
  do Supabase; sem Resend, Gmail API direta, Twilio ou SMS no runtime.

## Mapeamento do Manual v10

O Manual chama a migration da Trilha 05 de **0012 / schema 12**. O repositório real
já estava no schema lógico 18 devido a migrations corretivas e hardenings legítimos
das Trilhas 01–04. Portanto não houve downgrade, renumeração nem reescrita do
histórico. A migration canônica T05 foi adicionada de forma monotônica como
`20260922200604_trilha05_admin_governance.sql`, seguida do hardening aditivo
`20260923022000_trilha05_performance_hardening.sql`.

Este arquivo é uma evidência lógica reprodutível, não uma alegação de backup físico
que não existia.

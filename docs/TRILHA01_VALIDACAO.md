# Trilha 01 — resultados da execução

Data: 2026-09-19. Estado: **homologação parcial de código e SQL; homologação final bloqueada por configuração externa**.

| Verificação | Resultado observado |
| --- | --- |
| TypeScript | Aprovado |
| Build Vite + varredura do bundle | Aprovado; sem padrões de segredos no bundle |
| Testes unitários/HTTP | 23 aprovados |
| Testes de integração GoTrue/credenciais completas | 3 pulados explicitamente; não homologados |
| Playwright | 7 aprovados, Chromium real |
| Viewports | 320, 360, 430, 768, 1024, 1440 px; home e cadastro sem overflow horizontal |
| Migrations remotas | 8 aplicadas, histórico local sincronizado |
| SQL real em Supabase | Assertions aprovadas com rollback |
| Dados de teste após rollback | 0 pessoas, 0 usuários Auth, 0 eventos de auditoria |
| RLS | 8 tabelas habilitadas e forçadas; 15 policies nas tabelas app_* |
| Seeds | 4 papéis canônicos e singleton de configuração; sem usuários/produtos fictícios |
| Storage | documents privado e policies de propriedade |
| Preflight do runtime | Falhou por credenciais ausentes, corretamente |
| Releases homologadas | 0; nenhuma release fictícia criada |
| Vercel | Nenhum projeto retornado pela equipe conectada; deployment não realizado |

## Evidências visuais

- [Mobile 360 px](evidence/home-360.png)
- [Tablet 768 px](evidence/home-768.png)
- [Desktop 1440 px](evidence/home-1440.png)

Inspeção visual efetuada nessas três capturas. Layout segue os HTMLs limpos: paleta verde/laranja, header desktop, categorias laterais, hero e shell mobile com navegação inferior. A comparação não afirma igualdade pixel a pixel com os PNGs de apresentação comercial.

## Escopo dos testes SQL

`supabase/tests/foundation.sql` verifica RLS/column grants, singleton, papéis, isolamento de duas identidades, bloqueio de autoatribuição administrativa, atualização permitida do nome próprio, bloqueio de confiança/status, imutabilidade de auditoria com linha existente, revisão com e sem mudança e suspensão do espelho após exclusão Auth. As claims são definidas na transação SQL para testar RLS; isso não substitui a suíte com JWTs reais emitidos pelo GoTrue.

## Limites

Não foram validados cadastro/login com credenciais completas, confirmação de e-mail, execução pela URL real do Studio, runtime Vercel, backups remotos e promoção em três ambientes. Catálogo e operações de compra não fazem parte da fundação e permanecem explicitamente indisponíveis.

O ambiente de execução bloqueou o daemon agent-browser e o download padrão do navegador. A validação foi feita com Playwright e Chromium empacotado, sem desativar a segurança web do navegador. O build foi executado com Node 24. O erro de IPC do CLI tsx foi resolvido usando `node --import tsx`, sem elevação de permissões.

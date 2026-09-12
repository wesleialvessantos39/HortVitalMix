# LIVRO-RAIZ — HortiVitalMix

Documento permanente de rastreabilidade técnica do projeto greenfield. Fonte normativa atual: `HortiVitalMix_Manual_Mestre_Tecnico_Greenfield_v6.pdf`, versão 6, 12/09/2026.

## Fonte canônica
- Código, migrations e documentação: GitHub `wesleialvessantos39/HortVitalMix`.
- Banco: Neon PostgreSQL, projeto `HortiVitalMix`.
- Deploy: Vercel.
- Regra: nenhuma funcionalidade persistente é considerada pronta sem persistência real e evidência de aceite.

## Estado do Módulo 001 — Fundação e Configuração
| Ordem | Escopo | Estado |
| --- | --- | --- |
| OE-001-001 | Estrutura | EM IMPLEMENTAÇÃO / HOMOLOGAÇÃO |
| OE-001-002 | Configuração global | PENDENTE |
| OE-001-003 | Ambientes | PENDENTE |
| OE-001-004 | Banco | PENDENTE |

## 2026-09-12 — OE-001-001 — Estrutura greenfield
A base anterior de template foi substituída pela arquitetura exigida no Manual v6, sem reutilizar status do projeto legado como evidência.

### Frontend
- Página pública inicial HortiVitalMix inspirada nas referências visuais fornecidas: verde profundo, verde vivo, laranja, branco/creme, elementos orgânicos, foco em produtor local e consumidor.
- Responsividade para desktop, tablet e mobile desde a primeira ordem.
- Estados reais de boot, apresentação conectada/desconectada e tela de indisponibilidade com recuperação.
- Nenhum código de OE exposto na UI de negócio.

### Backend/API
- Express dividido em `routes`, `services`, `repositories`, `middleware`, `config` e `db`.
- `requestId` centralizado em header e payload.
- `/api/health`, `/api/ready`, `/api/v1/config` e `/api/v1/environment` registrados.
- 404 de API em JSON, 413 para payload excessivo e erro interno sem vazamento de segredo.
- Pool PostgreSQL com encerramento gracioso.

### Banco Neon
- Projeto: `HortiVitalMix`.
- Região: AWS South America East 1 — São Paulo.
- PostgreSQL: 17.
- Branch de desenvolvimento: `development`.
- Branch de homologação: `homologation`.
- Migration inicial: `0001_oe_001_001_foundation.sql`.
- Tabela desta OE: `app_schema_migrations`.

### Vercel
- Aplicação preparada com `vercel.json`, build Vite e função Express serverless em `api/index.ts`.
- Segredos não são expostos em `VITE_*`; `DATABASE_URL` é exclusivamente server-side.

### Próxima ordem
OE-001-002 — Configuração global. Não iniciar antes de concluir as evidências da OE-001-001.

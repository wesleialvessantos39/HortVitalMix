# LIVRO-RAIZ — HortiVitalMix

Documento permanente de rastreabilidade técnica do projeto greenfield. Fonte normativa atual: `HortiVitalMix_Manual_Mestre_Tecnico_Greenfield_v6.pdf`, versão 6, 12/09/2026.

## Fonte canônica
- Código, migrations e documentação: GitHub `wesleialvessantos39/HortVitalMix`.
- Banco: Neon PostgreSQL, projeto `HortiVitalMix`.
- Deploy: Vercel.
- Regra: nenhuma funcionalidade persistente é considerada pronta sem persistência real e evidência de aceite.
- Regra permanente de implementação: toda OE com impacto funcional deve tratar frontend e backend em conjunto, além de banco, responsividade, documentação e preparação de deploy quando aplicável.

## Estado do Módulo 001 — Fundação e Configuração
| Ordem | Escopo | Estado |
| --- | --- | --- |
| OE-001-001 | Estrutura | IMPLEMENTADA — homologação técnica concluída; CI externo com bloqueio de runner |
| OE-001-002 | Configuração global | PENDENTE |
| OE-001-003 | Ambientes | PENDENTE |
| OE-001-004 | Banco | PENDENTE |

## 2026-09-12 — OE-001-001 — Estrutura greenfield
A base anterior de template foi substituída pela arquitetura exigida no Manual v6, sem reutilizar status do projeto legado como evidência.

### Frontend
- Página pública inicial HortiVitalMix alinhada às referências visuais fornecidas: verde profundo, verde vivo, laranja, branco/creme, elementos orgânicos, foco em produtor local e consumidor.
- Header responsivo, navegação desktop e menu móvel real.
- Responsividade explícita para desktop, tablet e mobile.
- Estados reais de boot, apresentação com infraestrutura conectada/desconectada e tela de indisponibilidade com recuperação.
- Foco visível e respeito a `prefers-reduced-motion`.
- Nenhum código de OE ou texto de simulação exposto na UI de negócio.

### Backend/API
- Express dividido em `routes`, `services`, `repositories`, `middleware`, `config` e `db`.
- `requestId` centralizado em header e payload.
- `/api/health`, `/api/ready`, `/api/v1/config` e `/api/v1/environment` registrados.
- 404 de API em JSON, JSON inválido tratado, 413 para payload acima de 256 KiB e erro interno sem vazamento de conexão.
- Pool PostgreSQL real e encerramento gracioso no servidor local e no ciclo de encerramento da função Vercel.
- Contratos TypeScript e validação Zod na fronteira pública.
- Permissões-base `platform.config.read` e `platform.config.manage` registradas para as próximas OEs do módulo.

### Banco Neon
- Projeto: `HortiVitalMix` — id `little-dew-20362357`.
- Região: AWS South America East 1 — São Paulo.
- PostgreSQL: 17.
- Banco: `hortivitalmix`.
- Branch de desenvolvimento: `development` — `br-spring-lake-acphljdw`.
- Branch de homologação: `homologation` — `br-ancient-meadow-acmkote8`.
- Migration inicial: `0001_oe_001_001_foundation.sql`.
- SHA-256 da migration: `7affe9ce4ce91b115d537745c9f3bf53522450b66783a2c70c6a7633183c0563`.
- Tabela desta OE: `app_schema_migrations`.
- Migration aplicada e conferida em desenvolvimento e homologação, com PK, UNIQUE e CHECK constraints.
- Consulta real de disponibilidade realizada no Neon; sem modo demo e sem confirmação fictícia de persistência.

### Vercel
- Aplicação preparada com `vercel.json`, build Vite e função Express serverless em `api/index.ts`.
- Rewrite de `/api/:path*` preservado para a aplicação Express por parâmetro interno removido antes do roteamento.
- Função configurada para `gru1` (São Paulo), próxima ao Neon.
- Segredos não são expostos em `VITE_*`; `DATABASE_URL` é exclusivamente server-side.
- O projeto HortiVitalMix ainda não existe na conta Vercel conectada; por segurança, nenhum deploy foi direcionado ao projeto Vercel de outro sistema.

### GitHub e CI
- Implementação publicada na branch `main`.
- Workflow `HortiVitalMix CI` possui checkout, Node 22, instalação, typecheck, testes e build.
- A execução automática foi disparada e repetida; o GitHub Actions encerrou o job antes de qualquer etapa de runner, sem logs de etapa disponíveis. Esse bloqueio externo não foi classificado como sucesso.
- A OE mantém testes automatizados dos principais critérios de aceite, inclusive 503/200 de readiness, 404 JSON, 413, requestId e não vazamento de credenciais.

### Próxima ordem
OE-001-002 — Configuração global. Iniciar somente após manter registrada esta evidência e sem antecipar tabelas/fluxos funcionais das OEs seguintes.

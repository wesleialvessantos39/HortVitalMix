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
| OE-001-001 | Estrutura | IMPLEMENTADA — Google AI Studio corrigido; CI bloqueado antes da alocação do runner pelo GitHub |
| OE-001-002 | Configuração global | HOMOLOGADA — Neon real + gate Vercel `npm run check` aprovado |
| OE-001-003 | Ambientes | HOMOLOGADA — três ambientes isolados + gate Vercel aprovado |
| OE-001-004 | Banco | PENDENTE — LIBERADA PARA IMPLEMENTAÇÃO |

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

### Hardening final da OE-001-001
- Tratamento de erros e encerramento do pool revisados para não registrar mensagens potencialmente portadoras de credenciais/segredos.
- Último commit funcional desta OE: `9635fc034468b37911b0c1054739cad0687b333b`.
- GitHub Actions continuou encerrando o job antes de executar qualquer etapa, portanto o bloqueio permanece externo ao fluxo de typecheck/test/build e não foi mascarado como sucesso.


### Correção de 2026-09-12 — Google AI Studio e CI
- Removido o arquivo `.env.example` que fazia o Google AI Studio interpretar `APP_ENV`, `APP_BASE_URL`, `API_PORT` e `DATABASE_URL` como variáveis obrigatórias para iniciar o preview.
- `metadata.json` deixou de declarar capacidade de Gemini server-side, pois o HortiVitalMix não depende dessa capacidade nesta OE.
- `server/config/runtime.ts` passou a utilizar defaults seguros de desenvolvimento sem exigir variáveis de ambiente; a conexão do Neon permanece opcional e exclusivamente server-side.
- Nenhum segredo foi colocado no repositório para contornar o prompt.
- O workflow de CI foi simplificado, alterado para runner explícito `ubuntu-24.04` e ganhou uma primeira etapa `Runner handshake`.
- Execução automática nº 8 (`34698424135`) falhou novamente antes de qualquer etapa: a API do GitHub retornou `steps: null` e `logs_url: null`. Isso demonstra que a falha acontece antes da execução do código/workflow no runner.
- Como a integração disponível não possui acesso administrativo às configurações de GitHub Actions, a ativação/política do runner precisa ser verificada na interface do repositório em **Settings → Actions → General**. O workflow está pronto para ser reexecutado assim que o Actions permitir alocação do runner.

### Reexecução após habilitação manual do GitHub Actions
- Após a confirmação do usuário de que **Settings → Actions → General** foi ajustado, a execução nº `34698424135` foi reexecutada pela integração GitHub.
- A reexecução foi aceita pelo GitHub (`run_attempt: 2`), porém terminou novamente em `failure`.
- O job `OE-001 foundation validation` retornou `steps: null` e `logs_url: null`, confirmando que o runner ainda não chegou a iniciar nenhuma etapa do workflow.
- A próxima investigação deve ser feita sobre a anotação administrativa do GitHub associada ao job, com atenção especial a bloqueios de conta/billing/Actions entitlement, pois o workflow continua não alcançando sequer o handshake inicial.

### Decisão operacional — CI não bloqueante
- Para evitar novas falhas automáticas sem valor enquanto o GitHub não aloca o runner, o workflow `HortiVitalMix CI` passou temporariamente a aceitar apenas `workflow_dispatch` (execução manual).
- O problema do runner continua registrado como pendência externa de infraestrutura e **não será usado para bloquear as próximas OEs**.
- A aplicação, banco Neon, migrations, frontend e backend continuam sendo tratados normalmente; quando o runner do GitHub voltar a executar etapas, o CI será reativado para `push` e `pull_request`.
- Esta decisão não mascara o problema: ela apenas impede que cada commit gere uma nova execução vermelha que não chega a rodar nenhuma etapa.


## 2026-09-12 — OE-001-002 — Configuração global

### Base normativa aplicada
A implementação segue a OE-001-002 do Manual Mestre Técnico Greenfield v6: marca, contatos, região e parâmetros consistentes; configuração revisionada; GET público sem segredo; escrita administrativa com `platform.configuration.manage`, `expectedRevision`, idempotência e auditoria minimizada.

### Frontend
- Página pública ligada à configuração canônica revisionada.
- Título, idioma, identidade, slogan, localização e contatos usam a mesma versão.
- Criada tela responsiva `/admin/configuracao` com desktop, tablet e mobile.
- Estados observáveis: banco indisponível, salvando, sucesso, conflito de revisão, acesso negado e erro.
- A UI nunca trata falha como confirmação.
- Marca HortiVitalMix e tema principal permanecem protegidos; o painel só edita os campos permitidos.

### Backend
- Contratos compartilhados + Zod para leitura e escrita.
- `GET /api/v1/config` público.
- `PATCH /api/v1/admin/configuration` protegido no servidor por `platform.configuration.manage`.
- Sem principal autenticado real, a escrita retorna 403; nenhum token/admin fictício foi criado.
- Concorrência otimista por `expectedRevision`.
- Idempotência por `commandId`, lock transacional e hash de payload.
- Repetição do mesmo comando não cria nova revisão; reutilização do commandId com payload diferente gera conflito.
- Configuração inválida é rejeitada antes da persistência.

### Neon
- Migration: `0002_oe_001_002_global_configuration.sql`.
- SHA-256: `e8c77e4a32c7006a1d4d8292586b695895b528786021f97c8e54e9bf94a98e68`.
- Aplicada em development e homologation.
- `app_global_config` criada como singleton revisionado.
- `app_audit_events` criada para auditoria append-only da configuração.
- Índices e constraints conferidos nos dois branches.
- Teste real de concorrência em homologation comprovou que duas alterações baseadas na mesma revisão não sobrescrevem uma à outra.
- Prova real de persistência/auditoria em homologation alterou revisão 1→2, registrou auditoria, restaurou contato para NULL em revisão 3 e registrou nova auditoria.
- Estado atual comprovado de homologation: revisão 3, Ariquemes/RO, BRL, contato público nulo.

### Vercel e validação executável
- O erro de importação/build foi investigado e foram encontradas duas falhas reais de compilação: prop obrigatória de `BrandLogo` no estado indisponível e import incorreto de `AppEnvironment`.
- Ambas foram corrigidas na `main`.
- `package.json` passou a fixar Node 22.
- `vercel.json` passou a definir instalação, framework Vite, saída `dist`, região `gru1`, rewrites e gate `npm run check`.
- O commit `28571567aa68813e3cf12d0ab07f3ab19d22b954` recebeu `Vercel: success — Deployment has completed`, comprovando typecheck + build.
- O commit `d548a4d2cce21273f3378e1ba59aa419143f8611` executou o gate completo `npm run check` e recebeu novamente `Vercel: success — Deployment has completed`.
- Como `npm run check` executa typecheck, Vitest e build, a evidência executável exigida pelo Manual v6 foi concluída.
- As regras de banco não dependem apenas do runner: migration, persistência, concorrência, auditoria e idempotência foram comprovadas diretamente no Neon `homologation`.
- O GitHub Actions continua falhando externamente antes do primeiro step (`steps: null`); esse problema de runner permanece registrado, mas não invalida o gate Vercel positivo.

### Gate de homologação
**Aprovado:** frontend, backend, contratos, persistência Neon real, migration, constraints, índices, concorrência, auditoria, segurança pública, idempotência, responsividade, ausência de placeholders/TODO, typecheck, testes e build executados no Vercel.

### Decisão
A OE-001-002 está **HOMOLOGADA**.

A OE-001-003 está **LIBERADA PARA IMPLEMENTAÇÃO**, sem ser marcada como implementada antecipadamente. O registro detalhado permanece em `docs/orders/OE-001-002.md`.


### Hardening complementar — OE-001-002
- Idempotência corrigida para que a repetição do mesmo `commandId` seja reconhecida antes da comparação de revisão.
- Comandos no-op são auditados sem criar revisão artificial.
- Falhas reais do repositório de configuração agora resultam em `503 CONFIGURATION_UNAVAILABLE` e não vazam a mensagem interna do banco.
- Boundary público da configuração permanece estrito e rejeita propriedades privadas inesperadas.
- Testes foram ampliados para idempotência, reutilização indevida de commandId e indisponibilidade do PostgreSQL.
- A integração Vercel foi testada inclusive com um deployment mínimo independente do HortiVitalMix; ela também retornou um deployment em `INITIALIZING` e imediatamente passou a responder `Deployment not found`. Assim, o gate de build permanece pendente por ausência de evidência positiva, e não é classificado como falha comprovada do código.
- A OE-001-003 continua bloqueada até existir execução comprovada de typecheck, testes, build e verificação visual.


### Fechamento formal da OE-001-002 — correção Vercel e homologação
- Vercel voltou a receber o repositório GitHub e o contexto `Vercel` no commit passou de `pending` para `success`.
- O projeto ligado pelo Vercel Bot é identificado no status como `hortvitalmix`.
- Gate homologado: `npm run check` = typecheck + testes + build.
- Commit de evidência do gate: `d548a4d2cce21273f3378e1ba59aa419143f8611`.
- Banco homologado separadamente no Neon branch `br-ancient-meadow-acmkote8`, sem uso de banco em memória para a prova de persistência.
- Responsividade e identidade visual permanecem implementadas para desktop, tablet e mobile conforme as referências fornecidas.
- Limitação residual: a API de leitura do conector Vercel não enumera o novo projeto/deployment, embora o próprio Vercel Bot tenha reportado o deployment como concluído no GitHub. Esse defeito do conector não é convertido em falha do artefato.
- Resultado: **OE-001-002 HOMOLOGADA; OE-001-003 LIBERADA**.


## 2026-09-12 — OE-001-003 — Ambientes

### Resultado
**HOMOLOGADA.**

- development, homologation e production existem como branches Neon isoladas.
- production: `br-royal-block-ac90e4db`.
- Migration `0003_oe_001_003_environments.sql` aplicada nos três ambientes.
- Checksum: `d4ed92b4d50d7944aab2dd06b987e100a236c8bbc0431e6b5aef69de5fe158a3`.
- `app_releases` criada com constraint de ambiente, commit SHA e único release corrente.
- Os três bancos registram o mesmo artefato `170d8b08089de99a8d3b1f38488bc1bf0354d1cc`, cada um com seu próprio ambiente.
- `/api/ready` agora bloqueia banco de ambiente incorreto com 503/mismatch.
- Runtime e migration usam URLs separadas.
- COR 05 para porta vazia resolvida.
- Preview Vercel mapeia para homologation; produção Vercel mapeia para production.
- development/homologation usam noindex; production permite indexação.
- homologation/production aplicam TLS/HSTS e política de cookie secure.
- tokens de teste ficam restritos a development.
- Frontend recebeu aviso responsivo de ambiente fora de production.
- Vercel existente ligado ao GitHub retornou `success` no commit do artefato; `npm run check` cobre typecheck + testes + build.
- Nenhum projeto ou deployment paralelo foi criado para esta implementação.
- A tentativa de marcar a branch production como protected foi recusada pelo Neon por limite do plano; o isolamento da branch permanece ativo.

Registro detalhado: `docs/orders/OE-001-003.md`.

### Gate
OE-001-004 liberada somente após este fechamento formal.


### Correção operacional — Google AI Studio após OE-001-003
- Sintoma observado no preview: tela “Não foi possível consultar a API do HortiVitalMix”.
- Causa: frontend Vite dependia de proxy para um segundo backend em `localhost:3001`, processo que o preview do Google AI Studio não garante expor.
- Correção: Vite passou a montar a aplicação Express canônica no mesmo processo e mesma origem durante desenvolvimento.
- `npm run dev` agora é processo único para frontend + backend.
- Nenhum mock, API simulada ou credencial foi introduzido.
- Sem Neon configurado no preview, a apresentação funciona e informa corretamente banco indisponível; readiness permanece 503.
- Vercel continua usando exclusivamente a Function `api/index.ts`; nenhum projeto/deployment paralelo foi criado.
- Teste específico do preview local adicionado.

# Volume 01 — Trilha 02 — Registro de implementação e validação

Fonte normativa: **MANUAL MESTRE TÉCNICO v10 — TRILHAS 01 A 06**.

## Escopo

Trilha 02 — **Configuração Global Revisionada e Auditoria Imutável**.

A implementação foi aplicada de forma aditiva sobre o checkpoint canônico pré-Trilha 02, preservando:

- Conta pública separada de Administração;
- Consumer, Producer, Admin e Super Admin por papel real;
- mesmo CPF em Consumer/Producer sem duplicação de identidade;
- Google AI Studio via `/_hvm_api`;
- recuperação, confirmação e código de segurança vinculados ao papel;
- migration de segurança por papel do schema 13;
- Supabase canônico `xipbsazvymkqqfmfegwu`;
- estratégia gratuita sem GitHub Actions obrigatória.

## Backend

Implementado:

- `ConfigurationService` transacional em isolamento `SERIALIZABLE`;
- lock consultivo de comando e singleton;
- `expectedRevision` com resposta de conflito;
- idempotência por `commandId` e hash de payload;
- escrita de configuração e auditoria na mesma transação;
- redação de PII antes da persistência na auditoria;
- reautenticação recente de 15 minutos vinculada ao último login real;
- middleware de Super Administrador;
- proteção de origem para mutações;
- request ID e hash de IP;
- GET/PATCH de configuração administrativa;
- logs estruturados sem exposição de segredo/PII.

## Frontend

Implementado em `/admin/configuracao`:

1. loading/skeleton;
2. ready;
3. empty;
4. erro recuperável;
5. fluxo de mutação com sucesso, conflito 409 e reautenticação 401.

A tela mostra revisão atual, permite editar somente os campos do contrato canônico e não aceita campos administrativos injetados pelo cliente.

Acesso visual é oferecido em `/minha-conta` somente quando `activeRole === platform_super_admin`; a autorização continua sendo decidida no backend.

## Design e responsividade

Referências aplicadas:

- verde escuro `#143D24`;
- verde principal `#1B4D2E`;
- verde folha `#2E7D32`;
- verde claro `#E8F5E9`;
- cartões brancos, bordas suaves, cantos arredondados e hierarquia visual equivalente às referências desktop/mobile;
- breakpoint mobile abaixo de 768 px;
- ajuste extra abaixo de 360 px;
- E2E específico em 320, 360, 768 e 1440 px;
- prevenção de overflow horizontal.

## Supabase

Migration aplicada no projeto canônico:

`20260921193244_trilha02_config_hardening`

Efeitos:

- adiciona `app_global_config.updated_by UUID NULL`;
- assegura ausência de policy de escrita para `authenticated`;
- mantém índice único parcial de `command_id`;
- adiciona índice parcial de auditoria para `app_global_config`;
- não reescreve nenhuma migration anterior.

Estado estrutural verificado após aplicação:

- `updated_by`: presente;
- `uq_app_audit_events_command_id`: presente;
- `ix_app_audit_events_config_target`: presente;
- policies de escrita em `app_global_config`: **0**;
- tabelas com RLS habilitado e forçado: **9**;
- singleton `app_global_config`: **1**.

Schema lógico: **14**.

Hash canônico das 14 migrations:

`4df210ea6d4cdb05280f33889280edb1411532b0f24f5da8f7044110ef2617dc`

## Testes canônicos da Trilha 02

Total: **31 casos** em oito arquivos:

| Bloco | Casos |
|---|---:|
| Contrato de configuração | 9 |
| Redação de PII | 4 |
| Concorrência | 2 |
| Idempotência | 3 |
| Auditoria | 3 |
| Reautenticação | 3 |
| RLS | 3 |
| Payloads maliciosos | 4 |
| **Total** | **31** |

Há cobertura E2E adicional para responsividade, loading mínimo, erro recuperável, conflito 409 e sucesso.

## Política de integração real

O único Supabase disponível é o projeto canônico. Por segurança e conforme a governança já registrada, testes que criam identidades/fixtures são fail-closed nesse projeto e exigem ambiente development isolado.

A validação estrutural read-only foi executada no projeto canônico. Testes mutacionais reais devem ser executados somente quando existir ambiente isolado permitido pelo Livro Raiz.

## Vercel

- `main` é a única branch com deploy automático;
- build usa Node 24 e `npm ci`;
- `npm run build` usa `typecheck:app` + security check + Vite + bundle check;
- `/admin/configuracao` usa `no-store`;
- não há novas variáveis obrigatórias da Trilha 02;
- o commit integrado à `main` recebeu status **Vercel = success** com a descrição **"Deployment has completed"**;
- a release production `trilha02-v1` foi registrada em `app_releases` com schema 14 e hash canônico;
- o conector Vercel disponível ao ChatGPT não lista diretamente o projeto, então a evidência de deployment é o status oficial da integração Vercel publicado no commit GitHub.

## Checklist técnico

- [x] Backend implementado
- [x] Frontend implementado
- [x] Design aplicado
- [x] Responsividade coberta por E2E
- [x] Supabase atualizado
- [x] Migration/manifest sincronizados
- [x] 31 testes canônicos versionados
- [x] Build de produção protegido contra fontes de teste
- [x] Sem alteração regressiva nos fluxos pré-Trilha 02
- [x] Auditoria final A1–A18 aprovada no Supabase canônico
- [x] Release production `trilha02-v1` registrada
- [x] Deployment Vercel da `main` confirmado com status `success`
- [x] Livro Raiz atualizado e fechado

> Testes mutacionais que criam identidades/fixtures permanecem deliberadamente fail-closed contra production e só podem ser executados em ambiente development isolado. Não foram executados no projeto canônico para preservar a governança de segurança já registrada.

## Selagem gratuita - fechamento definitivo

Por determinacao do proprietario, nenhum branch Supabase cobrado e criado. Development e homologation passam a ser ambientes Supabase locais efemeros e independentes em runner GitHub-hosted padrao, enquanto production permanece no projeto canonico unico.

O workflow `.github/workflows/trilha02-free-seal.yml` foi adicionado para executar, em cada ambiente local, snapshot logico anterior a T02, aplicacao da migration T02, `verify:foundation` A1-A18, os 31 casos canonicos, build e release efemera. A tag `trilha02-v1` so e criada depois desses gates e de **Vercel = success** no mesmo SHA.

Em production foi executada prova mutacional transacional com `ROLLBACK`: bump de revision, unicidade de `commandId` e imutabilidade da auditoria passaram; o estado persistido permaneceu `revision=1`, slogan canonico e `audit_count=0`.

O snapshot remoto pre-migration de production nao e fabricado retroativamente. A excecao gratuita e documentada com historico/hash das migrations, fingerprint estrutural e prova de rollback. Detalhes: `docs/TRILHA02_FREE_TIER_SEAL.md`.

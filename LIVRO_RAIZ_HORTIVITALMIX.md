# Livro-Raiz HortiVitalMix

## Fonte de autoridade

- Manual: **MANUAL MESTRE TÉCNICO GREENFIELD v7 (MÓDULO v7)**.
- Regra de execução: fatias verticais casadas; banco, backend, frontend e navegação evoluem juntos.
- Dados fictícios, respostas simuladas e sucesso forçado são proibidos.

## Ambientes oficiais

| Ambiente | Neon branch | Estado |
| --- | --- | --- |
| Desenvolvimento | `development` (`br-lingering-haze-ac1jsgp8`) | Criada |
| Homologação | `homologation` (`br-twilight-darkness-aclggben`) | Criada |
| Produção | `production` (`br-falling-sunset-acc583ns`) | Criada |

Projeto Neon: `HortiVitalMix` (`flat-bonus-20719397`), PostgreSQL 17, região `aws-sa-east-1`.

## Volume 01 — Trilha 1

Status: **implementada; publicação de preview pendente de disponibilidade/cota externa**.

Entregas incorporadas:

- Runtime único Vite + Express no desenvolvimento.
- API de liveness, readiness e configuração pública.
- Atualização administrativa com revisão otimista, permissão de fundação e auditoria.
- Migration `0001_trilha1_foundation_and_config.sql` com histórico, releases, configuração singleton e auditoria append-only.
- Shell global responsiva, navegação SPA, header desktop, header mobile, bottom navigation e estados reais de dependência.
- Paleta, tipografia e estrutura visual alinhadas às referências desktop/mobile homologadas.
- Configuração Vercel versionada sem segredos.

## Critérios de fechamento

- [x] Migration aplicada e verificada primeiro em `development` (versão 1, checksum `547fc051791a36aa39e6803681968dfe9e2282e581f580bf9693588c66c1bb19`).
- [x] Typecheck sem erros.
- [x] Testes automatizados sem falhas.
- [x] Build de produção concluído.
- [x] Inspeção visual em 360 px, 768 px e 1440 px, sem scroll horizontal ou ruptura estrutural.
- [ ] Commit publicado no GitHub e deployment de preview inspecionado, quando houver cota.

### Evidência e limitações do ambiente de execução

- O endpoint `/api/health` respondeu `200` com `x-request-id`.
- O ambiente local desta execução bloqueou a resolução DNS externa do host Neon; `/api/ready` respondeu corretamente `503`, sem sucesso forçado. A estrutura e os dados foram conferidos pela conexão oficial do Neon.
- A configuração de produção exige `DATABASE_URL`, `APP_ENV`, `APP_RELEASE` e `PLATFORM_CONFIG_ADMIN_TOKEN` definidos como variáveis protegidas na Vercel; nenhum valor real foi versionado.

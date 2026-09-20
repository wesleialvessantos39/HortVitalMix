# Estratégia Free de Ambientes — Trilha 01

Data: 2026-09-19.

## Decisão autorizada

O proprietário determinou que **nenhuma Supabase Preview Branch paga** seja criada e que a homologação prossiga exclusivamente com recursos gratuitos.

O Manual Mestre Técnico v10 define a topologia oficial `dev | homolog | main` por branches Supabase. Nesta execução, essa topologia é substituída por **projetos Supabase isolados**, com credenciais próprias, mantendo a mesma separação lógica e a mesma ordem de promoção.

Esta é uma **errata operacional de custo**, não uma alegação de que projetos independentes sejam literalmente Preview Branches.

## Rotação por cota Free

A organização Free limita a execução a dois projetos ativos simultaneamente. A promoção usa rotação:

| Ambiente | Projeto | Project ref | Estado operacional |
| --- | --- | --- | --- |
| development | HortVitalMix-Development | `ldtcsrlxfpflzhnbjjnp` | ativo durante dev/homolog |
| homologation | HortVitalMix-Homologation | `vcbcbbnbboxoimqmuibm` | ativo durante dev/homolog |
| production | HortVitalMix | `xipbsazvymkqqfmfegwu` | pausado temporariamente durante dev/homolog; deve ser restaurado para a fase production |

Fluxo sem custo:

1. manter development + homologation ativos;
2. validar development;
3. validar homologation;
4. pausar development após registrar evidências necessárias;
5. restaurar production;
6. executar a fase production;
7. não criar nenhuma branch paga.

## Regras de segurança

- Credenciais nunca são compartilhadas entre ambientes.
- `referência protegida de production` continua apontando para `xipbsazvymkqqfmfegwu`, mesmo quando production estiver pausado.
- Testes destrutivos/fixtures só podem executar contra development.
- Homologation não é tratado como production e não recebe testes destrutivos.
- Nenhuma release é registrada até os gates correspondentes serem efetivamente aprovados.
- A pausa de production não muda sua identidade nem converte outro projeto em production.

## Estado verificado

### Development

- 8 migrations aplicadas.
- schema lógico v8.
- hardening documental aplicado.
- A1–A15 aprovados.
- RLS transacional por identidade aprovado.
- auditoria append-only aprovada.
- unicidade de `command_id` aprovada.
- teste transacional revertido com zero resíduos.

### Homologation

- 8 migrations aplicadas.
- schema lógico v8.
- hardening documental aplicado.
- A1–A15 aprovados.
- documentação de tabelas/colunas sensíveis: zero pendências.
- teste transacional revertido com zero resíduos.
- bucket `documents` privado.

### Production

- projeto original preservado e temporariamente pausado para liberar uma vaga Free.
- schema v8 já havia sido verificado antes da pausa.
- nenhuma release `trilha01-v1` foi registrada.
- deve ser restaurado somente após os gates de dev/homolog.

## Limitações ainda abertas

A estratégia Free resolve o custo do isolamento, mas **não elimina** os demais gates do Manual: Node 24, cobertura medida, suíte completa, Vercel READY, `verify:deploy`, releases e evidência de snapshot/backup por ambiente.

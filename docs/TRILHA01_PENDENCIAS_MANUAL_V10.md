# Atualização de execução — 2026-09-19

O proprietário autorizou seguir com a implementação após a proposta E01–E06. As seis correções foram incorporadas. O registro original abaixo permanece como histórico, não como status atual. Resultados atuais: [TRILHA01_VALIDACAO.md](TRILHA01_VALIDACAO.md).

Ajustes técnicos adicionais necessários para executar a intenção do manual:

- O índice de auditoria com predicado `now()` foi substituído por índice composto de data/ação: PostgreSQL exige expressões imutáveis no predicado. Índices duplicados sobre chaves já indexadas foram evitados.
- `SET LOCAL app.ip_pepper = $1` foi substituído por `set_config(..., true)` com parâmetro, forma aceita pelo PostgreSQL.
- Helpers não aceitam identidade do cliente; execução anônima revogada, contas suspensas não resolvem papel ativo. Grants de coluna protegem governança.
- Sessões verificam revogação, expiração de papéis e existência em auth.sessions, sem confiar em user_metadata.
- Flags de integração passaram a ser requisito explícito do gate: testes pulados não homologam a trilha.
- Identificadores de migrations foram gerados pelo CLI e sincronizados aos timestamps registrados pelo conector na aplicação, preservando o conteúdo aplicado.

A ausência dos três ambientes e das credenciais de execução continua impeditiva para homologação final. Nenhuma contratação foi feita.

---

# Trilha 01 — verificação inicial e proposta de errata

Data: 2026-09-19. Estado: proposta pendente de decisão; não é implementação nem homologação.

## Autoridade e limites da revisão

Fonte: `MANUAL MESTRE TÉCNICO v10.pdf`, 1.059 páginas, anexado pelo proprietário. As páginas abaixo são posições físicas do PDF, contadas a partir de 1. A revisão inicial concentrou-se na Trilha 01 e em seus critérios de aceite; não equivale a uma auditoria integral das seis trilhas.

O proprietário determinou execução literal, sem decisões que contrariem o manual. As correções abaixo são propostas explícitas, ainda não aplicadas ao PDF, ao código ou ao banco. Nenhuma release pode ser declarada homologada nesta etapa.

## Estado observado

- GitHub: `wesleialvessantos39/HortVitalMix`, branch padrão `main`, inicialmente vazio, com acesso de escrita disponível.
- Supabase: projeto `HortVitalMix`, ref `xipbsazvymkqqfmfegwu`, ativo; organização em plano Free.
- Consulta do schema `public`: nenhuma tabela retornada.
- Consulta de branches: nenhuma branch retornada. Não há evidência de ambientes `dev` e `homolog` provisionados.
- Dois HTMLs de referência localizados; cabeçalhos e tokens visuais examinados. Cinco PNGs de apresentação visualizados. As imagens incluem conceitos de negócio de trilhas futuras, que não devem ser declarados funcionais na Trilha 01.
- Nenhuma migration, alteração de Auth, Storage, credencial ou implantação Vercel executada.

## Divergências e correções propostas

| ID | Evidência no manual | Efeito da execução literal | Correção proposta para decisão |
| --- | --- | --- | --- |
| E01 | P. 68 exige migrations com timestamp; p. 136 converte `MAX(version)` em número e grava em `schema_version`; p. 70 define esse campo como `INTEGER`. | Um timestamp como `20260101000008` excede o limite de INTEGER PostgreSQL e não representa a versão lógica 8. O registro da release falharia. | Manter identificadores de migrations como texto; definir versão lógica em manifesto ordenado, validando os oito arquivos aplicados, e gravar 8 ao fechar a Trilha 01. Não usar simplesmente o total de migrations alheias à trilha. |
| E02 | P. 156 e p. 248 usam `--schema=1`; p. 252 determina schema final 8 e evidências com versão 8. | O mesmo deployment não passa simultaneamente nas duas expectativas. | Unificar os comandos e os critérios finais da Trilha 01 em versão lógica 8, conforme seu fechamento. |
| E03 | P. 94: `users_self_update` restringe a linha por usuário, sem restringir campos; p. 96 faz o equivalente no perfil de produtor. P. 91 determina que RLS seja a fronteira primária. | Se houver privilégio UPDATE de tabela para authenticated, o acesso direto à Data API poderá modificar campos próprios de governança, como status, nível de confiança e verificação. A policy de linha não protege colunas. Trata-se de risco no desenho proposto, não de exploração constatada: as tabelas ainda não existem. | Restringir privilégios de atualização às colunas de autoatendimento e/ou acrescentar proteção no banco contra alterações em campos de governança. Testar com JWT real tentativas de alterar status, autorização, verificação e confiança. Não depender exclusivamente do Express. |
| E04 | P. 68 exige RLS na migration que cria cada tabela, mas os scripts da Parte 2 deixam ENABLE/FORCE para a migration 0005. | A sequência literal cria tabelas antes da proteção exigida pelo próprio manual. | Habilitar e forçar RLS em cada migration de criação; acrescentar as policies na etapa definida, preservando o bloqueio por padrão entre etapas. |
| E05 | P. 86 espera erro de trigger ao apagar auditoria filtrando por um UUID aleatório. | Um DELETE que não encontra registros não dispara trigger FOR EACH ROW. O teste não comprova imutabilidade. | Inserir evento de teste dentro de transação, tentar UPDATE e DELETE daquele ID, exigir SQLSTATE 42501 e encerrar por rollback, sem resíduos. |
| E06 | O parser de `release-current.ts` da Parte 3 busca argumentos separados, mas as instruções usam `--tag=...`, `--environment=...` e `--sha=...`. | O script não encontra os argumentos apresentados no próprio runbook. | Aceitar tanto `--flag valor` quanto `--flag=valor`, com validação dos argumentos obrigatórios. |

As propostas preservam as intenções expressas de isolamento, versionamento e segurança, mas alteram exemplos literais; por isso não foram silenciosamente incorporadas.

## Ambientes e custos

A p. 30 exige `dev`, `homolog` e `main`, com credenciais distintas. A Parte 5 exige promoção sequencial development → homologation → production. Não é equivalente criar três linhas de ambiente no mesmo banco, nem três schemas compartilhando Auth e Storage.

A documentação oficial informa cobrança pelo uso de branches; não há base para prometer essa estrutura sem custo. Nenhuma contratação ou criação de recurso pago foi feita.

- Referência oficial: https://supabase.com/docs/guides/deployment/branching
- Cobrança: https://supabase.com/docs/guides/platform/manage-your-usage/branching

Decisão necessária: manter a topologia literal e providenciar os ambientes correspondentes, ou revisar formalmente o manual para uma topologia compatível com o orçamento. Uma eventual alternativa ainda precisa de desenho e aprovação; não está implementada nem homologada aqui.

## Sequência de implementação após resolução

1. Consolidar a errata aprovada e os identificadores dos três ambientes.
2. Construir backend e frontend conjuntamente: Express montado no Vite, contratos compartilhados, pooler transacional, clientes Supabase e shell responsiva integrada à configuração real.
3. Produzir e validar migrations 0001–0008, RLS, triggers, índices e seeds canônicos; aplicar primeiro em development.
4. Executar testes de contrato, integração com Supabase real e interface em 320, 360, 430, 768, 1024 e 1440 px. Teste pulado não vale como aprovado.
5. Validar segurança, build, gate de homologação e promoção sequencial; registrar SHA, hash de migrations e releases reais.
6. Atualizar Livro Raiz, GitHub e configuração Vercel. Cota indisponível mantém deploy pendente, nunca homologado por suposição.

## Checklist deste bloco preparatório

- [ ] Backend implementado — não iniciado; decisões acima pendentes.
- [ ] Frontend implementado — não iniciado.
- [ ] Design desktop/mobile aplicado — referências examinadas, aplicação pendente.
- [ ] Responsividade validada — sem aplicação executável para testar.
- [ ] Supabase atualizado — inspeção somente; nenhuma migration aplicada.
- [x] Livro Raiz criado — registro inicial com estado real, sem homologação fictícia.
- [x] GitHub sincronizado — documentação publicada em main; commits iniciais `d00532511aabee9e57b3b41be71fda38a42254d6` e `6cc3d2e4bd606cbb64ec96d0c47488f3461054c7`. Não representa entrega de código funcional.
- [ ] Pronto para Vercel — ainda sem build ou configuração de ambiente.
- [ ] Conformidade integral — bloqueada pelas divergências documentadas; revisão inicial concluída.

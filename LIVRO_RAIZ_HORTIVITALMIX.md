# Livro Raiz — HortiVitalMix

## 2026-09-19 — Trilha 01: implementação da fundação e verificação parcial

Status: **implementada em código e banco existente; não homologada integralmente**.

### Fonte de autoridade e autorização

Manual Mestre Técnico v10, Trilha 01, referências HTML desktop/mobile e imagens anexadas. O proprietário autorizou seguir com as correções documentadas e solicitou continuar até homologação final. Não autorizou contratação de recursos pagos.

### Escopo implementado

- React/Vite com Express montado na mesma origem e porta; adaptador serverless Vercel.
- Contratos Zod de saúde, readiness, configuração pública, cadastro PF e produtor; CPF com DV, email normalizado e telefone E.164.
- Cadastro público limitado a consumer/producer, transação de domínio e compensação no GoTrue; login, refresh, sessão e logout com cookies HttpOnly, SameSite e Secure fora de development.
- Sessão validada por Supabase getUser, estado da conta, sessão viva no Auth e papéis não revogados/expirados.
- Shell responsiva, navegação, formulários ligados à API e fallback visual não bloqueante; catálogo/compras/endereços continuam fora desta trilha.
- Oito migrations, oito tabelas com ENABLE/FORCE RLS, grants de coluna, helpers, auditoria append-only, singleton, índices, seeds canônicos e Storage privado.
- Manifesto com versão lógica 8; hash determinístico; scripts de preflight, fundação, release e verificação de deploy.

### Migrations aplicadas

Projeto: `xipbsazvymkqqfmfegwu`. Timestamps remotos sincronizados ao repositório sem alteração do SQL aplicado.

| Versão remota | Migration |
| --- | --- |
| 20260919030126 | foundation_releases |
| 20260919030128 | identity_roles |
| 20260919030130 | global_config_audit |
| 20260919030132 | helper_functions |
| 20260919030134 | rls_policies |
| 20260919030136 | indexes_performance |
| 20260919030138 | seeds_canonical |
| 20260919030140 | auth_delete_mirror |

Versão lógica: **8**. Hash: `59bf7dfa8bbfe0ae4bd9e58bf03bf9b243159fe78ac9f38175d3c848b55549d6`.

### Evidências

Typecheck e build aprovados; 23 testes unitários/HTTP e 7 testes Playwright aprovados. SQL real com rollback aprovado. Viewports 320/360/430/768/1024/1440 sem overflow horizontal. Nenhum usuário, pessoa ou evento de teste persistiu. Detalhes em [TRILHA01_VALIDACAO.md](docs/TRILHA01_VALIDACAO.md).

### Pendências impeditivas de homologação final

- Credenciais do pooler/Admin API não estão disponíveis no runtime Node. Preflight falha; três testes de integração estão pulados.
- Ambientes dev/homolog/main separados ainda não provisionados. A aplicação no projeto existente não representa promoção homologada.
- Conta Vercel conectada não retornou projetos; URL/variáveis/deployment ainda não configurados.
- Confirmação de e-mail, backups reais, release por ambiente e verificação pós-deploy pendentes.
- Advisor da função preexistente `rls_auto_enable` requer revisão administrativa. Helpers de autorização autenticados possuem search_path e escopo da própria identidade.

### Checklist da entrega

- [x] Backend escrito e endpoints locais testados; integração externa completa pendente.
- [x] Frontend escrito e ligado aos contratos da API.
- [x] Padrão visual dos HTMLs aplicado ao shell desktop/mobile.
- [x] Responsividade validada por navegador em seis viewports.
- [x] Supabase atualizado no projeto existente; três ambientes pendentes.
- [x] Livro Raiz atualizado.
- [ ] GitHub: confirmar publicação do commit desta entrega.
- [ ] Vercel integralmente pronta: build/configs preparados, projeto e segredos pendentes.
- [ ] Conformidade/homologação integral: não aprovada enquanto os gates externos estiverem pendentes.

### Release e transição

Nenhuma linha de release, tag de homologação ou snapshot fictício criada. Permanecer na Trilha 01. Não iniciar a Trilha 02.

---

## 2026-09-19 — Volume 01 / Trilha 01: abertura e verificação inicial

Status: **iniciada a análise; implementação e homologação pendentes**.

### Fonte de autoridade

- MANUAL MESTRE TÉCNICO v10 — Trilhas 01 a 06, PDF fornecido pelo proprietário.
- Escopo solicitado: somente Volume 01 / Trilha 01.
- Instruções vigentes: implementação full-stack, Supabase, referências visuais fornecidas, responsividade, GitHub e preparação para Vercel.
- A menção a v7 no modelo de registro do PDF é histórica; esta entrada identifica corretamente o arquivo v10 recebido.

### Escopo implementado

Somente documentação inicial e diagnóstico de pré-requisitos. Nenhuma funcionalidade de backend ou frontend foi entregue. Nenhum ambiente foi homologado.

### Evidências observadas

- Repositório identificado: `wesleialvessantos39/HortVitalMix`; inicialmente vazio; acesso de escrita disponível.
- Projeto Supabase identificado: `HortVitalMix` / `xipbsazvymkqqfmfegwu`; ativo; organização Free.
- Schema public sem tabelas retornadas; consulta de branches sem branches retornadas.
- Arquivos de referência presentes: manual, dois HTMLs e cinco PNGs.
- Foram examinados trechos técnicos e critérios de aceite da Trilha 01, cabeçalhos dos HTMLs e cinco imagens. Não há alegação de auditoria integral do Volume 01.

### Decisões pendentes e riscos identificados

A proposta em [docs/TRILHA01_PENDENCIAS_MANUAL_V10.md](docs/TRILHA01_PENDENCIAS_MANUAL_V10.md) detalha seis divergências, com páginas e correções propostas: versão de schema versus timestamp, gate schema 1 versus 8, proteção de campos sensíveis, momento de ativação do RLS, teste de imutabilidade e parser de argumentos da release.

Os ambientes separados exigidos pelo manual não foram provisionados. A cobrança de branches precisa ser resolvida antes da criação; não houve autorização de gastos nem contratação.

### Migrations aplicadas

Nenhuma nesta execução. Schema da aplicação: ainda não estabelecido. Não registrar versão 8 antes de aplicar e verificar as oito migrations previstas.

### Evidência de homologação

| Ambiente | Banco | Testes reais | Release | Snapshot | Deploy |
| --- | --- | --- | --- | --- | --- |
| development | Pendente | Não executados | Ausente | Não criado | Não realizado |
| homologation | Pendente | Não executados | Ausente | Não criado | Não realizado |
| production | Pendente | Não executados | Ausente | Não criado | Não realizado |

### Versionamento

Esta entrada inicia o histórico documental. O SHA verificável é o commit remoto que contém o arquivo; nenhum SHA de implementação ou tag de homologação foi inventado. A publicação deve ser conferida após a gravação remota.

### Limitações conhecidas

Não há aplicação executável, build aprovado, configuração Vercel validada ou teste responsivo concluído. A entrega deste bloco é preparatória e não atende, por si só, à implementação integral solicitada.

### Transição

Permanecer na Trilha 01. Resolver as divergências literais e a infraestrutura antes da homologação. Não iniciar a Trilha 02 nem criar a tag `trilha01-v1`.

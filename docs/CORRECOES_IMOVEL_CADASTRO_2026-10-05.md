# Correções de documentos do imóvel e confirmação do cadastro

Entrega aditiva sobre `main@c8e3957f16ec8013b93b0d2df522db34a6078e83`, T01–T17. A próxima trilha permanece fora do escopo. Fontes: Livro-Raiz e imagem fornecida pelo proprietário em 05/10/2026.

## Comportamento entregue

- Etapa 1 ocupa a largura do cadastro. Desktop distribui envio/lista e documento/dados em colunas; mobile apresenta o original antes dos dados, com identificação larga e áreas em pares quando há espaço. Controles têm área de toque adequada, foco visível e prévia de PDF ajustada quando a largura muda.
- Titular deixa de ser descartado no envio do PDF. Leitura aceita rótulos com quebra de linha e nomes explícitos. Quando o nome está ausente e o CPF não diverge, utiliza o nome da conta do produtor. Dados documentais divergentes continuam disponíveis para conferência; a pessoa cadastrada nunca é reescrita pelo documento.
- Consulta bem-sucedida aos dados salvos antecede a aplicação automática. Reabrir/atualizar o PDF preserva correções. Falha de consulta não autoriza sobrescrever dados; edição iniciada pelo usuário interrompe o preenchimento automático.
- **Salvar correção** grava nova conferência, imóvel e `draft_data` na mesma transação. Atualiza identificação, CAR/CCIR, município, áreas e sede; mantém água, atividade, acesso e outros dados manuais. Área consolidada corrigida pode atualizar a cultivada. Área incompatível ou revisão obsoleta aborta a gravação. Frontend busca o imóvel autoritativo e adota a revisão nas demais etapas. Repetição da tentativa não duplica conferências; mesmo comando com conteúdo diferente é rejeitado.
- Extração original e arquivo permanecem intactos. Leitura efetiva utiliza a última declaração, mesmo se houver conferência textual posterior. Administração e validação de submissão recebem os valores corrigidos. Imóveis aprovados/suspensos continuam protegidos.
- Cadastro novo com aceite explícito usa RPC aditivo que grava pessoa, papel, perfil e consentimento em uma transação, retornando o status do banco. Frontend não espera outra chamada de consentimento nesse caminho.
- Edge envia e-mail com `EdgeRuntime.waitUntil`, após concluir o domínio. Resposta distingue envio agendado de envio aceito. Contingência Express entrega contexto assinado; a página inicia o envio sem bloquear a navegação e sem repetir a tentativa automática na recarga.
- Consumidor/produtor segue no contexto assinado, resposta e URL de confirmação. A tela não pede escolher novamente. Links legados sem perfil utilizam papéis ativos do banco para reenvio, com resposta genérica que não enumera contas. Confirmação de e-mail continua obrigatória e não cria sessão de login.

## Banco e infraestrutura

Migration única: `20261005144950_registration_consent_fast_confirmation.sql`. Cria somente `complete_public_registration_with_consent`; RPC legado, tabelas, dados, policies e histórico anterior não são substituídos. EXECUTE somente `service_role`, `search_path` fixo. Schema lógico **53**, **59 migrations**, SHA-256 **b1889d4aa6b99e721709bdedc4afbdcd68a1d44c65932ea2a36bff9fcf934676**. Este avanço técnico não abre a T18.

Supabase canônico `xipbsazvymkqqfmfegwu`, Vercel Hobby/main/pdx1, RLS ENABLE/FORCE e mutações no backend preservados. Sem serviço pago, dependência nova ou GitHub Actions. Edge pública mantém `verify_jwt=false` já homologado; operações privilegiadas continuam no servidor.

## Verificação

- Suíte geral: **652 passaram**, 176 dependentes de ambiente não executados nessa suíte. Build, TypeScript da aplicação, manifesto, segurança cliente/bundle e cold start aprovados.
- PostgreSQL 17 local, 59 migrations: **9 passaram**, incluindo cadastro consumidor/produtor com consentimento, confirmação obrigatória, isolamento, concorrência/replay, rollback e histórico imutável. História completa React/HTTP/PostgreSQL em mobile com toque real e desktop comprova correção, etapas 2/3, recarga e preservação ao atualizar o PDF. Somente provedores externos Auth/Storage foram adaptados nessa história; domínio e persistência são reais.
- Browser: **46 passaram** em cadastro/documentos/T03/T04/T17; outros **28 T08** passaram na regressão. Três seletores antigos T03/T04 foram atualizados para a interface existente na base (entrada pelo menu Conta, seletor administrativo, texto de link indisponível). Essas interfaces não foram recriadas.
- Regressão T17 com PostgreSQL real: **18 passaram**, incluindo isolamento, idempotência e gates comerciais.
- Edge executada em harness: consumidor/produtor respondem após o commit sem aguardar provedor de e-mail pendente. Navegação controlada de ambos em 390/1440px comprovada abaixo de 10 segundos. Isso valida a retirada das esperas da aplicação; Auth/rede e entrega de e-mail não têm garantia absoluta de 10 segundos. Nenhuma conta sintética foi criada na produção.
- Preservação remota e publicação são registradas no fechamento e no arquivo de evidências, somente com contadores/hashes, sem dados pessoais.

## Fechamento de produção

- [PR #79](https://github.com/wesleialvessantos39/HortVitalMix/pull/79) integrada; SHA funcional **9a5ab52ab84ef9edc800fa3b867444be9e658e84**, árvore **390c3438061095b6c047bdcb7cd9a62c2cf71644** igual à validada localmente. Deployment **dpl_E8kGj3PLEf7A1c9dqS9aaLDa84Ls**, **READY**, production/**main/pdx1**. Health/ready/config aprovados na SHA exata, schema 53. Release funcional **correcoes-imovel-cadastro-v53-9a5ab52**; a SHA documental final será sincronizada após seu próprio READY.
- RPC aplicado como versão física **20261005152423**, com alias para **20261005144950**. Conferência remota: 59 migrations; EXECUTE negado a anon/authenticated e permitido a service_role; nenhuma tabela app sem RLS ENABLE/FORCE. Edge `public-registration` **v10 ACTIVE**, arquivo anterior conferido idêntico à main antes da publicação. Nenhum aviso novo de segurança/desempenho.
- Snapshots de **61 relações**: **57** idênticas à leitura inicial. Entre a leitura inicial e a pós-migration, auditoria e conferências cresceram, e imóvel/Auth.users apresentaram diferenças de hash. A auditoria registra atividade concorrente de declaração/prévia no fluxo já publicado entre 14:51 e 15:22, anterior à migration de 15:24, que cria somente um RPC. Essas diferenças são preservadas/documentadas; não foram tratadas como fixtures nem revertidas. Snapshot pós-migration e pós-publicação foi **idêntico nas 61 relações**. Arquivos, extrações originais, identidades, lojas, papéis e demais relações mantiveram hashes/contagens. Evidência: `CORRECOES_IMOVEL_CADASTRO_PRESERVACAO.json`.
- Produção: confirmação consumidor/produtor em **320/390/768/1440px**, sem combobox de perfil, overflow ou erro JS. Validações inválidas de cadastro/Edge e contexto de confirmação foram exercitadas sem criar conta; documentos/favoritos privados exigem autenticação e descoberta T17 continua pública. História de edição autenticada permanece comprovada no PostgreSQL local, preservando usuários/arquivos reais. Logs error/fatal do deployment, janela 5 min, sem ocorrências.

Entrega concluída. T18 continua fora do escopo; sua futura base é o schema lógico 53.

# Notificações, painel e interface — verificação de 8 de outubro de 2026

As notificações agora seguem o fluxo **sino → prévia → Mostrar mais → central → explicação → ação explícita**. O clique no aviso não envia diretamente a outra área. O contador usa o total global não lido, mesmo quando a central está filtrada. Consumidor, Produtor, Administrador e Super administrador recebem categorias e explicações compatíveis com o papel ativo, o proprietário e os poderes atuais.

## Entrega verificável

| Área | Comportamento entregue | Comprovação |
| --- | --- | --- |
| Notificações | Sino no cabeçalho, prévia de cinco avisos, central compacta, detalhe com evento/motivo/próximo passo, leitura persistida e ação autorizada | 14 cenários de interface; 48 cenários de contrato, HTTP e SQL; história completa em navegador com Express e PostgreSQL local |
| Painel administrativo | 36 indicadores em nove departamentos; auditoria global adicional somente para Super administrador com todos os poderes; atualização automática a cada 30 segundos, ao voltar à tela e por eventos locais | 21 testes unitários, cinco testes SQL e 12 cenários de interface; [fórmulas e limites](AUDITORIA_PAINEL_ADMINISTRATIVO_2026-10-08.md) |
| Configuração Global | Visão Operacional transferida ao painel; abas Identidade, Operação e Suporte, oito campos canônicos, prévia, revisão e preservação da edição durante sincronização | Cenários existentes de configuração e novos casos de painel, validação entre abas, falha de atualização e conflito |
| Navegação | Menu administrativo agrupado, todas as áreas acessíveis e sino fora da lateral; alvos mobile de 44px; alturas muito pequenas preservam rolagem necessária | Cenários de navegação, sessão, governança e contas em mobile/desktop |
| Categorias públicas | Grade mobile de duas ou três colunas, nomes completos e nenhuma rolagem horizontal | Seis categorias em 320/390px, seleção preservada e verificação de largura/alvos |
| Carregamento | Skeleton compartilhado, equivalente ao padrão de configuração, com movimento reduzido; dados existentes permanecem visíveis durante atualização quando o contexto não mudou | [Inventário de 45 indicadores em 42 arquivos](CARREGAMENTO_PADRONIZADO_2026-10-08.md) |
| Aplicativos | Área Android e iPhone/iPad na página inicial com “Em breve”, sem links fictícios | Revisão visual em 320/390/768/1440px; empacotamento e URLs das lojas ainda não existem |

As melhorias de mídia e o ciclo excluir/reenviar/limpar convites já publicados em #101/#102 estão consolidados no [Livro Raiz](../LIVRO_RAIZ_HORTIVITALMIX.md). Conteúdo longo continua rolável; o objetivo é remover excesso de espaço e rolagem artificial, mantendo acesso ao conteúdo e zoom.

## Permissões e banco de produção

A revisão encontrou notificações administrativas antigas com `required_sector` nulo, visíveis mesmo após retirar o poder da área de origem. A migration aditiva `20261008220225_notification_origin_permissions.sql` estabelece a mesma origem para API e RLS, preserva avisos pessoais sem setor e adiciona uma política SELECT restritiva. O helper privilegiado é privado, vinculado a `auth.uid()` e usa `search_path` vazio; `anon` não pode executá-lo. O detalhe, a lista, o contador e as ações de leitura aplicam as mesmas regras.

Aplicação confirmada no projeto Supabase `xipbsazvymkqqfmfegwu`, versão física `20261008220740`, reconciliada pelo manifesto: **schema 66, 73 migrations**, hash `11cfaf481196044d3a52bb078413c507285d6a112cc74bc37813ce57ee6bd8b9`.

Contagens e digests de notificações, exceções de poderes e atribuições de papéis ficaram idênticos antes/depois. Não foram criados convites, contas ou notificações de teste em produção. Advisors mantiveram os cinco WARN de segurança e 25 WARN de desempenho anteriores, sem WARN adicional. [Evidência resumida](evidence/notificacoes-painel-2026-10-08/supabase-schema66.json).

## Validação final local

- **568 testes unitários aprovados**, em 61 arquivos.
- **496 cenários de navegador aprovados na consolidação final**. A execução inicial aprovou 477; os 19 restantes passaram nas reexecuções após atualizar expectativas antigas e estabilizar o servidor. Não foram descartados casos. [Resultados por cenário](evidence/notificacoes-painel-2026-10-08/e2e-final-summary.json).
- História completa de notificações em quatro perfis e 320/390/768/1440px: navegador → API real → PostgreSQL local → leitura persistida → retorno ao navegador. Somente o transporte de autenticação/Data API usa adaptador local. Nenhum erro JavaScript. [Evidência](evidence/notificacoes-painel-2026-10-08/notification-postgres-story.json).
- TypeScript, manifesto/histórico, gates obrigatórios do build, análise de segurança, Vite e inspeção do bundle concluídos. Cold start da API aprovado sem `ERR_REQUIRE_ESM`; `git diff --check` limpo.
- Os testes SQL mutacionais recusam banco remoto e usam fixtures sintéticas no PostgreSQL local isolado. Os testes de interface com fixtures comprovam comportamento e não são apresentados como login privado em produção.

A entrega funcional foi integrada na **PR #104**, SHA `8e31858ab452cce022aa4533225d7aee23ad968f`. Deployment `dpl_dk4qbD33oirRKTnDrUyrzua1oZ3G` confirmado READY em Production e no domínio oficial, com release `fix-notifications-v66-8e31858` e schema 66. Passaram **44 combinações de páginas públicas/viewport e 19 verificações HTTP/worker**, sem erros JavaScript, imagens quebradas ou rolagem horizontal. A revisão de logs do deployment, em janela de dez minutos, não retornou grupos error/fatal. [Prova da publicação](evidence/notificacoes-painel-2026-10-08/production-release-proof.json).

O fechamento documental preserva a evidência desta publicação funcional. Uma integração posterior somente de documentos terá seu próprio SHA e release corrente em `/api/ready`; não altera o código comprovado. Os quatro fluxos privados foram validados localmente, e não por login real na produção.

## Pendência externa comprovada

O template local distingue Administrador e Super administrador e está pronto. TinyFish foi reconhecido como instalado após a atualização da conexão, mas esta sessão continua sem ferramenta de navegador autenticado nem leitura/alteração de `config/auth`. A função `tinyfish-free` oferece pesquisa e leitura de páginas públicas. **O template hospedado do Supabase Auth não foi aplicado nem verificado.** [Diagnóstico e alteração exata](CONFIGURACAO_TEMPLATE_SUPABASE_2026-10-08.md). A publicação do frontend não resolve essa configuração hospedada.

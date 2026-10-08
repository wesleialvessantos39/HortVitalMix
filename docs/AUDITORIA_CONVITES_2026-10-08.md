# Auditoria dos convites administrativos — 08/10/2026

O código anterior não atendia ao pedido completo: a emissão e a listagem estavam implementadas, mas não existiam exclusão nem limpeza do histórico. O template de e-mail tinha uma apresentação genérica, sem distinguir Administrador setorial de Super administrador. A expiração invalidava o link no banco, mas deixava a identidade provisória no Supabase Auth; isso podia impedir outro convite para o mesmo e-mail.

## Telas identificadas antes dos ajustes

| Tela | Caminho | Constatação anterior | Ajuste implementado |
| --- | --- | --- | --- |
| Convites administrativos | `/admin/governanca` | Emissão e histórico; sem exclusão/limpeza | Excluir, limpar finalizados, busca por e-mail, filtro de status, confirmação acessível, distinção de papéis |
| Ativação do convite | `/admin/aceitar-convite` e alias `/admin/convite` | Mesmo cartão para ambos os papéis; e-mail longo podia ultrapassar 320 px | Ícone, cor e explicação próprios de cada papel; validade; quebra de e-mail longo; redirecionamento para entrada do papel correto |
| Convite enviado por e-mail | `supabase/templates/invite.html` | Mensagem genérica com CSS no cabeçalho | Layout com tabelas e estilos inline; variantes verde/setorial e roxa/super; setores por nome; botão e instruções de validade |

## Comportamento do ciclo de vida

Excluir um convite ainda não aceito cancela o link e o remove da lista. A identidade provisória Auth é liberada somente se não estiver vinculada a pessoa, principal administrativo, perfil ou atribuição de papel real. A liberação também é tentada antes do próximo envio, inclusive para convites expirados. Nenhuma conta real é apagada por esta operação.

Excluir um convite já aceito remove o convite do histórico e preserva o acesso ativado. Limpar histórico arquiva somente convites aceitos, cancelados ou expirados; os pendentes continuam válidos. O backend considera todos os finalizados do escopo, inclusive os que ultrapassam o limite de 100 itens da listagem.

Como a credencial ativada permanece existente, excluir seu convite aceito não permite criar outra credencial para o mesmo e-mail e portal. O reenvio atendido por esta correção é o de convites não aceitos, cancelados ou expirados, cuja identidade provisória possa ser liberada sem apagar uma conta real.

O arquivamento usa eventos append-only `admin.invite.archived`; a limpeza registra `admin.invite.history_cleared`. Não exige migração nem modifica os eventos de auditoria existentes. Administradores setoriais alteram apenas convites próprios para o mesmo papel; Super administradores mantêm o alcance de governança existente. Novas rotas preservam proteção de origem, sessão, revogação de governança e autenticação recente. `expectedRevision` impede excluir silenciosamente um convite que mudou desde a listagem, e `commandId` permite repetição segura.

A emissão mantém `pg_advisory_xact_lock` durante a entrega e a associação da identidade Auth. O convite só fica visível quando está pronto; outra emissão ao mesmo e-mail aguarda a transação e respeita o convite pendente. O uso de bloqueio de transação evita depender de bloqueios de sessão em conexões com pooling de transação.

## Verificação local

- 14 testes unitários de cancelamento, autorização, revisão, repetição, preservação e falha de Auth.
- 7 testes em Postgres 17 descartável, com todas as migrações e triggers reais. Auth simulado usa outra conexão de banco. Verificados cancelamento, token invalidado, reenvio ao mesmo e-mail, aceite real preservado, conta pública real protegida, limpeza seletiva, repetição e emissão concorrente.
- 10 verificações Playwright: excluir → reenviar → limpar em 320/390/1440 px, apresentação de aceite dos dois papéis nessas larguras e garantia de que uma resposta atrasada da atualização não restaure o convite excluído. Sem transbordamento horizontal com e-mail longo.
- TypeScript do aplicativo e projeto completos aprovados; contratos/guards existentes de governança aprovados.

As verificações não enviaram e-mails reais nem alteraram banco de produção. O teste Postgres é condicionado a `HVM_ADMIN_INVITES_LOCAL_DATABASE_URL` e recusa destinos fora de `127.0.0.1:55432/postgres`. Não foi usado PgBouncer real.

O cancelamento do link permanece efetivo mesmo quando o Auth está indisponível; nesse caso a liberação do e-mail fica pendente e é tentada novamente no próximo envio. Supabase Auth e Postgres não compartilham uma transação: uma queda do processo ou falha de confirmação depois de criar a identidade externa pode deixar uma identidade provisória sem associação persistida. Esse cenário exige reconciliação operacional e não foi reproduzido nesta rodada. A serialização e os testes locais não comprovam recuperação automática de todas as falhas externas.

As prévias dos e-mails em `artifacts/auditoria/email-convite-platform_admin.html` e `email-convite-platform_super_admin.html` são simulações do template com metadados sintéticos e link `example.invalid`. Foram inspecionadas e capturadas em 320/560 px, sem transbordamento. As imagens compartilháveis de 320 px estão em `docs/evidence/auditoria-responsividade-2026-10-08/convite-admin-320-preview.png` e `convite-super-320-preview.png`. Elas não representam um e-mail real recebido.

## Publicação e configuração hospedada

A publicação da aplicação Vercel e a configuração do e-mail são etapas separadas. O HTML em `supabase/templates/invite.html` precisa também ser aplicado ao template **Invite user** do projeto Supabase hospedado via painel ou Management API. A configuração local `supabase/config.toml` não atualiza sozinha o template remoto. Sem essa etapa, e-mails enviados pelo serviço hospedado podem continuar usando a aparência antiga.

No painel do projeto Supabase, abra **Authentication → Email Templates → Invite user** (acesso direto: `https://supabase.com/dashboard/project/<project-ref>/auth/templates`). Defina o assunto como `Convite administrativo | HortiVitalMix`, substitua o corpo pelo conteúdo integral de `supabase/templates/invite.html` e salve. Os placeholders e condições `{{ ... }}` devem ser preservados; o backend fornece os metadados de papel e setores em cada convite. As prévias estáticas com `example.invalid` não devem ser usadas como modelo remoto.

Referência do fornecedor: https://supabase.com/docs/guides/auth/auth-email-templates

# Modelo de convite hospedado — verificação de acesso

**Atualização de 8 de outubro de 2026:** o usuário informou que já configurou o template no painel do Supabase. A investigação abaixo documenta o acesso disponível na rodada anterior; não representa uma nova solicitação para repetir a configuração. O conteúdo hospedado e a entrega de e-mails não foram relidos/testados por automação. A mensagem posterior “Entre novamente para confirmar esta operação” era exibida pelo aplicativo para falhas HTTP 401, inclusive quando a confirmação administrativa de 15 minutos havia vencido, antes do envio ao Supabase. Esse caso é tratado no fluxo de Governança, sem exigir outra alteração do template.

O usuário optou por configurar o modelo diretamente no painel. O [guia completo de configuração](GUIA_CONFIGURAR_CONVITE_SUPABASE.md) reúne o HTML integral, assunto, URLs, condição de SMTP no plano Free e a verificação pelo fluxo de Governança. A investigação de acesso abaixo permanece como histórico; a criação do guia não comprova a aplicação remota do template.

Verificado em **8 de outubro de 2026, 20:51 UTC**, com consultas posteriores às **20:56 UTC** e **21:56 UTC** depois da escolha e confirmação de atualizar as conexões. Projeto: `xipbsazvymkqqfmfegwu`.

## Resultado

O modelo local está pronto em `supabase/templates/invite.html`, com apresentação distinta para Administrador setorial e Super administrador. O assunto definido em `supabase/config.toml` é **Convite administrativo | HortiVitalMix**. A configuração hospedada **não foi alterada nesta verificação**, pois não existe acesso autenticado ao painel ou à configuração Auth pela Management API disponível nesta sessão. Isso também significa que não é possível confirmar qual corpo está atualmente salvo no serviço hospedado.

## O que foi confirmado

- A Edge Function `tinyfish-free` está **ACTIVE**, versão **2**, com `verify_jwt: true`. A leitura da versão hospedada confirma somente as operações `status`, `search` e `fetch`.
- Essa função acessa páginas HTTPS públicas e pesquisas. Ela não abre um navegador autenticado, não preenche formulários e não edita a configuração do Supabase Auth. A chave TinyFish, mesmo configurada no Supabase, não fornece uma sessão do painel Supabase.
- Às 20:51 e 20:56 UTC, o diretório oficial de plugins retornou **TinyFish `installed: false`**. Às 21:56 UTC, depois da atualização de conexões feita pelo usuário, esse mesmo diretório retornou **`installed: true`**. A sugestão de TinyFish já havia sido registrada em 8 de outubro, às 16:41 UTC; não foi criada uma nova sugestão.
- Os métodos Supabase disponíveis permitem SQL, leitura de funções e implantação de funções, mas não incluem leitura/alteração de `config/auth`.
- A verificação atual do ambiente reportou `observations_current: true`, sem credenciais configuradas, identidades externas ou variáveis de autenticação prontas. Não há `SUPABASE_ACCESS_TOKEN` no processo.
- O navegador autenticado não está disponível pelos métodos de controle permitidos nesta sessão. Nenhuma senha, cookie, segredo de função ou conteúdo do Vault foi extraído para contornar essa ausência.
- O envio de convites no servidor fornece `hvm_admin_role`, `hvm_identity_mode` e `hvm_admin_sectors`, usados pelo modelo somente para apresentação. A autorização permanece no fluxo do servidor.

Nenhum e-mail real foi enviado, nenhuma conta foi criada e nenhuma configuração de produção foi modificada durante esta investigação.

Na segunda consulta, a escolha do usuário ainda não havia disponibilizado ferramentas de navegador nem alterado `installed: false` do TinyFish. Na terceira consulta, **a instalação passou a ser reconhecida pelo diretório**, mas o conjunto de ferramentas executáveis continuou sem métodos TinyFish, controle de navegador ou descoberta de ferramentas. O catálogo de skills também não forneceu uma skill TinyFish. Uma leitura isolada de permissões apresentou estado divergente (`not_installed`), portanto ela não comprova que a sessão de execução recebeu a nova conexão. Nenhuma permissão foi modificada.

O ambiente foi novamente observado na revisão **20**, com observações atuais e sem credenciais/identidades externas disponibilizadas. Assim, a pendência concreta agora é **disponibilizar a capacidade de navegador autenticado à sessão de execução**; não é correto repetir que o usuário precisa instalar TinyFish, nem presumir que seus cookies do Supabase já foram compartilhados. Não há evidência de bloqueio por aprovação ou de uma tentativa de salvar o modelo rejeitada pelo Supabase: a ação de edição ainda não pôde ser executada.

## Acesso necessário para concluir por automação

Basta um dos seguintes caminhos autenticados:

1. TinyFish instalado e conectado **nesta conversa**, com uma sessão do painel Supabase autorizada para editar o projeto; ou
2. Uma credencial da Management API disponibilizada ao ambiente por ligação segura, com permissão de leitura e alteração da configuração Auth deste projeto.

Não envie tokens ou senhas em mensagens, no repositório ou no frontend. A chave de API da TinyFish não substitui o acesso à conta Supabase. O token `service_role` do projeto também não substitui uma credencial da Management API.

## Alteração exata e verificação

A [documentação oficial de modelos de e-mail](https://supabase.com/docs/guides/auth/auth-email-templates) define o endpoint:

```text
GET   https://api.supabase.com/v1/projects/xipbsazvymkqqfmfegwu/config/auth
PATCH https://api.supabase.com/v1/projects/xipbsazvymkqqfmfegwu/config/auth
```

O PATCH deve conter somente estes campos, preservando os demais modelos e configurações:

```json
{
  "mailer_subjects_invite": "Convite administrativo | HortiVitalMix",
  "mailer_templates_invite_content": "<conteúdo completo de supabase/templates/invite.html>"
}
```

Depois de salvar, repetir o GET e comparar o assunto e o corpo integral com o arquivo do repositório. A comprovação deve registrar o projeto, o horário e o hash SHA-256 do corpo, sem registrar o token nem as demais configurações Auth. Não é necessário enviar convites reais para verificar a persistência do modelo.

Alternativa equivalente: editar **Invite user** em [Authentication → Email Templates](https://supabase.com/dashboard/project/xipbsazvymkqqfmfegwu/auth/templates), salvar e confirmar o conteúdo reabrindo o formulário na mesma sessão autenticada.

Salvar o arquivo HTML no GitHub, implantar a aplicação Vercel ou implantar `tinyfish-free` não aplica esse modelo à instância hospedada do Supabase Auth.

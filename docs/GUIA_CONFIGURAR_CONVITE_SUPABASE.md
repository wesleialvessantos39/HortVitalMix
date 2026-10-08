# Configurar o e-mail de convite administrativo do HortiVitalMix

Este guia configura o modelo **Invite user** do Supabase Auth do projeto **HortVitalMix**, referência `xipbsazvymkqqfmfegwu`. O assunto é único; o corpo adapta a apresentação ao perfil convidado: verde para Administrador setorial e roxo para Super administrador.

O código abaixo é uma cópia integral de `supabase/templates/invite.html`. Ele não foi alterado nesta preparação. Nenhuma configuração hospedada foi salva e nenhum convite real foi enviado por esta verificação.

## 1. Abrir o projeto correto e verificar se a edição está disponível

1. Entre no [painel de modelos de e-mail do HortVitalMix](https://supabase.com/dashboard/project/xipbsazvymkqqfmfegwu/auth/templates) com sua conta Supabase.
2. Confirme que o projeto selecionado é **HortVitalMix** e que o endereço do navegador contém `xipbsazvymkqqfmfegwu`.
3. No menu do projeto, o caminho é **Authentication → Email Templates**. Abra **Invite user**; esse é o modelo para convites, diferente dos modelos de cadastro, recuperação e magic link.
4. Se o editor estiver disponível, prossiga para a configuração de URLs e do modelo abaixo.

Desde **3 de junho de 2026**, projetos novos no plano **Free** que usam o serviço de e-mail padrão do Supabase não podem personalizar os modelos Auth. Essa restrição não se aplica ao Pro ou superior, nem a projetos Free com **Custom SMTP** configurado. Este projeto foi criado após essa mudança; o plano e a configuração SMTP atuais não foram verificados nesta sessão. Portanto, só siga a etapa de SMTP abaixo se o painel bloquear a personalização ou se a entrega apresentar um erro relacionado ao provedor.

### Se o painel exigir Custom SMTP

1. Use um provedor de e-mail que ofereça SMTP e conclua nele a verificação do seu domínio/remetente. Os registros DNS pedidos pelo provedor, normalmente SPF e DKIM, devem ser cadastrados no serviço onde o seu domínio é administrado.
2. Abra [Authentication → SMTP Settings](https://supabase.com/dashboard/project/xipbsazvymkqqfmfegwu/auth/smtp).
3. Ative a opção de SMTP personalizado e preencha os campos com os dados fornecidos pelo provedor:

| Campo | Valor a informar |
| --- | --- |
| Sender email / e-mail do remetente | Um endereço autorizado do domínio verificado no provedor, como `convites@seu-dominio.com`. Use seu endereço real. |
| Sender name / nome do remetente | `HortiVitalMix` |
| Host | O servidor SMTP informado pelo provedor. |
| Port | A porta informada pelo provedor, como `587` ou `465`, somente se esse for o valor indicado para sua conta. |
| Username / usuário | O usuário SMTP fornecido pelo provedor. |
| Password / senha | A credencial SMTP fornecida pelo provedor, digitada somente neste painel. |

4. Salve a configuração SMTP e volte ao editor de **Invite user**. Se esses dados já estiverem configurados e funcionando, mantenha-os.

A [documentação oficial de SMTP](https://supabase.com/docs/guides/auth/auth-smtp) explica as restrições do serviço padrão. Não é necessário alterar tabelas SQL, liberar RLS ou desativar confirmação de e-mail para configurar o modelo.

## 2. Conferir o endereço do aplicativo e o redirecionamento

1. Abra [Authentication → URL Configuration](https://supabase.com/dashboard/project/xipbsazvymkqqfmfegwu/auth/url-configuration).
2. No campo **Site URL**, confira este endereço de produção:

```text
https://hortvitalmix.vercel.app
```

3. Em **Redirect URLs**, preserve as entradas usadas pelas outras funções do aplicativo e adicione estas entradas específicas caso ainda não existam:

```text
https://hortvitalmix.vercel.app/admin/aceitar-convite
https://hortvitalmix.vercel.app/admin/aceitar-convite?token=*
```

A segunda entrada permite os valores de token gerados em cada convite, mantendo o domínio e o caminho administrativo definidos. Cole o `*` como está; não coloque um token de convite real nessa configuração. O Supabase usa padrões de correspondência para a lista de redirects, e o token deste aplicativo contém apenas caracteres hexadecimais. Não é necessário adicionar uma permissão genérica para qualquer domínio ou qualquer caminho.

4. Salve as alterações dessa tela. O arquivo `supabase/config.toml` contém valores para desenvolvimento local; salvar esse arquivo no GitHub não substitui a configuração do projeto hospedado.

## 3. Definir o assunto

Volte a [Authentication → Email Templates → Invite user](https://supabase.com/dashboard/project/xipbsazvymkqqfmfegwu/auth/templates). No campo de assunto, normalmente chamado **Subject**, cole exatamente:

```text
Convite administrativo | HortiVitalMix
```

## 4. Colar o corpo HTML completo

No editor do corpo do e-mail, apague o conteúdo atual e cole **todo** o bloco abaixo. Se houver uma prévia visual e um editor de código, use o editor de código/HTML. Copie apenas do `<!doctype html>` até `</html>`, sem as marcações Markdown que delimitam o bloco.

Mantenha as expressões `{{ ... }}` exatamente como estão. Elas são processadas pelo Supabase quando o convite é enviado.

```html
<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Seu convite HortiVitalMix</title></head>
<body style="margin:0;padding:0;background:#f3f6f1;font-family:Arial,Helvetica,sans-serif;color:#193321;">
<div style="display:none;max-height:0;overflow:hidden;">Seu acesso administrativo ao HortiVitalMix está pronto para ativação. Convite pessoal válido por 24 horas.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f6f1;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #dfe7df;border-radius:18px;overflow:hidden;">
<tr><td style="padding:24px;background:#163f26;color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.5px;">Horti<span style="color:#f2a04d;">Vital</span>Mix</td></tr>
{{ if eq .Data.hvm_admin_role "platform_super_admin" }}
<tr><td style="padding:22px 24px;background:#f4effb;border-bottom:1px solid #e5dcef;">
<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#715390;">GOVERNANÇA DA PLATAFORMA</p>
<h1 style="margin:0;font-size:26px;line-height:1.25;color:#49345f;">Convite de Super administrador</h1>
<p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#665475;">Você foi convidado para a gestão do HortiVitalMix e dos acessos administrativos.</p>
</td></tr>
{{ else }}
<tr><td style="padding:22px 24px;background:#edf6ee;border-bottom:1px solid #dcebdc;">
<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#42724c;">ADMINISTRAÇÃO POR SETORES</p>
<h1 style="margin:0;font-size:26px;line-height:1.25;color:#193e25;">Convite de Administrador setorial</h1>
<p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#4a6550;">Seu acesso será limitado aos setores autorizados pela governança.</p>
{{ if .Data.hvm_admin_sectors }}<p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#244b30;"><strong>Setores autorizados</strong><br>{{ .Data.hvm_admin_sectors }}</p>{{ end }}
</td></tr>
{{ end }}
<tr><td style="padding:24px;">
<p style="margin:0 0 16px;font-size:15px;line-height:1.65;">Para ativar seu acesso, confirme seus dados e crie a senha administrativa na página do convite.</p>
{{ if eq .Data.hvm_identity_mode "existing" }}<p style="margin:0 0 18px;padding:14px;background:#f5f8f3;border-radius:10px;font-size:13px;line-height:1.6;color:#45604b;">Seu cadastro existente será preservado. O novo acesso administrativo terá perfil e senha próprios.</p>{{ end }}
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:#1b4d2e;border-radius:10px;"><a href="{{ .RedirectTo }}" style="display:inline-block;padding:15px 23px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;line-height:1.3;">Ativar meu acesso</a></td></tr></table>
<p style="margin:22px 0 10px;font-size:13px;line-height:1.6;color:#52685a;"><strong>Convite pessoal · válido por 24 horas · uso único</strong><br>Um convite cancelado ou substituído não permite ativar o acesso.</p>
<p style="margin:0 0 10px;font-size:12px;line-height:1.6;color:#68756b;">Se o botão não funcionar, <a href="{{ .RedirectTo }}" style="color:#1b4d2e;">abra a página de ativação por este link</a>.</p>
<p style="margin:0;font-size:12px;line-height:1.6;color:#68756b;">Não compartilhe este convite. Se você não esperava recebê-lo, ignore a mensagem.</p>
</td></tr>
<tr><td style="padding:18px 24px;border-top:1px solid #e7ece6;background:#fafbf8;font-size:12px;line-height:1.6;color:#6b766d;">HortiVitalMix<br>Governança administrativa segura</td></tr>
</table>
</td></tr></table>
</body></html>
```

## 5. Salvar e confirmar que o modelo ficou persistido

1. Salve o modelo no botão de salvar alterações do editor.
2. Aguarde a confirmação de sucesso apresentada pelo painel. Uma prévia visual, por si só, não comprova que o conteúdo foi salvo.
3. Saia do editor de **Invite user** e abra esse modelo novamente.
4. Confira o assunto e confirme que o corpo ainda contém:
   - `{{ if eq .Data.hvm_admin_role "platform_super_admin" }}`;
   - os títulos **Convite de Super administrador** e **Convite de Administrador setorial**;
   - as duas ocorrências de `href="{{ .RedirectTo }}"`, no botão e no link alternativo.

A prévia do painel pode não receber os metadados de um convite real. Nesse caso, ela pode apresentar apenas o ramo verde. Os dois perfis devem ser conferidos com convites criados pelo aplicativo. O novo modelo será usado nos próximos e-mails; mensagens já recebidas mantêm seu conteúdo original.

## 6. Verificar o resultado pelo fluxo do aplicativo

1. Abra [HortiVitalMix](https://hortvitalmix.vercel.app/) e entre com uma conta administrativa que tenha poder para criar os convites desejados.
2. Abra [Governança](https://hortvitalmix.vercel.app/admin/governanca) pelo menu administrativo.
3. Envie um convite de **Administrador setorial** para um endereço de teste sob seu controle, selecionando os setores permitidos. Confira na caixa de entrada se o assunto está correto, se o bloco é verde e se os setores aparecem.
4. Se sua conta tem autorização para convidar Super administradores, envie um convite desse perfil para outro endereço de teste sob seu controle. Confira o bloco roxo e o título de Super administrador.
5. Abra **Ativar meu acesso** no e-mail. A URL deve começar por `https://hortvitalmix.vercel.app/admin/aceitar-convite?token=` e a tela deve apresentar o perfil desse convite.
6. Para verificar apenas o modelo e o destino do link, basta abrir essa tela. Conclua o formulário somente se também quiser criar o acesso administrativo de teste.

Use o envio de **Governança do HortiVitalMix** para essa verificação. A ação **Invite user** da página de usuários do Supabase cria um convite Auth comum, mas não cria o registro de convite, os setores e as permissões no fluxo de governança do aplicativo. Ela também não fornece o token próprio exigido por esta página de ativação.

### Se a mensagem não chegar ou o link não abrir como esperado

| Situação observada | O que conferir |
| --- | --- |
| Editor informa que o plano não permite personalização | Verifique a condição de plano Free + SMTP padrão descrita no início e configure Custom SMTP, se aplicável. |
| Envio retorna `Email address not authorized` | O SMTP padrão só atende endereços autorizados da equipe Supabase. Para entregar aos destinatários do aplicativo, confira Custom SMTP. |
| Envio retorna limite de e-mails / status `429` | Aguarde o intervalo informado e confira [Authentication → Rate Limits](https://supabase.com/dashboard/project/xipbsazvymkqqfmfegwu/auth/rate-limits) e os limites do seu provedor. |
| O aplicativo confirma o envio, mas a mensagem não aparece | Confira spam/lixo eletrônico e os registros de entrega do provedor SMTP, antes de reenviar repetidamente. |
| Botão abre a página inicial ou localhost | Confira Site URL, as duas entradas de Redirect URLs e se o corpo salvo usa `.RedirectTo`. Gere um convite novo pelo aplicativo depois da correção. |
| Tela informa convite expirado, cancelado ou já utilizado | Use a situação exibida em Governança. Um convite pendente dura 24 horas; cancelar ou substituir o convite invalida o link anterior. |

Se o seu provedor oferece rastreamento que reescreve links, preserve o endereço completo de ativação; desative esse rastreamento para estes e-mails se ele estiver modificando o destino. A verificação de SMTP depende do erro ou estado observado: este guia não afirma que o SMTP do projeto esteja ausente ou com defeito.

## Por que o botão usa `{{ .RedirectTo }}`

O servidor do HortiVitalMix gera um token próprio de 32 bytes, representado por 64 caracteres hexadecimais, e registra seu hash no convite administrativo. Esse registro tem validade de **24 horas**, destinatário, perfil, setores e situação de cancelamento/aceite.

Ao solicitar o e-mail ao Supabase, o aplicativo envia `redirectTo` com a página `/admin/aceitar-convite?token=...`. O Supabase disponibiliza esse valor ao modelo na variável `{{ .RedirectTo }}`. Ao abrir o link, a página consulta o backend do HortiVitalMix; a conclusão do formulário valida o registro do convite, confirma os dados e cria o acesso/poderes correspondentes. Abrir a página não consome o convite.

`{{ .ConfirmationURL }}` pertence à verificação padrão de convite do Supabase Auth. Usá-la aqui passaria pelo fluxo de confirmação e sessão Auth, diferente do aceite de governança que o aplicativo implementa. Para este modelo, mantenha `.RedirectTo` nos dois links.

Os metadados `hvm_admin_role`, `hvm_admin_sectors` e `hvm_identity_mode` personalizam título, cor, setores e a mensagem de cadastro existente. Eles servem para apresentação. Os poderes efetivos vêm do registro do convite e das permissões verificadas pelo backend, não do HTML ou dos metadados editáveis de usuário.

## Referências verificadas

- [Modelos de e-mail e variáveis do Supabase](https://supabase.com/docs/guides/auth/auth-email-templates).
- [Site URL e lista de redirecionamentos](https://supabase.com/docs/guides/auth/redirect-urls).
- [SMTP personalizado](https://supabase.com/docs/guides/auth/auth-smtp).
- [Mudança de personalização no plano Free em 3 de junho de 2026](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier).

Conferido contra a documentação atual e o código do convite do HortiVitalMix em 8 de outubro de 2026. O HTML acima foi preservado integralmente; a verificação de persistência e entrega ocorrerá quando você salvar e testar pelo seu painel/aplicativo.

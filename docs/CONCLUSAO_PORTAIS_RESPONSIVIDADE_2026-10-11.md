# Conclusão da revisão — 11/10/2026

## Resultado da auditoria

A base `539962c` já tinha instalação assistida, apresentação compacta quando instalado, atualização web automática sem aviso flutuante, histórico de convites com exclusão, exclusão de conta profissional e Governança com setores responsivos. O Livro Raiz registrava corretamente duas pendências: senha pública compartilhada e convite de e-mail fora do Gmail dependente de alias. Esta entrega implementa essas pendências e corrige o overflow residual dos bloqueios por localidade.

## Portais independentes

- Consumidor e Produtor passam a ter hashes de senha próprios. A migração copia somente os hashes existentes; nenhuma senha é exposta ou redefinida e os IDs de negócio são preservados.
- Cada sessão pública fica vinculada no servidor a um único portal. Alterar cookie, papel enviado pelo cliente ou reutilizar token não concede o outro acesso. As políticas de leitura privadas do PostgreSQL também exigem o portal correto.
- Um segundo cadastro público escolhe sua própria senha e exige confirmação de e-mail daquele portal. A confirmação e o login por link possuem prova aleatória, temporária e de uso único.
- Recuperação e troca de senha alteram somente a credencial solicitada e revogam as sessões daquele portal. Consumo da prova, alteração da senha, revogação e auditoria são transacionais.
- Admin e Super permanecem em identidades Auth exclusivas. Gmail conserva o alias que entrega na mesma caixa. Para outros provedores, o login administrativo usa uma identidade interna e o convite chega ao endereço real pelo Supabase Auth/SMTP existente.
- O token do convite HortiVitalMix confirma o convite. A sessão de e-mail do destinatário não é importada como credencial administrativa. Um login público criado depois de um administrativo recebe outra identidade, preservando o principal administrativo e sua senha.
- O perfil exibido e o e-mail de contato vêm do domínio do portal; aliases internos não aparecem como endereço do usuário.

Credenciais antigas de Consumidor e Produtor com o mesmo e-mail começam com a senha anterior para preservar acesso, mas passam a ser independentes: qualquer troca posterior afeta somente o portal escolhido. Sessões antigas de pessoas que já tinham os dois papéis precisam entrar novamente para estabelecer o contexto exclusivo. A mesma pessoa legal pode continuar sendo referenciada pelos perfis, sem conceder um login por meio do outro.

## Instalação e atualização

O Android usa a confirmação nativa quando o navegador disponibiliza o evento de instalação. O iOS continua exigindo a ação Compartilhar → Adicionar à Tela de Início. Depois de instalado, a central apresenta o estado de instalação e uma verificação de atualização. O aviso global permanece oculto. Atualizações web são aplicadas automaticamente quando operações, uploads, formulários e fila offline permitem uma troca segura. A instalação de um novo pacote nativo permanece sujeita às regras do Android/iOS.

## Convites antigos

A consulta de produção encontrou quatro registros: um pendente e três já invalidados/arquivados. A Governança inclui o histórico e o filtro de excluídos anteriormente. Convites pendentes podem ser excluídos pela ação autorizada, cancelando o link e permitindo novo envio. Nenhum convite real foi enviado, excluído ou reativado nesta revisão. O erro de duplicidade continua protegendo acesso já ativo ou convite vigente para o mesmo papel; ele não impede papéis diferentes ou e-mail público existente.

## Responsividade e validação

O defeito residual de bloqueios era a largura mínima de fieldsets e de colunas de texto anônimas nos checkboxes. Agora ambos se ajustam e nomes/e-mails longos quebram sem ultrapassar o celular.

Validação executada:

- Bateria geral: 1.324 testes aprovados; 512 condicionais sem configuração real foram pulados.
- PostgreSQL 17 descartável: todas as 80 migrações aplicadas de zero. Senhas, confirmação, sessão, recuperação concorrente, convites, poderes e perfis testados com SQL real. O transporte GoTrue/SMTP foi substituído por fixtures locais para não enviar mensagens reais.
- 14 cenários de convites aprovados, incluindo Gmail/Outlook de Consumidor/Produtor; 30 cenários de perfis/poderes; seis de credenciais; três de login HTTP com senha real de banco e vínculo de sessão.
- Auditoria das telas: 106 cenários distintos, entre 320 e 1440 px. Exclusão de conta e Governança verificadas também em 390/768/1024 px. Fixtures antigas foram atualizadas às respostas atuais da API. Uma falha de importação durante reinício do servidor passou na repetição dirigida.
- TypeScript completo, build com gates do projeto, verificação de histórico de migrações, bundle sem segredos e evidência de cadastro aprovados.
- PWA: 63 cenários distintos aprovados com Service Worker e dois builds reais; uma medição vertical foi repetida com sucesso.

Não foram utilizados pagamentos, serviços adicionais ou testes com contas reais. Instalação física em telefones e entrega SMTP real não foram simuladas como aprovação.

## Publicação

Schema lógico 73, 80 migrações. Migração canônica `20261011032631_independent_public_portal_credentials.sql`. Destinos conferidos: Supabase `xipbsazvymkqqfmfegwu`, Vercel `hortvitalmix` da equipe existente, repositório `wesleialvessantos39/HortVitalMix`, ramo `main`. Migração aplicada em produção como `20261011135735`; cinco credenciais públicas existentes esperadas e cinco migradas. Edge `public-registration` v13 ACTIVE. A confirmação do site será acrescentada após a versão estar READY e o domínio apresentar o commit e o schema corretos.

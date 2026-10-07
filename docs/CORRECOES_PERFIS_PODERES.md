# Cadastros independentes, conexão e poderes administrativos

Correções solicitadas após a Trilha 25, sobre `main/be095e5ef9de9a53295046055b8466b5af7cdda5`. Supabase único `xipbsazvymkqqfmfegwu`, Vercel exclusivamente `main/production/pdx1`, infraestrutura gratuita. Schema lógico **65 / 72 migrations**, sem abrir outra trilha.

## Perfis por cadastro

`app_account_profiles` mantém nome, CPF, e-mail, telefone e revisão separados por usuário/papel. Consumidor, Produtor, Administrador e Super administrador têm seus próprios perfis, inclusive quando a identidade legal é a mesma. `ProfilePrivacyService` e a sessão usam o papel selecionado; editar o nome grava somente esse perfil. Formulários identificam o papel e rejeitam uma gravação obsoleta após trocar de portal. CommandId, revisão e auditoria permanecem operacionais.

A migração cria os perfis existentes sem atualizar nomes na identidade legal `app_people`. Quando existem metadados originais do próprio cadastro e auditoria da última edição, esses registros permitem recuperar o nome original dos outros perfis e manter a edição no papel que a fez. Quando não há essa evidência, o valor anterior é conservado; nenhum nome é inventado. Pedidos, snapshots, documentos, imóveis e vínculos de titularidade anteriores permanecem intactos.

O segundo cadastro público recebe seu próprio nome/telefone na mesma transação que acrescenta o papel explicitamente solicitado. A aceitação de convite administrativo, inclusive para CPF já conhecido, permite informar nome e telefone do cadastro administrativo sem sobrescrever os demais perfis. As credenciais administrativas distintas existentes são preservadas. CPF/e-mail/telefone apresentados na conta continuam sujeitos aos campos editáveis já homologados; endereços, preferências e regras de privacidade anteriores são preservados.

## Conexão do produtor

Online e sem pendências, o aviso fica oculto. A perda de conexão mostra “Modo offline”; ao reconectar, o aviso de conexão desaparece. Havendo comandos pendentes, conflitos ou reconfirmação necessária, o painel “Ações aguardando confirmação” continua disponível. Os efeitos de cache, worker, fila por identidade e sincronização continuam montados mesmo quando não há faixa visível. O trial T23 conserva conteúdo/prazo/CTA e a largura própria abaixo do cabeçalho.

## Convites e apresentação

Histórico e aceitação mostram nomes dos setores em português, chips com quebra própria, status completo e data/hora separados. O histórico muda de tabela para cartões conforme a largura disponível no painel, evitando compressão de e-mail, status e prazo. A apresentação foi preparada para **320, 390, 768 e 1440 px**.

## Retirar e devolver poderes

Em **Usuários e Acessos → Gerenciar poderes**, um Super administrador com gestão de contas e acessos pode marcar/desmarcar individualmente:

- Verificação de documentos.
- Moderação do catálogo.
- Operações financeiras.
- Gestão de localidades.
- Gestão de contas e acessos.
- Configuração da plataforma e BI.
- Gestão de reembolsos.
- Denúncias e avaliações.
- Pagamentos e assinaturas.

Administradores setoriais recebem/restituem as delegações de `app_admin_sector_members`. Super administradores começam com todos os poderes; `app_admin_permission_overrides` registra exceções explícitas que prevalecem sobre esse padrão. Retirar um poder não altera a hierarquia nem concede acesso a outras áreas. Categorias e BI continuam exclusivos do Super administrador, exigindo também o poder correspondente.

O servidor verifica os poderes atuais, as rotas anteriores seguem protegidas e policies SELECT restritivas fecham a leitura direta dos setores retirados. Navegação/atalhos refletem as permissões e a sessão administrativa se atualiza ao voltar à janela ou a cada 30 segundos. Uma aba antiga não autoriza uma ação proibida no servidor. Falha de consulta de autorização não concede poderes por padrão.

Gravações exigem origem permitida, autenticação recente, revisão e commandId. A transação registra auditoria e um aviso único ao titular afetado; repetir o comando não duplica alterações/avisos. Conflitos de revisão exigem consultar a versão atual. Bloqueio/exclusão de outro Super administrador ficam disponíveis, conservando as regras de hierarquia, autoexclusão protegida e pelo menos um Super disponível, sem prazo, com gestão de acessos para restaurar os poderes.

## Banco, preservação e verificação

Migrations CLI **20261007205812_independent_profiles_admin_permissions.sql** e **20261007214314_revoke_profile_client_column_mutations.sql**: duas tabelas novas com **ENABLE/FORCE RLS**, acesso exclusivo do backend; RPC do segundo cadastro transacional; helpers privados com search_path definido e EXECUTE restrito; novas policies somente restritivas. A revisão encontrou quatro grants UPDATE por coluna da fundação que sobreviveram aos REVOKE de tabela: nome/telefone da pessoa e nome/atividade do perfil do produtor. A segunda migration revoga somente esses acessos diretos do cliente; leitura, policies, dados e operações autorizadas pelo backend são conservados. As **70 migrations anteriores** permanecem byte a byte iguais. A função de exclusão conserva o corpo anterior e acrescenta as proteções para outro Super administrador.

Rodada geral: **873 testes aprovados**, **424 condicionais não executados nessa rodada**. Os testes PostgreSQL/navegador são executados separadamente contra o container local descartável, com serviços e HTTP reais; somente o transporte de Auth/Data API usa adaptador local. **337 regressões PostgreSQL anteriores**, **sete histórias completas anteriores** e **63 cenários de interfaces anteriores** aprovados. As correções têm uma história completa nova de edição dos quatro perfis, retirada/devolução de poderes e avisos offline, além dos cenários de domínio e proteção contra edição direta. As verificações adicionais após revogar os quatro grants são registradas nos metadados. TypeScript, build, manifesto, proteção contra segredos/bundle e audit de produção verificados; zero vulnerabilidades de dependências de produção. O verificador estático T05 foi alinhado ao helper que respeita revogações e à mensagem atual da aceitação do convite, conservando as demais verificações.

Verificação final: **27 cenários novos**, incluindo a história React → HTTP → PostgreSQL dos quatro perfis e poderes; nove cenários separados retiram/devolvem cada poder e confirmam que os outros oito continuam operacionais. Após fechar os grants, as **31 regressões dirigidas** de documentos/cadastro e loja passaram novamente, incluindo a história real de correção documental em mobile/desktop. As duas migrations físicas são **20261007214025** e **20261007214554**; hash final **654a6a62c736a81b32941d3e5badd395f723f3b0d1e011902a52836025968525**.

Após cada aplicação, **99/99 relações anteriores** conservaram contagem/digest. **97/97 tabelas app_*** têm ENABLE/FORCE; zero DML de cliente em tabela ou coluna e zero execução de cliente nos helpers de mutação. Os grants anteriores de tabela e leitura por coluna foram preservados; a diferença é exclusivamente a retirada dos quatro UPDATE por coluna acima. Advisors mantêm **5 WARN de segurança e 25 WARN de desempenho anteriores**, sem WARN novo. Metadados, PR, SHA e READY constam em [CORRECOES_PERFIS_PRESERVACAO.json](CORRECOES_PERFIS_PRESERVACAO.json) e no Livro-Raiz. Sem reset, contas/pedidos de teste, envio de convites ou cobrança na produção. Capas/fotos/WebP/cache T22, vendas/reembolsos por papel, badge por opção, nomes/preços configuráveis dos planos e gateway real preparado/inativo são conservados.

Publicação funcional concluída: **PR #99**, SHA **6c483d202308d6933dd691136764829257b12025**, deployment **dpl_4UQ6LvsEApvyYVMJ2bQB5mXEtfCv READY/main/production/pdx1**, selo **fix-profiles-v65-6c483d2**, no domínio oficial. **22 verificações HTTP**, **32 combinações de página/largura**, worker e seus **72 assets** aprovados. **98/98 relações de negócio/Auth/Storage** permanecem idênticas; somente `app_releases` recebe o selo intencional. Sem grupos error/fatal na janela de cinco minutos consultada. O fechamento documental conserva esse código e recebe sua própria publicação/selo da SHA exata após READY.

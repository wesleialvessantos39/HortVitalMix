# Instalação, atualizações, convites e responsividade

## Alterações

- Aplicativo instalado apresenta somente o estado de instalação e a ação de verificar atualizações. A central evita ações duplicadas; detalhes técnicos ficam na administração.
- Atualizações web continuam automáticas e agora não exibem avisos flutuantes. Formulários, uploads, confirmação, compras e fila offline continuam protegidos. Atualizações de pacotes nativos aparecem somente nas páginas de atualização.
- Android usa a confirmação nativa quando oferecida pelo navegador. iOS exige Compartilhar → Adicionar à Tela de Início; o site não pode concluir essa ação sozinho.
- Governança consulta também o histórico arquivado. Convites pendentes antigos não ficam limitados aos 100 mais recentes. Os excluídos são consultáveis sem reativar links; cancelamento e auditoria permanecem preservados.
- Convites reconhecem o cadastro público pelo e-mail sem exigir o CPF na emissão. A ativação confere CPF antes de alterar a credencial exclusiva do convite. Convites antigos vinculados a credenciais existentes são recusados sem alterar suas senhas.
- Administrador e superadministrador têm identidades Auth separadas. Uma nova proteção no banco impede atribuir papéis públicos ou de outro portal administrativo à mesma credencial. Referenciar a mesma pessoa não concede acesso nem compartilha senha administrativa.
- Exclusão de conta recebeu confirmação organizada, explicação da retenção, campos adaptáveis e caixas de seleção de tamanho fixo. Governança recebeu setores em grade, descrição e contagem. Regras gerais de formulários deixam de esticar checkbox/radio.

## Validação

- Build completo, TypeScript e verificações de segurança aprovados.
- 925 testes aprovados: unidade, autenticação administrativa e 12 cenários de convites em PostgreSQL 17 descartável com as migrations reais.
- Navegador: revisão de conta, governança, navegação, convites e telas com conteúdo longo entre 320 e 1440 pixels. Rodada final de 37 cenários aprovada; rodada inicial de 25 aprovada. Testes usam dados sintéticos.
- PWA: duas versões de produção locais, worker real, instalação simulada para Android/iOS, atualização automática e preservação de trabalho/IndexedDB. Resultados completos registrados na entrega.
- Nenhum convite real foi enviado ou excluído pelos testes.
- Migration lógica 72 aplicada no projeto canônico com versão física `20261011024748`. Nenhuma conta existente foi mesclada ou migrada.

## Limites do envio e da identidade pública

O envio usa o SMTP já configurado no Supabase, através de Auth. Gmail/Googlemail permitem aliases entregues à mesma caixa e resolvidos internamente por portal. Para endereços de outros provedores que já possuem identidade Auth, a entrega ao endereço original com uma credencial distinta ainda exige transporte SMTP acessível ao backend ou um Send Email Hook. As ferramentas desta sessão não expõem a configuração SMTP hospedada; não foram copiadas credenciais nem alterada essa configuração. Não se afirma suporte universal a aliases.

Consumidor e produtor continuam com seleção de portal e perfis separados conforme a arquitetura existente. Quando ambos já pertencem à mesma identidade pública, a senha Auth continua compartilhada. Separar essas senhas exige um fluxo próprio de migração e recuperação; esta revisão não reescreve credenciais de usuários existentes.

O advisor de segurança já indicava funções auxiliares SECURITY DEFINER usadas por políticas, tabelas internas sem políticas de acesso direto e proteção de senhas vazadas desabilitada. A migration nova não amplia grants públicos. Referências: [funções e grants](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [políticas RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

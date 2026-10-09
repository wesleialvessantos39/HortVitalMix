# Confirmação da identidade nos convites administrativos

O usuário informou que configurou o template hospedado no Supabase e encontrou a mensagem “Entre novamente para confirmar esta operação” ao tentar enviar convites. A mensagem vinha do tratamento genérico de HTTP 401 em Governança: a tela não distinguia uma sessão inválida da exigência de confirmação recente da identidade. Quando a confirmação de 15 minutos vencia, não havia uma ação na tela para concluí-la. O transporte ainda tentava renovar o token e repetir o comando, embora renovar uma sessão não confirme a senha.

## Comportamento corrigido

- Criar um convite de Administrador ou Super administrador, excluir um convite e limpar o histórico abrem uma janela de confirmação quando o backend retorna `ADMIN_REAUTHENTICATION_REQUIRED`.
- A janela mantém e-mail, CPF, papel, setores, revisão e `commandId` da operação original. Senha incorreta mantém a janela aberta. Cancelar ou pressionar Escape antes da confirmação não executa a ação.
- A senha é confirmada por `POST /v1/admin/auth/reauthenticate`, que recebe somente `password`. O servidor resolve o principal administrativo atual e seu e-mail canônico; o cliente não escolhe outra conta ou portal. O login existente mantém os limites de tentativas, o estado da conta, o papel e os poderes vigentes.
- O servidor compara usuário e papel antes de emitir a sessão/prova; uma sessão autenticada com identidade divergente é rejeitada e revogada. O cliente também verifica o ator capturado no bloqueio, o papel e a versão local da identidade antes de adotar a sessão ou retomar o comando.
- A operação retoma uma única vez após a confirmação. Um segundo bloqueio não cria um ciclo. Cliques repetidos não disparam comandos concorrentes, e novas tentativas após falha de rede reutilizam o identificador quando o conteúdo continua igual.
- Falhas de sessão, poder, conflito, senha, limite de tentativas e indisponibilidade têm tratamentos diferentes. Uma sessão inválida oferece o acesso administrativo apropriado; não é tratada como uma confirmação de senha pendente.

## Proteções preservadas

A janela de 15 minutos não foi ampliada nem removida. A prova continua assinada com HMAC, vinculada ao usuário e ao `session_id` e armazenada em cookie HttpOnly. A renovação de JWT não renova a confirmação de identidade. As ações continuam verificando sessão Auth ativa, conta ativa, origem, papel, poderes, revisão, idempotência e auditoria no backend. Metadados de usuário não decidem autorização.

Renovação e confirmação são coordenadas no transporte da mesma aba: a confirmação aguarda a renovação em trânsito, e respostas de sessão expirada aguardam a validação e adoção da confirmação antes de retomar. Respostas de uma identidade anterior não substituem o armazenamento nem repetem uma operação sob outra conta. A versão local serve somente para descartar respostas antigas; a autorização permanece no servidor.

Não há migration ou alteração de dados de negócio. Schema permanece **66 / 73 migrations**, hash `11cfaf481196044d3a52bb078413c507285d6a112cc74bc37813ce57ee6bd8b9`. O HTML do convite e a configuração Auth hospedada não foram alterados nesta correção. A configuração do template foi informada pelo usuário; não foi relida por automação.

## Verificação

O backend passou em **37 testes**: 22 cenários de rota Express/middleware/prova, nove do serviço de confirmação e seis da prova assinada existente. As rotas e o middleware são reais; Auth, consultas e entrega usam adaptadores locais sintéticos. Os testes verificam ambos os papéis, expiração, senha incorreta, sessão revogada, conta bloqueada, poder retirado, divergência de usuário/portal, origem externa e as proteções de exclusão/limpeza.

O transporte passou em **12 testes**, incluindo ausência de renovação/repetição para confirmação ou senha incorreta, renovação da sessão realmente expirada, ordenação de confirmação/adoção e rejeição de replay de POST após troca de identidade.

No navegador, **31 cenários passaram**: 16 específicos da confirmação e 15 existentes de governança/responsividade. Depois do último ajuste de verificação da identidade na passagem entre confirmação e retomada, os 16 específicos passaram novamente. Foram exercitados Administrador convidando Administrador e Super administrador convidando ambos os papéis, mobile/desktop, preservação de CPF/setores, cancelamento, senha incorreta, indisponibilidade, troca de conta, cliques repetidos, exclusão e limpeza. A primeira execução foi interrompida após uma falha durante alteração/HMR do código; seu histórico foi preservado e os cenários foram reexecutados com o código estabilizado, sem reduzir as verificações.

TypeScript completo (aplicativo, servidor e testes), `git diff --check` e build passaram. O build verificou manifesto de migrations, segurança, **212 cenários dos gates obrigatórios**, evidências existentes, bundle e ausência de segredo no bundle. A geração do bundle ocorreu depois do último ajuste funcional. A revisão independente verificou origem, identidade, poderes, validade da prova, desmontagem, ordenação de sessão e retomada do comando.

Os quatro prompts dos dois perfis em `320×850` e `1440×850` passaram na revisão visual e em verificações de geometria/foco: senha vazia, foco visível, janela contida na viewport, sem rolagem horizontal e sem erro JavaScript. [Resultados, histórico e capturas](evidence/confirmacao-convites-2026-10-08/verification.json). A captura posterior ao envio também usa somente respostas sintéticas locais.

Nenhuma conta ou convite real foi criado pelos testes. Não foi feito login autenticado em produção nem verificada a entrega de e-mail pelo SMTP hospedado. Os testes de navegador usam respostas sintéticas; não são apresentados como teste de senha ou entrega no Supabase hospedado.

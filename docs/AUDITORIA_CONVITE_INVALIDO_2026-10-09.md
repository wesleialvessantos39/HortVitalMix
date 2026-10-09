# Convite indisponível e encerramento seguro

O link inválido não criava uma conta nem importava uma sessão. O botão antigo abria o acesso administrativo, que reutilizava uma sessão válida já presente no navegador. Para quem abriu o convite, o resultado parecia uma autenticação sem senha.

A tela de convite indisponível agora mantém somente o botão superior **Voltar ao site**. Ao tocar nele, o aplicativo revoga a sessão de cookie e a sessão administrativa armazenada neste navegador, incluindo pares de bearer/refresh diferentes. A navegação à vitrine ocorre somente depois da revogação e da limpeza dos snapshots privados. Falha de Auth, rede ou IndexedDB mantém a tela e permite tentar novamente pelo mesmo botão. Não se considera um 401/403 genérico prova de encerramento.

Abrir um link inválido, por si, não encerra sessões. A saída depende do toque explícito; um link recebido de outra pessoa não se torna um mecanismo automático de logout. Convites válidos também encerram a identidade anterior antes de apresentar o login com senha da conta ativada.

As outras abas recebem somente um aviso com nonce aleatório, sem tokens nem dados pessoais. Elas removem o estado privado e descartam validações que estavam em andamento. Leituras tardias não podem recriar snapshots. A saída aguarda confirmação de identidade/refresh em andamento, e uma resposta tardia de aceitação após voltar no navegador não redireciona nem encerra a conta da próxima tela. O botão Sair da administração utiliza a mesma rotina.

## Comprovação local

- 50 casos unitários/HTTP aprovados: links indisponíveis nos dois papéis administrativos, revogação, erros definitivos e transitórios, cookie e bearer independentes, descarte de cache e regressões de confirmação recente.
- 34 cenários de navegador aprovados: quatro tipos de conta, convite inválido/expirado/cancelado/aceito, falha e nova tentativa, histórico do navegador, fila/snapshots locais, outras abas, refresh e verificações tardias.
- As fixtures são sintéticas e locais. Nenhuma conta de produção foi usada e nenhum convite real foi enviado.

Resultados: [unidade e transporte](evidence/convite-invalido-2026-10-09/unit-50-passed.log), [navegador](evidence/convite-invalido-2026-10-09/browser-34-passed.log). Os testes de interface comprovam o estado autenticado e a navegação, sem afirmar homologação em aparelho Android/iOS.

Esta auditoria registra a implementação local. A publicação, a SHA efetiva e a verificação do domínio oficial serão registradas no fechamento integrado do Livro Raiz.

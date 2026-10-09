# Departamentos administrativos: organização e responsividade

Validação local realizada em 9 de outubro de 2026. A publicação e a versão ativa são registradas separadamente no Livro Raiz.

## Inventário verificado

| Tela | Organização e verificação |
| --- | --- |
| Usuários | Pesquisa, tipo de conta e situação; contas em tabela no desktop e cartões identificados em telas estreitas; ações e revisão de cadastro preservadas. |
| Localidades | Lista e busca por nome/IBGE primeiro; cadastro aberto por “Novo município”; cobertura, impacto de bloqueio e exclusão continuam disponíveis. |
| Bloqueios por localidade | Pesquisa de pessoa, escopo e justificativa; histórico adaptado em cartões; confirmação da mesma conta sem sair da tela. |
| Categorias | Lista, descrição e ações com nomes extensos, sem transbordamento horizontal. |
| BI executivo | Indicadores, período, gráficos e valores diários; legenda da tabela não cria mais uma coluna estreita e excessivamente alta no mobile. |
| Auditoria de imóveis | Comparação em três colunas quando há largura útil suficiente; uma coluna para leitura no mobile; imóveis aprovados permanecem somente para consulta. |
| Avaliações | Filtros e cartões de moderação organizados, comentários extensos e ações acessíveis. |
| Assinaturas | Planos primeiro; formulário aberto por “Novo plano” ou “Editar plano”; recolher e continuar edição preserva o rascunho. |
| Reembolsos | Fila, detalhe, mensagens e histórico adaptados ao espaço disponível. |
| Denúncias | Fila, relato, decisão e histórico no padrão administrativo. |
| Política de reembolso | Campos, grupos e ações adaptados, com rótulos e foco visível. |
| Pagamentos | Configuração, campos, grupos e ações no padrão administrativo. |

A suíte de governança também percorreu Painel, Governança, Usuários, Auditoria, Conta, Perfil, Endereços, Preferências e Privacidade para Administrador e Super administrador, e Configuração/Localidades no perfil correspondente. Financeiro, Catálogo, Aplicativos e Departamentos têm auditorias e testes próprios; esta verificação não substitui esses registros.

## Ajustes concretos

O estilo compartilhado fica restrito ao portal administrativo. Cabeçalhos, espaçamentos, cartões, campos e ações usam uma apresentação consistente com a identidade do aplicativo. A mudança de tabela para cartões considera a largura disponível do conteúdo, incluindo o espaço ocupado pela barra lateral.

Nos cartões menores, metadados curtos ocupam pares de colunas; identificação, ações, lista de setores e justificativa mantêm largura inteira. Isso reduz altura sem omitir informação. Na captura de Localidades em 320 pixels, com um município e viewport de 900 pixels, a imagem completa caiu de 984 para 900 pixels após esse ajuste. Listas extensas, históricos, descrições e formulários abertos continuam permitindo rolagem vertical.

Localidades e Assinaturas deixam os formulários recolhidos quando já existem registros. O primeiro cadastro continua visível quando a lista está vazia. Abrir o editor leva o foco ao primeiro campo; recolher devolve o foco ao botão, e retomar conserva os valores. Apenas cancelar a edição de um plano limpa seu rascunho. Nenhuma gravação ocorre ao abrir, recolher ou retomar.

O caption do BI conserva largura legível no modo mobile. A suíte mede largura maior que 220 pixels e altura de até 110 pixels nas quatro larguras verificadas, evitando o problema anterior de letras distribuídas em uma coluna vertical.

Bloqueios e Localidades confirmam a senha da mesma identidade e retomam o comando original, com o mesmo identificador, payload e revisão. Senha incorreta ou cancelamento preserva os dados e o impacto exibido. Uma identidade diferente encerra a sessão e não repete a decisão. Uma nova exigência de confirmação após a tentativa confirmada encerra o retry com aviso, sem perder a justificativa.

## Evidência e limites

**75 de 75 testes de navegador aprovados** na execução completa: 48 casos cobrindo as 12 telas em 320, 390, 768 e 1440 pixels; 12 fluxos de filtros, formulários e confirmação; e 15 casos existentes de governança, incluindo 1024 pixels. Após o ajuste final de duas colunas nos cartões estreitos, **14 de 14 verificações afetadas passaram novamente**, com novas capturas mobile. A execução focada anterior também passou em 11 de 11 casos, incluindo as regressões de usuário em 320 pixels, BI, encerramento de identidade diferente e exclusão/revisão de cadastro.

As verificações conservaram as asserções de ausência de transbordamento da página e dos cartões, ausência de erro JavaScript, identificação de campos e manutenção das ações. Os testes adicionais conferem foco, valores de rascunho, ausência de gravação acidental, comandos equivalentes após confirmação e ausência de repetição em identidade diferente.

Logs, capturas e fingerprints das fontes verificadas estão em `docs/evidence/departamentos-responsivos-2026-10-09/verification.json`. As capturas incluem as quatro larguras para Localidades, Assinaturas e BI, e amostras mobile/desktop das outras telas. Os dados usados são fixtures sintéticas com nomes e textos deliberadamente extensos; não representam métricas ou contas de produção.

O servidor de teste utilizou banco local sintético, URLs/chaves Supabase de produção vazias e interceptação das APIs no navegador. Estes testes não enviaram e-mails, não criaram contas reais e não alteraram dados de negócio de produção. A autenticação real e a publicação final precisam ser verificadas no fluxo de liberação registrado pelo Livro Raiz.

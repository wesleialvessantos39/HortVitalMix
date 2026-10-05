# Localização responsiva e conferência da T16 — 2026-10-05

Base: `main@5c00e02b8ae444d6c5598235332652da4f28ad57`, com T16 já entregue pelo PR #76. Fontes: Livro-Raiz atualizado e plano T12–T25 fornecido pelo titular. A T16 do plano é **Geometria Operacional, Polígonos e Frete**; carrinho pertence à T18. Esta rodada preserva a implementação T16 e corrige os controles de Localização solicitados.

## Comportamento

- Um único seletor de região visível no topo, tanto no celular como no desktop. O mesmo componente é usado pelos dois cabeçalhos; o cabeçalho inativo fica oculto pelas regras responsivas existentes.
- O seletor identifica a **Região da vitrine**, mostra o município selecionado e abre o catálogo existente de localidades ativas. A escolha fecha o diálogo, devolve o foco ao seletor e permanece após recarregar a página. **Ver todas as regiões** limpa somente essa escolha.
- O cartão lateral exibe o endereço padrão quando houver um, identificado como **Endereço de entrega**. O segundo botão de região foi consolidado no seletor do topo. A região escolhida continua independente do endereço pessoal e do login.
- O seletor tem altura mínima de 48 px, foco visível, nome acessível completo, estado expandido e associação com o diálogo. Municípios longos são abreviados visualmente, mantendo o nome completo para tecnologias assistivas e no título do botão.

Arquivos de aplicação: `src/App.tsx`, `src/components/LocationSelector.tsx` e `src/components/locationSelector.css`. O verificador estrutural de localidades foi adaptado à extração do componente, conservando a verificação da presença do seletor e dos seus controles. O cenário existente de troca de endereço padrão foi atualizado para conferir o resumo de entrega no local atual, além do seletor independente de região.

## T16 e base preservadas

Schema lógico **51**, **57 migrations**, hash **d1ef54620ad0fd0cf8f83e7c7e0396249166226f4be8c874b50ea622babc3f23**, sem nova migration. Serviços, contratos, páginas de endereço/imóvel/loja/produto/estoque/entrega, API, dependências, lockfile e configuração Vercel não foram alterados. Não foram iniciadas T17, T18, checkout ou pagamentos.

Consulta somente de leitura no Supabase canônico `xipbsazvymkqqfmfegwu` confirmou: migration física T16 `20261005040640`; RLS ENABLE/FORCE nas três tabelas; nenhuma permissão de escrita para `anon`/`authenticated`/`PUBLIC`; policy SELECT de cotações pelo dono do endereço; Haversine Ariquemes–Porto Velho **159,081402025558 km**. O banco de negócio não foi modificado nesta rodada.

## Verificação realizada

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | Aprovado |
| `npm run build` | Aprovado, incluindo 149 testes dos gates existentes |
| `npm run test:t16:unit` | 35 aprovados |
| `npm run test:t07:unit` | 24 aprovados |
| `npm run test:t16:e2e` | 14 aprovados |
| Navegador T12/T13/T14/T15 | 72 aprovados |
| Navegador T07, incluindo padrão, GPS e portais administrativos | 13 aprovados |
| Manifesto, evidências de localidades, bundle e segredos | Aprovados |
| `git diff --check` | Aprovado |

Inspeção adicional com agent-browser em **320/390/768/1024/1200/1440 px**: um seletor visível, sem overflow horizontal e área de toque >=48 px. Conferidos escolha, persistência após recarga, limpeza da região, Escape, devolução de foco e endereço padrão preservado ao trocar a região. Fixtures HTTP usadas somente no navegador local; produção sem dados de teste.

Os testes PostgreSQL completos e a suíte histórica integral não foram reexecutados nesta rodada de interface. Não há mudança de SQL/serviço/contrato; a T16 foi conferida por seus testes HTTP/interface existentes e por consultas reais somente de leitura. O aviso anterior de bundle acima de 500 kB permanece não bloqueante.

## Publicação conferida

PR [#77](https://github.com/wesleialvessantos39/HortVitalMix/pull/77) integrado na **main `944f68e1039fab9aaed088b515f571a7723f06f2`**. A árvore Git publicada coincide exatamente com a árvore validada localmente (`80fa7801e21b39f4631208cd3d950c0c201d1da9`). Deployment **dpl_2DyWvnWQ6rHxTgGi35m98mRnNKXQ**, **READY**, production/main/**pdx1**, no domínio **https://hortvitalmix.vercel.app**. Release funcional `t16-localizacao-v51-944f68e`; `verify:deploy` passou para health/ready/config na SHA exata. Nenhuma mudança de plano ou serviço contratado.

Navegador em Production, com catálogo real e sem fixtures: escolha de município, fechamento/foco, persistência após recarga e limpeza confirmados. Conferidas novamente as seis larguras, inclusive com **Machadinho D'Oeste – RO**, sem overflow e com um seletor visível. Conferência adicional em contexto Chromium móvel com `hasTouch: true`, 390 px e `locator.tap()`: escolha de Ariquemes, recarga e limpeza passaram, com zero erro JavaScript. A API privada `/api/v1/producer/store/delivery` continua retornando **401 AUTH_REQUIRED** para visitante.

Esta rodada modifica no Supabase somente o registro corrente de release em `app_releases`, após READY, mantendo schema/hash. Nenhuma fixture ou nova migration em produção. O fechamento documental atualiza somente este relatório e o apêndice do Livro-Raiz; a release acompanha a SHA final da main após o deploy documental READY.

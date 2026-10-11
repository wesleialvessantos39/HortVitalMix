# Offline e sincronização dos quatro portais — 11/10/2026

## Comportamento entregue

Consumidor, Produtor, Administrador e Super administrador usam o mesmo mecanismo durável, com dados, rascunhos, arquivos e ações separados por UUID **e papel do portal**. O mesmo e-mail, inclusive com UUID público compartilhado, não combina as filas de Consumidor e Produtor. Administrador e Super continuam com seus principais exclusivos.

O aplicativo salva uma ação elegível no IndexedDB **antes** de tentar a rede. Sem conexão, informa que ela foi salva no aparelho, sem fingir que o servidor confirmou. Recarregar a aplicação preserva a sessão resumida, os dados consultados, o formulário e as ações. Login, senha, OTP, MFA, tokens e URLs assinadas não entram na fila nem nos rascunhos.

Ao reconectar, voltar à janela ou reabrir a aplicação, o sincronizador verifica a sessão real e o portal ativo, envia as ações automaticamente na ordem original e consulta novamente os dados visitados. Enquanto a aplicação está visível, também reconcilia a cada 30 segundos. Novas ações durante um envio retomam rapidamente; falhas transitórias têm tentativas progressivas e a reconexão remove o atraso. Abas usam bloqueio compartilhado e IDs estáveis para evitar repetições. Um atraso de tentativa mantém a ordem das ações seguintes.

A atualização das consultas chega às telas dos quatro perfis. Formulários em edição permanecem intactos. Rascunhos não expiram automaticamente: são removidos quando o envio correspondente é confirmado e o usuário não fez uma nova edição, ou quando o respectivo portal é excluído. Radios, checkboxes e campos controlados são restaurados como valores de formulário, sem armazenar HTML.

A interface permanece discreta: exibe o estado offline ou ações ainda pendentes, com acesso à revisão. Ao concluir, não deixa um aviso permanente de conexão nem cria notificações de atualização do aplicativo. A central de atualizações também considera as filas dos quatro perfis.

## Cobertura

| Área | Funcionamento sem conexão |
| --- | --- |
| Conta e preferências dos quatro perfis | Consultas já carregadas, rascunhos e alterações salvas por portal. |
| Consumidor | Carrinho, favoritos, avaliações, solicitações e mensagens comerciais, assinaturas e preparação de cotação conforme as permissões originais. |
| Produtor | Loja, produtos, estoque, entregas, pedidos, dados rurais e mensagens; imagens conservam os bytes e o ID do comando. |
| Imóvel rural | Após salvar o imóvel e conferir a documentação obrigatória, as cinco etapas finais podem ser enviadas como uma operação atômica; erro em qualquer etapa desfaz todas. |
| Documentos | Arquivo e metadados ficam no aparelho; ao conectar, a aplicação obtém URL nova, envia e confirma com os mesmos IDs. Não guarda a URL assinada. |
| Administração e Super | Configurações, categorias, localidades, bloqueios, catálogo, governança, convites, documentos, verificação, planos, decisões e mensagens; permissões são verificadas novamente no servidor. |
| Dados alterados enquanto havia conexão | As consultas são atualizadas automaticamente e refletem alterações do mesmo ou de outro aparelho. |

Conflitos de revisão preservam a alteração local e o valor mais recente do servidor, exigindo revisão em vez de sobrescrita. Acesso retirado mantém a ação como recusada e elimina o dado da consulta cujo acesso foi negado. Sessão ou prova recente vencida preserva a ação e solicita confirmação da identidade do mesmo portal. A fila de outro titular/papel não aparece nem é enviada.

Operações de senha, login e MFA exigem conexão e não guardam credenciais. Cobrança, execução de estorno, checkout definitivo e exclusão definitiva exigem confirmação conectada; a intenção sem credenciais pode permanecer para revisão. Não se inicia movimentação financeira a partir de uma tentativa invisível. Dados documentais obrigatórios, aprovação de loja, estoque, preços, localidade e demais regras do servidor continuam sendo exigidos.

## Persistência e servidor

- IndexedDB `hvm-rural-v1` foi atualizado da versão 1 para a 2, preservando comandos e snapshots anteriores. Novos stores: `portal_requests`, `portal_cache`, `portal_drafts`, `portal_uploads`.
- Leituras e sessão resumida têm validade de sete dias. Filas e arquivos pendentes não possuem expiração automática. Sem snapshot consultado anteriormente, a aplicação informa a indisponibilidade; não fabrica dados.
- Limites por portal: 500 ações/64 MiB; documentos, 30 arquivos/64 MiB; arquivo até 15 MiB, respeitando os limites menores de cada funcionalidade. Cache de consultas limitado a 250 caminhos/12 MiB e 512 KiB por resposta. Falha de armazenamento é informada e nunca apresentada como salvamento bem-sucedido.
- Logout limpa sessão e consultas privadas, mas conserva trabalho pendente e rascunhos para o titular original. Exclusão confirmada de um perfil apaga somente o seu escopo, incluindo os respectivos recibos no banco.
- `X-HVM-Offline-Scope` é uma expectativa de identidade, jamais uma autorização. `X-HVM-Offline-Id` identifica a tentativa; o cliente só remove JSON da fila quando recebe o recibo correspondente do servidor.
- Serviços SQL participam da transação do recibo via contexto assíncrono; transações internas viram savepoints. Mutation e recibo são confirmados juntos, com recuperação da resposta original após perda de rede. O papel SQL configurado do backend permanece igual ao das chamadas online.
- Serviços que usam Auth, Storage ou provedores mantêm sua idempotência de domínio, sem manter conexão SQL ocupada durante a chamada externa. Uploads binários conservam a idempotência do serviço de mídia.
- RLS e grants continuam restringindo clientes diretos. `app_offline_request_receipts` possui RLS forçado, nenhuma leitura/gravação por anon/authenticated, chave composta por titular/papel/ID e FK ao perfil do portal. Não armazena o corpo do pedido ou credenciais.
- Migração aditiva: `20261011164621_portal_offline_receipts.sql`. Schema lógico 74, 81 migrações, hash `3eb3a0f0f4e56ec4a813c0a3e7cefcfc056451b05bdd443cc5c8c6ae0bf49b2c`. Nenhum byte do histórico anterior foi alterado.

## Validação

TypeScript completo; build com os gates existentes; segurança e bundle; manifesto e PWA. Build estático com 89 recursos e zero recursos privados no cache do Service Worker. PostgreSQL 17 novo e descartável recebeu as 81 migrações de zero.

1.352 verificações gerais aprovadas; 533 condicionais puladas quando não foram fornecidas suas credenciais/ambientes específicos. Em execução separada, 110 verificações aprovadas em sete arquivos: 88 casos com PostgreSQL/HTTP real, incluindo quatro perfis no React, e 22 casos de fronteiras/política. Casos novos exercitam perfil real, cinco etapas rurais reais, rollback documental, revisão concorrente, resposta perdida, abas simultâneas, expiração de prova, permissões e exclusão de recibos por perfil.

12 cenários de transporte no Chromium verificam arquivos persistidos, upload renovado, bytes intactos, credenciais ausentes, confirmação financeira, falha transitória, autenticação, ordem, recibo ausente, negação de cache, armazenamento indisponível e limpeza independente. Cenários PWA usam dois builds Vite reais e Service Worker; as APIs de identidade/negócio são fixtures declaradas. Os dados SQL são exercitados separadamente, sem usar clientes reais como teste. A evidência final da bateria PWA e da publicação fica em `docs/evidence/offline-portais-2026-10-11/validacao.json`.

## Operação e limites

É necessário abrir o aplicativo conectado para estabelecer a identidade e carregar os dados de trabalho. O navegador pode suspender uma aplicação fechada; a sincronização automática retoma quando ele permite execução, quando a aplicação fica ativa ou ao reabrir. Não há promessa de execução contínua com o aplicativo encerrado no iOS/Android. Desinstalação, limpeza manual dos dados ou perda do aparelho removem o armazenamento local ainda não enviado.

Esta entrega publica o site/PWA e os contratos do transporte existente. Instalação física e binários Android/iOS requerem sua homologação própria. Nenhum login de cliente real, envio SMTP, cobrança, estorno ou exclusão de conta real é executado na validação. A atualização silenciosa preserva formulários, arquivos e todas as filas antes de ativar outra versão.

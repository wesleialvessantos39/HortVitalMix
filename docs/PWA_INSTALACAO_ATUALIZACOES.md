# HortiVitalMix — instalação e atualização web

O canal atual é **um único PWA**, servido pela Vercel a partir da main. Não há build de APK/IPA/AAB, loja, assinatura, empacotador, serviço OTA, contratação ou nova aplicação para esta entrega. O mesmo backend Supabase, Auth, Storage, banco e quatro perfis continuam em uso.

## Entradas e permissões

- `/`: dois cartões de instalação.
- `/aplicativos`: instalação, versão, benefícios, compatibilidade e ajuda.
- `/instalar/android` e `/instalar/ios`: página compartilhada com assistente aberto, sem entregar binário.
- `/admin/aplicativos`: nova central PWA. Administrador precisa do poder `platform_configuration`; Super administrador também respeita negação explícita. O gate e o principal canônico existentes foram preservados.
- `/downloads/android` e `/downloads/ios`: canais nativos históricos, preservados. Não se confundem com PWA nem são necessários para instalá-lo.

Os cinco workflows ativos e os auxiliares exclusivos de orquestração/sincronização Actions foram removidos. Registros históricos do Livro Raiz/documentação e os módulos, contratos, assinaturas, recibos e APIs nativas continuam preservados. A central PWA não chama nem depende deles. Não é necessário executar CI para obter uma versão PWA.

## Android

O gerenciador captura `beforeinstallprompt` antes de montar React e conserva o evento até um gesto do usuário. O botão abre o prompt real se o evento estiver disponível e os requisitos tiverem sido verificados. O nome/ícone vêm do manifesto oficial. Aceitação e cancelamento são distintos; `appinstalled` confirma o navegador, mas não equivale a estar executando em standalone.

Sem evento válido, o botão abre ajuda contextual para Chrome, Edge, Samsung Internet ou Firefox. No computador, os dois assistentes permitem copiar um endereço para o telefone. Navegadores internos orientam a abertura externa. Não se promete instalação automática ou uma API que não exista.

## iPhone e iPad

No Safari, o botão mostra três instruções compactas: Compartilhar → Adicionar à Tela de Início → Adicionar, mantendo Abrir como App da Web ativado quando disponível. Não pede abrir o Safari novamente nem copiar endereço. Em outro navegador iOS reconhecido, orienta seu próprio menu e oferece Safari como alternativa quando necessário. Ajuda recolhida explica Editar Ações e Ver Mais no iPad.

Quando for preciso abrir o endereço, **Abrir instalação** abre diretamente `/instalar/ios#passos` em nova aba com as instruções, sem copiar/colar. `noopener noreferrer` protege a origem; o fragmento controla apenas a apresentação. A cópia permanece recolhida somente para falha de abertura. WhatsApp/Instagram/Facebook recebem orientação de saída externa; o aplicativo que hospeda o navegador decide se o link pode abrir fora dele. O link não promete forçar Safari, instalar ou confirmar a instalação. Não há API equivalente à confirmação Android no Safari atual; [pesquisa em fontes primárias de outubro de 2026](PESQUISA_INSTALACAO_IOS_2026-10-10.md).

UA Client Hints, plataforma, User-Agent e toque identificam o dispositivo sem coleta remota de identificadores. iPad com `MacIntel` e múltiplos pontos de toque é reconhecido. `display-mode: standalone` e `navigator.standalone` identificam execução instalada; nenhuma preferência gravada finge uma instalação. Nesse ambiente, os cartões dão lugar ao estado instalado e à verificação de atualizações.

## Identidade real e publicação

O plugin lê os **bytes finais escritos pelo Vite/Rolldown**, incluindo imports já resolvidos. Gera `pwa-version.json` com commit fornecido pela Vercel (ou Git local), versão do package.json, identidade SHA-256 do conjunto e hashes/tamanhos de cada recurso. O HTML carrega essa identidade em `meta[name=hvm-pwa-build]`. A data de publicação permanece `null` porque o build não pode comprovar antecipadamente o horário do deployment; a interface informa a data real da última verificação.

A identidade dos recursos muda quando muda o build e não é um número de APK/IPA. Não há selo canônico fictício, segredo, token, dado administrativo ou documento no manifesto. A atualização PWA independe de `app_releases`; o registro canônico existente só pode receber a SHA efetivamente observada depois de READY, com schema/hash verdadeiros.

`npm run pwa:verify` confere hashes/tamanhos finais, PNGs 192/512, manifesto, vínculos HTML, sintaxe do worker e headers de atualização. É obrigatório no build local e no buildCommand Vercel, junto aos gates anteriores preservados.

## Cache e ativação

Há somente um registro global `/offline-worker.js`, scope `/`, `updateViaCache: none`, fora do Capacitor. O banner do produtor consome o estado compartilhado e conserva sua sincronização anterior.

1. A instalação de um candidato baixa todos os recursos essenciais, com três downloads concorrentes, timeout, HTTPS/origem local, sem credenciais e sem redirects. Cada byte é verificado por SHA-256/tamanho antes de entrar no cache próprio.
2. Falha rejeita o candidato e remove somente o seu cache parcial, depois de os downloads concorrentes terminarem. A versão anterior continua funcional.
3. Não há `skipWaiting()` incondicional. O worker aguardando recebe uma solicitação; consulta **todas as janelas**, incluindo abas não controladas, em duas etapas. Abas suspensas, antigas sem protocolo ou sem resposta adiam a transição.
   O primeiro worker ativa naturalmente, sem votação para substituir uma versão inexistente. O gerenciador revalida o worker aguardando depois de cada consulta assíncrona; uma mensagem de preparação atrasada de um worker já ativo não bloqueia a digitação.
4. Cada aba verifica sessão, rota, operações API, arquivos, modais, formulários, operações da cesta, escritas/sincronização e toda a fila local. Uma concessão breve impede novos gestos e novas escritas durante a votação, com retomada em caso de aborto. Nenhuma operação existente é interrompida ou reenviada.
5. Abas em segundo plano recebem a identidade do mesmo candidato verificado, sem depender de uma consulta de versão que o sistema operacional tenha suspendido.
6. Após ambas as confirmações, `skipWaiting()` ativa a versão. A recarga tem nova avaliação síncrona e durável; nunca é uma recarga sem guardas. Se o ambiente mudar, a aba conserva seu trabalho e os recursos da sua versão anterior.
7. `clients.claim()` só ocorre quando **todas** as janelas já executam exatamente o build ativado. Isso habilita offline no primeiro acesso sem recarregar formulários. Em versões mistas/abas sem resposta, não há claim indiscriminado.

Navegações usam o shell da versão do worker; imports JS/CSS com hash permanecem vinculados a seus arquivos, inclusive chunks antigos em abas abertas. Limpeza conserva o build ativo, todos os builds identificados por abas e um anterior; sem resposta confiável, preserva todos. Falha de limpeza opcional não derruba um worker íntegro. Nenhum comando de atualização apaga IndexedDB, tokens ou sessões.

Não se cacheia API, bearer, documentos, downloads nativos, fotografias privadas ou respostas de outras origens. O cache armazena somente HTML estático do Vite, JS/CSS, manifesto, favicon e ícones oficiais. Autenticação, RLS, uploads privados, cookies e segurança do transporte anterior permanecem em vigor.

## Quando a atualização é verificada

Ao abrir, foco/primeiro plano, retorno da conexão, mudança de visibilidade, manualmente e a cada minuto enquanto visível. Um candidato aguardando é reavaliado periodicamente e após mudança de atividade. Rotas de edição, checkout/pagamento e outras atividades que não estão na lista segura continuam protegidas até o retorno a uma página segura. Formulários em montagem permanecem protegidos durante a verificação de sessão.

Os formulários deixam o estado editado por `reset` ou por `hvm:form-saved` disparado no próprio formulário depois de confirmação real. Um submit, isoladamente, não prova que os dados foram salvos. Fila offline de qualquer conta local, inclusive conflitos, bloqueia a atualização sem expor linhas de outra conta. IDs/idempotência, journal remoto, snapshots por conta e TTL anteriores continuam intactos.

Vercel usa no-store no worker/versionamento/HTML de entrada e APIs; manifesto é revalidado e assets com hash são imutáveis. CSP, HTTPS, main-only e pdx1 permanecem. Não há garantia de execução enquanto offline ou totalmente suspenso pelo Android/iOS; a verificação retoma na próxima oportunidade.

## Verificação e limites

Diagnóstico anterior: [AUDITORIA_PWA_2026-10-10.md](AUDITORIA_PWA_2026-10-10.md). Evidências e resultados finais: `docs/evidence/pwa-2026-10-10/` e nova entrada do Livro Raiz.

Os testes de navegador usam dois builds Vite reais, worker/cache/IndexedDB reais e fixtures locais de Auth/API. Os eventos de instalação, sinais iOS/Android e standalone são simulados explicitamente. Isso **não comprova instalação física, ícone real, login instalado ou políticas de suspensão em Android/iPhone**.

Pendências físicas: Chrome/Edge/Samsung Android; Safari iPhone/iPad; confirmação/cancelamento e ícone; abertura standalone; login dos quatro perfis; sessão após reabertura; uso rural offline, reconexão e sincronização; update em aparelhos com telas/abas suspensas e rede intermitente. O cache também continua sujeito a espaço disponível e políticas de armazenamento do navegador.

Na primeira migração, uma aba anterior sem o protocolo de votação não pode ser forçada com segurança: deve terminar sua atividade e fechar/reabrir. A partir dos builds com este gerenciador, a ativação coordenada não exige reinstalação. Nenhum simulador é apresentado como instalação de aparelho real.

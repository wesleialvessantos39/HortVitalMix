# Instalação no iPhone e iPad — pesquisa e diagnóstico

Pesquisa realizada em **10/10/2026**, antes de modificar o instalador. Solicitação: aproximar a simplicidade do botão Android sem sair do PWA gratuito existente.

## Conclusão técnica

O Safari não oferece ao JavaScript da página a confirmação programática de instalação usada pelo Android. O caminho oficial continua sendo o **compartilhamento do próprio navegador → Adicionar à Tela de Início → Adicionar**. No layout compacto, o compartilhamento pode estar dentro do menu. O usuário deve manter “Abrir como App da Web” ativado, quando disponível.

Não é possível prometer “clicar no site e somente confirmar” no Safari com as APIs atuais. Uma janela desenhada pelo HortiVitalMix não seria a confirmação da Apple. Nome, ícone, modo standalone e atualização já são fornecidos pelo manifesto e pelo PWA existentes.

## Fontes primárias verificadas

1. [Apple: transforme um site em um app no Safari do iPhone](https://support.apple.com/pt-br/guide/iphone/iphea86e5236/ios). Descreve o menu/compartilhamento, a ação de adicionar, o controle de app web e a confirmação. Também orienta Editar Ações se a opção não aparecer. A página corrente consultada identifica iOS 27; não é evidência de teste físico.
2. [Apple: transforme um site em um app no Safari do iPad](https://support.apple.com/guide/ipad/open-as-web-app-ipad8f1f7a29/ipados). O compartilhamento pode exigir View More antes de Add to Home Screen. Não se deve fixar uma seta numa posição que varia entre dispositivos/layouts.
3. [WebKit: Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/). A partir dessa versão, sites adicionados à tela inicial abrem como app web por padrão; o controle continua pertencendo ao usuário. Isso não cria uma API de instalação para páginas.
4. [WebKit: posição sobre BeforeInstallPromptEvent, #619](https://github.com/WebKit/standards-positions/issues/619). Pedido de fevereiro de 2026, marcado `position: oppose`. É uma proposta, não suporte implementado no Safari.
5. [WebKit: posição sobre Web Install API, #463](https://github.com/WebKit/standards-positions/issues/463). Posição contrária, encerrada em maio de 2026. `navigator.install()` não resolve a instalação no Safari.
6. [Chrome: elemento HTML install, maio de 2026](https://developer.chrome.com/blog/install-element-ot). Experimento Chromium/Edge, com flag/origin trial; não é disponibilidade universal nem implementação iOS/Safari.
7. [MDN: beforeinstallprompt](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event) e [Navigator.share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share). Compartilhar uma URL não equivale a instalar nem comprova a presença da ação de adicionar à tela inicial.
8. [Apple: SFAddToHomeScreenActivityItem](https://developer.apple.com/documentation/safariservices/sfaddtohomescreenactivityitem) e [WKWebView](https://developer.apple.com/documentation/webkit/wkwebview). As APIs nativas e o entitlement pertencem a aplicativos de navegador; não são acessíveis ao React/JavaScript do site. [Implementação Web Share do WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Cocoa/WKShareSheet.mm): o compartilhamento web prepara texto, URL e arquivos, não uma chamada de instalação. A inexistência de garantia de instalação via `share()` é a conclusão da análise conjunta dessas fontes.
9. [WebKit: navegadores terceiros desde iOS/iPadOS 16.4](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/). Podem oferecer adicionar à tela inicial em seu próprio menu. A interface deve orientar esse menu e oferecer Safari quando a opção estiver ausente, sem exigir troca de navegador desnecessariamente.

Perfis de configuração/Web Clips, Atalhos, SDK nativo ou distribuição alternativa não oferecem a confirmação PWA equivalente no site. Exigiriam outros fluxos/aplicativos/configuração e não atendem à solução PWA única solicitada. Nenhum deles será instalado, gerado ou contratado.

## Diagnóstico do código e das imagens

Base inspecionada: main `1bb5e2cf824bb7358eef3625d4cde1824c195ec5`. Livro Raiz e guia PWA consultados; arquivos completos de cartões, estilos e detecção, registro/prompt global e testes relevantes revisados. Rotas e manifesto permanecem os da implementação existente.

`src/components/pwa/PwaInstallCards.tsx` apresentava quatro cartões grandes, instrução para abrir Safari mesmo dentro dele, campo de URL/cópia e parágrafo técnico para todos os dispositivos. A fotografia confirma a extensão desnecessária do assistente. O prompt real era condicionado ao rótulo Android; a disponibilidade deve ser decidida pelo evento real e pelo dispositivo correspondente ao botão.

`src/lib/pwaDevice.ts` já reconhece Safari, Chrome, Edge, Firefox, navegadores internos e iPad com identificação Mac/toque. `src/lib/pwaManager.ts` conserva o evento real e distingue aceitação, cancelamento, confirmação e execução standalone. Atualizações automáticas, votação entre abas, proteção de operações e IndexedDB não precisam ser modificadas.

## Ajuste definido

- No Safari de iPhone/iPad: três instruções curtas e ilustradas; sem abrir Safari novamente, copiar endereço ou botão intermediário para fingir instalação.
- Em navegador iOS externo reconhecido: usar seu próprio compartilhamento; ajuda recolhida para abrir no Safari se a opção estiver ausente.
- Em WhatsApp/Instagram/outros navegadores internos: instrução de saída externa e endereço copiável; não orientar instalação dentro de uma WebView incompatível.
- Em computador, Android usando o botão Apple ou dispositivo desconhecido: endereço de entrada iOS para abrir no dispositivo correto; instruções completas recolhidas.
- Orientação adicional do proprietário: **Abrir instalação** abre diretamente uma nova aba em `/instalar/ios#passos`, com ajuda visível para continuar; não exige copiar o endereço. A cópia fica apenas como alternativa recolhida se a abertura falhar. O fragmento é uma indicação visual, sem credenciais ou concessão de poder; `noopener noreferrer` protege a origem. Um link HTTPS não pode garantir saída do navegador interno para Safari: quem decide isso é o aplicativo/navegador hospedeiro. Nessa situação a ajuda orienta seu menu externo. Não são usados esquemas privados ou não documentados para prometer uma abertura garantida.
- Ajuda recolhida para Editar Ações, layouts diferentes, Ver Mais no iPad e modo app web. Não afirmar conclusão ao copiar ou fechar as instruções.
- Usar prompt programático somente quando o navegador realmente entregar um evento válido, o PWA estiver pronto e o dispositivo corresponder ao botão. Isso prepara a aplicação para capacidades reais sem alegar suporte Safari inexistente.

## Validação e publicação

Resultados, arquivos modificados, commit e deployment confirmados estão na nova entrada do Livro Raiz e nas [evidências](evidence/ios-instalacao-2026-10-10/publicacao-funcional.json): TypeScript/build/gates, 49 testes PWA, 62 cenários de navegador, 123 verificações HTTP e 23 visitas ao domínio real. A abertura da URL em nova aba foi executada de fato no Chromium; não há fixtures de API na verificação pública. A prontidão do primeiro cache foi aguardada separadamente do estado de versão atual, preservando as verificações de layout. Testes de sinais iOS em Chromium verificam a lógica e a interface; **não comprovam instalação física no Safari ou ícone real no iPhone/iPad**.

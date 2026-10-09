# Transporte Android/iOS e domínio próprio — 9 de outubro de 2026

## Implementação

O navegador web usa `/api` na própria origem, inclusive em um novo domínio conectado à Vercel. Somente os hosts conhecidos do Google AI Studio usam o proxy `/_hvm_api` como primeira opção. Um HTML de SPA recebido por uma leitura nesse proxy pode usar a alternativa `/api`; uma resposta HTML 200 de um comando não causa repetição do comando.

O bundle Capacitor usa o plugin oficial `CapacitorHttp` explicitamente. A interceptação global de `fetch` deve permanecer desligada. O servidor da aplicação é `https://hortvitalmix.vercel.app` ou uma origem HTTPS aprovada pelo responsável no momento da compilação, por `VITE_HVM_NATIVE_BACKEND_ORIGIN`. Nenhum parâmetro de link, manifestação de atualização, perfil ou notificação pode trocar essa origem. A origem configurada não aceita credenciais, porta alternativa, caminho, fragmento, endereço IP ou host local.

As chamadas nativas ficam restritas a `/api/v1/`, `/api/health` e `/api/ready` da origem compilada. Redirecionamentos de API são desabilitados, segmentos codificados de travessia são recusados e uma resposta com URL final externa é rejeitada. O plugin envia `Origin` igual à origem HTTPS do backend. Essa informação preserva a validação de origem existente; não substitui senha, sessão ou autorização. O servidor não ganhou CORS aberto nem exceção para `capacitor://localhost` ou `http://localhost` em produção.

As sessões de produtor e consumidor seguem usando os cookies HttpOnly do backend, no armazenamento de cookies do transporte nativo. O token administrativo segue restrito aos endpoints administrativos. Não se grava um cookie HttpOnly em localStorage nem se retorna `Set-Cookie` para os componentes. Renovação e encerramento usam o mesmo transporte.

O plugin HTTP não fornece cancelamento nativo por `AbortSignal`. A chamada JavaScript abortada deixa de usar sua resposta, mas continua registrada como pendente até o encerramento real do plugin. A troca de identidade e o encerramento aguardam as operações de sessão ainda pendentes. O aviso de atualização também vê comandos e sessões nativos pendentes, impedindo que esse intervalo pareça livre para uma atualização.

Os arquivos protegidos passam por `fetchApiFile`: usa a origem confiável, inclui o bearer administrativo quando aplicável e transforma os bytes recebidos pelo plugin em um Blob local. Isso abrange a conferência documental e o PDF/imagem do imóvel; evita exigir que o WebView leia um cookie de outro domínio. Links de tela cheia usam esse Blob quando o app está empacotado. Fotos públicas usam a API absoluta confiável definida por `apiBase()`.

## Domínio próprio

Conectar um domínio à mesma aplicação Vercel não exige mudar o banco Supabase ou criar outro backend. O navegador passa a chamar `/api` no novo domínio. A aplicação instalada pode continuar usando a origem Vercel estável, que deve ser mantida; trocar a origem compilada requer uma nova versão nativa. Não usar redirecionamento HTTP da API antiga para o domínio novo, pois o transporte deliberadamente recusa redirecionamentos de API.

Quando houver um domínio real, o responsável deve adicionar esse domínio ao projeto Vercel e confirmar HTTPS, adicionar apenas as URLs de retorno necessárias ao Auth do Supabase e manter os registros de e-mail MX/TXT. Não foram inventados domínio, registros DNS, certificados ou URLs de callback. Os e-mails continuam abrindo o fluxo web existente; esta implementação não adiciona deep links que importam sessões automaticamente para o app.

## Validação e limites

A suíte de transporte passou 97 de 97 testes em sete arquivos. Inclui o aplicativo Express com configuração de proteção de origem de produção, todas as rejeições de origem local/externa, domínio próprio simulado, renovação de sessão, arquivo privado, aborto com operação nativa pendente, isolamento do servidor e impedimento de repetição de senha/comando. Registro: `docs/evidence/transporte-mobile-2026-10-09/unit.log`.

Os testes de bridge são emulados. Não equivalem a um APK/IPA assinado rodando em um aparelho real. Antes de distribuir o aplicativo, verificar em Android e iOS: login dos quatro perfis; sobrevivência dos cookies ao reiniciar; refresh; saída por convite inválido; bloqueio de acesso após logout; PDF/foto; conectividade interrompida; troca de domínio e tratamento de links externos. A transferência de arquivos grandes pela ponte tem limites próprios do plugin e precisa ser verificada com os arquivos máximos aceitos pelo produto. Empacotamento e assinatura continuam sujeitos aos certificados e contas reais das lojas.

Referência consultada: documentação Capacitor HTTP e tipos do pacote `@capacitor/core`, incluindo `disableRedirects`, `connectTimeout`, `readTimeout` e ausência de cancelamento por `AbortSignal`.

Uploads JPEG por API são convertidos para base64 com `dataType:file`, preservando os bytes e o Content-Type no plugin HTTP. A aplicação Android utiliza mínimo API26 porque a implementação travada do plugin não decodifica o corpo binário em API24/25. Upload de documentos por URL assinada utiliza o transporte web sem cookies do backend. O tamanho adicional da ponte deve ser homologado no aparelho antes da distribuição.

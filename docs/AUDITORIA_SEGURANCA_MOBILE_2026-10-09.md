# Auditoria independente de segurança mobile — 9 de outubro de 2026

Esta revisão verificou código, contratos e testes locais da integração Android/iOS, dos downloads e da sincronização de versões. Não enviou convites, alterou pessoas, executou autenticação real nem publicou pacotes em produção.

## Resultado verificado

- **88 testes passaram**: transporte nativo, proteção de origem em produção, domínio próprio, assinatura GitHub OIDC e contratos de versões/artefatos.
- **15 testes do pipeline passaram**: identificação do pacote, certificado, versões, origem do callback, impressão do runtime e reutilização de artefatos em tentativas do mesmo workflow.
- Os cinco SHAs fixados das GitHub Actions foram consultados na API pública dos respectivos repositórios e existem. A consulta não usou credenciais.

Logs e respostas resumidas estão em [evidence/seguranca-mobile-2026-10-09](evidence/seguranca-mobile-2026-10-09/). São testes com identidade e artefatos sintéticos; eles não equivalem a testes em um aparelho.

## Fronteiras conferidas

**Sessões e domínio.** O aplicativo usa uma origem HTTPS definida na compilação assinada. URLs recebidas em parâmetros, notificações ou manifests não escolhem o servidor de autenticação. O transporte limita chamadas à API desse servidor, bloqueia redirecionamentos, retira sobrescritas de Cookie/Host e não entrega Set-Cookie ao restante da aplicação. O navegador mantém chamadas em `/api` do próprio domínio; o proxy alternativo permanece restrito às origens conhecidas do Google Studio.

A proteção de origem do servidor continua ativa. `X-HVM-Request` não autoriza sozinho uma mutação em produção, e origens `capacitor://localhost`, HTTP local ou um site externo não ganharam acesso CORS com credenciais. O transporte nativo apresenta a origem do seu backend HTTPS. O callback de CI apresenta essa mesma origem e ainda precisa de um JWT GitHub válido.

O cancelamento JavaScript de uma chamada nativa não cancela necessariamente a operação do sistema operacional. Por isso, renovações/login nativos continuam contabilizados até o resultado real da ponte, e a saída/confirmação de identidade aguarda sua conclusão antes de revogar a sessão. O teste de renovação abortada verifica essa ordem.

**Identidade do CI.** A verificação exige assinatura RSA-SHA256 obtida no JWKS fixo do GitHub, audience fixo, repositório e proprietário exatos, branch `main`, workflow conhecido, ambiente `mobile-release`, evento permitido e runner hospedado no GitHub. Validade e idade do JWT têm limites. Cabeçalhos `jku`, `x5u`, algoritmos alternativos e tokens adulterados são recusados. O commit enviado deve coincidir com o commit autenticado pelo token. Essa identidade é tratada antes do middleware de sessão Supabase; o token de CI não vira login de um usuário.

**Pacotes e publicação.** O workflow de Android verifica application ID, versão e build reais com `aapt`, assina o APK, executa `apksigner verify` e compara o certificado à impressão fixada. O servidor limita origem/caminho do Storage, redirects, tamanho e SHA-256 por leitura dos bytes. Essa leitura do servidor confirma integridade e formato ZIP; a prova da assinatura do APK vem do workflow autenticado, que executa a verificação nativa.

A primeira assinatura aguarda publicação explícita de um administrador com `platform_configuration` e autenticação recente. Essa publicação fixa o assinante. Outros certificados não substituem silenciosamente o aplicativo. Comandos revalidam o poder no banco, respeitam negações inclusive para Super administrador, exigem revisão atual e vinculam a repetição idempotente ao ator, operação e conteúdo.

No iOS, o workflow verifica assinatura, equipe, application ID, versão/build e ausência da permissão de depuração do IPA exportado, antes do envio à Apple. Um upload aceito ainda pode estar em processamento no App Store Connect/TestFlight. Portanto, o servidor mantém o candidato aguardando aprovação do canal oficial e rejeita ativação de publicação automática para iOS.

**Retirada e tentativas antigas.** A revisão identificou e solicitou correção do caso em que um CI atrasado podia publicar automaticamente uma versão menor depois da retirada da versão atual. O serviço agora compara o build à maior versão anteriormente publicada, inclusive as retiradas; candidatos antigos permanecem disponíveis para revisão administrativa. Restaurar uma versão é uma ação explícita, e o mínimo de segurança não diminui por retirada/restauração.

Também foi corrigida a repetição de um workflow: nomes dos artefatos privados usam o run ID, permitindo reutilizar o resultado de etapas já aprovadas. Uma nova tentativa só repete um build existente quando seu conteúdo é idêntico; bytes, certificado, commit ou metadados diferentes não sobrescrevem a versão. Caminhos de APK incluem build e SHA, e uploads não têm `upsert`.

**Avisos e dados em edição.** A versão instalada vem de `App.getInfo`, sem inferência por user agent. Instalação é uma ação explícita, com bloqueio durante edição, envio, confirmação de identidade e ações duráveis ainda sem sincronizar. Links passam pelas rotas estáveis do backend assinado. No aplicativo Capacitor com arquivos embarcados, o aviso de atualização web não oferece recarregamento que fingiria instalar um novo bundle.

## Limites da comprovação

O pacote escolhido usa arquivos web embarcados no Capacitor. Alterações de banco, backend e configurações servidas pela API chegam aos aplicativos instalados; alterações dos arquivos embarcados exigem uma nova versão assinada. **OTA de frontend não está implementado**, e `server.url`/`allowNavigation` de desenvolvimento não foram habilitados como atalho de produção.

Compilação, assinatura e instalação reais dependem do ambiente Android/macOS, dos certificados e das contas de distribuição. A ativação do pipeline assinado também depende das configurações e proteções do ambiente `mobile-release`. Esta auditoria não certifica login/cookies após reiniciar um aparelho, upgrade sobre uma instalação anterior, disponibilidade de uma versão na Apple nem existência de um APK/IPA publicado. Essas validações devem ocorrer antes de habilitar as variáveis de liberação; artefatos de verificação sem assinatura não são downloads públicos.

Um domínio próprio futuro usa as mesmas rotas e banco do projeto Vercel. A origem dos aplicativos já instalados permanece a definida na sua assinatura; manter a origem canônica evita trocar o backend por um redirect arbitrário. Esta revisão não conectou um domínio que ainda não foi informado nem alterou DNS ou remetentes de e-mail.

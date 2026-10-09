# Android, iOS e atualizações do HortiVitalMix

A arquitetura selecionada é **Capacitor 8 com HTML, CSS e JavaScript embarcados**, usando a mesma API da Vercel e o mesmo Supabase do site. Não há um segundo banco de dados e o aplicativo não executa migrações. O projeto nativo reproduzível está em `packaging/capacitor`; as propostas anteriores de TWA e de um shell Swift remoto foram retiradas para manter uma única estratégia.

## O que atualiza automaticamente

| Alteração | Comportamento |
| --- | --- |
| Produtos, pedidos, usuários, notificações e conteúdo do Supabase | A API apresenta os dados atuais sem gerar outro instalador. |
| Correção compatível no backend da Vercel | Os aplicativos instalados usam a API corrigida. O backend deve continuar atendendo as versões instaladas. |
| Layout ou funcionalidade do site | O site recebe o deploy. Como o aplicativo usa arquivos embarcados e OTA ainda não está homologado, o workflow gera um novo pacote nativo. |
| Plugin, permissão, SDK ou componente nativo | Exige um novo APK/AAB ou uma versão distribuída pela Apple. |
| Mudança incompatível do contrato ou requisito mínimo | A Central de Aplicativos indica a versão mínima suportada e o aplicativo oferece o canal oficial de atualização. |

**OTA de código web está indisponível nesta implementação.** Não existe uma instalação silenciosa, um serviço Capgo contratado nem um `server.url` de live reload disfarçado de configuração de produção. Ativar OTA futuramente exige assinatura das versões web, verificação de compatibilidade com o runtime, recuperação da versão anterior e testes que preservem formulários e a fila offline. O sistema apresenta esse estado real.

## Sincronização automática da publicação web

O job `web_sync` usa a origem fixa `https://hortvitalmix.vercel.app`, aguarda até 20 minutos pelo runtime da SHA daquela execução e chama `POST /api/v1/mobile-ci/web-release`. A API verifica OIDC, ambiente de produção, commit do runtime e commit observado novamente no domínio canônico. Confere o histórico completo das migrations já aplicadas, incluindo os timestamps físicos do Supabase, antes de alterar somente `app_releases`. Não executa SQL de migração, não copia o banco e não toca em usuários, pedidos ou Auth.

O histórico é preservado, uma repetição da versão corrente é idempotente, e execuções anteriores ou SHAs já arquivadas são recusadas. Lock e comparação da revisão evitam que dois jobs sobrescrevam o selo. A conferência do alias e a transação do Supabase pertencem a serviços distintos: a garantia corresponde à SHA observada no domínio canônico durante a sincronização, sem atomicidade com uma promoção externa na Vercel.

A central só declara a versão web disponível quando o selo corresponde ao deployment real. Erros de autenticação, schema ou integridade deixam o job falhar, sem marcar uma atualização inexistente como concluída. Migrações futuras continuam exigindo aplicação controlada antes da publicação. Para repetir apenas uma sincronização falhada, use **Actions → execução da main → web_sync → Re-run failed jobs**; uma SHA antiga não pode restaurar outra versão.

## Projetos e identidade instalada

- App ID proposto: `br.com.hortivitalmix.app`, ainda sem publicação conhecida nas lojas. Confirme esse identificador antes da primeira publicação; depois mantenha-o e mantenha a assinatura para que a instalação seguinte atualize o aplicativo existente.
- Android: SDK mínimo 26 (Android 8), compile/target SDK 36, Java 21, Gradle 8.14.3 com checksum oficial do wrapper.
- iOS: mínimo 15, projeto Xcode e Swift Package Manager gerados pelo Capacitor.
- Dependências exatas e dois lockfiles: Capacitor 8.5.3, App 8.1.2 e Browser 8.0.5.
- Ícones e splash utilizam a identidade real de `public/favicon.svg`; regenere com `node scripts/mobile/native-brand.mjs` quando o ícone mudar.
- O cliente lê plataforma e versão/build **do pacote instalado**, por `Capacitor.getPlatform()` e `App.getInfo()`. A impressão do runtime é compilada em `VITE_HVM_NATIVE_RUNTIME_HASH` e calculada a partir do projeto nativo, configuração e dependências travadas. Não usa o user agent como identidade de versão.
- HTTP é explicitamente realizado pelo adaptador nativo do aplicativo. O patch global do `fetch` está desativado; não há relaxamento geral de CORS, HTTP inseguro ou acesso arbitrário a servidores.

## Mesmo Supabase, backend e domínio próprio

A origem padrão da API embarcada é `https://hortvitalmix.vercel.app`. O aplicativo recebe somente a origem HTTPS pública e a identidade da versão. Credenciais do banco, service role, chaves de assinatura e credenciais Apple nunca entram no bundle.

Ao conectar um domínio próprio **ao mesmo projeto Vercel**, o site e o aplicativo continuam usando o mesmo Supabase. O alias canônico existente pode continuar servindo a API dos aplicativos já instalados. Configure no Supabase as URLs HTTPS de autenticação e recuperação utilizadas pelo site, preserve o alias canônico e mantenha a compatibilidade dos contratos. Não redirecione a API canônica a um host novo que o aplicativo antigo não conhece.

Se decidir mudar a origem da API embarcada, configure `HVM_NATIVE_BACKEND_ORIGIN` no GitHub antes do próximo pacote. O endereço é validado como origem HTTPS, sem usuário/senha, porta especial, caminho, parâmetros, hash ou loopback. Alterar o domínio usado pelo site não troca silenciosamente a origem confiável de um pacote já instalado. O domínio próprio e seus registros DNS precisam existir e ser confirmados na Vercel; nenhum domínio foi comprado ou anexado automaticamente.

A identidade de CI mantém a audiência estável `https://hortvitalmix.vercel.app/mobile-ci`. `HVM_MOBILE_CI_ORIGIN` pode selecionar o endereço HTTPS do mesmo backend, mantendo as mesmas regras de identidade. O processo não requer token GitHub permanente nem service role nos runners. A validação OIDC fixa os IDs do repositório e do proprietário, o ambiente `mobile-release` e o subject imutável do GitHub usado pelos repositórios criados após 15/07/2026. Não configure um subject personalizado sem ajustar e revisar essa fronteira. [Regra oficial](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims).

## Workflow automático

`.github/workflows/hvm-mobile-build.yml` roda em PRs, em alterações aprovadas na `main` e manualmente por **Actions → HortiVitalMix — Android e iOS → Run workflow**. PRs apenas documentais são ignoradas; todo push na `main`, inclusive documentação, verifica e sincroniza a identidade web publicada. O detector evita recompilar Android/iOS quando os arquivos embarcados e o projeto nativo não mudaram.

1. `npm ci` instala as dependências travadas do site e do workspace nativo.
2. Os testes do pipeline e os gates existentes verificam o build web.
3. O detector separa mudanças de servidor/dados das mudanças em arquivos embarcados ou no projeto nativo. Após os gates, o job `web_sync` aguarda a SHA completa na origem canônica da Vercel e sincroniza o selo web com identidade OIDC temporária. Não depende de assinatura Android nem conta Apple.
4. Para mudanças que exigem pacote, compila APK/AAB Android sem assinatura e iOS para simulador. Esses arquivos de validação não são oferecidos como instaladores.
5. Jobs de publicação são separados, executam somente na `main`, usam o ambiente `mobile-release` e ficam desativados até a configuração e homologação necessárias.
6. Android: verifica App ID, versão e build reais com `aapt`, assina com a chave permanente, verifica o APK com `apksigner`, confirma a impressão do certificado configurada e produz checksums. AAB fica como artefato privado para a distribuição pela Play Store.
7. iOS: importa certificado temporariamente, faz archive/export assinado, verifica a assinatura, Team ID, App ID, versão/build e ausência de entitlement de depuração; envia à Apple pelo App Store Connect.
8. A API recebe uma identidade temporária GitHub OIDC vinculada ao repositório, `main`, workflow autorizado, execução e tentativa. O Android é enviado a um caminho imutável no Supabase Storage; o servidor confere os bytes, tamanho e SHA-256 antes de registrar a versão.

A primeira versão entra como **verificada**, para publicação pela administração. Após aprovar a primeira assinatura, o departamento pode habilitar publicação automática Android para versões posteriores que mantenham essa identidade. **iOS continua exigindo confirmação do canal oficial após processamento/revisão Apple**; sucesso no upload de um IPA não comprova disponibilidade na loja.

## Configuração de publicação Android

No GitHub, em **Settings → Environments**, configure `mobile-release`, restrinja as branches de publicação à `main` e configure revisores conforme a política de publicação da equipe. Não forneça secrets a PRs.

Em **Settings → Secrets and variables → Actions**, configure:

| Tipo | Nome | Conteúdo |
| --- | --- | --- |
| Secret | `HVM_ANDROID_KEYSTORE_BASE64` | Keystore permanente codificado em base64. |
| Secret | `HVM_ANDROID_KEYSTORE_PASSWORD` | Senha do keystore. |
| Secret | `HVM_ANDROID_KEY_ALIAS` | Alias da chave de distribuição. |
| Secret | `HVM_ANDROID_KEY_PASSWORD` | Senha dessa chave. |
| Variable | `HVM_ANDROID_CERTIFICATE_SHA256` | SHA-256 real do certificado de distribuição, 64 caracteres hexadecimais. |
| Variable | `HVM_ANDROID_NATIVE_VERIFIED` | `true` somente depois de validar login, sessões, pedidos, documentos, fila offline e instalação/atualização em aparelho real. |
| Variable | `HVM_ANDROID_RELEASE_ENABLED` | `true` para habilitar os jobs de assinatura/publicação após a preparação. |
| Variable opcional | `HVM_MIN_SUPPORTED_ANDROID_BUILD` | Build mínimo suportado; padrão `1`. Nunca superior ao build publicado. |

Crie e guarde a chave de distribuição em local seguro. **Não gere uma nova chave a cada build**: Android não aceitará a atualização do APK instalado se o App ID ou assinatura mudarem. Os secrets devem ser configurados pela interface segura do GitHub, nunca no código ou no Livro Raiz.

O número de build vem de `github.run_number`; o ledger rejeita a reutilização de um build com bytes, assinatura ou metadados diferentes. Ao substituir o workflow ou importar um aplicativo anteriormente publicado, adapte a sequência antes de publicar para continuar acima da versão já instalada.

## Configuração iOS

É necessário ter conta Apple Developer, App ID e aplicativo App Store Connect registrados, certificado de distribuição e um canal real App Store/TestFlight. A Apple pode cobrar pela conta; esta infraestrutura não promete distribuição iOS sem custos externos.

| Tipo | Nome | Conteúdo |
| --- | --- | --- |
| Secret | `HVM_APPLE_CERT_P12_BASE64` | Certificado e chave privada de distribuição em P12, base64. |
| Secret | `HVM_APPLE_CERT_PASSWORD` | Senha do P12. |
| Secret | `HVM_APPLE_API_KEY_P8_BASE64` | Chave privada App Store Connect em P8, base64. |
| Secret | `HVM_APPLE_API_KEY_ID` | Identificador dessa chave. |
| Secret | `HVM_APPLE_API_ISSUER_ID` | Issuer ID da organização Apple. |
| Variable | `HVM_APPLE_TEAM_ID` | Team ID Apple real, 10 caracteres. |
| Variable | `HVM_IOS_DISTRIBUTION_URL` | URL existente da App Store ou do TestFlight; não invente um App Store ID. |
| Variable | `HVM_IOS_NATIVE_VERIFIED` | `true` somente após homologação em iPhone/iPad e atualização instalada. |
| Variable | `HVM_IOS_RELEASE_ENABLED` | `true` após configurar a assinatura e o envio Apple. |
| Variable opcional | `HVM_MIN_SUPPORTED_IOS_BUILD` | Build mínimo suportado; padrão `1`. |

A chave Apple precisa permitir o envio e provisionamento desse aplicativo. Contratos, permissões e registros iniciais Apple devem estar válidos. O runner elimina certificado/chave e keychain temporários ao encerrar o job. O IPA assinado permanece em artefato privado e nunca é oferecido no site como uma instalação comum por arquivo. Na Central, publique a versão somente depois de confirmar que o número correspondente está disponível no canal oficial.

## Downloads, administração e recuperação

Os botões públicos usam `/downloads/android` e `/downloads/ios`, que apontam para a versão atualmente publicada, e não para uma URL fixa antiga. Android usa um objeto imutável `app-downloads/android/<build>/<sha256>.apk`; não depende de download anônimo de releases de um repositório GitHub privado.

O departamento **Aplicativos** atende super administrador e administrador com `platform_configuration`. Ele apresenta identidade web, versões nativas, integridade, estado de sincronização, versões verificadas/publicadas/retiradas e operações autorizadas. Retirar uma versão não apaga banco de dados nem transforma arquivo inexistente em instalador. Uma reversão de distribuição seleciona uma versão anteriormente verificada; Android não instala silenciosamente um APK com build inferior.

Em um erro de CI, **Re-run failed jobs** pode consumir o artefato já produzido pela execução, pois o nome depende do run ID e não da tentativa. Repetir uma confirmação com o mesmo conteúdo é idempotente. Se recompilar produzir bytes diferentes para um build já registrado, faça **Run workflow** para obter um novo run number; o servidor bloqueia a sobrescrita desse build. Confira o ledger e o hash antes de decidir retirar ou publicar outra versão.

## Homologação indispensável antes do primeiro instalador público

Teste em Android e iOS reais: login de todos os papéis, manutenção e expiração da sessão, logout de cookie e bearer, convite/redefinição de senha, reautenticação, pedidos, carregamento de imagens, upload/download e visualização de documentos, câmera/arquivos quando suportados, navegação externa, teclado, safe areas, operação offline e fila pendente. Links de e-mail continuam usando a origem web HTTPS; esta implementação não adiciona importação automática de tokens nem deep links de autenticação.

Depois instale uma segunda versão assinada com a mesma identidade e confirme que dados locais, sessões válidas e a fila offline são preservados. Confirme também o comportamento de uma versão abaixo do mínimo suportado. Esse teste é diferente de compilar para simulador ou testar o site em navegador.

## Evidência desta implementação

Consulte `docs/evidence/pipeline-mobile-2026-10-09/`. Foram executados testes dos scripts, instalação limpa do workspace com lockfile, geração/sincronização dos projetos, validação do workflow com actionlint e inicialização do wrapper Gradle 8.14.3 com checksum oficial. Esses resultados **não comprovam APK/IPA assinado nem instalação física**. O executor desta implementação não possui Android SDK completo nem Xcode; a compilação dos projetos é responsabilidade dos runners configurados no workflow. Credenciais de assinatura, canais Apple e a homologação física precisam existir antes de habilitar os jobs de publicação.

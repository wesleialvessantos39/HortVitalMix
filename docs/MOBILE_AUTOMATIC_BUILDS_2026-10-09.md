# Automação mobile — preparação posterior à Trilha 25

O pipeline executará no push aprovado à main (ignorando alterações somente documentais) e por workflow_dispatch.
Gera os projetos nativos de modo efêmero e compila Android e iOS sem assinar.
Não substitui CI, dados, Supabase, Vercel ou mecanismos offline existentes.

A publicação do Android está **bloqueada por padrão** até que os testes físicos, a autenticação nativa e os contratos da API estejam homologados.
Para habilitar após a homologação: adicionar arquivo de evidência
docs/evidence/mobile-native-release-approved.txt, variável GitHub Actions
HVM_MOBILE_RELEASE_ENABLED=true e os secrets:
HVM_ANDROID_KEYSTORE_BASE64, HVM_ANDROID_KEYSTORE_PASSWORD,
HVM_ANDROID_KEY_ALIAS, HVM_ANDROID_KEY_PASSWORD.
O APK assinado e verificado é publicado no GitHub Releases (tag hvm-mobile-rN).

iOS no macos-26 compila para simulador **sem IPA distribuível**. IPA e atualizações
nativas exigem Apple Developer, certificados, profiles, xcodebuild archive/export,
testes físicos e canal de distribuição Apple autorizado. Não oferecer link direto
de IPA no Brasil como se fosse equivalente a instalação de APK.

**Pendências antes de qualquer publicação:** migrar URLs relativas /api e sessões
com cookies, CORS e CSRF para origem Capacitor sem enfraquecer o backend;
configurar ícones e branding; versionar dependências e projetos nativos
estabilizados; criar testes reais e validação de instalação/atualização.

O aviso de atualização no aplicativo deverá solicitar instalação do novo pacote
Android, sem executar instalação silenciosa. iOS direciona à loja aprovada;
conteúdo web/PWA pode receber atualizações próprias, preservando a fila offline
Trilha 25. Somente disponibilizar versões assinadas, funcionais e homologadas.

Esta preparação não comprova builds bem-sucedidos, APK/IPA assinados, nem atualizações já instaladas.

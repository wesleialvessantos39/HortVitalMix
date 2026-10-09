# Registro e sincronização de versões Android/iOS

O backend registra cada pacote produzido pelo workflow confiável, mantém a versão pública de cada plataforma e guarda o histórico de publicação, retirada e restauração. Metadados do pacote são imutáveis: nem o papel `service_role` pode alterar checksum, certificado, commit, tamanho ou número de build depois do registro. A alteração da publicação usa revisão, recibo de comando e auditoria, sem alterar produtos, pedidos, usuários ou dados operacionais.

## Fluxo de publicação

1. `.github/workflows/hvm-mobile-build.yml` compila e assina o pacote. O job autorizado roda no GitHub, no ambiente `mobile-release`, a partir de `main` do repositório `wesleialvessantos39/HortVitalMix`.
2. O job solicita ao GitHub um token OIDC de curta duração com audience fixa `https://hortvitalmix.vercel.app/mobile-ci`. Não recebe a chave `service_role` nem senha do banco. O servidor verifica a assinatura RS256 em JWKS oficial, issuer, audience, validade, repositório, branch, workflow, ambiente, evento e tipo de runner. Tokens de forks, pull requests, outros workflows ou ambientes não entram.
3. Android: `POST /api/v1/mobile-ci/uploads` prepara um upload sem sobrescrita, no caminho `app-downloads/android/<build>/<sha256>.apk`. O upload é enviado diretamente ao Supabase Storage, sem atravessar o limite de corpo das Functions da Vercel. O bucket é criado somente se ainda não existir; um bucket existente privado não é tornado público automaticamente.
4. `POST /api/v1/mobile-ci/releases` recebe metadados vinculados ao commit e à execução verificados. Para Android, o servidor busca o objeto na origem fixa deste projeto Supabase, confere tamanho, checksum SHA-256 e formato ZIP, e consome o recibo de preparação. A verificação de assinatura do APK é feita pelo `apksigner` no workflow confiável; ZIP e checksum no servidor não substituem essa verificação.
5. A primeira versão fica **verificada, aguardando publicação**. Um administrador com `platform_configuration`, ou Super administrador com esse poder, confirma a publicação após autenticação recente. Isso aprova e fixa o certificado daquela plataforma.
6. Depois dessa aprovação, a sincronização automática Android pode ser ativada. Apenas um build maior que **todos os builds anteriormente publicados**, inclusive retirados, e com o certificado aprovado, passa automaticamente a atual. Um workflow antigo que termina atrasado fica como candidato verificado, sem desfazer uma retirada.
7. iOS: upload de IPA é anterior ao processamento e à aprovação da Apple. Por isso o callback registra apenas um candidato verificado. Cada publicação pública requer confirmação administrativa de que aquela versão já está disponível no endereço oficial App Store/TestFlight. A API rejeita ativação automática iOS. O IPA assinado permanece como artefato privado do workflow; não existe instalação pública fictícia de IPA.

Proteja `main` e configure o ambiente GitHub `mobile-release` para permitir somente essa branch, com os responsáveis pela primeira configuração e pelas credenciais de assinatura. A assinatura RS256 do token prova a identidade do workflow, enquanto a proteção do repositório e do ambiente mantém o código do workflow confiável. Não compartilhe tokens OIDC ou URLs de upload nos logs.

## Selo web após cada publicação Vercel

O mesmo workflow inclui `web_sync` somente para `main` em `push` ou execução manual, com `id-token: write` no ambiente `mobile-release`. Inclui pushes documentais porque eles também alteram a SHA do runtime. Não usa segredo de banco, token permanente GitHub ou credencial Vercel; a API existente mantém sua conexão protegida ao Supabase.

`GET /api/v1/mobile-ci/web-release/status` informa somente ambiente e identidade pública do build, sem sessão, cookies ou consultas ao banco. O script aguarda o commit esperado; depois obtém um token OIDC novo e chama `POST /api/v1/mobile-ci/web-release` com `{sourceCommit}`. O servidor confere novamente o domínio canônico fixo sob lock, valida migrations já aplicadas e sela `app_releases` preservando o histórico. CAS, piso de execução CI autenticada e recusa de SHA arquivada impedem um job atrasado de repor uma release anterior.

`401/403` após o runtime correto são falhas de autorização, sem tentativas intermináveis. Tempo esgotado, história/schema divergentes, conflito definitivo ou recibo inválido falham explicitamente. Nenhuma DDL é executada por esse callback; nenhuma versão nativa é publicada por ele. Assinatura, build mínimo e aprovação Apple continuam governados pelos fluxos abaixo.

## APIs e histórico

- `GET /api/v1/mobile-releases`: política pública real, build atual, versão mínima, fingerprint do runtime, commit, schema, checksum, tamanho, canal e link permanente. Não devolve operador, identidade CI ou chaves.
- `GET /api/v1/admin/mobile-releases`: até 100 versões recentes, estado, certificado, execução CI, revisão, configurações e contagem de uploads realmente pendentes. O estado vazio é apresentado como aguardando a primeira versão; não são criados builds demonstrativos.
- `POST /api/v1/admin/mobile-releases/commands`: `publish`, `withdraw`, `restore` ou `configure`. O mesmo comando, ator e payload reproduz o resultado sem gerar nova auditoria; mudanças no ator ou payload são recusadas. Revisão antiga informa conflito, sem sobrescrever outro operador.
- `GET /downloads/android` e `/downloads/ios`: a integração com distribuição resolve a publicação atual. A retirada não busca silenciosamente uma versão antiga ou um APK manual. APK manual só pode apontar para uma versão verificada e publicada do registro.

A versão mínima é um piso de segurança. Publicar uma nova versão pode elevar esse piso; retirar ou restaurar um pacote nunca o diminui. Uma restauração abaixo do piso é recusada. A identidade de assinatura também não é trocada por um formulário: trocar a chave Android sem tratar a linhagem de assinatura impediria a atualização dos aplicativos já instalados.

O fingerprint distingue runtimes nativos compatíveis. Ele não autoriza baixar e executar JavaScript remoto por conta própria. A implantação web continua atualizando backend e conteúdo remoto, enquanto mudanças de frontend empacotado, plugins ou permissões exigem novo pacote. O cliente usa a identidade real do pacote instalado para comparar build e piso, e mantém suas operações pendentes ao apresentar a atualização.

## Recuperação de sincronização

Uma URL de upload permite somente inserir o caminho preparado e expira em até duas horas. Um callback sem preparação, com objeto ausente, tamanho/checksum divergente ou commit incompatível falha sem publicar. Os detalhes do job ficam nos logs do GitHub Actions; o departamento mostra a última verificação concluída e os uploads ainda pendentes, em vez de declarar que uma tentativa falhada sincronizou.

Uma execução repetida com o mesmo build e os mesmos metadados é idempotente, mesmo em outra tentativa. Um upload já presente no mesmo caminho pode retornar 409; o workflow continua até a conferência de bytes pelo servidor. Se recompilar o mesmo build produzir bytes diferentes, é necessário iniciar uma **nova execução**, com novo build. O backend não sobrescreve um pacote já registrado com outro checksum, certificado ou commit. Uploads de novas tentativas idênticas são marcados como consumidos no replay.

As URLs de download são relativas ao domínio visitado; objetos assinados permanecem no Supabase e o audience OIDC permanece fixo. Adicionar um domínio verificado na Vercel não exige copiar o banco nem regenerar artefatos antigos. O bootstrap/transport e as origens autorizadas devem acompanhar o domínio conforme a configuração do projeto, sem confiar em redirecionamentos fornecidos por clientes.

## Verificação desta entrega

Testes usam somente o PostgreSQL descartável em `127.0.0.1:55432`, identidades sintéticas e HTTP simulado para bytes de teste. Não foram assinados pacotes de produção nem enviados arquivos a lojas durante esses testes. As credenciais de assinatura Android e Apple são requisitos externos reais.

- JWTs RSA reais: sucesso, claims de outro repositório/branch/workflow/ambiente, token expirado, assinatura adulterada, algoritmos indevidos, JWKS indisponível e cabeçalhos com URL de chave externa.
- HTTP: montagem nos três prefixos e dispatcher Vercel, sessão, poder/deny, autenticação recente, origem, payload estrito, revisão e erros sem segredos.
- SQL real: aprovação inicial, assinatura fixa, Android automático, iOS em espera, retirada/restauração com piso preservado, CI atrasado, replay entre tentativas, CAS concorrente, revogação canônica, RLS e metadados imutáveis.
- Streaming: checksum, tamanho, limite, origem fixa, redirecionamento proibido e conteúdo que não é APK.

Evidências de testes estão em `docs/evidence/mobile-release-ledger-2026-10-09/`.

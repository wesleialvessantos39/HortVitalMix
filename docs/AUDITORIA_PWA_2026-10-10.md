# Instalação e atualização PWA — diagnóstico anterior

Base analisada: `main@137b1b40fb051dd1a81c1c17f22324c0a31ca6d8`. Livro Raiz consultado antes da implementação, especialmente os registros de distribuição, sincronização web, T25/offline, autenticação e publicação exclusivamente main/pdx1. Não é uma nova trilha.

## Código e funcionamento encontrados

- `public/manifest.webmanifest`: identidade HortiVitalMix, scope/start_url `/`, standalone, ícones PNG 192/512. Manifesto estático; Vite o copia. `index.html` vincula manifesto, cor e apple-touch-icon; não captura instalação.
- `src/main.tsx` monta React; `src/App.tsx` monta avisos globais e rotas/perfis, mas não registra o worker globalmente.
- `src/lib/offline-worker.js` e `scripts/offline-worker-plugin.ts`: revisão hash, precache de index/JS/CSS, três downloads concorrentes. Não verificam hashes individuais; `skipWaiting()` no install e `clients.claim()` no activate são incondicionais. Navegações de produtor/conta usam rede com fallback shell; arquivos podem vir de caches de diferentes versões. Retém somente um cache anterior.
- `src/components/producer/OfflineStatusBanner.tsx` registra o worker somente quando o produtor monta o banner, após 1,2 s. A sincronização conserva comandos até resposta validada e commit IndexedDB.
- `src/components/AppUpdateNotice.tsx`: consulta a distribuição canônica, compara SHA e oferece recarga manual; protege rotas, formulários editados, foco, arquivos, modais, operações API/sessão e fila do usuário. Não prepara recursos nem coordena abas.
- `src/components/AppDownloadSection.tsx`, `src/pages/AppDownloadsPage.tsx`, `src/hooks/useAppDistribution.ts` e `shared/contracts/appDistribution.ts`: cartões dependem de `android/ios.available`, versão e `/downloads/*`. Sem pacote publicado, exibem “Publicação em preparação/Em breve”. Isso não verifica capacidade PWA. Leitura compartilhada/validação dos contratos nativos deve continuar preservada.
- `src/lib/offlineDb.ts`: banco `hvm-rural-v1` v1, fila por usuário, conflitos, snapshots com TTL, sincronização idempotente e sessão offline do produtor. Não pode ser apagado nem migrado por esta alteração.
- `src/lib/api.ts`: contadores de mutações, renovação/confirmacão de identidade, troca de geração, rejeição de replay administrativo indevido. Reutilizar na avaliação de segurança.
- `vite.config.ts`: define SHA do build e gera worker. `vercel.json`: integração Git exclusiva main, pdx1, HTTPS/CSP e no-store nas APIs; faltam headers explícitos de revalidação do worker/manifesto/versionamento PWA.
- Inspecionados também `NativeUpdateNotice`, `installedApp`, `nativeTransport`, contratos de releases, `AdminAppDistributionPage`, `AdminMobileReleaseCenter`, permissões e scripts/workflows nativos. App nativo deve continuar sem worker web; canais `/downloads/android` e `/downloads/ios` permanecem reservados aos binários reais.

## Produção observada antes da mudança

Vercel projeto `prj_I45qiWMbm1O2BVML983JL0WlRtY5`, equipe `team_ESpPjHpD1m2by7mz0fNAJiXu`. Deployment `dpl_9pEuj5XXrdhy79PVoZ6pQpUNaCuq` READY/main/production na SHA base. Domínio `https://hortvitalmix.vercel.app`; worker real servido como JavaScript. Nenhuma alteração remota, migração ou dados de negócio necessária para habilitar PWA.

## Decisões

Separar `/instalar/android` e `/instalar/ios` dos canais nativos. Registrar uma vez globalmente fora do Capacitor. Android usa evento real e gesto do usuário; iOS usa assistente honesto Safari. Gerar manifesto público do build com SHA e hashes dos recursos, sem segredos, independente de `app_releases` e de CI. Preparar o cache integral antes de ativar; consultar e proteger todas as abas, adiar em caso de trabalho/aba sem resposta e nunca apagar IndexedDB. Redesenhar a central pública e administrativa usando o poder canônico `platform_configuration`. Remover os cinco workflows ativos; documentação histórica permanece como histórico e não como instrução de implantação atual.

Resultados automatizados, limites físicos e publicação funcional READY foram registrados na entrada de 10/10/2026 do [Livro Raiz](../LIVRO_RAIZ_HORTIVITALMIX.md), no [guia PWA](PWA_INSTALACAO_ATUALIZACOES.md) e nas [evidências](evidence/pwa-2026-10-10/). A primeira SHA PWA publicada é `7b2799a60399a0f9b6f8b186577eaf6d27908e07`, Vercel `dpl_ACwqmQKP9m34zA4ah9un86oA9DEe` READY no domínio oficial. Homologação física Android/iPhone/iPad permanece explicitamente pendente.

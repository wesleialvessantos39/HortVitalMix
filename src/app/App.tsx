import { useCallback, useEffect, useState } from 'react';
import type { PublicConfig } from '../../shared/contracts/configuration';
import { AdminConfigurationPage } from '../modules/foundation/AdminConfigurationPage';
import { PublicHome } from '../modules/foundation/PublicHome';
import { UnavailablePage } from '../modules/foundation/UnavailablePage';
import { foundationApi } from '../services/foundationApi';

type BootState =
  | { status: 'loading' }
  | { status: 'ready'; config: PublicConfig; databaseReady: boolean }
  | { status: 'error' };

function applyGlobalConfiguration(config: PublicConfig): void {
  document.title = config.brand.pageTitle;
  document.documentElement.lang = config.parameters.locale;

  const root = document.documentElement;
  root.style.setProperty('--green-900', config.brand.theme.primary);
  root.style.setProperty('--lime', config.brand.theme.secondary);
  root.style.setProperty('--orange', config.brand.theme.accent);

  const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  themeMeta?.setAttribute('content', config.brand.theme.primary);
}

export default function App() {
  const [state, setState] = useState<BootState>({ status: 'loading' });

  const boot = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const [config, health] = await Promise.all([
        foundationApi.getConfig(),
        foundationApi.getHealth(),
      ]);
      applyGlobalConfiguration(config);
      setState({ status: 'ready', config, databaseReady: health.database === 'ready' });
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (state.status === 'loading') {
    return (
      <main className="boot-screen" aria-live="polite" aria-busy="true">
        <div className="boot-spinner" />
        <p>Carregando HortiVitalMix…</p>
      </main>
    );
  }

  if (state.status === 'error') {
    return <UnavailablePage onRetry={() => void boot()} />;
  }

  if (window.location.pathname === '/admin/configuracao') {
    return (
      <AdminConfigurationPage
        config={state.config}
        databaseReady={state.databaseReady}
        onConfigUpdated={(config) => {
          applyGlobalConfiguration(config);
          setState((current) => (
            current.status === 'ready'
              ? { ...current, config }
              : current
          ));
        }}
        onReload={() => void boot()}
      />
    );
  }

  return <PublicHome config={state.config} databaseReady={state.databaseReady} />;
}

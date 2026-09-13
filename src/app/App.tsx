import { useCallback, useEffect, useState } from 'react';
import type { PublicConfig } from '../../shared/contracts/configuration';
import type { EnvironmentResponse } from '../../shared/contracts/foundation';
import { AdminConfigurationPage } from '../modules/foundation/AdminConfigurationPage';
import { PublicHome } from '../modules/foundation/PublicHome';
import { UnavailablePage } from '../modules/foundation/UnavailablePage';
import { foundationApi } from '../services/foundationApi';

type BootState =
  | { status: 'loading' }
  | { status: 'ready'; config: PublicConfig; environment: EnvironmentResponse; databaseReady: boolean }
  | { status: 'error' };

function applyEnvironmentMetadata(environment: EnvironmentResponse): void {
  document.documentElement.dataset.environment = environment.environment;

  let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!robots) {
    robots = document.createElement('meta');
    robots.name = 'robots';
    document.head.appendChild(robots);
  }
  robots.content = environment.indexing === 'index'
    ? 'index, follow'
    : 'noindex, nofollow, noarchive';
}

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
      const [config, health, environment] = await Promise.all([
        foundationApi.getConfig(),
        foundationApi.getHealth(),
        foundationApi.getEnvironment(),
      ]);
      applyGlobalConfiguration(config);
      applyEnvironmentMetadata(environment);
      setState({
        status: 'ready',
        config,
        environment,
        databaseReady:
          health.database === 'ready' && environment.databaseBinding === 'ready',
      });
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
        environment={state.environment}
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

  return (
    <PublicHome
      config={state.config}
      environment={state.environment}
      databaseReady={state.databaseReady}
    />
  );
}

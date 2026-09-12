import { useCallback, useEffect, useState } from 'react';
import type { PublicConfig } from '../../shared/contracts/foundation';
import { PublicHome } from '../modules/foundation/PublicHome';
import { UnavailablePage } from '../modules/foundation/UnavailablePage';
import { foundationApi } from '../services/foundationApi';

type BootState =
  | { status: 'loading' }
  | { status: 'ready'; config: PublicConfig; databaseReady: boolean }
  | { status: 'error' };

export default function App() {
  const [state, setState] = useState<BootState>({ status: 'loading' });

  const boot = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const [config, health] = await Promise.all([
        foundationApi.getConfig(),
        foundationApi.getHealth(),
      ]);
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

  return <PublicHome config={state.config} databaseReady={state.databaseReady} />;
}

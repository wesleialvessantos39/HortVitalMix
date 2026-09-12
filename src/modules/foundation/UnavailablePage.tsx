import { RefreshCw, ServerOff } from 'lucide-react';
import { BrandLogo } from '../../components/brand/BrandLogo';

interface UnavailablePageProps {
  onRetry: () => void;
}

export function UnavailablePage({ onRetry }: UnavailablePageProps) {
  return (
    <main className="unavailable-page">
      <section className="unavailable-card" aria-live="polite">
        <BrandLogo />
        <div className="status-icon danger"><ServerOff size={30} aria-hidden="true" /></div>
        <p className="eyebrow">Serviço temporariamente indisponível</p>
        <h1>Não foi possível consultar a API do HortiVitalMix.</h1>
        <p>Nenhuma ação foi confirmada. Quando a conexão com o serviço for restabelecida, você poderá tentar novamente com segurança.</p>
        <button type="button" className="primary-button" onClick={onRetry}>
          <RefreshCw size={18} aria-hidden="true" /> Verificar novamente
        </button>
      </section>
    </main>
  );
}

import type { EnvironmentResponse } from '../../../shared/contracts/foundation';

interface EnvironmentNoticeProps {
  environment: EnvironmentResponse;
}

const labels = {
  development: 'Desenvolvimento',
  homologation: 'Homologação',
  production: 'Produção',
} as const;

const bindingLabels = {
  ready: 'banco correto',
  unavailable: 'banco indisponível',
  unbound: 'banco sem identidade',
  mismatch: 'banco de outro ambiente',
} as const;

export function EnvironmentNotice({ environment }: EnvironmentNoticeProps) {
  if (environment.environment === 'production') return null;

  return (
    <aside
      className={`environment-notice binding-${environment.databaseBinding}`}
      role="status"
      aria-label={`Ambiente ${labels[environment.environment]}`}
    >
      <strong>{labels[environment.environment]}</strong>
      <span>{bindingLabels[environment.databaseBinding]}</span>
      <small>Indexação pública desativada.</small>
    </aside>
  );
}

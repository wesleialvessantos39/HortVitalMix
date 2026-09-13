import { Database, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { EnvironmentResponse } from '../../../shared/contracts/foundation';

export function DatabaseIntegrityCard({ environment }: { environment: EnvironmentResponse }) {
  const healthy =
    environment.databaseBinding === 'ready'
    && environment.migrationIntegrity === 'valid'
    && environment.schemaVersion === environment.expectedSchemaVersion
    && environment.releaseVersion === environment.expectedReleaseVersion;

  return (
    <section className="config-card database-integrity-card" aria-live="polite">
      <div className="config-card-heading">
        <Database aria-hidden="true" />
        <div>
          <h2>Integridade do banco</h2>
          <p>O servidor compara ambiente, release e histórico de migrações antes de liberar persistência.</p>
        </div>
      </div>
      <div className={`database-integrity-state ${healthy ? 'is-healthy' : 'has-warning'}`}>
        {healthy ? <ShieldCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
        <div>
          <strong>{healthy ? 'Banco verificado' : 'Banco requer atenção'}</strong>
          <span>Migrações: {environment.migrationIntegrity} • schema {environment.schemaVersion ?? '—'} / {environment.expectedSchemaVersion}</span>
          <small>Release atual: {environment.releaseVersion ?? 'não identificado'} • esperado: {environment.expectedReleaseVersion}</small>
        </div>
      </div>
    </section>
  );
}

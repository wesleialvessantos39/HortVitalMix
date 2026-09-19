import { config } from 'dotenv';
import { resolve } from 'path';

export default async function globalSetup() {
  config({ path: resolve(process.cwd(), '.env.test'), override: true });
  config({ path: resolve(process.cwd(), '.env.local'), override: false });

  const required = ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_DB_URL'];
  const missing = required.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    console.warn(`\n[TEST] Integração desabilitada — variáveis ausentes: ${missing.join(', ')}`);
    console.warn('[TEST] Unidade e contrato continuam; integração pulada não conta como homologada.\n');
    process.env.HVM_INTEGRATION_ENABLED = 'false';
  } else {
    console.log('\n[TEST] Integração habilitada — Supabase real configurado.\n');
    process.env.HVM_INTEGRATION_ENABLED = 'true';
  }

  process.env.NODE_ENV = 'test';
  process.env.APP_ENV = 'development';
}

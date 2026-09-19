import { describe,it } from 'vitest';
const enabled=process.env.HVM_INTEGRATION_ENABLED==='true' && Boolean(process.env.SUPABASE_DB_URL);
export const integrationDescribe=enabled?describe:describe.skip;export const integrationIt=enabled?it:it.skip;

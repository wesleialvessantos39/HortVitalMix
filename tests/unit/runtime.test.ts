import { describe,it,expect } from 'vitest';
import { resolveDbUrl } from '../../server/config/runtime';
describe('runtime database URL',()=>{it('rejeita placeholder',()=>expect(resolveDbUrl('development',{SUPABASE_DB_URL:'postgresql://u:p@base:6543/postgres'} as NodeJS.ProcessEnv).url).toBeNull());it('rejeita alias em production',()=>expect(resolveDbUrl('production',{DATABASE_URL:'postgresql://u:p@x.pooler.supabase.com:6543/postgres'} as NodeJS.ProcessEnv).url).toBeNull());});

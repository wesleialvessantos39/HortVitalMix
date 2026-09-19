import { describe, expect, it } from 'vitest';
import { resolveDbUrl } from '../../server/config/runtime';
describe('resolveDbUrl',()=>{
  it('rejeita placeholder base',()=>expect(resolveDbUrl('development',{SUPABASE_DB_URL:'postgresql://u:p@base:6543/postgres'}).url).toBeNull());
  it('rejeita DATABASE_URL em production',()=>expect(resolveDbUrl('production',{DATABASE_URL:'postgresql://u:p@example.com:6543/postgres'}).url).toBeNull());
  it('aceita SUPABASE_DB_URL canônica',()=>expect(resolveDbUrl('production',{SUPABASE_DB_URL:'postgresql://u:p@example.com:6543/postgres'}).source).toBe('SUPABASE_DB_URL'));
});

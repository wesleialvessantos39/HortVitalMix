import { expect } from 'vitest';
import { dbPool } from '../../server/db/pool';
import { supabasePublic } from '../../server/supabase/client';
import { integrationDescribe, integrationIt } from '../helpers/integration';

integrationDescribe('app_global_config singleton',()=>{
  integrationIt('existe exatamente uma linha',async()=>{const r=await dbPool!.query<{count:string}>(`select count(*)::text count from public.app_global_config`);expect(r.rows[0].count).toBe('1')});
  integrationIt('é pública para leitura',async()=>{if(!supabasePublic)throw new Error('public client missing');const {data,error}=await supabasePublic.from('app_global_config').select('platform_name,revision').single();expect(error).toBeNull();expect(data?.platform_name).toBe('HortiVitalMix');expect(Number(data?.revision)).toBeGreaterThanOrEqual(1)});
});

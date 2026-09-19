import { randomUUID } from 'crypto';
import { expect } from 'vitest';
import { dbPool } from '../../server/db/pool';
import { supabaseAdmin } from '../../server/supabase/client';
import { AuthService } from '../../server/services/AuthService';
import { generateValidCPF } from '../helpers/identity';
import { integrationDescribe, integrationIt } from '../helpers/integration';

integrationDescribe('E2E — Cadastro de produtor',()=>{
  integrationIt('cria user + person + role + profile e duplicado retorna conflict',async()=>{
    if(!dbPool||!supabaseAdmin)throw new Error('integration unavailable');
    const marker=randomUUID().replace(/-/g,'').slice(0,12); const email=`producer-${marker}@example.invalid`;
    const payload={fullName:'Produtor de Teste',cpf:generateValidCPF(),email,phone:`+55699${marker.replace(/\D/g,'').padEnd(8,'7').slice(0,8)}`,password:`Hvm!${marker}Aa9#`,brandName:`Sítio ${marker.slice(0,5)}`,activityType:'misto' as const};
    const first=await AuthService.registerProducer(payload,'00000000-0000-4000-8000-000000000001');
    expect(first.status).toBe('success');
    if(first.status!=='success')return;
    try{
      const chain=await dbPool.query(`select p.id,r.role_code,pr.id profile_id from public.app_people p join public.app_user_role_assignments r on r.user_id=p.user_id join public.app_producer_profiles pr on pr.person_id=p.id where p.user_id=$1`,[first.userId]);
      expect(chain.rows).toHaveLength(1); expect(chain.rows[0].role_code).toBe('producer'); expect(chain.rows[0].profile_id).toBeTruthy();
      const duplicate=await AuthService.registerProducer(payload,'00000000-0000-4000-8000-000000000002');
      expect(duplicate.status).toBe('conflict');
    }finally{
      const person=await dbPool.query<{id:string}>(`select id from public.app_people where user_id=$1`,[first.userId]);
      if(person.rows[0])await dbPool.query(`delete from public.app_producer_profiles where person_id=$1`,[person.rows[0].id]);
      await dbPool.query(`delete from public.app_people where user_id=$1`,[first.userId]);
      await dbPool.query(`delete from public.app_user_role_assignments where user_id=$1`,[first.userId]);
      await supabaseAdmin.auth.admin.deleteUser(first.userId).catch(()=>undefined);
      await dbPool.query(`delete from public.app_users where id=$1`,[first.userId]);
    }
  });
});

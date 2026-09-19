import { randomUUID } from 'crypto';
import { expect } from 'vitest';
import { dbPool } from '../../server/db/pool';
import { supabaseAdmin } from '../../server/supabase/client';
import { integrationDescribe, integrationIt } from '../helpers/integration';

integrationDescribe('auth.users → app_users',()=>{
  integrationIt('criação espelha imediatamente e deleção suspende',async()=>{
    if(!supabaseAdmin||!dbPool)throw new Error('integration unavailable');
    const email=`trigger-${randomUUID()}@example.invalid`;
    const {data,error}=await supabaseAdmin.auth.admin.createUser({email,password:'Hvm!Trigger123#',email_confirm:true});
    if(error||!data.user)throw error??new Error('identity not created');
    const id=data.user.id;
    try{
      const created=await dbPool.query<{status:string}>(`select status from public.app_users where id=$1`,[id]);
      expect(created.rows[0]?.status).toBe('active');
      await supabaseAdmin.auth.admin.deleteUser(id);
      const deleted=await dbPool.query<{status:string;authorization_revision:number}>(`select status,authorization_revision from public.app_users where id=$1`,[id]);
      expect(deleted.rows[0]?.status).toBe('suspended');
      expect(deleted.rows[0]?.authorization_revision).toBeGreaterThan(1);
    }finally{
      await supabaseAdmin.auth.admin.deleteUser(id).catch(()=>undefined);
      await dbPool.query(`delete from public.app_users where id=$1`,[id]);
    }
  });
});

import { randomUUID } from 'crypto';
import { expect } from 'vitest';
import { dbPool } from '../../server/db/pool';
import { integrationDescribe, integrationIt } from '../helpers/integration';

integrationDescribe('audit append-only',()=>{
  integrationIt('bloqueia UPDATE e DELETE de uma linha real com SQLSTATE 42501',async()=>{
    if(!dbPool)throw new Error('integration unavailable');
    const client=await dbPool.connect(); const id=randomUUID();
    try{
      await client.query('begin');
      await client.query(`insert into public.app_audit_events(id,request_id,action,target_entity,client_ip_hash) values($1,$2,'test.audit','test',$3)`,[id,randomUUID(),'0'.repeat(64)]);
      await client.query('savepoint before_update');
      try{await client.query(`update public.app_audit_events set actor_role='x' where id=$1`,[id]);throw new Error('UPDATE deveria falhar');}
      catch(error){expect((error as {code?:string}).code).toBe('42501');await client.query('rollback to savepoint before_update');}
      await client.query('savepoint before_delete');
      try{await client.query(`delete from public.app_audit_events where id=$1`,[id]);throw new Error('DELETE deveria falhar');}
      catch(error){expect((error as {code?:string}).code).toBe('42501');await client.query('rollback to savepoint before_delete');}
      await client.query('rollback');
    }finally{client.release();}
  });
});

import type { PoolClient } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dbPool } from '../../server/db/pool';
import { clientFor, type EphemeralIdentity } from './identity';

export async function withRole<T>(
  role:'anon'|'authenticated'|'service_role',
  userId:string|null,
  fn:(client:PoolClient)=>Promise<T>,
):Promise<T>{
  if(!dbPool)throw new Error('dbPool ausente');
  const client=await dbPool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    if(userId){
      await client.query('SELECT set_config($1,$2,true)',[
        'request.jwt.claims',
        JSON.stringify({sub:userId,role}),
      ]);
    }
    const result=await fn(client);
    await client.query('ROLLBACK');
    return result;
  }catch(error){
    await client.query('ROLLBACK').catch(()=>undefined);
    throw error;
  }finally{
    client.release();
  }
}

export async function asIdentity<T>(
  identity:EphemeralIdentity,
  run:(client:SupabaseClient)=>Promise<T>,
):Promise<T>{
  const client=await clientFor(identity);
  try{return await run(client);}finally{await client.auth.signOut();}
}

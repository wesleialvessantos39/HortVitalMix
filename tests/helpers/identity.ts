import { randomInt, randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { dbPool } from '../../server/db/pool';
import { supabaseAdmin } from '../../server/supabase/client';

function cpfDigit(base:string):number{
  const size=base.length;
  let sum=0;
  for(let i=0;i<size;i++)sum+=Number(base[i])*(size+1-i);
  const rest=(sum*10)%11;
  return rest===10?0:rest;
}
export function generateValidCPF():string{
  let base='';
  do{base=Array.from({length:9},()=>String(randomInt(0,10))).join('');}while(/^(\d)\1{8}$/.test(base));
  const d1=cpfDigit(base); const d2=cpfDigit(base+String(d1));
  return `${base}${d1}${d2}`;
}

export type EphemeralIdentity={userId:string;personId:string;email:string;password:string;role:'consumer'|'producer'};

export async function createEphemeralIdentity(role:'consumer'|'producer'='consumer'):Promise<EphemeralIdentity>{
  if(!supabaseAdmin||!dbPool)throw new Error('Integration clients not configured');
  const marker=randomUUID().replace(/-/g,'').slice(0,16);
  const email=`hvm-test-${marker}@example.invalid`;
  const password=`Hvm!${marker}Aa9#`;
  const {data,error}=await supabaseAdmin.auth.admin.createUser({email,password,email_confirm:true});
  if(error||!data.user)throw error??new Error('Auth user not created');
  const userId=data.user.id;
  try{
    const person=await dbPool.query<{id:string}>(`insert into public.app_people(user_id,full_name,cpf_normalized,email_normalized,phone_e164) values($1,$2,$3,$4,$5) returning id`,[userId,'Usuário Teste',generateValidCPF(),email,`+5569${randomInt(900000000,999999999)}`]);
    await dbPool.query(`insert into public.app_user_role_assignments(user_id,role_code) values($1,$2)`,[userId,role]);
    if(role==='producer')await dbPool.query(`insert into public.app_producer_profiles(person_id,brand_name,rural_activity_type) values($1,$2,'misto')`,[person.rows[0].id,`Produtor ${marker.slice(0,5)}`]);
    return {userId,personId:person.rows[0].id,email,password,role};
  }catch(error){await supabaseAdmin.auth.admin.deleteUser(userId).catch(()=>undefined);throw error;}
}

export async function cleanupIdentity(identity:EphemeralIdentity):Promise<void>{
  if(!supabaseAdmin||!dbPool)return;
  await dbPool.query(`delete from public.app_producer_profiles where person_id=$1`,[identity.personId]);
  await dbPool.query(`delete from public.app_people where id=$1`,[identity.personId]);
  await dbPool.query(`delete from public.app_user_role_assignments where user_id=$1`,[identity.userId]);
  await supabaseAdmin.auth.admin.deleteUser(identity.userId).catch(()=>undefined);
  await dbPool.query(`delete from public.app_users where id=$1`,[identity.userId]);
}

export async function clientFor(identity:EphemeralIdentity){
  const url=process.env.SUPABASE_URL; const anon=process.env.SUPABASE_ANON_KEY;
  if(!url||!anon)throw new Error('SUPABASE_URL/SUPABASE_ANON_KEY required');
  const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.auth.signInWithPassword({email:identity.email,password:identity.password});
  if(error||!data.session)throw error??new Error('No session');
  return client;
}

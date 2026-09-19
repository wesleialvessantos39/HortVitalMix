import type { SupabaseClient } from '@supabase/supabase-js';
import { clientFor, type EphemeralIdentity } from './identity';
export async function asIdentity<T>(identity:EphemeralIdentity,run:(client:SupabaseClient)=>Promise<T>):Promise<T>{
  const client=await clientFor(identity);
  try{return await run(client);}finally{await client.auth.signOut();}
}

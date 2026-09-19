import { expect } from 'vitest';
import { createEphemeralIdentity, cleanupIdentity } from '../helpers/identity';
import { asIdentity } from '../helpers/supabaseContext';
import { integrationDescribe, integrationIt } from '../helpers/integration';

integrationDescribe('RLS',()=>{
  integrationIt('usuário A não lê app_people de usuário B',async()=>{
    const alice=await createEphemeralIdentity('consumer'); const bob=await createEphemeralIdentity('producer');
    try{
      await asIdentity(alice,async(client)=>{
        const {data,error}=await client.from('app_people').select('id,user_id');
        expect(error).toBeNull(); expect(data?.map(row=>row.id)).toEqual([alice.personId]); expect(data?.some(row=>row.id===bob.personId)).toBe(false);
      });
    }finally{await cleanupIdentity(bob);await cleanupIdentity(alice);}
  });
});

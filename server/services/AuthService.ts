import type { PoolClient } from 'pg';
import { RegisterProducerSchema } from '../../shared/contracts/auth';
import { classifyDbError, reportFailure } from '../config/reportFailure';
import { dbPool } from '../db/pool';
import { supabaseAdmin } from '../supabase/client';

export class AuthService {
  static async registerProducer(input: unknown, requestId: string) {
    const parsed=RegisterProducerSchema.safeParse(input);
    if(!parsed.success){
      return {
        status:'invalid' as const,
        issues:parsed.error.issues.map((issue)=>({path:issue.path.join('.'),message:issue.message})),
      };
    }
    if(!supabaseAdmin||!dbPool)return {status:'unavailable' as const};

    const data=parsed.data;
    const {data:authData,error:authError}=await supabaseAdmin.auth.admin.createUser({
      email:data.email,
      password:data.password,
      email_confirm:false,
      user_metadata:{intended_role:'producer'},
    });

    if(authError||!authData.user){
      if(authError?.message.toLowerCase().includes('already registered')||authError?.message.toLowerCase().includes('registered')){
        return {status:'conflict' as const,message:'Dados de identificação informados já estão em uso.'};
      }
      reportFailure({
        category:'auth_unavailable',
        requestId,
        route:'/api/v1/auth/register/producer',
        method:'POST',
        statusCode:503,
      });
      return {status:'unavailable' as const};
    }

    let client:PoolClient|null=null;
    try{
      client=await dbPool.connect();
      await client.query('BEGIN');

      const person=await client.query<{id:string}>(
        `INSERT INTO public.app_people
          (user_id,full_name,cpf_normalized,email_normalized,phone_e164)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id`,
        [authData.user.id,data.fullName,data.cpf,data.email,data.phone],
      );

      await client.query(
        `INSERT INTO public.app_user_role_assignments (user_id,role_code)
         VALUES ($1,'producer')`,
        [authData.user.id],
      );

      await client.query(
        `INSERT INTO public.app_producer_profiles
          (person_id,brand_name,rural_activity_type,verification_status,trust_level)
         VALUES ($1,$2,$3,'declared',0)`,
        [person.rows[0].id,data.brandName,data.activityType],
      );

      await client.query('COMMIT');
      return {status:'success' as const,userId:authData.user.id};
    }catch(error){
      if(client)await client.query('ROLLBACK').catch(()=>undefined);
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id).catch(()=>undefined);

      const category=classifyDbError(error);
      if(category==='conflict'){
        return {status:'conflict' as const,message:'Dados de identificação informados já estão em uso.'};
      }

      reportFailure({
        category,
        requestId,
        route:'/api/v1/auth/register/producer',
        method:'POST',
        statusCode:503,
      });
      return {status:'unavailable' as const};
    }finally{
      client?.release();
    }
  }
}

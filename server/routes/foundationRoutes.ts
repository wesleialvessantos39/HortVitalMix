import { Router } from 'express';
import { classifyDbError, reportFailure } from '../config/reportFailure';
import { runtime } from '../config/runtime';
import { dbPool, DATABASE_CONFIGURED } from '../db/pool';
import { AuthService } from '../services/AuthService';

export const foundationRouter = Router();

foundationRouter.get('/health',(req,res)=>
  res.status(200).json({
    status:'ok',
    time:new Date().toISOString(),
    environment:runtime.appEnv,
    requestId:req.requestId,
  })
);

foundationRouter.get('/ready',async(req,res)=>{
  if(!DATABASE_CONFIGURED||!dbPool){
    return res.status(503).json({
      status:'unavailable',
      databaseConnected:false,
      reason:runtime.dbUrlRejectionReason??'Conexão PostgreSQL não configurada',
      requestId:req.requestId,
    });
  }

  try{
    const result=await dbPool.query<{schema_version:number;release_tag:string}>(
      `SELECT schema_version,release_tag
         FROM public.app_releases
        WHERE environment=$1 AND is_current=true
        ORDER BY deployed_at DESC
        LIMIT 1`,
      [runtime.appEnv],
    );

    if(!result.rows.length){
      return res.status(503).json({
        status:'degraded',
        databaseConnected:true,
        reason:'Release corrente não configurada',
        requestId:req.requestId,
      });
    }

    return res.status(200).json({
      status:'ready',
      databaseConnected:true,
      schemaVersion:result.rows[0].schema_version,
      releaseTag:result.rows[0].release_tag,
      requestId:req.requestId,
    });
  }catch(error){
    reportFailure({
      category:classifyDbError(error),
      requestId:req.requestId,
      route:'/api/ready',
      method:'GET',
      statusCode:503,
    });
    return res.status(503).json({
      status:'unavailable',
      databaseConnected:false,
      reason:'Falha de conexão com PostgreSQL Supabase',
      requestId:req.requestId,
    });
  }
});

foundationRouter.get('/v1/config',async(req,res)=>{
  if(!dbPool)return res.status(503).json({error:'DATABASE_NOT_CONFIGURED',requestId:req.requestId});

  try{
    const result=await dbPool.query(
      `SELECT platform_name,slogan,default_municipality,default_state,currency,timezone,support_email,support_phone,revision
         FROM public.app_global_config
        WHERE singleton_guard=true
        LIMIT 1`
    );

    if(!result.rows.length)return res.status(503).json({error:'CONFIG_NOT_INITIALIZED',requestId:req.requestId});

    const row=result.rows[0];
    return res.status(200).json({
      platformName:row.platform_name,
      slogan:row.slogan,
      defaultMunicipality:row.default_municipality,
      defaultState:row.default_state,
      currency:row.currency,
      timezone:row.timezone,
      supportEmail:row.support_email,
      supportPhone:row.support_phone,
      revision:row.revision,
    });
  }catch(error){
    reportFailure({
      category:classifyDbError(error),
      requestId:req.requestId,
      route:'/api/v1/config',
      method:'GET',
      statusCode:503,
    });
    return res.status(503).json({error:'DB_UNAVAILABLE',requestId:req.requestId});
  }
});

foundationRouter.post('/v1/auth/register/producer',async(req,res)=>{
  const result=await AuthService.registerProducer(req.body,req.requestId);
  if(result.status==='success')return res.status(201).json(result);
  if(result.status==='invalid')return res.status(400).json(result);
  if(result.status==='conflict')return res.status(409).json(result);
  return res.status(503).json(result);
});

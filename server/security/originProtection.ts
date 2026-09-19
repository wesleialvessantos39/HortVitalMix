import type { NextFunction, Request, Response } from 'express';
import { runtime } from '../config/runtime';

const SAFE_METHODS = new Set(['GET','HEAD','OPTIONS']);

/**
 * Bloqueia requisições cross-site em mutações autenticadas.
 * - Sec-Fetch-Site quando presente
 * - Origin contra allowlist canônica
 * - em production exige Origin ou Referer válido
 */
export function originProtection(req:Request,res:Response,next:NextFunction):void{
  if(SAFE_METHODS.has(req.method)){next();return;}

  const fetchSite=req.headers['sec-fetch-site'];
  const origin=req.headers.origin;
  const referer=req.headers.referer;

  if(fetchSite==='cross-site'){
    res.status(403).json({error:'ORIGIN_REJECTED',message:'Requisição cross-site bloqueada.',requestId:req.requestId});
    return;
  }

  if(typeof origin==='string'&&origin.length>0){
    if(!isOriginAllowed(origin)){
      res.status(403).json({error:'ORIGIN_REJECTED',message:'Origem não autorizada.',requestId:req.requestId});
      return;
    }
  }else if(runtime.isProduction){
    const refererOrigin=typeof referer==='string'?safeOriginFromUrl(referer):null;
    if(!refererOrigin||!isOriginAllowed(refererOrigin)){
      res.status(403).json({error:'ORIGIN_REJECTED',message:'Origin/Referer ausente ou inválido.',requestId:req.requestId});
      return;
    }
  }

  next();
}

function isOriginAllowed(origin:string):boolean{
  const allowlist=buildAllowlist();
  return allowlist.some((rule)=>rule.endsWith('*')?origin.startsWith(rule.slice(0,-1)):origin===rule);
}

function buildAllowlist():string[]{
  const base:string[]=[];
  const envAllow=process.env.HVM_ALLOWED_ORIGINS;
  if(envAllow)base.push(...envAllow.split(',').map((s)=>s.trim()).filter(Boolean));

  base.push('https://hortivitalmix.vercel.app','http://localhost:3000','http://127.0.0.1:3000');
  if(!runtime.isProduction)base.push('https://*.vercel.app');

  return base;
}

function safeOriginFromUrl(value:string):string|null{
  try{return new URL(value).origin;}catch{return null;}
}

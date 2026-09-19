import { expect } from 'vitest';
import { createApp } from '../../server/app';
import { integrationDescribe, integrationIt } from '../helpers/integration';

integrationDescribe('runtime Express',()=>{
  integrationIt('/api/health e /api/v1/config retornam contratos canônicos',async()=>{
    const server=createApp().listen(0,'127.0.0.1');
    await new Promise<void>((resolve,reject)=>{server.once('listening',()=>resolve());server.once('error',reject)});
    try{
      const address=server.address(); if(!address||typeof address==='string')throw new Error('server address unavailable');
      const base=`http://127.0.0.1:${address.port}`;
      const health=await fetch(`${base}/api/health`); expect(health.status).toBe(200); expect((await health.json()).status).toBe('ok');
      const config=await fetch(`${base}/api/v1/config`); expect(config.status).toBe(200); const body=await config.json(); expect(body.platformName).toBe('HortiVitalMix'); expect(body.revision).toBeGreaterThanOrEqual(1);
      const ready=await fetch(`${base}/api/ready`); const readyBody=await ready.json();
      if(ready.status===200){expect(readyBody.databaseConnected).toBe(true);expect(readyBody.releaseTag).toBeTruthy();}
      else{expect(ready.status).toBe(503);expect(readyBody.reason).toBeTruthy();}
    }finally{await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
  });
});

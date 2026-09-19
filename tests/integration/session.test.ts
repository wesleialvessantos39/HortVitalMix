import type { NextFunction, Request, Response } from 'express';
import { expect } from 'vitest';
import { sessionMiddleware } from '../../server/middleware/session';
import { cleanupIdentity, clientFor, createEphemeralIdentity } from '../helpers/identity';
import { integrationDescribe, integrationIt } from '../helpers/integration';

integrationDescribe('sessionMiddleware',()=>{
  integrationIt('JWT válido popula req.actor com papéis vivos',async()=>{
    const identity=await createEphemeralIdentity('producer');
    const client=await clientFor(identity);

    try{
      const {data,error}=await client.auth.getSession();
      expect(error).toBeNull();
      expect(data.session?.access_token).toBeTruthy();

      const req={
        headers:{authorization:`Bearer ${data.session!.access_token}`},
        actor:null,
      } as unknown as Request;

      let nextCalled=false;
      const next=(()=>{nextCalled=true;}) as NextFunction;

      await sessionMiddleware(req,{} as Response,next);

      expect(nextCalled).toBe(true);
      expect(req.actor?.userId).toBe(identity.userId);
      expect(req.actor?.roles).toContain('producer');
    }finally{
      await client.auth.signOut().catch(()=>undefined);
      await cleanupIdentity(identity);
    }
  });
});

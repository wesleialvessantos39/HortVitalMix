import express from 'express';
import request from 'supertest';
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({query:vi.fn(),release:vi.fn()}));
vi.mock('../../server/db/pool.ts',()=>({dbPool:{connect:async()=>m,query:m.query}}));
vi.mock('../../server/middleware/adminSession.ts',()=>({
 adminSessionMiddleware:(q:any,s:any,n:any)=>{q.adminActor={userId:'11111111-1111-4111-8111-111111111111',role:q.headers['x-role'],isSuperAdmin:q.headers['x-role']==='platform_super_admin'};q.requestId='33333333-3333-4333-8333-333333333333';q.clientIpHash='a'.repeat(64);n();},
 requireSuperAdmin:(q:any,s:any,n:any)=>q.adminActor.isSuperAdmin?n():s.sendStatus(403),
 requireRecentAuth:(q:any,s:any,n:any)=>q.headers['x-stale']?s.sendStatus(401):n(),
}));
vi.mock('../../server/security/originProtection.ts',()=>({originProtection:(_q:any,_s:any,n:any)=>n()}));
import {adminGovernanceRouter} from '../../server/routes/adminGovernanceRoutes';
const app=express();app.use(express.json());app.use(adminGovernanceRouter);
const id='22222222-2222-4222-8222-222222222222', body={status:'blocked',commandId:id,mode:'indefinite'};
let isSuper=false,other=true;
beforeEach(()=>{vi.clearAllMocks();isSuper=false;other=true;m.query.mockImplementation(async(sql:string)=>{
 if(sql.startsWith('SELECT * FROM public.app_users'))return {rows:[{status:'active'}],rowCount:1};
 if(sql.includes('AS last_active'))return {rows:[{last_active:isSuper&&!other,is_super:isSuper,other_available:other}],rowCount:1};
 return {rows:[],rowCount:0};
});});
const call=()=>request(app).patch('/users/'+id+'/status').set('x-role','platform_super_admin');
it('forbids a sector administrator',async()=>{expect((await request(app).patch('/users/'+id+'/status').set('x-role','platform_admin').send(body)).status).toBe(403);expect(m.query).not.toHaveBeenCalled();});
it('requires recent authentication',async()=>{expect((await call().set('x-stale','1').send(body)).status).toBe(401);});
it('blocks public accounts indefinitely and records an audit in the transaction',async()=>{expect((await call().send(body)).status).toBe(200);expect(m.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO public.app_audit_events'))).toBe(true);expect(m.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');});
it('rejects missing or reversed custom intervals',async()=>{expect((await call().send({...body,mode:'custom'})).status).toBe(422);expect((await call().send({...body,mode:'custom',startsAt:'2099-10-26T14:00:00Z',endsAt:'2099-09-26T14:00:00Z'})).status).toBe(422);});
it('stores explicit UTC interval for automatic release',async()=>{expect((await call().send({...body,mode:'custom',startsAt:'2099-09-26T14:00:00Z',endsAt:'2099-10-26T14:00:00Z'})).status).toBe(200);const update=m.query.mock.calls.find(([sql])=>sql.startsWith('UPDATE public.app_users'));expect(update?.[1].slice(2,4)).toEqual(['2099-09-26T14:00:00Z','2099-10-26T14:00:00Z']);});
it('protects the last unscheduled super administrator',async()=>{isSuper=true;other=false;expect((await call().send(body)).status).toBe(409);expect(m.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE public.app_users'))).toBe(false);});
it('clears the interval when unblocking',async()=>{expect((await call().send({status:'active',commandId:id})).status).toBe(200);const update=m.query.mock.calls.find(([sql])=>sql.startsWith('UPDATE public.app_users'));expect(update?.[1].slice(2,4)).toEqual([null,null]);});

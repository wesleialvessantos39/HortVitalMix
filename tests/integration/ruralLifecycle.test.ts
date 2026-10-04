import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({query:vi.fn(),release:vi.fn()}));
vi.mock('../../server/db/pool.ts',()=>({dbPool:{connect:async()=>m}}));
import {RuralPropertyService} from '../../server/services/RuralPropertyService';
const id='22222222-2222-4222-8222-222222222222', uid='11111111-1111-4111-8111-111111111111';
let row:any;
beforeEach(()=>{vi.clearAllMocks();row={id,producer_id:id,status:'draft',revision:2,completed_at:null};m.query.mockImplementation(async(sql:string)=>{
 if(sql.includes('SELECT pp.id'))return {rows:[{id}]};
 if(sql.includes('SELECT * FROM public.app_properties'))return {rows:[row]};
 return {rows:[]};
});});
it('deletes drafts and audits atomically under the v46 lifecycle',async()=>{
 await RuralPropertyService.deleteDraft(uid,id,2,id,id,'a'.repeat(64));
 expect(m.query.mock.calls.some(([sql])=>sql.startsWith('DELETE FROM public.app_properties'))).toBe(true);
 expect(m.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
});
it.each(['completed','submitted','rejected','suspended'])('preserves v46 deletion of %s',async(status)=>{
 row.status=status;await RuralPropertyService.deleteDraft(uid,id,2,id,id,'a'.repeat(64));
 expect(m.query.mock.calls.some(([sql])=>sql.startsWith('DELETE FROM public.app_properties'))).toBe(true);
 expect(m.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
});
it('requires explicit acknowledgement to delete the last approved property in its region',async()=>{
 row.status='verified';await expect(RuralPropertyService.deleteDraft(uid,id,2,id,id,'a'.repeat(64))).rejects.toMatchObject({code:'LAST_APPROVED_REGION_CONFIRMATION_REQUIRED'});
 expect(m.query.mock.calls.some(([sql])=>sql.startsWith('DELETE FROM'))).toBe(false);
});
it('allows acknowledged deletion of the last approved property',async()=>{
 row.status='verified';await RuralPropertyService.deleteDraft(uid,id,2,id,id,'a'.repeat(64),true);
 expect(m.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
});
it('allows deletion of a draft that was previously completed, preserving v46',async()=>{
 row.completed_at=new Date();await RuralPropertyService.deleteDraft(uid,id,2,id,id,'a'.repeat(64));
 expect(m.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
});
it('rejects stale revisions before deleting',async()=>{
 await expect(RuralPropertyService.deleteDraft(uid,id,1,id,id,'a'.repeat(64))).rejects.toMatchObject({code:'PROPERTY_REVISION_CONFLICT'});
});
it('rejects another producer property',async()=>{
 m.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT pp.id')?[{id}]:[]}));
 await expect(RuralPropertyService.deleteDraft(uid,id,2,id,id,'a'.repeat(64))).rejects.toMatchObject({code:'PROPERTY_NOT_FOUND'});
});
it('prevents submitting saved partial changes against stale complete columns',async()=>{
 row.draft_data={propertyName:''};
 await expect(RuralPropertyService.submitProperty(uid,'producer',id,{commandId:id,expectedRevision:2,agroecologicalCommitment:true},id,'a'.repeat(64))).rejects.toMatchObject({code:'PROPERTY_INCOMPLETE'});
});

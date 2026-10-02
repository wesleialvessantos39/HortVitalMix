import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({query:vi.fn(),release:vi.fn()}));
vi.mock('../../server/db/pool.ts',()=>({dbPool:{connect:async()=>m}}));
import {RuralPropertyService} from '../../server/services/RuralPropertyService';
const id='22222222-2222-4222-8222-222222222222', uid='11111111-1111-4111-8111-111111111111';
let row:any;
let docs:Array<{id:string}>;
beforeEach(()=>{vi.clearAllMocks();row={id,producer_id:id,status:'draft',revision:2,completed_at:null};docs=[];m.query.mockImplementation(async(sql:string)=>{
 if(sql.includes('SELECT pp.id'))return {rows:[{id}]};
 if(sql.includes('SELECT * FROM public.app_properties'))return {rows:[row]};
 if(sql.includes('SELECT id FROM public.app_documents'))return {rows:docs};
 return {rows:[]};
});});
it('deletes only never-completed drafts and audits atomically',async()=>{
 await RuralPropertyService.deleteDraft(uid,id,2,id,id,'a'.repeat(64));
 expect(m.query.mock.calls.some(([sql])=>sql.includes('SET deleted_at=clock_timestamp(),draft_data=NULL'))).toBe(true);
 expect(m.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
});
it('archives attached documents and invalidates active extraction jobs before hiding the draft',async()=>{
 docs=[{id:'55555555-5555-4555-8555-555555555555'}];
 await RuralPropertyService.deleteDraft(uid,id,2,id,id,'a'.repeat(64));
 expect(m.query.mock.calls.some(([sql])=>sql.includes("SET status='archived'")&&sql.includes('app_documents'))).toBe(true);
 expect(m.query.mock.calls.some(([sql])=>sql.includes("SET status='failed'")&&sql.includes("PROPERTY_DRAFT_DELETED"))).toBe(true);
 expect(m.query.mock.calls.some(([sql])=>sql.includes('DELETE FROM public.app_property_boundaries'))).toBe(true);
 expect(m.query.mock.calls.some(([sql])=>sql.includes('DELETE FROM public.app_rural_activities'))).toBe(true);
 expect(m.query.mock.calls.some(([sql])=>sql.includes('UPDATE public.app_verification_requests')&&sql.includes('superseded_at=clock_timestamp()'))).toBe(true);
 expect(m.query.mock.calls.some(([sql])=>sql.includes('SET deleted_at=clock_timestamp(),draft_data=NULL'))).toBe(true);
 expect(m.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
});
it.each(['completed','submitted','verified','rejected','suspended'])('rejects deletion of %s',async(status)=>{
 row.status=status;await expect(RuralPropertyService.deleteDraft(uid,id,2,id,id,'a'.repeat(64))).rejects.toMatchObject({code:'COMPLETED_PROPERTY_DELETE_FORBIDDEN'});
 expect(m.query.mock.calls.some(([sql])=>sql.includes('SET deleted_at=clock_timestamp(),draft_data=NULL'))).toBe(false);
 expect(m.query.mock.calls.some(([sql])=>sql.includes("SET status='archived'"))).toBe(false);
});
it('prevents deletion even after a completed property returns to draft',async()=>{
 row.completed_at=new Date();await expect(RuralPropertyService.deleteDraft(uid,id,2,id,id,'a'.repeat(64))).rejects.toMatchObject({code:'COMPLETED_PROPERTY_DELETE_FORBIDDEN'});
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

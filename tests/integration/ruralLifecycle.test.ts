import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({query:vi.fn(),release:vi.fn()}));
vi.mock('../../server/db/pool.ts',()=>({dbPool:{connect:async()=>m,query:m.query}}));
import {RuralPropertyService} from '../../server/services/RuralPropertyService';
import {DocumentStorageService} from '../../server/services/DocumentStorageService';
import {VerificationQueueService} from '../../server/services/VerificationQueueService';
const id='22222222-2222-4222-8222-222222222222', uid='11111111-1111-4111-8111-111111111111';
let row:any, documents:Array<Record<string,any>>,propertyExists:boolean;
beforeEach(()=>{vi.clearAllMocks();row={id,producer_id:id,status:'draft',revision:2,completed_at:null};documents=[];propertyExists=true;m.query.mockImplementation(async(sql:string)=>{
 if(sql.includes('SELECT pp.id'))return {rows:[{id}]};
 if(sql.includes('SELECT * FROM public.app_properties'))return {rows:propertyExists?[row]:[]};
 if(sql.includes('SELECT storage_path FROM public.app_documents'))return {rows:documents};
 if(sql.includes('SELECT storage_path'))return {rows:[]};
 if(sql.includes('SELECT p.id FROM public.app_properties'))return {rows:propertyExists?[{id}]:[]};
 if(sql.includes('SELECT id,property_id,document_type'))return {rows:propertyExists?documents:[]};
 if(sql.includes('SELECT DISTINCT r.producer_id'))return {rows:propertyExists?[{producer_id:id}]:[]};
 if(sql.includes('SELECT r.id, r.property_id'))return {rows:propertyExists?[{
   id:'33333333-3333-4333-8333-333333333333',property_id:id,producer_id:id,
   status:'pending',priority:0,created_at:new Date(),updated_at:new Date(),
   property_name:'Chácara de teste',municipality:'Ariquemes',line_vicinal:'Linha 1',
   property_status:'draft',registration_number:null,superseded_at:null,documents:[],
   decision_history:[],
 }]:[]};
 if(sql.startsWith('DELETE FROM public.app_properties')){propertyExists=false;return {rows:[]};}
 return {rows:[]};
});});
it('deletes only never-completed drafts and audits atomically',async()=>{
 await RuralPropertyService.deleteDraft(uid,id,2,id,id,'a'.repeat(64));
 expect(m.query.mock.calls.some(([sql])=>sql.startsWith('DELETE FROM public.app_properties'))).toBe(true);
 expect(m.query.mock.calls.some(([sql])=>sql==='COMMIT')).toBe(true);
});
it('deletes a draft with custody documents, queues their private files, and commits before cleanup',async()=>{
 documents=[{id:'doc1',storage_path:'properties/property/document.pdf'},{id:'doc2',storage_path:'properties/property/archived.pdf'}];
 await RuralPropertyService.deleteDraft(uid,id,2,id,id,'a'.repeat(64));
 expect(m.query.mock.calls.some(([sql,params])=>String(sql).includes('app_property_document_storage_cleanup')&&params?.[0]?.length===2)).toBe(true);
 expect(m.query.mock.calls.some(([sql])=>String(sql).includes('PROPERTY_HAS_DOCUMENTS'))).toBe(false);
 const commitOrder=m.query.mock.invocationCallOrder[m.query.mock.calls.findIndex(([sql])=>sql==='COMMIT')];
 const cleanupOrder=m.query.mock.invocationCallOrder.find((order,index)=>String(m.query.mock.calls[index]?.[0]).includes('SELECT storage_path')&&String(m.query.mock.calls[index]?.[0]).includes('app_property_document_storage_cleanup'));
 expect(commitOrder).toBeLessThan(cleanupOrder!);
});
it('removes draft documents from administrator archives and verification queues after owner deletion',async()=>{
 const archivedDocument={id:'doc1',property_id:id,document_type:'car_sicar',file_name:'CAR.pdf',file_size_bytes:1200,mime_type:'application/pdf',status:'archived',created_at:new Date()};
 documents=[archivedDocument];
 const auditor={userId:'admin',role:'platform_admin',isSuperAdmin:true,sectors:[]};
 expect(await DocumentStorageService.list({userId:'admin',role:'platform_admin',auditor:true,requestId:id,ipHash:'a'.repeat(64)},id)).toEqual([archivedDocument]);
 expect((await VerificationQueueService.list(auditor,'pending')).requests).toHaveLength(1);

 await RuralPropertyService.deleteDraft(uid,id,2,id,id,'a'.repeat(64));

 await expect(DocumentStorageService.list({userId:'admin',role:'platform_admin',auditor:true,requestId:id,ipHash:'a'.repeat(64)},id)).rejects.toMatchObject({code:'PROPERTY_NOT_FOUND'});
 expect((await VerificationQueueService.list(auditor,'pending')).requests).toHaveLength(0);
 await expect(RuralPropertyService.getProperty(uid,id)).rejects.toMatchObject({code:'PROPERTY_NOT_FOUND'});
});
it.each(['completed','submitted','verified','rejected','suspended'])('rejects deletion of %s',async(status)=>{
 row.status=status;await expect(RuralPropertyService.deleteDraft(uid,id,2,id,id,'a'.repeat(64))).rejects.toMatchObject({code:'COMPLETED_PROPERTY_DELETE_FORBIDDEN'});
 expect(m.query.mock.calls.some(([sql])=>sql.startsWith('DELETE FROM'))).toBe(false);
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

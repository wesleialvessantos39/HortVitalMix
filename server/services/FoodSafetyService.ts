import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { dbPool } from "../db/pool.ts";
import { supabaseAdmin } from "../supabase/client.ts";
import { signedMediaUrls } from "../storage/signedMedia.ts";
import { commerceAdmin, commerceAudit, commerceCommand, commerceIdentity, commerceTransaction, CommerceError, type CommerceAudit } from "./CommerceSupport.ts";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import { FOOD_RESPONSIBILITY_TERMS, FOOD_RIGHTS_NOTICE, foodRuleMatches, foodAcceptanceState, type FoodSelector } from "../../shared/foodSafety.ts";
import {
  FoodAdminOverviewSchema, FoodAdminQuerySchema, FoodLearningQuerySchema, FoodLearningResponseSchema,
  FoodMaterialCommandSchema, FoodMaterialSchema, FoodRequirementsSchema, FoodRuleBodySchema, FoodRuleCommandSchema,
  FoodRuleSchema, FoodUploadSchema, FoodHoldSchema, FoodAcceptanceSchema,
  type FoodAcceptanceInput, type FoodRule, type FoodMaterial,
} from "../../shared/contracts/foodSafety.ts";
const BUCKET = "food-education";
const rulesLock = (c: PoolClient, exclusive = false) => c.query(`SELECT pg_advisory_xact_lock${exclusive ? "" : "_shared"}(76,hashtext('food-rules'))`);
const ruleSelect = `SELECT r.id,r.revision,r.status,r.current_version_id AS version_id,r.draft_body AS body,r.updated_at FROM public.app_food_rules r`;
function rule(row: Record<string, any>, published = false): FoodRule {
  return FoodRuleSchema.parse({id:row.id,revision:row.revision,status:published ? "published" : row.status,versionId:row.version_id ?? null,body:row.body,updatedAt:new Date(row.updated_at).toISOString()});
}
async function materials(c: PoolClient, admin = false, audience = "consumer",target:{state?:string;municipality?:string}={}): Promise<FoodMaterial[]> {
  const rows = (await c.query(`SELECT m.*,a.object_path FROM public.app_food_materials m
    LEFT JOIN public.app_food_assets a ON a.id=(m.body->>'assetId')::uuid AND a.status='ready'
    WHERE ($1::boolean OR (m.status='published' AND m.body->>'audience' IN ('both',$2)
      AND (m.body->>'scope'='national' OR (m.body->>'state'=$3 AND (m.body->>'scope'<>'municipality' OR public.fn_locality_normalize(m.body->>'municipality')=public.fn_locality_normalize($4))))))
    ORDER BY m.updated_at DESC,m.id LIMIT 300`,[admin,audience,target.state ?? null,target.municipality ?? ""])).rows;
  const urls = await signedMediaUrls(BUCKET,rows.map(r=>r.object_path).filter(Boolean));
  return rows.map(r=>FoodMaterialSchema.parse({id:r.id,revision:r.revision,status:r.status,body:r.body,mediaUrl:r.object_path ? urls.get(r.object_path) : null,updatedAt:r.updated_at.toISOString()}));
}
async function productContext(c: PoolClient, id: string) {
  const row = (await c.query(`SELECT p.id,p.title,p.category_id,p.food_family,p.food_process,p.food_revision,p.food_hold,p.food_hold_reason,
    loc.state,loc.municipality,pe.user_id AS owner_id,
    hvm_food_private.product_is_compliant(p.id) AS compliant
    FROM public.app_products p JOIN public.app_producer_stores s ON s.id=p.store_id
    JOIN public.app_properties loc ON loc.id=s.property_id
    JOIN public.app_producer_profiles pp ON pp.id=s.producer_profile_id JOIN public.app_people pe ON pe.id=pp.person_id
    WHERE p.id=$1`,[z.uuid().parse(id)])).rows[0];
  if(!row)throw new CommerceError("PRODUCT_NOT_FOUND",404);
  return row;
}
async function applicableRules(c: PoolClient, id: string) {
  return (await c.query(`SELECT r.id,r.revision,r.current_version_id AS version_id,v.body,v.created_at AS updated_at
    FROM public.app_food_rules r JOIN public.app_food_rule_versions v ON v.id=r.current_version_id
    WHERE v.id=ANY(hvm_food_private.expected_versions($1)) ORDER BY v.id`,[id])).rows.map(r=>rule(r,true));
}
export async function foodRequirements(c: PoolClient,id: string) {
  const p = await productContext(c,id);
  const rules = await applicableRules(c,id);
  const token = createHash("sha256").update(JSON.stringify({productId:p.id,foodRevision:p.food_revision,family:p.food_family,process:p.food_process,
    state:p.state,municipality:p.municipality,held:p.food_hold,versions:rules.map(r=>r.versionId),responsibility:FOOD_RESPONSIBILITY_TERMS,rights:FOOD_RIGHTS_NOTICE})).digest("hex");
  return FoodRequirementsSchema.parse({productId:p.id,family:p.food_family,process:p.food_process,location:{state:p.state,municipality:p.municipality},
    token,rules,checklist:rules.flatMap(r=>r.body.checklist.map(i=>({...i,acceptanceKey:r.versionId+":"+i.key,ruleTitle:r.body.title}))),
    responsibilityTerms:FOOD_RESPONSIBILITY_TERMS,rightsNotice:FOOD_RIGHTS_NOTICE,additionalTerms:rules.map(r=>r.body.producerTerms).filter(Boolean),
    compliant:p.compliant,held:p.food_hold,holdReason:p.food_hold_reason,requiresClassification:!p.food_family || !p.food_process});
}
export async function recordFoodAcceptance(c: PoolClient,id:string,userId:string,input:FoodAcceptanceInput | undefined,commandId:string,ctx:CommerceAudit) {
  if(!input)throw new CommerceError("PRODUCT_FOOD_CHECKLIST_REQUIRED",422);
  const value = FoodAcceptanceSchema.parse(input);
  const req = await foodRequirements(c,id);
  const state=foodAcceptanceState({token:req.token,keys:req.checklist.map(i=>i.acceptanceKey),held:req.held,classified:!req.requiresClassification},value);
  if(state==="held")throw new CommerceError("PRODUCT_FOOD_ON_HOLD",422);
  if(state==="classification")throw new CommerceError("PRODUCT_FOOD_CLASSIFICATION_REQUIRED",422);
  if(state==="stale")throw new CommerceError("PRODUCT_FOOD_RULES_CHANGED",409);
  if(state!=="valid" || !req.rules.length)throw new CommerceError("PRODUCT_FOOD_CHECKLIST_REQUIRED",422);
  const p = await productContext(c,id);
  if(p.owner_id!==userId)throw new CommerceError("FORBIDDEN",403);
  await c.query(`INSERT INTO public.app_food_acceptances(product_id,actor_id,product_title,food_revision,rule_version_ids,requirements_token,checked_keys,rule_snapshot,terms_snapshot,client_ip_hash,command_id,location_state,location_municipality)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[id,userId,p.title,p.food_revision,req.rules.map(r=>r.versionId),req.token,value.checkedKeys,
      JSON.stringify(req.rules),JSON.stringify({responsibility:req.responsibilityTerms,rights:req.rightsNotice,additional:req.additionalTerms}),ctx.ipHash,commandId,p.state,p.municipality]);
}
function published(c:PoolClient) {
  return c.query(`SELECT r.id,r.revision,r.current_version_id AS version_id,v.body,v.created_at AS updated_at
    FROM public.app_food_rules r JOIN public.app_food_rule_versions v ON v.id=r.current_version_id WHERE r.status<>'archived' ORDER BY r.is_core DESC,v.body->>'title'`);
}
async function asset(c:PoolClient,assetId:string,kind:string) {
  const row = (await c.query("SELECT * FROM public.app_food_assets WHERE id=$1 AND status='ready'",[assetId])).rows[0];
  if(!row || !row.mime_type.startsWith(kind+"/"))throw new CommerceError("FOOD_ASSET_NOT_READY",422);
}
export const FoodSafetyService = {
  async ownerRequirements(id:string,userId:string) {
    return commerceTransaction(async c=>{
      await commerceIdentity(c,userId,"producer");
      const p = await productContext(c,id);if(p.owner_id!==userId)throw new CommerceError("PRODUCT_NOT_FOUND",404);
      return foodRequirements(c,id);
    });
  },
  async publicProduct(id:string) {
    return commerceTransaction(async c=>{
      const visible = await c.query(`SELECT p.id FROM public.app_products p JOIN public.app_categories cat ON cat.id=p.category_id
        WHERE p.id=$1 AND p.is_published AND cat.is_active AND hvm_store_private.store_is_visible(p.store_id)
        AND hvm_food_private.product_is_compliant(p.id)`,[z.uuid().parse(id)]);
      if(!visible.rowCount)throw new CommerceError("PRODUCT_NOT_FOUND",404);
      const req=await foodRequirements(c,id);
      // Never disclose the producer's acceptance, IP, account identity or token.
      return {productId:id,location:req.location,guidance:req.rules.map(r=>({title:r.body.title,text:r.body.consumerGuidance,sources:r.body.sources})),rightsNotice:FOOD_RIGHTS_NOTICE,
        declarationNotice:"O aceite do checklist é uma declaração do produtor e não representa certificação sanitária ou inspeção oficial."};
    });
  },
  async learning(raw:unknown,userId?:string) {
    const query=FoodLearningQuerySchema.parse(raw);
    return commerceTransaction(async c=>{
      let state=query.state,municipality=query.municipality;
      if(userId) {
        await commerceIdentity(c,userId,"producer");
        if(!state) {
          const loc=(await c.query(`SELECT l.state,l.municipality FROM public.app_producer_stores s
            JOIN public.app_properties l ON l.id=s.property_id JOIN public.app_producer_profiles pp ON pp.id=s.producer_profile_id
            JOIN public.app_people pe ON pe.id=pp.person_id WHERE pe.user_id=$1 LIMIT 1`,[userId])).rows[0];
          if(loc){state=loc.state;municipality=loc.municipality;}
        }
      }
      const applies=(v:FoodSelector)=> {
        const families=!query.family || !v.families.length || v.families.includes(query.family);
        const processes=!query.process || !v.processes.length || v.processes.includes(query.process);
        const foodMatch=v.matchMode==="any" ? (!v.families.length && !v.processes.length) || (v.families.length>0 && families) || (v.processes.length>0 && processes) : families && processes;
        return foodMatch && (v.scope==="national" || (!!state && v.state===state && (v.scope!=="municipality" || foodRuleMatches({...v,families:[],processes:[],categoryIds:[]},
          {family:"",process:"",categoryId:"",state,municipality:municipality ?? ""}))));
      };
      const rules=(await published(c)).rows.map(r=>rule(r,true)).filter(r=>applies(r.body));
      const educational=(await materials(c,false,userId ? "producer" : "consumer",{state,municipality})).filter(m=>applies(m.body));
      return FoodLearningResponseSchema.parse({rules,materials:educational,responsibilityTerms:FOOD_RESPONSIBILITY_TERMS,rightsNotice:FOOD_RIGHTS_NOTICE,
        scopeNote:"Referências nacionais e complementos locais publicados pelo departamento. As exigências variam por produto, processo e local de produção; confira a autoridade sanitária competente. A biblioteca não é uma lista exaustiva de todas as normas do país."});
    });
  },
  async overview(actor:AdminActorContext,raw:unknown={}) {
    const filters=FoodAdminQuerySchema.parse(raw);
    const productScope=`SELECT p.id,p.title,s.store_name,p.food_family,p.food_process,p.is_published,p.food_hold,p.food_hold_reason,l.state,l.municipality,p.updated_at,
      hvm_food_private.product_is_compliant(p.id) AS compliant FROM public.app_products p JOIN public.app_producer_stores s ON s.id=p.store_id JOIN public.app_properties l ON l.id=s.property_id`;
    const productFilter=`(title ILIKE $1 OR store_name ILIKE $1) AND ($2='all' OR ($2='pending' AND NOT compliant AND NOT food_hold) OR ($2='held' AND food_hold) OR ($2='ready' AND compliant))`;
    const parameters=["%"+filters.search+"%",filters.status];
    return commerceTransaction(async c=>{
      await commerceAdmin(c,actor,"food_legislation");
      const [rs,ps,cs,acs,total]=await Promise.all([
        c.query(`${ruleSelect} ORDER BY r.is_core DESC,r.updated_at DESC LIMIT 300`),
        c.query(`WITH products AS (${productScope}) SELECT * FROM products WHERE ${productFilter} ORDER BY food_hold DESC,updated_at DESC,id LIMIT 50 OFFSET $3`,[...parameters,(filters.page-1)*50]),
        c.query("SELECT id,name FROM public.app_categories ORDER BY name"),
        c.query("SELECT id,product_title,accepted_at,cardinality(rule_version_ids) AS rule_count,food_revision FROM public.app_food_acceptances ORDER BY accepted_at DESC LIMIT 50"),
        c.query(`WITH products AS (${productScope}) SELECT count(*)::integer AS total FROM products WHERE ${productFilter}`,parameters),
      ]);
      return FoodAdminOverviewSchema.parse({pagination:{page:filters.page,pageSize:50,total:total.rows[0].total},rules:rs.rows.map(r=>rule(r)),materials:await materials(c,true),categories:cs.rows,
        products:ps.rows.map(p=>({id:p.id,title:p.title,storeName:p.store_name,family:p.food_family,process:p.food_process,published:p.is_published,compliant:p.compliant,held:p.food_hold,holdReason:p.food_hold_reason,state:p.state,municipality:p.municipality})),
        recentAcceptances:acs.rows.map(a=>({id:a.id,productTitle:a.product_title,acceptedAt:a.accepted_at.toISOString(),ruleCount:a.rule_count,foodRevision:a.food_revision}))});
    });
  },
  async saveRule(actor:AdminActorContext,raw:unknown,ctx:CommerceAudit) {
    const input=FoodRuleCommandSchema.parse(raw);
    return commerceTransaction(async c=>{
      await rulesLock(c,true);await commerceAdmin(c,actor,"food_legislation");
      return commerceCommand(c,actor.userId,input.commandId,"food.rule.save",input,async()=>{
        const old=input.id ? (await c.query("SELECT * FROM public.app_food_rules WHERE id=$1 FOR UPDATE",[input.id])).rows[0] : null;
        if(input.id && !old)throw new CommerceError("FOOD_RULE_NOT_FOUND",404);
        if(old && old.revision!==input.expectedRevision)throw new CommerceError("FOOD_REVISION_CHANGED",409);
        if(old?.is_core && (input.status==="archived" || input.body.scope!=="national" || input.body.families.length || input.body.processes.length || input.body.categoryIds.length))throw new CommerceError("FOOD_BASE_RULE_REQUIRED",422);
        const id=old?.id ?? randomUUID();
        if(!old)await c.query("INSERT INTO public.app_food_rules(id,slug,draft_body,status) VALUES($1,$2,$3,'draft')",[id,"custom-"+id,JSON.stringify(input.body)]);
        let versionId=old?.current_version_id ?? null;
        if(input.status==="published") {
          const next=(await c.query("SELECT coalesce(max(version),0)+1 AS version FROM public.app_food_rule_versions WHERE rule_id=$1",[id])).rows[0].version;
          versionId=(await c.query("INSERT INTO public.app_food_rule_versions(rule_id,version,body,created_by) VALUES($1,$2,$3,$4) RETURNING id",[id,next,JSON.stringify(input.body),actor.userId])).rows[0].id;
        }
        await c.query("UPDATE public.app_food_rules SET draft_body=$2,status=$3,current_version_id=$4,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",[id,JSON.stringify(input.body),input.status,versionId]);
        await commerceAudit(c,actor.userId,actor.role,"food.rule."+input.status,"app_food_rules",id,{before:old?.draft_body ?? null,after:input.body,versionId},ctx,input.commandId);
        return rule((await c.query(`${ruleSelect} WHERE r.id=$1`,[id])).rows[0]);
      });
    });
  },
  async saveMaterial(actor:AdminActorContext,raw:unknown,ctx:CommerceAudit) {
    const input=FoodMaterialCommandSchema.parse(raw);
    return commerceTransaction(async c=>{
      await commerceAdmin(c,actor,"food_legislation");
      return commerceCommand(c,actor.userId,input.commandId,"food.material.save",input,async()=>{
        const old=input.id ? (await c.query("SELECT * FROM public.app_food_materials WHERE id=$1 FOR UPDATE",[input.id])).rows[0] : null;
        if(input.id && !old)throw new CommerceError("FOOD_MATERIAL_NOT_FOUND",404);
        if(old && old.revision!==input.expectedRevision)throw new CommerceError("FOOD_REVISION_CHANGED",409);
        if(input.body.assetId)await asset(c,input.body.assetId,input.body.kind);
        const id=old?.id ?? randomUUID();
        if(old)await c.query("UPDATE public.app_food_materials SET body=$2,status=$3,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",[id,JSON.stringify(input.body),input.status]);
        else await c.query("INSERT INTO public.app_food_materials(id,body,status) VALUES($1,$2,$3)",[id,JSON.stringify(input.body),input.status]);
        await commerceAudit(c,actor.userId,actor.role,"food.material."+input.status,"app_food_materials",id,{before:old?.body ?? null,after:input.body},ctx,input.commandId);
        return {id};
      });
    });
  },
  async hold(actor:AdminActorContext,raw:unknown,ctx:CommerceAudit) {
    const input=FoodHoldSchema.parse(raw);
    return commerceTransaction(async c=>{
      await rulesLock(c,true);await commerceAdmin(c,actor,"food_legislation");
      return commerceCommand(c,actor.userId,input.commandId,"food.product.hold",input,async()=>{
        const row=(await c.query("SELECT id,food_hold FROM public.app_products WHERE id=$1 FOR UPDATE",[input.productId])).rows[0];
        if(!row)throw new CommerceError("PRODUCT_NOT_FOUND",404);
        await c.query("UPDATE public.app_products SET food_hold=$2,food_hold_reason=$3,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",[input.productId,input.hold,input.hold ? input.reason : null]);
        await commerceAudit(c,actor.userId,actor.role,input.hold ? "food.product.held" : "food.product.released","app_products",input.productId,{before:row.food_hold,hold:input.hold,reason:input.reason},ctx,input.commandId);
        return {id:input.productId,hold:input.hold};
      });
    });
  },
  async uploadTicket(actor:AdminActorContext,raw:unknown,ctx:CommerceAudit) {
    const input=FoodUploadSchema.parse(raw);
    if(!supabaseAdmin)throw new CommerceError("DEPENDENCY_UNAVAILABLE",503);
    return commerceTransaction(async c=>{
      await commerceAdmin(c,actor,"food_legislation");
      return commerceCommand(c,actor.userId,input.commandId,"food.asset.ticket",input,async()=>{
        const id=randomUUID(),extension={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","video/mp4":"mp4","video/webm":"webm"}[input.mimeType];
        const path="education/"+id+"/media."+extension;
        const signed=await supabaseAdmin!.storage.from(BUCKET).createSignedUploadUrl(path,{upsert:false});
        if(signed.error || !signed.data?.signedUrl)throw new CommerceError("FOOD_UPLOAD_UNAVAILABLE",503);
        await c.query("INSERT INTO public.app_food_assets(id,object_path,mime_type,bytes,uploaded_by) VALUES($1,$2,$3,$4,$5)",[id,path,input.mimeType,input.size,actor.userId]);
        await commerceAudit(c,actor.userId,actor.role,"food.asset.ticket","app_food_assets",id,{mimeType:input.mimeType,size:input.size},ctx,input.commandId);
        return {assetId:id,uploadUrl:signed.data.signedUrl};
      });
    });
  },
  async completeUpload(actor:AdminActorContext,id:string,ctx:CommerceAudit) {
    return commerceTransaction(async c=>{
      await commerceAdmin(c,actor,"food_legislation");
      const row=(await c.query("SELECT * FROM public.app_food_assets WHERE id=$1 AND uploaded_by=$2 FOR UPDATE",[z.uuid().parse(id),actor.userId])).rows[0];
      if(!row || !supabaseAdmin)throw new CommerceError("FOOD_ASSET_NOT_FOUND",404);
      const [folder,owner,name]=row.object_path.split("/");
      const list=await supabaseAdmin.storage.from(BUCKET).list(folder+"/"+owner,{search:name,limit:5});
      const object=list.data?.find(o=>o.name===name);
      if(list.error || !object || Number(object.metadata?.size)!==row.bytes || object.metadata?.mimetype!==row.mime_type)
        throw new CommerceError("FOOD_UPLOAD_INVALID",422);
      await c.query("UPDATE public.app_food_assets SET status='ready' WHERE id=$1",[id]);
      await commerceAudit(c,actor.userId,actor.role,"food.asset.ready","app_food_assets",id,{mimeType:row.mime_type,size:row.bytes},ctx);
      return {assetId:id};
    });
  },
  async acceptanceRecord(actor:AdminActorContext,id:string) {
    return commerceTransaction(async c=>{
      await commerceAdmin(c,actor,"food_legislation");
      const row=(await c.query(`SELECT id,product_title,food_revision,rule_snapshot,terms_snapshot,checked_keys,accepted_at,location_state,location_municipality
        FROM public.app_food_acceptances WHERE id=$1`,[z.uuid().parse(id)])).rows[0];
      if(!row)throw new CommerceError("FOOD_ACCEPTANCE_NOT_FOUND",404);
      return {id:row.id,productTitle:row.product_title,foodRevision:row.food_revision,rules:row.rule_snapshot,terms:row.terms_snapshot,checkedKeys:row.checked_keys,
        acceptedAt:row.accepted_at.toISOString(),location:{state:row.location_state,municipality:row.location_municipality}};
    });
  },
  async productHistory(actor:AdminActorContext,id:string) {
    return commerceTransaction(async c=>{
      await commerceAdmin(c,actor,"food_legislation");
      const rows=(await c.query(`SELECT occurred_at,actor_role,action,payload_after FROM public.app_audit_events
        WHERE target_entity='app_products' AND target_id=$1 AND action IN ('food.product.held','food.product.released') ORDER BY occurred_at DESC LIMIT 100`,[z.uuid().parse(id)])).rows;
      return {events:rows.map(r=>({at:r.occurred_at.toISOString(),role:r.actor_role,action:r.action,reason:r.payload_after?.reason ?? ""}))};
    });
  },
};

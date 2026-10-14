import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { FoodSafetyService } from "../services/FoodSafetyService.ts";
import { CommerceError } from "../services/CommerceSupport.ts";
import { adminSessionMiddleware, requireAdminSector, requireRecentAuth } from "../middleware/adminSession.ts";
import { originProtection } from "../security/originProtection.ts";
export const foodSafetyRouter=Router();
function foodQuery(req:Request,allowed:readonly string[]) {
  // Use the normalized URL, not Vercel's retained routing query object.
  const params=new URL(req.url,"http://localhost").searchParams;
  for(const key of ["path","__hvm_path","x-vercel-protection-bypass","x-vercel-set-bypass-cookie"])params.delete(key);
  const result:Record<string,string|string[]>={};
  for(const key of allowed){const values=[...new Set(params.getAll(key))];if(values.length)result[key]=values.length===1 ? values[0] : values;}
  return result;
}
const learningFilters=["state","municipality","family","process"] as const;
foodSafetyRouter.use(["/food","/producer/food","/admin/food"],(_req,res,next)=>{res.setHeader("Cache-Control","private, no-store");next();});
async function run(req:Request,res:Response,work:()=>Promise<unknown>) {
  try {res.json(await work());}catch(e) {
    res.status(e instanceof CommerceError ? e.status : e instanceof z.ZodError ? 422 : 503).json({error:e instanceof CommerceError ? e.code : e instanceof z.ZodError ? "FOOD_VALIDATION_ERROR" : "DEPENDENCY_UNAVAILABLE",requestId:req.requestId,
      ...(e instanceof z.ZodError ? {validation:e.issues.map(i=>({code:i.code,path:i.path.filter(p=>typeof p==="number" || ["state","municipality","family","process","search","status","page"].includes(String(p)))}))} : {})});
  }
}
const context=(req:Request)=>({requestId:req.requestId,ipHash:req.clientIpHash});
foodSafetyRouter.get("/food/learning",(req,res)=>run(req,res,()=>FoodSafetyService.learning(foodQuery(req,learningFilters))));
foodSafetyRouter.get("/food/products/:id",(req,res)=>run(req,res,()=>FoodSafetyService.publicProduct(String(req.params.id))));
foodSafetyRouter.get("/producer/food/learning",(req,res)=>{
  if(!req.actor?.roles.includes("producer")){res.status(403).json({error:"PRODUCER_REQUIRED"});return;}
  return run(req,res,()=>FoodSafetyService.learning(foodQuery(req,learningFilters),req.actor!.userId));
});
foodSafetyRouter.get("/producer/food/products/:id",(req,res)=>{
  if(!req.actor?.roles.includes("producer")){res.status(403).json({error:"PRODUCER_REQUIRED"});return;}
  return run(req,res,()=>FoodSafetyService.ownerRequirements(String(req.params.id),req.actor!.userId));
});
foodSafetyRouter.use("/admin/food",adminSessionMiddleware,requireAdminSector("food_legislation"));
foodSafetyRouter.get("/admin/food/overview",(req,res)=>run(req,res,()=>FoodSafetyService.overview(req.adminActor!,foodQuery(req,["search","status","page"]))));
foodSafetyRouter.get("/admin/food/acceptances/:id",(req,res)=>run(req,res,()=>FoodSafetyService.acceptanceRecord(req.adminActor!,String(req.params.id))));
foodSafetyRouter.get("/admin/food/products/:id/history",(req,res)=>run(req,res,()=>FoodSafetyService.productHistory(req.adminActor!,String(req.params.id))));
foodSafetyRouter.post("/admin/food/rules",originProtection,requireRecentAuth,(req,res)=>run(req,res,()=>FoodSafetyService.saveRule(req.adminActor!,req.body,context(req))));
foodSafetyRouter.post("/admin/food/materials",originProtection,requireRecentAuth,(req,res)=>run(req,res,()=>FoodSafetyService.saveMaterial(req.adminActor!,req.body,context(req))));
foodSafetyRouter.post("/admin/food/holds",originProtection,requireRecentAuth,(req,res)=>run(req,res,()=>FoodSafetyService.hold(req.adminActor!,req.body,context(req))));
foodSafetyRouter.post("/admin/food/uploads",originProtection,requireRecentAuth,(req,res)=>run(req,res,()=>FoodSafetyService.uploadTicket(req.adminActor!,req.body,context(req))));
foodSafetyRouter.post("/admin/food/uploads/:id/complete",originProtection,requireRecentAuth,(req,res)=>run(req,res,()=>FoodSafetyService.completeUpload(req.adminActor!,String(req.params.id),context(req))));

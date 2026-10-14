import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { FoodSafetyService } from "../services/FoodSafetyService.ts";
import { CommerceError } from "../services/CommerceSupport.ts";
import { adminSessionMiddleware, requireAdminSector, requireRecentAuth } from "../middleware/adminSession.ts";
import { originProtection } from "../security/originProtection.ts";
import { businessQuery } from "../security/businessQuery.ts";
export const foodSafetyRouter=Router();
foodSafetyRouter.use(["/food","/producer/food","/admin/food"],(_req,res,next)=>{res.setHeader("Cache-Control","private, no-store");next();});
async function run(req:Request,res:Response,work:()=>Promise<unknown>) {
  try {res.json(await work());}catch(e) {
    res.status(e instanceof CommerceError ? e.status : e instanceof z.ZodError ? 422 : 503).json({error:e instanceof CommerceError ? e.code : e instanceof z.ZodError ? "FOOD_VALIDATION_ERROR" : "DEPENDENCY_UNAVAILABLE",requestId:req.requestId});
  }
}
const context=(req:Request)=>({requestId:req.requestId,ipHash:req.clientIpHash});
foodSafetyRouter.get("/food/learning",(req,res)=>run(req,res,()=>FoodSafetyService.learning(businessQuery(req))));
foodSafetyRouter.get("/food/products/:id",(req,res)=>run(req,res,()=>FoodSafetyService.publicProduct(String(req.params.id))));
foodSafetyRouter.get("/producer/food/learning",(req,res)=>{
  if(!req.actor?.roles.includes("producer")){res.status(403).json({error:"PRODUCER_REQUIRED"});return;}
  return run(req,res,()=>FoodSafetyService.learning(businessQuery(req),req.actor!.userId));
});
foodSafetyRouter.get("/producer/food/products/:id",(req,res)=>{
  if(!req.actor?.roles.includes("producer")){res.status(403).json({error:"PRODUCER_REQUIRED"});return;}
  return run(req,res,()=>FoodSafetyService.ownerRequirements(String(req.params.id),req.actor!.userId));
});
foodSafetyRouter.use("/admin/food",adminSessionMiddleware,requireAdminSector("food_legislation"));
foodSafetyRouter.get("/admin/food/overview",(req,res)=>run(req,res,()=>FoodSafetyService.overview(req.adminActor!)));
foodSafetyRouter.post("/admin/food/rules",originProtection,requireRecentAuth,(req,res)=>run(req,res,()=>FoodSafetyService.saveRule(req.adminActor!,req.body,context(req))));
foodSafetyRouter.post("/admin/food/materials",originProtection,requireRecentAuth,(req,res)=>run(req,res,()=>FoodSafetyService.saveMaterial(req.adminActor!,req.body,context(req))));
foodSafetyRouter.post("/admin/food/holds",originProtection,requireRecentAuth,(req,res)=>run(req,res,()=>FoodSafetyService.hold(req.adminActor!,req.body,context(req))));
foodSafetyRouter.post("/admin/food/uploads",originProtection,requireRecentAuth,(req,res)=>run(req,res,()=>FoodSafetyService.uploadTicket(req.adminActor!,req.body,context(req))));
foodSafetyRouter.post("/admin/food/uploads/:id/complete",originProtection,requireRecentAuth,(req,res)=>run(req,res,()=>FoodSafetyService.completeUpload(req.adminActor!,String(req.params.id),context(req))));

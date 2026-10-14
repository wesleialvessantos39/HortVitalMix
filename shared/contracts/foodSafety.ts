import { z } from "zod";
import { BRAZIL_STATES, FOOD_FAMILIES, FOOD_PROCESSES, safeFoodLink, youtubeVideoId } from "../foodSafety.ts";
export const FoodFamilySchema = z.enum(FOOD_FAMILIES);
export const FoodProcessSchema = z.enum(FOOD_PROCESSES);
export const FoodIllustrationSchema = z.enum(["wash", "water", "cold", "label", "trace", "environment", "license"]);
const text = (max: number) => z.string().trim().max(max);
const link = text(2048).refine(safeFoodLink, "Use um endereço HTTPS público.");
const selector = {
  scope: z.enum(["national", "state", "municipality"]).default("national"),
  state: z.enum(BRAZIL_STATES).nullable().default(null), municipality: text(120).nullable().default(null),
  families: z.array(FoodFamilySchema).max(10).default([]), processes: z.array(FoodProcessSchema).max(6).default([]),
  categoryIds: z.array(z.uuid()).max(100).default([]),
};
const checkScope = (v: { scope: string; state: string | null; municipality: string | null }, c: z.RefinementCtx) => {
  if (v.scope !== "national" && !v.state) c.addIssue({code:"custom",path:["state"],message:"Informe o estado."});
  if (v.scope === "municipality" && !v.municipality?.trim()) c.addIssue({code:"custom",path:["municipality"],message:"Informe o município."});
  if (v.scope === "national" && (v.state || v.municipality)) c.addIssue({code:"custom",message:"A regra nacional não deve restringir a localidade."});
  if (v.scope === "state" && v.municipality) c.addIssue({code:"custom",message:"A regra estadual não deve restringir o município."});
};
export const FoodSourceSchema = z.object({title:text(180).min(3),url:link,authority:text(100).min(2),reviewedAt:z.iso.date()}).strict();
export const FoodChecklistItemSchema = z.object({key:text(64).regex(/^[a-z][a-z0-9_]*$/),title:text(180).min(3),explanation:text(1500).min(10),illustration:FoodIllustrationSchema}).strict();
export const FoodRuleBodySchema = z.object({
  title:text(180).min(3),summary:text(1500).min(10),...selector,
  checklist:z.array(FoodChecklistItemSchema).min(1).max(20),sources:z.array(FoodSourceSchema).min(1).max(30),
  consumerGuidance:text(2000).min(10),producerTerms:text(4000).default(""),
}).strict().superRefine(checkScope).superRefine((v,c)=>{
  if(new Set(v.checklist.map(i=>i.key)).size!==v.checklist.length)c.addIssue({code:"custom",path:["checklist"],message:"Os cuidados precisam de identificadores diferentes."});
});
export type FoodRuleBody = z.infer<typeof FoodRuleBodySchema>;
export const FoodRuleSchema = z.object({id:z.uuid(),versionId:z.uuid().nullable(),revision:z.number().int().positive(),status:z.enum(["draft","published","archived"]),body:FoodRuleBodySchema,updatedAt:z.iso.datetime()}).strict();
export type FoodRule = z.infer<typeof FoodRuleSchema>;
export const FoodRuleCommandSchema = z.object({id:z.uuid().optional(),expectedRevision:z.number().int().positive().optional(),status:z.enum(["draft","published","archived"]),body:FoodRuleBodySchema,commandId:z.uuid()}).strict();
export const FoodMaterialBodySchema = z.object({
  title:text(180).min(3),description:text(4000).min(10),...selector,
  kind:z.enum(["guide","image","video","youtube","link"]),audience:z.enum(["producer","consumer","both"]),
  url:link.nullable().default(null),assetId:z.uuid().nullable().default(null),illustration:FoodIllustrationSchema.default("wash"),
}).strict().superRefine(checkScope).superRefine((v,c)=>{
  if(v.kind==="youtube" && (!v.url || !youtubeVideoId(v.url)))c.addIssue({code:"custom",path:["url"],message:"Informe um vídeo válido do YouTube."});
  if(v.kind==="link" && !v.url)c.addIssue({code:"custom",path:["url"],message:"Informe o endereço do material."});
  if(["image","video"].includes(v.kind) && !v.assetId)c.addIssue({code:"custom",path:["assetId"],message:"Envie o arquivo primeiro."});
});
export type FoodMaterialBody = z.infer<typeof FoodMaterialBodySchema>;
export const FoodMaterialSchema = z.object({id:z.uuid(),revision:z.number().int().positive(),status:z.enum(["draft","published","archived"]),body:FoodMaterialBodySchema,mediaUrl:z.string().nullable(),updatedAt:z.iso.datetime()}).strict();
export type FoodMaterial = z.infer<typeof FoodMaterialSchema>;
export const FoodMaterialCommandSchema = z.object({id:z.uuid().optional(),expectedRevision:z.number().int().positive().optional(),status:z.enum(["draft","published","archived"]),body:FoodMaterialBodySchema,commandId:z.uuid()}).strict();
export const FoodUploadSchema = z.object({mimeType:z.enum(["image/jpeg","image/png","image/webp","video/mp4","video/webm"]),size:z.number().int().positive().max(33554432),commandId:z.uuid()}).strict();
export const FoodAcceptanceSchema = z.object({requirementsToken:text(64).regex(/^[a-f0-9]{64}$/),checkedKeys:z.array(text(120)).max(300),acceptResponsibility:z.literal(true),acceptTerms:z.literal(true)}).strict();
export type FoodAcceptanceInput = z.infer<typeof FoodAcceptanceSchema>;
export const FoodRequirementsSchema = z.object({
  productId:z.uuid(),family:FoodFamilySchema.nullable(),process:FoodProcessSchema.nullable(),
  location:z.object({state:z.string(),municipality:z.string()}).strict(),
  token:z.string(),rules:z.array(FoodRuleSchema),checklist:z.array(FoodChecklistItemSchema.extend({acceptanceKey:z.string(),ruleTitle:z.string()})),
  responsibilityTerms:z.string(),rightsNotice:z.string(),additionalTerms:z.array(z.string()),
  compliant:z.boolean(),held:z.boolean(),holdReason:z.string().nullable(),requiresClassification:z.boolean(),
}).strict();
export type FoodRequirements = z.infer<typeof FoodRequirementsSchema>;
export const FoodLearningQuerySchema = z.object({state:z.enum(BRAZIL_STATES).optional(),municipality:text(120).optional(),family:FoodFamilySchema.optional(),process:FoodProcessSchema.optional()}).strict();
export const FoodLearningResponseSchema = z.object({rules:z.array(FoodRuleSchema),materials:z.array(FoodMaterialSchema),responsibilityTerms:z.string(),rightsNotice:z.string(),scopeNote:z.string()}).strict();
export type FoodLearning = z.infer<typeof FoodLearningResponseSchema>;
export const FoodHoldSchema = z.object({productId:z.uuid(),hold:z.boolean(),reason:text(1500).min(10),commandId:z.uuid()}).strict();
export const FoodAdminOverviewSchema = z.object({
  rules:z.array(FoodRuleSchema),materials:z.array(FoodMaterialSchema),
  products:z.array(z.object({id:z.uuid(),title:z.string(),storeName:z.string(),family:FoodFamilySchema.nullable(),process:FoodProcessSchema.nullable(),published:z.boolean(),compliant:z.boolean(),held:z.boolean(),holdReason:z.string().nullable(),state:z.string(),municipality:z.string()}).strict()),
  categories:z.array(z.object({id:z.uuid(),name:z.string()}).strict()),
  recentAcceptances:z.array(z.object({id:z.uuid(),productTitle:z.string(),acceptedAt:z.iso.datetime(),ruleCount:z.number().int(),foodRevision:z.number().int()}).strict()),
}).strict();
export type FoodAdminOverview = z.infer<typeof FoodAdminOverviewSchema>;

import { z } from "zod";

export const BrazilianStatesEnum = z.enum([
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
]);
export const CommandIdSchema = z.string().uuid();
export const CreateAddressSchema = z.object({
  label: z.string().trim().min(1).max(64).default("Casa"),
  cep: z.string().transform(v=>v.replace(/\D/g,"")).refine(v=>/^[0-9]{8}$/.test(v),"CEP com 8 dígitos"),
  street: z.string().trim().min(2).max(255),
  number: z.string().trim().min(1).max(32).default("S/N"),
  complement: z.string().trim().max(128).nullable().optional(),
  neighborhood: z.string().trim().min(2).max(128),
  city: z.string().trim().min(2).max(100),
  state: BrazilianStatesEnum,
  isDefault: z.boolean().default(false),
  commandId: CommandIdSchema,
}).strict();
export const SetDefaultAddressSchema = z.object({commandId:CommandIdSchema}).strict();
export const DeleteAddressSchema = z.object({commandId:CommandIdSchema}).strict();
export const UpdateProfileSchema = z.object({
  fullName:z.string().trim().min(3).max(255),
  expectedRevision:z.number().int().positive(),
  commandId:CommandIdSchema,
}).strict();
export const UpdatePreferencesSchema = z.object({
  marketingConsent:z.boolean().optional(),
  orderUpdatesChannel:z.enum(["email","sms","both"]).optional(),
  quietHoursEnabled:z.boolean().optional(),
  quietHoursStart:z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).nullable().optional(),
  quietHoursEnd:z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).nullable().optional(),
  expectedRevision:z.number().int().positive(),
  commandId:CommandIdSchema,
}).strict().superRefine((value,ctx)=>{
  if(value.quietHoursEnabled===true && (!value.quietHoursStart || !value.quietHoursEnd))
    ctx.addIssue({code:"custom",message:"Informe início e fim do horário de silêncio",path:["quietHoursStart"]});
});
export type CreateAddressInput=z.infer<typeof CreateAddressSchema>;
export type UpdateProfileInput=z.infer<typeof UpdateProfileSchema>;
export type UpdatePreferencesInput=z.infer<typeof UpdatePreferencesSchema>;
export type AddressView={id:string;label:string;cep:string;street:string;number:string;complement:string|null;neighborhood:string;city:string;state:string;isDefault:boolean;revision:number;createdAt:string;updatedAt:string};
export type ProfileView={fullName:string;cpfMasked:string;email:string;phone:string;revision:number};
export type PreferencesView={marketingConsent:boolean;orderUpdatesChannel:"email"|"sms"|"both";quietHoursEnabled:boolean;quietHoursStart:string|null;quietHoursEnd:string|null;revision:number};
export type ConsentView={id:string;consentType:string;isGranted:boolean;policyVersion:string;registeredAt:string};

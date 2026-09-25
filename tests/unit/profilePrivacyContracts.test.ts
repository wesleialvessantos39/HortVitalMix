import {describe,expect,it} from "vitest";
import {CreateAddressSchema,UpdatePreferencesSchema,UpdateProfileSchema} from "../../shared/contracts/profilePrivacy";
describe("Trilha 06 contracts",()=>{
 it("normaliza CEP",()=>expect(CreateAddressSchema.parse({label:"Casa",cep:"76870-000",street:"Rua A",number:"1",neighborhood:"Centro",city:"Ariquemes",state:"RO",commandId:crypto.randomUUID()}).cep).toBe("76870000"));
 it.each(["123","abcdefgh","123456789"])("rejeita CEP inválido %s",cep=>expect(CreateAddressSchema.safeParse({label:"Casa",cep,street:"Rua A",number:"1",neighborhood:"Centro",city:"Ariquemes",state:"RO",commandId:crypto.randomUUID()}).success).toBe(false));
 it("aplica padrões seguros de endereço",()=>{const value=CreateAddressSchema.parse({cep:"76870000",street:"Rua A",number:"1",neighborhood:"Centro",city:"Ariquemes",state:"RO",commandId:crypto.randomUUID()});expect(value.label).toBe("Casa");expect(value.isDefault).toBe(false);});
 it("rejeita commandId não UUID",()=>expect(CreateAddressSchema.safeParse({label:"Casa",cep:"76870000",street:"Rua A",number:"1",neighborhood:"Centro",city:"Ariquemes",state:"RO",commandId:"repetido"}).success).toBe(false));
 it("rejeita UF inexistente",()=>expect(CreateAddressSchema.safeParse({label:"Casa",cep:"76870000",street:"Rua A",number:"1",neighborhood:"Centro",city:"Ariquemes",state:"XX",commandId:crypto.randomUUID()}).success).toBe(false));
 it("rejeita campo extra",()=>expect(CreateAddressSchema.safeParse({label:"Casa",cep:"76870000",street:"Rua A",number:"1",neighborhood:"Centro",city:"Ariquemes",state:"RO",admin:true,commandId:crypto.randomUUID()}).success).toBe(false));
 it("aceita perfil revisionado",()=>expect(UpdateProfileSchema.safeParse({fullName:"Maria da Silva",expectedRevision:1,commandId:crypto.randomUUID()}).success).toBe(true));
 it("rejeita revisão zero",()=>expect(UpdateProfileSchema.safeParse({fullName:"Maria da Silva",expectedRevision:0,commandId:crypto.randomUUID()}).success).toBe(false));
 it.each(["email","sms","both"] as const)("aceita canal %s",orderUpdatesChannel=>expect(UpdatePreferencesSchema.safeParse({orderUpdatesChannel,expectedRevision:1,commandId:crypto.randomUUID()}).success).toBe(true));
 it("exige horários quando silêncio é ligado",()=>expect(UpdatePreferencesSchema.safeParse({quietHoursEnabled:true,expectedRevision:1,commandId:crypto.randomUUID()}).success).toBe(false));
 it("aceita horários válidos",()=>expect(UpdatePreferencesSchema.safeParse({quietHoursEnabled:true,quietHoursStart:"22:00",quietHoursEnd:"06:00",expectedRevision:1,commandId:crypto.randomUUID()}).success).toBe(true));
 it("rejeita horário impossível",()=>expect(UpdatePreferencesSchema.safeParse({quietHoursEnabled:true,quietHoursStart:"25:00",quietHoursEnd:"06:00",expectedRevision:1,commandId:crypto.randomUUID()}).success).toBe(false));
});

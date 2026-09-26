import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({from:vi.fn(), signIn:vi.fn(), signOut:vi.fn(), sendOtp:vi.fn()}));
vi.mock("../../server/db/pool.ts",()=>({dbPool:null}));
vi.mock("../../server/supabase/client.ts",()=>({
 supabaseAdmin:{from:m.from},supabasePublic:null,
 createSupabasePublicClient:()=>({auth:{signInWithPassword:m.signIn,signOut:m.signOut,signInWithOtp:m.sendOtp}}),
}));
import { AdminGovernanceService } from "../../server/services/AdminGovernanceService.ts";
function query(data:unknown){const q:any={};for(const op of ["select","eq","in","is","limit"])q[op]=()=>q;q.maybeSingle=async()=>({data,error:null});q.then=(fn:any)=>Promise.resolve({data,error:null}).then(fn);return q;}
let role:string,confirmed:boolean,status:string,assigned:string;
beforeEach(()=>{
 vi.restoreAllMocks();vi.resetAllMocks();role="platform_super_admin";confirmed=true;status="active";assigned="platform_super_admin";
 vi.spyOn(AdminGovernanceService as any,"rateLimit").mockResolvedValue({limited:false});
 vi.spyOn(AdminGovernanceService as any,"recordAttempt").mockResolvedValue(undefined);
 m.signOut.mockResolvedValue({error:null});
 m.signIn.mockResolvedValue({data:{user:{id:"u",email_confirmed_at:"2026-09-01"},session:{access_token:"access",refresh_token:"refresh",expires_in:3600}},error:null});
 m.from.mockImplementation(table=>query(({
 app_admin_principals:[{admin_user_id:"u",portal_role:role,email_verified_at:confirmed?"2026-09-01":null,auth_email:"test@example.invalid"}],
 app_users:{status},app_user_role_assignments:[{role_code:assigned,expires_at:null}],
 app_admin_sector_members:[{sector_code:"operations",expires_at:null}],
 } as any)[table]));
});
describe("administrative password login — user policy 2026-09-25",()=>{
 it.each(["platform_admin","platform_super_admin"] as const)("creates %s session with password, without email OTP",async portal=>{
  role=assigned=portal;
  const result=await AdminGovernanceService.login("test@example.invalid","password","ip","request",portal);
  expect(result).toMatchObject({status:"session_created",role:portal,sectors:portal==="platform_admin"?["operations"]:[]});
  expect(m.sendOtp).not.toHaveBeenCalled();expect(m.signIn).toHaveBeenCalledOnce();
 });
 it("requires initial confirmation",async()=>{confirmed=false;expect(await AdminGovernanceService.login("test@example.invalid","password","ip","r","platform_super_admin")).toMatchObject({status:"email_confirmation_required"});expect(m.sendOtp).not.toHaveBeenCalled();});
 it("rejects an incorrect password",async()=>{m.signIn.mockResolvedValue({data:{},error:{message:"invalid"}});expect(await AdminGovernanceService.login("test@example.invalid","wrong","ip","r","platform_super_admin")).toEqual({status:"invalid_credentials"});});
 it("rejects a suspended account",async()=>{status="suspended";expect(await AdminGovernanceService.login("test@example.invalid","password","ip","r","platform_super_admin")).toEqual({status:"account_blocked"});});
 it("does not grant super access using an administrator credential",async()=>{role=assigned="platform_admin";expect(await AdminGovernanceService.login("test@example.invalid","password","ip","r","platform_super_admin")).toEqual({status:"no_admin_role"});});
 it("still enforces rate limits",async()=>{vi.mocked((AdminGovernanceService as any).rateLimit).mockResolvedValue({limited:true,retryAfterSeconds:60});expect(await AdminGovernanceService.login("test@example.invalid","password","ip","r","platform_super_admin")).toMatchObject({status:"rate_limited"});expect(m.signIn).not.toHaveBeenCalled();});
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
const mocks = vi.hoisted(() => ({
 getUser: vi.fn(), from: vi.fn(), rpc: vi.fn(), createUser: vi.fn(),
 resolve: vi.fn(),
}));
vi.mock("../../server/supabase/client.ts", () => ({
 supabaseAdmin: { auth: { getUser: mocks.getUser, admin: { createUser: mocks.createUser } }, from: mocks.from, rpc: mocks.rpc },
 createSupabasePublicClient: () => null,
}));
vi.mock("../../server/db/pool.ts", () => ({ dbPool: null }));
vi.mock("../../server/services/IdentityAccessService.ts", () => ({ resolveIdentityAccess: mocks.resolve }));
import { sessionMiddleware } from "../../server/middleware/session.ts";
import { adminSessionMiddleware } from "../../server/middleware/adminSession.ts";
import { register } from "../../server/services/AuthService.ts";
function response() {
 const res = { status: vi.fn(), json: vi.fn(), locals: {} };
 res.status.mockReturnValue(res); return res;
}
function chain(data: unknown) {
 const query: any = {};
 for (const method of ["select", "eq", "in", "is", "or"]) query[method] = vi.fn(() => query);
 query.maybeSingle = vi.fn(async () => ({ data, error: null }));
 query.single = vi.fn(async () => ({ data, error: null }));
 query.limit = vi.fn(async () => ({ data, error: null }));
 query.then = (resolve: any) => Promise.resolve({ data, error: null }).then(resolve);
 return query;
}
const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const token = "header." + Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url") + ".auth-adapted";
beforeEach(() => vi.resetAllMocks());
describe("authentication request performance without authorization bypass", () => {
 it.each(["/v1/admin/auth/login", "/api/v1/admin/auth/verify-session", "/_hvm_api/v1/admin/invites", "/v1/auth/logout", "/v1/auth/session"])("does not resolve public identity before the dedicated handler: %s", async path => {
  const next = vi.fn(); const res = response();
  await sessionMiddleware({ path, headers: { cookie: "hvm_access=old-token" } } as Request, res as unknown as Response, next);
  expect(next).toHaveBeenCalledOnce(); expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.resolve).not.toHaveBeenCalled();
 });
 it.each(["platform_super_admin", "platform_admin"])("validates %s once and retains its sector restrictions", async role => {
  mocks.getUser.mockResolvedValue({data:{user:{id:userId,email_confirmed_at:"2026-01-01"}},error:null});
  mocks.rpc.mockResolvedValue({data:[{created_at:new Date().toISOString()}],error:null});
  mocks.from.mockImplementation(table => chain(({
   app_admin_principals:{admin_user_id:userId,portal_role:role},
   app_user_role_assignments:[{role_code:role,expires_at:null}],
   app_users:{status:"active"}, app_admin_sector_members:[{sector_code:"operations",expires_at:null}],
  } as any)[table]));
  const req:any={headers:{cookie:`hvm_access=${token}; hvm_portal_role=${role}`}};
  const next=vi.fn(); await adminSessionMiddleware(req,response() as unknown as Response,next);
  expect(next).toHaveBeenCalledOnce(); expect(mocks.getUser).toHaveBeenCalledOnce();
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("fn_live_auth_session",{p_user_id:userId,p_session_id:sessionId});
  expect(req.adminActor.role).toBe(role);
  expect(req.adminActor.sectors).toEqual(role==="platform_admin"?["operations"]:[]);
 });
 it("rejects a suspended super administrator",async()=>{
  mocks.getUser.mockResolvedValue({data:{user:{id:"user",email_confirmed_at:"2026-01-01"}},error:null});
  mocks.from.mockImplementation(table=>chain(table==="app_users"?{status:"suspended"}:null));
  const res=response(),next=vi.fn();
  await adminSessionMiddleware({headers:{cookie:"hvm_access=token"}} as Request,res as unknown as Response,next);
  expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
 });
 it.each(["consumer", "producer"] as const)("registers %s with bounded parallel identity checks and still requires confirmation",async role=>{
  mocks.from.mockImplementation(table=>chain(table==="app_users"?{status:"active"}:null));
  mocks.createUser.mockResolvedValue({data:{user:{id:"new-user"}},error:null});
  mocks.rpc.mockResolvedValue({data:{},error:null});
  const result=await register({fullName:"Test Person",cpf:"12345678909",email:"test@example.invalid",password:"unused-test-password",phone:"+5569999999999"} as any,role,"test-request");
  expect(mocks.from.mock.calls.map(([table])=>table)).toEqual(["app_people","app_people","app_users"]);
  expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({email_confirm:false}));
  expect(result.confirmationRequired).toBe(true); expect(mocks.rpc).toHaveBeenCalledOnce();
 });
 it("does not create an account when CPF and email belong to different people",async()=>{
  mocks.from.mockReturnValueOnce(chain({user_id:"one"})).mockReturnValueOnce(chain({user_id:"two"}));
  await expect(register({cpf:"12345678909",email:"test@example.invalid"} as any,"consumer","request")).rejects.toThrow("REGISTRATION_IDENTITY_CONFLICT");
  expect(mocks.createUser).not.toHaveBeenCalled();
 });
});

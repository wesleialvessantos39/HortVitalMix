import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from "vitest";

// Auth externo é adaptado; sessão, transações e grants são PostgreSQL real local.
// Esta suíte não declara Supabase Auth ou produção homologados.
const m = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), rpc: vi.fn(), userId: "", sessionId: "" }));
vi.mock("../../server/db/pool.ts", async () => {
  if (!process.env.HVM_AUDIT_LOCAL_DATABASE_URL) return { dbPool: null };
  const url = new URL(process.env.HVM_AUDIT_LOCAL_DATABASE_URL);
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/postgres")
    throw Error("AUDIT_LOCAL_DATABASE_REQUIRED");
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return { dbPool: client };
});
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: { auth: { getUser: m.getUser }, from: m.from, rpc: m.rpc },
  createSupabasePublicClient: () => ({ auth: { getUser: m.getUser } }),
}));
import { dbPool } from "../../server/db/pool.ts";
import { adminSessionMiddleware, requireRecentAuth } from "../../server/middleware/adminSession.ts";
const db = dbPool!;
function chain(data: unknown) {
  const q: any = {};
  for (const method of ["select", "eq", "in", "is"]) q[method] = () => q;
  q.maybeSingle = async () => ({ data, error: null });
  q.then = (resolve: any) => Promise.resolve({ data, error: null }).then(resolve);
  return q;
}
function request() {
  const payload = Buffer.from(JSON.stringify({ session_id: m.sessionId, iat: Math.floor(Date.now() / 1000) })).toString("base64url");
  return { headers: { authorization: "Bearer header." + payload + ".validated-by-auth-adapter", cookie: "hvm_portal_role=platform_super_admin" }, requestId: randomUUID() } as any;
}
function response() {
  const res: any = { status: vi.fn(), json: vi.fn(), locals: {} };
  res.status.mockReturnValue(res);
  return res;
}
beforeEach(async () => {
  vi.resetAllMocks();
  m.userId = randomUUID();
  m.sessionId = randomUUID();
  await db.query("BEGIN");
  await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())", [m.userId, m.userId + "@example.test"]);
  const person = randomUUID();
  await db.query("INSERT INTO app_people(id,user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,'Pessoa sintética',$3,$4,'+5569999999999')", [person, m.userId, String(Math.floor(Math.random() * 1e11)).padStart(11, "0"), m.userId + "@example.test"]);
  await db.query("INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'platform_super_admin')", [m.userId]);
  await db.query("INSERT INTO app_admin_principals(admin_user_id,person_id,admin_email,portal_role) VALUES($1,$2,$3,'platform_super_admin')", [m.userId, person, m.userId + "@example.test"]);
  await db.query("INSERT INTO auth.sessions(id,user_id,created_at) VALUES($1,$2,now())", [m.sessionId, m.userId]);
  m.getUser.mockResolvedValue({ data: { user: { id: m.userId, email_confirmed_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString() } }, error: null });
  m.from.mockImplementation((table: string) => chain(({
    app_admin_principals: { admin_user_id: m.userId, portal_role: "platform_super_admin" },
    app_user_role_assignments: [{ role_code: "platform_super_admin", expires_at: null }],
    app_users: { status: "active" },
  } as any)[table]));
});
afterEach(async () => { await db.query("ROLLBACK"); });
afterAll(async () => { await db?.end(); });
describe.runIf(Boolean(process.env.HVM_AUDIT_LOCAL_DATABASE_URL))("Auditoria: Auth adaptado, sessão e grants em PostgreSQL real local", () => {
  it("aceita a sessão administrativa viva e recém-autenticada", async () => {
    const req = request(), res = response(), next = vi.fn();
    await adminSessionMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    const recent = vi.fn();
    requireRecentAuth(req, res, recent);
    expect(recent).toHaveBeenCalledOnce();
  });
  it("nega token adaptado quando sua sessão foi revogada", async () => {
    await db.query("DELETE FROM auth.sessions WHERE id=$1", [m.sessionId]);
    const next = vi.fn(), res = response();
    await adminSessionMiddleware(request(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it("nega sessão expirada pelo not_after", async () => {
    await db.query("UPDATE auth.sessions SET not_after=now()-interval '1 minute' WHERE id=$1", [m.sessionId]);
    const next = vi.fn(), res = response();
    await adminSessionMiddleware(request(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it("nega session_id inexistente", async () => {
    m.sessionId = randomUUID();
    const next = vi.fn(), res = response();
    await adminSessionMiddleware(request(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it("outro login da mesma conta não reautentica esta sessão antiga", async () => {
    await db.query("UPDATE auth.sessions SET created_at=now()-interval '1 hour' WHERE id=$1", [m.sessionId]);
    const req = request(), res = response(), next = vi.fn();
    await adminSessionMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    const recent = vi.fn();
    requireRecentAuth(req, res, recent);
    expect(recent).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it("falha de Auth responde sem liberar acesso nem rejeição não tratada", async () => {
    m.getUser.mockRejectedValue(Error("upstream failure"));
    const res = response(), next = vi.fn();
    await expect(adminSessionMiddleware(request(), res, next)).resolves.toBeUndefined();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });
  it("anon/authenticated não possuem privilégio destrutivo sobre consentimentos/preferências", async () => {
    const result = await db.query("SELECT has_table_privilege(r,t,'TRUNCATE') AS permitted FROM unnest(ARRAY['anon','authenticated']) r CROSS JOIN unnest(ARRAY['public.app_consent_records','public.app_user_preferences']) t");
    expect(result.rows.every((row: { permitted: boolean }) => row.permitted === false)).toBe(true);
  });
});

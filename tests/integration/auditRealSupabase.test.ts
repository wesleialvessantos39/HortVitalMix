import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

// Adapta somente a configuração de URL. Auth, REST, Storage e PostgreSQL
// executam serviços reais isolados. Nunca utiliza o projeto de produção.
const enabled = Boolean(process.env.HVM_AUDIT_REAL_SERVICES_CONFIG);
async function localConfiguration() {
  const path = process.env.HVM_AUDIT_REAL_SERVICES_CONFIG;
  if (!path) return null;
  const c = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  const db = new URL(c.dbUrl);
  if (
    c.url !== "http://127.0.0.1:57421" ||
    db.hostname !== "127.0.0.1" ||
    db.port !== "55433" ||
    db.pathname !== "/postgres"
  ) throw Error("AUDIT_REAL_LOCAL_SERVICES_REQUIRED");
  return c;
}
vi.mock("../../server/config/runtime.ts", async (original) => {
  const actual = await original<typeof import("../../server/config/runtime.ts")>();
  const c = await localConfiguration();
  if (!c) return actual;
  return { ...actual, runtime: { ...actual.runtime, appEnv: "development", supabaseUrl: c.url, anonKey: c.anonKey, serviceKey: c.serviceKey, ipPepper: "audit-local-pepper", secureCookies: false } };
});
vi.mock("../../server/supabase/client.ts", async (original) => {
  const c = await localConfiguration();
  if (!c) return original();
  const { createClient } = await import("@supabase/supabase-js");
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const publicClient = () => createClient(c.url, c.anonKey, options);
  return {
    supabaseAdmin: createClient(c.url, c.serviceKey, options),
    supabasePublic: publicClient(),
    createSupabasePublicClient: publicClient,
    createSupabaseUserClient: (token: string) => createClient(c.url, c.anonKey, { ...options, global: { headers: { Authorization: "Bearer " + token } } }),
  };
});
vi.mock("../../server/db/pool.ts", async (original) => {
  const c = await localConfiguration();
  if (!c) return original();
  const { default: pg } = await import("pg");
  return { dbPool: new pg.Pool({ connectionString: c.dbUrl, max: 3 }) };
});
import { supabaseAdmin, createSupabasePublicClient, createSupabaseUserClient } from "../../server/supabase/client.ts";
import { dbPool } from "../../server/db/pool.ts";
import { adminSessionMiddleware, requireRecentAuth, requireSuperAdmin } from "../../server/middleware/adminSession.ts";
import { resolveLiveAuthSession, sessionIdFromVerifiedToken } from "../../server/security/liveSession.ts";
import { issueRecentAuthProof } from "../../server/security/recentAuth.ts";
import { issueRegistrationConsentProof, verifyRegistrationConsentProof } from "../../server/security/registrationConsent.ts";
import { sessionMiddleware } from "../../server/middleware/session.ts";
import { authRouter } from "../../server/routes/authRoutes.ts";
import { LGPD_CADASTRO_POLICY_VERSION } from "../../shared/lgpdCadastro.ts";

type Identity = { id: string; personId: string; email: string; password: string; token: string; sessionId: string };
const identities: Record<string, Identity> = {};
function guardedApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.requestId = randomUUID(); req.clientIpHash = "a".repeat(64); res.locals.requestId = req.requestId; next(); });
  app.get("/admin", adminSessionMiddleware, (_req, res) => res.json({ allowed: true }));
  app.get("/recent", adminSessionMiddleware, requireRecentAuth, (_req, res) => res.json({ allowed: true }));
  app.get("/super", adminSessionMiddleware, requireSuperAdmin, (_req, res) => res.json({ allowed: true }));
  app.use(sessionMiddleware);
  app.use("/v1/auth", authRouter);
  return app;
}
const app = guardedApp();
function authorized(path: string, who = "super", cookie?: string) {
  const req = request(app).get(path).set("Authorization", "Bearer " + identities[who].token);
  return cookie ? req.set("Cookie", cookie) : req;
}
async function freshSession(who: string) {
  const person = identities[who];
  const result = await createSupabasePublicClient()!.auth.signInWithPassword({ email: person.email, password: person.password });
  if (result.error || !result.data.session) throw Error("LOCAL_AUTH_LOGIN_FAILED:" + result.error?.code);
  return result.data.session;
}
beforeAll(async () => {
  if (!enabled) return;
  for (const [index, [name, roles]] of Object.entries({ public: ["consumer", "producer"], other: ["consumer"], admin: ["platform_admin"], super: ["platform_super_admin"] }).entries()) {
    const email = randomUUID() + "@example.test", password = "Synthetic-" + randomUUID() + "!";
    const created = await supabaseAdmin!.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: "platform_super_admin", is_admin: true } });
    if (created.error || !created.data.user) throw Error("LOCAL_AUTH_USER_CREATION_FAILED:" + created.error?.code);
    const id = created.data.user.id, personId = randomUUID();
    await dbPool!.query("INSERT INTO app_people(id,user_id,full_name,cpf_normalized,email_normalized,phone_e164,email_verified_at) VALUES($1,$2,'Pessoa sintética da auditoria',$3,$4,'+5569999999999',now())", [personId, id, String(Date.now()).slice(-9) + String(index).padStart(2, "0"), email]);
    for (const role of roles) await dbPool!.query("INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,$2)", [id, role]);
    if (roles.includes("producer")) await dbPool!.query("INSERT INTO app_producer_profiles(person_id) VALUES($1)", [personId]);
    if (roles[0].startsWith("platform_")) await dbPool!.query("INSERT INTO app_admin_principals(admin_user_id,person_id,admin_email,portal_role) VALUES($1,$2,$3,$4)", [id, personId, email, roles[0]]);
    identities[name] = { id, personId, email, password, token: "", sessionId: "" };
    const session = await freshSession(name);
    identities[name].token = session.access_token;
    identities[name].sessionId = sessionIdFromVerifiedToken(session.access_token)!;
  }
});
afterAll(async () => { if (enabled) await dbPool!.end(); });

describe.runIf(enabled)("Auditoria: serviços Supabase reais e isolados", () => {
  it("Auth valida login e a sessão possui linha canônica no banco", async () => {
    const user = await supabaseAdmin!.auth.getUser(identities.super.token);
    expect(user.error).toBeNull();
    expect(user.data.user?.id).toBe(identities.super.id);
    expect((await resolveLiveAuthSession(identities.super.id, identities.super.sessionId)).status).toBe("active");
    expect((await authorized("/recent")).status).toBe(200);
  });
  it("Data API consulta a sessão pela RPC restrita sem pool SQL", async () => {
    expect((await resolveLiveAuthSession(identities.super.id, identities.super.sessionId, false)).status).toBe("active");
    expect((await resolveLiveAuthSession(identities.other.id, identities.super.sessionId, false)).status).toBe("invalid");
  });
  it("anon e authenticated não podem executar a RPC administrativa", async () => {
    const args = { p_user_id: identities.super.id, p_session_id: identities.super.sessionId };
    expect((await createSupabasePublicClient()!.rpc("fn_live_auth_session", args)).error).not.toBeNull();
    expect((await createSupabaseUserClient(identities.public.token)!.rpc("fn_live_auth_session", args)).error).not.toBeNull();
  });
  it("metadados e cookie manipulados não promovem Consumidor/Produtor", async () => {
    expect((await authorized("/admin", "public", "hvm_portal_role=platform_super_admin")).status).toBe(401);
    expect((await authorized("/super", "admin")).status).toBe(403);
    expect((await authorized("/admin", "super", "hvm_portal_role=platform_admin")).status).toBe(403);
  });
  it("RLS permite o perfil próprio e não retorna o perfil de outra pessoa", async () => {
    const client = createSupabaseUserClient(identities.public.token)!;
    const own = await client.from("app_people").select("id,user_id").eq("id", identities.public.personId);
    expect(own.error).toBeNull(); expect(own.data).toHaveLength(1);
    const other = await client.from("app_people").select("id,user_id").eq("id", identities.other.personId);
    expect(other.error).toBeNull(); expect(other.data).toHaveLength(0);
  });
  it("campos administrativos não podem ser atualizados diretamente pelo cliente", async () => {
    const client = createSupabaseUserClient(identities.public.token)!;
    const change = await client.from("app_user_role_assignments").insert({ user_id: identities.public.id, role_code: "platform_super_admin" });
    expect(change.error).not.toBeNull();
    const status = await client.from("app_users").update({ status: "active" }).eq("id", identities.public.id);
    expect(status.error).not.toBeNull();
  });
  it("uma identidade conserva login de Consumidor e Produtor", async () => {
    for (const portalRole of ["consumer", "producer"]) {
      const response = await request(app).post("/v1/auth/login").set("Origin", "http://127.0.0.1:3000").send({ email: identities.public.email, password: identities.public.password, portalRole });
      expect(response.status).toBe(200);
      const cookies = response.headers["set-cookie"] as unknown as string[];
      expect(cookies.some((v) => v.startsWith("hvm_access=") && v.includes("HttpOnly"))).toBe(true);
    }
  });
  it("outro login não concede reautenticação a uma sessão antiga", async () => {
    const { super: person } = identities;
    await dbPool!.query("UPDATE auth.sessions SET created_at=now()-interval '1 hour' WHERE id=$1", [person.sessionId]);
    await freshSession("super");
    expect((await authorized("/admin")).status).toBe(200);
    expect((await authorized("/recent")).status).toBe(401);
    const proof = issueRecentAuthProof(person.id, person.token);
    expect((await authorized("/recent", "super", "hvm_reauth=" + encodeURIComponent(proof))).status).toBe(200);
    await dbPool!.query("UPDATE auth.sessions SET created_at=now() WHERE id=$1", [person.sessionId]);
  });
  it("not_after expirado impede autorização SQL e RPC", async () => {
    await dbPool!.query("UPDATE auth.sessions SET not_after=now()-interval '1 minute' WHERE id=$1", [identities.super.sessionId]);
    expect((await resolveLiveAuthSession(identities.super.id, identities.super.sessionId)).status).toBe("invalid");
    expect((await resolveLiveAuthSession(identities.super.id, identities.super.sessionId, false)).status).toBe("invalid");
    expect((await authorized("/admin")).status).toBe(401);
    await dbPool!.query("UPDATE auth.sessions SET not_after=NULL WHERE id=$1", [identities.super.sessionId]);
  });
  it("JWT adulterado e pedido sem token não atravessam Auth", async () => {
    const parts = identities.public.token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    payload.sub = identities.super.id; payload.role = "service_role";
    parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
    expect((await request(app).get("/admin").set("Authorization", "Bearer " + parts.join("."))).status).toBe(401);
    expect((await request(app).get("/admin")).status).toBe(401);
  });
  it("consentimento anônimo exige prova e grava somente para a identidade vinculada", async () => {
    const input = { userId: identities.public.id, email: identities.public.email, policyVersion: LGPD_CADASTRO_POLICY_VERSION };
    const before = await dbPool!.query("SELECT count(*)::int AS n FROM app_consent_records WHERE person_id=$1", [identities.public.personId]);
    expect((await request(app).post("/v1/auth/lgpd-acceptance").send(input)).status).toBe(401);
    const proof = issueRegistrationConsentProof(input);
    expect((await request(app).post("/v1/auth/lgpd-acceptance").send({ ...input, consentProof: proof })).status).toBe(204);
    expect((await request(app).post("/v1/auth/lgpd-acceptance").send({ ...input, userId: identities.other.id, consentProof: proof })).status).toBe(401);
    const after = await dbPool!.query("SELECT count(*)::int AS n FROM app_consent_records WHERE person_id=$1", [identities.public.personId]);
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);
    expect((await request(app).post("/v1/auth/lgpd-acceptance").send({ ...input, consentProof: proof })).status).toBe(204);
    expect((await dbPool!.query("SELECT count(*)::int AS n FROM app_consent_records WHERE person_id=$1", [identities.public.personId])).rows[0].n).toBe(after.rows[0].n);
  });
  it("Storage privado entrega URL assinada e nega leitura pública", async () => {
    const path = identities.public.personId + "/audit-" + randomUUID() + ".pdf";
    const bytes = Buffer.from("%PDF-1.4\nDocumento sintético da auditoria local\n%%EOF");
    const upload = await supabaseAdmin!.storage.from("documents_private").upload(path, bytes, { contentType: "application/pdf" });
    expect(upload.error?.message ?? null).toBeNull();
    const signed = await supabaseAdmin!.storage.from("documents_private").createSignedUrl(path, 60);
    expect(signed.error?.message ?? null).toBeNull();
    const response = await fetch(signed.data!.signedUrl);
    expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
    const publicUrl = supabaseAdmin!.storage.from("documents_private").getPublicUrl(path).data.publicUrl;
    expect((await fetch(publicUrl)).ok).toBe(false);
    expect((await createSupabasePublicClient()!.storage.from("documents_private").download(path)).error).not.toBeNull();
    expect((await createSupabaseUserClient(identities.other.token)!.storage.from("documents_private").createSignedUrl(path, 60)).error).not.toBeNull();
  });
  it("bucket restrito recusa MIME não permitido", async () => {
    const upload = await supabaseAdmin!.storage.from("documents_private").upload(randomUUID() + ".html", Buffer.from("<script>alert(1)</script>"), { contentType: "text/html" });
    expect(upload.error).not.toBeNull();
  });
  it("confirmação e recuperação passam pelo Auth real", async () => {
    const email = randomUUID() + "@example.test", password = "Synthetic-" + randomUUID() + "!";
    const signup = await supabaseAdmin!.auth.admin.generateLink({ type: "signup", email, password });
    expect(signup.error?.code ?? null).toBeNull();
    if (!signup.data.properties) throw Error("LOCAL_CONFIRMATION_LINK_REQUIRED");
    const confirmation = await createSupabasePublicClient()!.auth.verifyOtp({ type: "signup", token_hash: signup.data.properties.hashed_token });
    expect(confirmation.error?.code ?? null).toBeNull();
    expect(confirmation.data.user?.email_confirmed_at).toBeTruthy();
    const recovery = await supabaseAdmin!.auth.admin.generateLink({ type: "recovery", email });
    expect(recovery.error?.code ?? null).toBeNull();
    if (!recovery.data.properties) throw Error("LOCAL_RECOVERY_LINK_REQUIRED");
    const client = createSupabasePublicClient()!;
    const verified = await client.auth.verifyOtp({ type: "recovery", token_hash: recovery.data.properties.hashed_token });
    expect(verified.error?.code ?? null).toBeNull();
    const changed = await client.auth.updateUser({ password: password + "-New" });
    expect(changed.error?.code ?? null).toBeNull();
    expect((await createSupabasePublicClient()!.auth.signInWithPassword({ email, password })).error).not.toBeNull();
    expect((await createSupabasePublicClient()!.auth.signInWithPassword({ email, password: password + "-New" })).error).toBeNull();
  });
  it("logout revoga a sessão real e a autorização deixa de aceitar o token", async () => {
    const signedOut = await supabaseAdmin!.auth.admin.signOut(identities.super.token, "local");
    expect(signedOut.error?.code ?? null).toBeNull();
    expect((await supabaseAdmin!.auth.getUser(identities.super.token)).error).not.toBeNull();
    expect((await resolveLiveAuthSession(identities.super.id, identities.super.sessionId)).status).toBe("invalid");
    expect((await authorized("/admin")).status).toBe(401);
  });
  it.runIf(Boolean(process.env.HVM_AUDIT_REAL_EDGE_URL))("Edge Deno real preserva cadastro, consentimento atômico e segunda função pública", async () => {
    const url = process.env.HVM_AUDIT_REAL_EDGE_URL;
    if (url !== "http://127.0.0.1:8000") throw Error("AUDIT_REAL_LOCAL_EDGE_REQUIRED");
    const email = randomUUID() + "@example.test", password = "Synthetic-" + randomUUID() + "!";
    let cpf = String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
    for (let n = 9; n < 11; n++) {
      const sum = [...cpf].reduce((total, digit, i) => total + Number(digit) * (n + 1 - i), 0);
      const digit = (sum * 10) % 11; cpf += digit === 10 ? "0" : String(digit);
    }
    const data = { fullName: "Pessoa sintética Edge", email, password, cpf, phone: "+5569999999999", municipality: "Ariquemes", state: "RO" };
    const send = (body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://hortvitalmix.vercel.app" }, body: JSON.stringify(body) });
    const before = (await dbPool!.query("SELECT count(*)::int AS n FROM auth.users")).rows[0].n;
    const elevated = await send({ role: "platform_super_admin", data });
    expect(elevated.status).toBe(400);
    expect((await send({ role: "consumer", data: { ...data, owner_id: identities.super.id } })).status).toBe(400);
    expect((await dbPool!.query("SELECT count(*)::int AS n FROM auth.users")).rows[0].n).toBe(before);
    const created = await send({ role: "consumer", data, consent: { policyVersion: LGPD_CADASTRO_POLICY_VERSION } });
    const first = await created.json();
    expect(first.error ?? null).toBeNull(); expect(created.status).toBe(201);
    expect(first.lgpdRecorded).toBe(true);
    expect(verifyRegistrationConsentProof(first.consentProof, { userId: first.userId, email, policyVersion: LGPD_CADASTRO_POLICY_VERSION })).toBe(true);
    expect((await dbPool!.query("SELECT count(*)::int AS n FROM app_consent_records cr JOIN app_people p ON p.id=cr.person_id WHERE p.user_id=$1 AND cr.consent_type='lgpd_cadastro'", [first.userId])).rows[0].n).toBe(1);
    const confirmed = await supabaseAdmin!.auth.admin.updateUserById(first.userId, { email_confirm: true });
    expect(confirmed.error?.code ?? null).toBeNull();
    const denied = await send({ role: "producer", data: { ...data, password: "WrongPassword#2026" }, consent: { policyVersion: LGPD_CADASTRO_POLICY_VERSION } });
    expect(denied.status).toBe(409); expect((await denied.json()).consentProof).toBeUndefined();
    const added = await send({ role: "producer", data, consent: { policyVersion: LGPD_CADASTRO_POLICY_VERSION } });
    const second = await added.json();
    expect(second.error ?? null).toBeNull(); expect(added.status).toBe(201);
    expect(second.userId).toBe(first.userId); expect(second.existingIdentity).toBe(true); expect(second.roleAdded).toBe(true);
    expect(verifyRegistrationConsentProof(second.consentProof, { userId: first.userId, email, policyVersion: LGPD_CADASTRO_POLICY_VERSION })).toBe(true);
    expect((await dbPool!.query("SELECT role_code FROM app_user_role_assignments WHERE user_id=$1 AND revoked_at IS NULL ORDER BY role_code", [first.userId])).rows.map(r => r.role_code)).toEqual(["consumer", "producer"]);
    expect((await dbPool!.query("SELECT count(*)::int AS n FROM auth.users")).rows[0].n).toBe(before + 1);
  });
});

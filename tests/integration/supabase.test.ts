import { describe, it, expect, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import request from "supertest";
import { dbPool } from "../../server/db/pool";
import { runtime } from "../../server/config/runtime";
import { supabaseAdmin } from "../../server/supabase/client";
import { app } from "../../server/app";
import {
  GlobalConfigPublicSchema,
  FOUNDATION_SCHEMA_VERSION,
} from "../../shared/contracts/foundation";
import { RO_MUNICIPALITIES } from "../../shared/localities/roMunicipalities";

const PRODUCTION_PROJECT_REF = "xipbsazvymkqqfmfegwu";
const enabled =
  runtime.appEnv === "development" &&
  Boolean(runtime.projectRef) &&
  runtime.projectRef !== PRODUCTION_PROJECT_REF;

function assertIsolatedDevelopment() {
  if (runtime.appEnv !== "development")
    throw new Error("ISOLATED_TEST_ENV_REQUIRED");

  if (runtime.projectRef === PRODUCTION_PROJECT_REF)
    throw new Error("PRODUCTION_PROJECT_REF_REJECTED");

  if (!dbPool || !supabaseAdmin)
    throw new Error("INTEGRATION_CLIENTS_REQUIRED");
}

function cpfDigit(base: string): number {
  const size = base.length;
  let sum = 0;
  for (let i = 0; i < size; i++) sum += Number(base[i]) * (size + 1 - i);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

function generateCpf(): string {
  let base = "";
  do {
    base = Array.from({ length: 9 }, () => String(randomInt(0, 10))).join("");
  } while (/^(\d)\1{8}$/.test(base));
  const d1 = cpfDigit(base);
  const d2 = cpfDigit(base + String(d1));
  return `${base}${d1}${d2}`;
}

function registration(overrides: Record<string, unknown> = {}) {
  const marker = randomUUID().replace(/-/g, "");
  return {
    fullName: "Produtor Teste Integração",
    cpf: generateCpf(),
    email: `hvm-${marker}@example.com`,
    phone: (() => {
      const number = String(randomInt(900000000, 999999999));
      return "(69) " + number.slice(0, 5) + "-" + number.slice(5);
    })(),
    password: `Hvm!${marker}Aa9#`,
    // Trava de cobertura: o cadastro público só conclui em município ativo.
    municipality: "Ariquemes",
    state: "RO",
    ...overrides,
  };
}

async function cleanupRegisteredUser(userId: string) {
  assertIsolatedDevelopment();

  const person = await dbPool!.query<{ id: string }>(
    "SELECT id FROM public.app_people WHERE user_id=$1",
    [userId],
  );

  if (person.rows[0]) {
    await dbPool!.query(
      "DELETE FROM public.app_producer_profiles WHERE person_id=$1",
      [person.rows[0].id],
    );
  }

  await dbPool!.query(
    "DELETE FROM public.app_user_role_assignments WHERE user_id=$1",
    [userId],
  );
  await dbPool!.query("DELETE FROM public.app_people WHERE user_id=$1", [
    userId,
  ]);

  const deleted = await supabaseAdmin!.auth.admin.deleteUser(userId);
  if (deleted.error && deleted.error.status !== 404) throw deleted.error;

  await dbPool!.query("DELETE FROM public.app_users WHERE id=$1", [userId]);
}

describe.skipIf(!enabled)("Supabase real e JWTs reais", () => {
  it("exige ambiente development isolado", () => {
    assertIsolatedDevelopment();
    expect(dbPool).not.toBeNull();
    expect(supabaseAdmin).not.toBeNull();
  });

  it("executa invariantes SQL com rollback", async () => {
    assertIsolatedDevelopment();
    const c = await dbPool!.connect();
    try {
      await c.query(readFileSync("supabase/tests/foundation.sql", "utf8"));
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  });

  it("permite rascunho documental vazio sem enfraquecer a submissão completa", async () => {
    assertIsolatedDevelopment();
    const columns = await dbPool!.query<{
      attname: string;
      attnotnull: boolean;
      column_default: string | null;
    }>(
      `SELECT a.attname,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS column_default
         FROM pg_attribute a
         LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid='public.app_properties'::regclass
          AND a.attname=ANY($1::text[]) AND NOT a.attisdropped`,
      [[
        "property_name",
        "rural_zone_sector",
        "line_vicinal",
        "municipality",
        "latitude_sede",
        "longitude_sede",
      ]],
    );
    expect(columns.rows).toHaveLength(6);
    expect(columns.rows.every((column) => !column.attnotnull)).toBe(true);
    expect(
      columns.rows.find((column) => column.attname === "municipality")
        ?.column_default,
    ).toBeNull();

    const check = await dbPool!.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid='public.app_properties'::regclass
          AND conname='ck_app_properties_submission_complete'`,
    );
    expect(check.rows[0]?.definition).toMatch(/status.*draft/i);
    expect(check.rows[0]?.definition).toContain("property_name IS NOT NULL");
    expect(check.rows[0]?.definition).toContain("latitude_sede IS NOT NULL");
  });

  it("impede corridas de cadastro por código IBGE e nome normalizado", async () => {
    assertIsolatedDevelopment();
    const marker = randomUUID().replace(/-/g, "").slice(0, 10);
    const codes: string[] = [];
    while (codes.length < 3) {
      const candidate = String(randomInt(1_000_000, 9_999_999));
      if (codes.includes(candidate)) continue;
      const existing = await dbPool!.query(
        "SELECT 1 FROM public.app_municipalities WHERE ibge_code=$1",
        [candidate],
      );
      if (!existing.rows.length) codes.push(candidate);
    }
    const [duplicateCode, nameRaceCodeA, nameRaceCodeB] = codes;
    const nameCodeA = `Concorrência ${marker}-A`;
    const nameCodeB = `Concorrência ${marker}-B`;
    const codeRace = await Promise.allSettled([
      dbPool!.query(
        "INSERT INTO public.app_municipalities(ibge_code,name,state) VALUES($1,$2,'RO')",
        [duplicateCode, nameCodeA],
      ),
      dbPool!.query(
        "INSERT INTO public.app_municipalities(ibge_code,name,state) VALUES($1,$2,'RO')",
        [duplicateCode, nameCodeB],
      ),
    ]);
    const nameRace = await Promise.allSettled([
      dbPool!.query(
        "INSERT INTO public.app_municipalities(ibge_code,name,state) VALUES($1,$2,'RO')",
        [nameRaceCodeA, `Concorrência   ${marker}`],
      ),
      dbPool!.query(
        "INSERT INTO public.app_municipalities(ibge_code,name,state) VALUES($1,$2,'RO')",
        [nameRaceCodeB, `  CONCORRENCIA ${marker}  `],
      ),
    ]);
    try {
      expect(codeRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(
        codeRace.filter((result) => result.status === "rejected").map((result) => result.reason.code),
      ).toEqual(["23505"]);
      expect(nameRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(
        nameRace.filter((result) => result.status === "rejected").map((result) => result.reason.code),
      ).toEqual(["23505"]);
      expect(RO_MUNICIPALITIES).toHaveLength(52);
    } finally {
      await dbPool!.query(
        "DELETE FROM public.app_municipalities WHERE ibge_code=ANY($1::varchar[])",
        [[duplicateCode, nameRaceCodeA, nameRaceCodeB]],
      );
    }
  });

  it("GoTrue cria espelho e JWT respeita isolamento", async () => {
    assertIsolatedDevelopment();

    const email = `hvm-${randomUUID()}@example.com`;
    const password = randomUUID() + "A!";
    let id: string | undefined;

    try {
      const created = await supabaseAdmin!.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      id = created.data.user!.id;

      const auth = createClient(runtime.supabaseUrl, runtime.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const login = await auth.auth.signInWithPassword({ email, password });
      expect(login.error).toBeNull();
      expect(login.data.session?.access_token).toBeTruthy();
      const accessToken = login.data.session!.access_token;

      await dbPool!.query(
        "INSERT INTO public.app_user_role_assignments(user_id,role_code) VALUES($1,'consumer')",
        [id],
      );

      const actor = await request(app)
        .get("/v1/auth/session")
        .set("Cookie", `hvm_access=${encodeURIComponent(accessToken)}; hvm_portal_role=consumer`);
      expect(actor.status).toBe(200);
      expect(actor.body.userId).toBe(id);
      expect(actor.body.roles).toEqual(["consumer"]);

      const own = await auth.from("app_users").select("id");
      expect(own.error).toBeNull();
      expect(own.data?.map((r) => r.id)).toEqual([id]);

      const update = await auth
        .from("app_users")
        .update({ status: "blocked" })
        .eq("id", id);
      expect(update.error).not.toBeNull();

      const roles = await auth
        .from("app_user_role_assignments")
        .insert({ user_id: id, role_code: "platform_super_admin" });
      expect(roles.error).not.toBeNull();

      const signedOut = await auth.auth.signOut();
      expect(signedOut.error).toBeNull();

      const revoked = await request(app)
        .get("/v1/auth/session")
        .set("Cookie", `hvm_access=${encodeURIComponent(accessToken)}; hvm_portal_role=consumer`);
      expect(revoked.status).toBe(401);
    } finally {
      if (id) {
        const deleted = await supabaseAdmin!.auth.admin.deleteUser(id);
        expect(deleted.error).toBeNull();

        const mirror = await dbPool!.query(
          "SELECT status FROM public.app_users WHERE id=$1",
          [id],
        );
        // A exclusão operacional canônica v46 remove o espelho do Auth.
        expect(mirror.rows).toHaveLength(0);

        await dbPool!.query("DELETE FROM public.app_users WHERE id=$1", [id]);
      }
    }
  });

  it("cadastro de produtor cria cadeia user + person + role + profile", async () => {
    assertIsolatedDevelopment();
    const payload = registration();
    let userId: string | undefined;

    try {
      const response = await request(app)
        .post("/v1/auth/register-producer")
        .set("Origin", "http://localhost:3000")
        .send(payload);

      expect(response.status).toBe(201);
      userId = response.body.userId;
      expect(userId).toMatch(/^[0-9a-f-]{36}$/i);

      const chain = await dbPool!.query(
        `SELECT u.status,p.full_name,r.role_code,pp.property_name,pp.verification_status,pp.trust_level
           FROM public.app_users u
           JOIN public.app_people p ON p.user_id=u.id
           JOIN public.app_user_role_assignments r ON r.user_id=u.id AND r.revoked_at IS NULL
           JOIN public.app_producer_profiles pp ON pp.person_id=p.id
          WHERE u.id=$1`,
        [userId],
      );

      expect(chain.rows).toHaveLength(1);
      expect(chain.rows[0]).toMatchObject({
        status: "active",
        role_code: "producer",
        property_name: null,
        verification_status: "declared",
        trust_level: 0,
      });
    } finally {
      if (userId) await cleanupRegisteredUser(userId);
    }
  });

  it("cadastro duplicado retorna conflito sem segunda identidade", async () => {
    assertIsolatedDevelopment();
    const payload = registration();
    let userId: string | undefined;

    try {
      const first = await request(app)
        .post("/v1/auth/register-producer")
        .set("Origin", "http://localhost:3000")
        .send(payload);
      expect(first.status).toBe(201);
      userId = first.body.userId;

      const second = await request(app)
        .post("/v1/auth/register-producer")
        .set("Origin", "http://localhost:3000")
        .send(payload);
      expect(second.status).toBe(409);
      expect(second.body.error).toBe("EXISTING_ACCOUNT_CONFIRM_REQUIRED");

      const people = await dbPool!.query<{ n: number }>(
        "SELECT count(*)::int n FROM public.app_people WHERE email_normalized=$1",
        [payload.email],
      );
      expect(people.rows[0].n).toBe(1);
    } finally {
      if (userId) await cleanupRegisteredUser(userId);
    }
  });

  it("CPF de outra identidade é rejeitado antes de criar usuário no GoTrue", async () => {
    assertIsolatedDevelopment();
    const blocker = registration();
    let blockerId: string | undefined;

    try {
      const first = await request(app)
        .post("/v1/auth/register-producer")
        .set("Origin", "http://localhost:3000")
        .send(blocker);
      expect(first.status).toBe(201);
      blockerId = first.body.userId;

      const before = await dbPool!.query<{ n: number }>(
        "SELECT count(*)::int n FROM public.app_users",
      );

      const failing = registration({ cpf: blocker.cpf });
      const second = await request(app)
        .post("/v1/auth/register-producer")
        .set("Origin", "http://localhost:3000")
        .send(failing);

      expect(second.status).toBe(409);
      expect(second.body.error).toBe("CPF_LINKED_TO_EXISTING_ACCOUNT");

      const authRows = await dbPool!.query<{ n: number }>(
        "SELECT count(*)::int n FROM auth.users WHERE lower(email)=lower($1)",
        [failing.email],
      );
      expect(authRows.rows[0].n).toBe(0);

      const after = await dbPool!.query<{ n: number }>(
        "SELECT count(*)::int n FROM public.app_users",
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
    } finally {
      if (blockerId) await cleanupRegisteredUser(blockerId);
    }
  });

  it("config pública retorna o contrato canônico real", async () => {
    assertIsolatedDevelopment();

    const response = await request(app).get("/v1/config");
    expect(response.status).toBe(200);
    expect(GlobalConfigPublicSchema.safeParse(response.body).success).toBe(
      true,
    );
  });

  it("readiness é fail-closed sem release e valida release real quando existe", async () => {
    assertIsolatedDevelopment();

    const release = await dbPool!.query<{
      release_tag: string;
      schema_version: number;
    }>(
      "SELECT release_tag,schema_version FROM public.app_releases WHERE environment=$1 AND is_current=true",
      [runtime.appEnv],
    );

    const response = await request(app).get("/ready");

    if (!release.rows[0]) {
      expect(response.status).toBe(503);
      expect(response.body.reason).toBe("RELEASE_NOT_CONFIGURED");
      return;
    }

    expect(response.status).toBe(200);
    expect(response.body.databaseConnected).toBe(true);
    expect(response.body.schemaVersion).toBe(FOUNDATION_SCHEMA_VERSION);
    expect(response.body.releaseTag).toBe(release.rows[0].release_tag);
  });

  afterAll(async () => {
    await dbPool?.end();
  });
});

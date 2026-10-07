import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
const local = vi.hoisted(() => ({
  tokens: new Map<string, string>(),
  pool: null as any,
}));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_PROFILES_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw Error("PROFILES_LOCAL_DATABASE_REQUIRED");
  const pg = (await import("pg")).default;
  return { dbPool: new pg.Pool({ connectionString: value, max: 8 }) };
});
vi.mock("../../server/config/runtime.ts", async (original) => {
  const value = await original<any>();
  return {
    ...value,
    runtime: {
      ...value.runtime,
      appEnv: "development",
      secureCookies: false,
      ipPepper: "profiles-local-proof",
    },
  };
});
// External Auth transport only is adapted. All sessions, profiles, role assignments,
// permission checks, mutations, audit and RLS below run against real local PostgreSQL.
vi.mock("../../server/supabase/client.ts", () => {
  const client = {
    auth: {
      getUser: async (token: string) => {
        const id = local.tokens.get(token);
        const user = id
          ? (
              await local.pool.query(
                "SELECT id,email,email_confirmed_at FROM auth.users WHERE id=$1",
                [id],
              )
            ).rows[0]
          : null;
        return {
          data: {
            user: user
              ? {
                  ...user,
                  email_confirmed_at: user.email_confirmed_at?.toISOString(),
                }
              : null,
          },
          error: null,
        };
      },
      admin: { signOut: async () => ({ error: null }) },
    },
    from: (table: string) => {
      const where: string[] = [],
        args: any[] = [];
      const q: any = {
        select: () => q,
        is: (key: string, v: any) => {
          where.push(v === null ? `${key} IS NULL` : `${key} IS NOT NULL`);
          return q;
        },
        eq: (key: string, v: any) => {
          args.push(v);
          where.push(`${key}=$${args.length}`);
          return q;
        },
        in: (key: string, v: string[]) => {
          args.push(v);
          where.push(`${key}=ANY($${args.length}::varchar[])`);
          return q;
        },
        limit: () => q,
        order: () => q,
      };
      const run = async () => {
        try {
          return {
            data: (
              await local.pool.query(
                `SELECT * FROM public.${table}${where.length ? " WHERE " + where.join(" AND ") : ""}`,
                args,
              )
            ).rows,
            error: null,
          };
        } catch {
          return {
            data: null,
            error: { message: "local Data API unavailable" },
          };
        }
      };
      q.maybeSingle = async () => {
        const r = await run();
        return { ...r, data: r.data?.[0] ?? null };
      };
      q.then = (resolve: any) => run().then(resolve);
      return q;
    },
  };
  return {
    supabaseAdmin: client,
    supabasePublic: client,
    createSupabasePublicClient: () => client,
    createSupabaseUserClient: () => client,
  };
});
import { dbPool } from "../../server/db/pool.ts";
import { app } from "../../server/app.ts";
import { ProfilePrivacyService } from "../../server/services/ProfilePrivacyService.ts";
import { AdminPermissionService } from "../../server/services/AdminPermissionService.ts";
import {
  commerceAdmin,
  commerceTransaction,
} from "../../server/services/CommerceSupport.ts";
import { NotificationService } from "../../server/services/NotificationService.ts";
import { ADMIN_SECTOR_LABELS } from "../../shared/adminPermissions.ts";
import { issueRecentAuthProof } from "../../server/security/recentAuth.ts";
const db = dbPool!;
const sectors = Object.keys(ADMIN_SECTOR_LABELS).sort() as any[];
const context = () => ({ requestId: randomUUID(), ipHash: "a".repeat(64) });
const names = {
  consumer: "Pessoa pública original",
  producer: "Pessoa pública original",
  platform_admin: "Administrador original",
  platform_super_admin: "Super original",
};
let publicId: string,
  adminId: string,
  rootId: string,
  otherRoot: string,
  personId: string;
const created: string[] = [];
async function user(
  name: string,
  person?: string,
  role?: string,
  email?: string,
) {
  const id = randomUUID();
  created.push(id);
  const mail = email ?? id + "@example.test";
  await db.query(
    "INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES($1,$2,now(),$3)",
    [id, id + "@auth.example.test", JSON.stringify({ full_name: name })],
  );
  let pid = person;
  if (!pid)
    pid = (
      await db.query(
        "INSERT INTO app_people(user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,$3,$4,'+5569999999999') RETURNING id",
        [
          id,
          name,
          String(Math.floor(Math.random() * 1e11)).padStart(11, "0"),
          mail,
        ],
      )
    ).rows[0].id;
  if (role) {
    await db.query(
      "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,$2)",
      [id, role],
    );
    if (role.startsWith("platform_"))
      await db.query(
        "INSERT INTO app_admin_principals(admin_user_id,person_id,admin_email,portal_role,email_verified_at) VALUES($1,$2,$3,$4,now())",
        [id, pid, mail, role],
      );
  }
  await db.query("UPDATE app_users SET status='active' WHERE id=$1", [id]);
  return { id, personId: pid! };
}
function actor(id = rootId, role = "platform_super_admin"): AdminActorContext {
  return {
    userId: id,
    role: role as any,
    isSuperAdmin: role === "platform_super_admin",
    sectors: [],
    sessionIssuedAt: new Date().toISOString(),
  };
}
async function cookies(id: string, role: string) {
  const sid = randomUUID();
  await db.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)", [
    sid,
    id,
  ]);
  const token =
    "header." +
    Buffer.from(JSON.stringify({ session_id: sid })).toString("base64url") +
    ".local-adapter";
  local.tokens.set(token, id);
  return `hvm_access=${token}; hvm_portal_role=${role}; hvm_reauth=${issueRecentAuthProof(id, token)}`;
}
async function change(id: string, codes = sectors, commandId = randomUUID()) {
  const view = await AdminPermissionService.get(id, actor());
  return AdminPermissionService.update(
    id,
    actor(),
    { sectors: codes, commandId, expectedRevision: view.revision },
    context(),
  );
}
describe.runIf(!!process.env.HVM_PROFILES_LOCAL_DATABASE_URL)(
  "Cadastros independentes e poderes: PostgreSQL/HTTP local real",
  () => {
    beforeEach(async () => {
      for (const id of created.reverse())
        await db.query("DELETE FROM auth.users WHERE id=$1", [id]);
      created.length = 0;
      local.pool = db;
      local.tokens.clear();
      const person = await user(names.consumer);
      publicId = person.id;
      personId = person.personId;
      for (const role of ["consumer", "producer"])
        await db.query(
          "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,$2)",
          [publicId, role],
        );
      adminId = (
        await user(
          names.platform_admin,
          personId,
          "platform_admin",
          "same-" + publicId + "@example.test",
        )
      ).id;
      await db.query(
        "INSERT INTO app_admin_sector_members(user_id,sector_code) VALUES($1,'refund_management')",
        [adminId],
      );
      rootId = (
        await user(
          names.platform_super_admin,
          personId,
          "platform_super_admin",
          "same-" + publicId + "@example.test",
        )
      ).id;
      otherRoot = (
        await user("Outro Super original", undefined, "platform_super_admin")
      ).id;
    });
    afterAll(async () => {
      for (const id of created.reverse())
        await db.query("DELETE FROM auth.users WHERE id=$1", [id]);
      await db.end();
    });
    it.each(Object.keys(names))(
      "editar %s preserva nome/revisão dos demais cadastros",
      async (role) => {
        const ids = {
          consumer: publicId,
          producer: publicId,
          platform_admin: adminId,
          platform_super_admin: rootId,
        };
        const before = await Promise.all(
          Object.keys(names).map((role) =>
            ProfilePrivacyService.getProfile(
              ids[role as keyof typeof ids],
              role,
            ),
          ),
        );
        const id = ids[role as keyof typeof ids],
          current = await ProfilePrivacyService.getProfile(id, role);
        const commandId = randomUUID(),
          input = {
            fullName: "Nome exclusivo " + role,
            expectedRevision: current.revision,
            profileRole: role as any,
            commandId,
          };
        const result = await ProfilePrivacyService.updateProfile(
          id,
          role,
          input,
          randomUUID(),
          "a".repeat(64),
        );
        expect(result.status).toBe("updated");
        await ProfilePrivacyService.updateProfile(
          id,
          role,
          input,
          randomUUID(),
          "a".repeat(64),
        );
        const after = await Promise.all(
          Object.keys(names).map((r) =>
            ProfilePrivacyService.getProfile(ids[r as keyof typeof ids], r),
          ),
        );
        Object.keys(names).forEach((r, i) => {
          if (r === role) expect(after[i].fullName).toBe(input.fullName);
          else expect(after[i]).toEqual(before[i]);
        });
        expect(
          (
            await db.query("SELECT full_name FROM app_people WHERE id=$1", [
              personId,
            ])
          ).rows[0].full_name,
        ).toBe(names.consumer);
        expect(
          (
            await db.query(
              "SELECT count(*)::int n FROM app_audit_events WHERE command_id=$1",
              [commandId],
            )
          ).rows[0].n,
        ).toBe(1);
      },
    );
    it("sessão e perfil HTTP mostram os nomes do papel ativo, inclusive com mesmo CPF/e-mail", async () => {
      for (const [role, id] of [
        ["consumer", publicId],
        ["producer", publicId],
        ["platform_admin", adminId],
        ["platform_super_admin", rootId],
      ]) {
        const cookie = await cookies(id, role);
        const session = await request(app)
          .get("/api/v1/auth/session")
          .set("Cookie", cookie);
        expect(session.status).toBe(200);
        expect(session.body.fullName).toBe(names[role as keyof typeof names]);
        const profile = await request(app)
          .get("/api/v1/account/profile")
          .set("Cookie", cookie);
        expect(profile.status).toBe(200);
        expect(profile.body.fullName).toBe(names[role as keyof typeof names]);
        expect(profile.body.profileRole).toBe(role);
      }
    });
    it("impede formulário de outro papel e conflito de revisão sem alterar dados", async () => {
      const profile = await ProfilePrivacyService.getProfile(
        publicId,
        "producer",
      );
      await expect(
        ProfilePrivacyService.updateProfile(
          publicId,
          "producer",
          {
            fullName: "Nome cruzado",
            profileRole: "consumer",
            expectedRevision: profile.revision,
            commandId: randomUUID(),
          },
          randomUUID(),
          "a".repeat(64),
        ),
      ).rejects.toMatchObject({ code: "PROFILE_SCOPE_CHANGED" });
      const result = await ProfilePrivacyService.updateProfile(
        publicId,
        "producer",
        {
          fullName: "Nome antigo",
          expectedRevision: 999,
          commandId: randomUUID(),
        },
        randomUUID(),
        "a".repeat(64),
      );
      expect(result.status).toBe("conflict");
      expect(
        await ProfilePrivacyService.getProfile(publicId, "producer"),
      ).toEqual(profile);
    });
    it("novo papel conserva o nome e telefone informados; falha de perfil aborta também o papel", async () => {
      const p = await user("Cadastro inicial", undefined, "consumer");
      const base = (
        await db.query("SELECT * FROM app_people WHERE user_id=$1", [p.id])
      ).rows[0];
      await db.query(
        "SELECT public.add_public_role_with_profile($1,$2,$3,'producer',$4,$5)",
        [
          p.id,
          base.cpf_normalized,
          base.email_normalized,
          "Nome de produtor novo",
          "+5569988888888",
        ],
      );
      expect(
        (await ProfilePrivacyService.getProfile(p.id, "consumer")).fullName,
      ).toBe("Cadastro inicial");
      expect(
        await ProfilePrivacyService.getProfile(p.id, "producer"),
      ).toMatchObject({
        fullName: "Nome de produtor novo",
        phone: "+5569988888888",
      });
      const bad = await user("Cadastro inicial isolado", undefined, "consumer");
      const person = (
        await db.query("SELECT * FROM app_people WHERE user_id=$1", [bad.id])
      ).rows[0];
      await expect(
        db.query(
          "SELECT public.add_public_role_with_profile($1,$2,$3,'producer',$4,$5)",
          [
            bad.id,
            person.cpf_normalized,
            person.email_normalized,
            "Nome inválido",
            "bad-phone",
          ],
        ),
      ).rejects.toThrow();
      expect(
        (
          await db.query(
            "SELECT 1 FROM app_user_role_assignments WHERE user_id=$1 AND role_code='producer'",
            [bad.id],
          )
        ).rowCount,
      ).toBe(0);
    });
    it("Super começa com todos os poderes, retirada bloqueia domínio e notificações, devolução restaura", async () => {
      expect(
        (await AdminPermissionService.get(otherRoot, actor())).sectors,
      ).toEqual(sectors);
      await db.query(
        "SELECT hvm_notifications_private.emit($1,'platform_super_admin',$2,'refunds','Reembolso local','Caso local','/admin/reembolsos','refund_management')",
        [otherRoot, randomUUID()],
      );
      const root = actor(otherRoot);
      expect(
        (
          await NotificationService.list(
            { userId: otherRoot, role: "platform_super_admin", admin: root },
            {},
          )
        ).notifications.some((n) => n.title === "Reembolso local"),
      ).toBe(true);
      await change(
        otherRoot,
        sectors.filter((code) => code !== "refund_management"),
      );
      await expect(
        commerceTransaction((c) => commerceAdmin(c, root, "refund_management")),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        (
          await NotificationService.list(
            { userId: otherRoot, role: "platform_super_admin", admin: root },
            {},
          )
        ).notifications.some((n) => n.title === "Reembolso local"),
      ).toBe(false);
      await commerceTransaction((c) =>
        commerceAdmin(c, root, "payment_configuration"),
      );
      await change(otherRoot);
      await commerceTransaction((c) =>
        commerceAdmin(c, root, "refund_management"),
      );
    });
    it.each(sectors)(
      "retirar/devolver %s impede apenas o poder correspondente no servidor",
      async (code) => {
        await change(
          otherRoot,
          sectors.filter((value) => value !== code),
        );
        await expect(
          commerceTransaction((c) => commerceAdmin(c, actor(otherRoot), code)),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        for (const other of sectors.filter((value) => value !== code))
          await commerceTransaction((c) =>
            commerceAdmin(c, actor(otherRoot), other),
          );
        await change(otherRoot);
        await commerceTransaction((c) =>
          commerceAdmin(c, actor(otherRoot), code),
        );
      },
    );
    it("último Super com gestão de acessos não é bloqueado nem excluído", async () => {
      await change(otherRoot, []);
      const cookie = await cookies(rootId, "platform_super_admin");
      const response = await request(app)
        .patch("/api/v1/admin/users/" + rootId + "/status")
        .set("Cookie", cookie)
        .set("Sec-Fetch-Site", "same-origin")
        .send({
          status: "blocked",
          mode: "indefinite",
          commandId: randomUUID(),
        });
      expect(response.status).toBe(409);
      expect(
        (await db.query("SELECT status FROM app_users WHERE id=$1", [rootId]))
          .rows[0].status,
      ).toBe("active");
      await expect(
        db.query("SELECT public.delete_active_account($1,$2)", [
          rootId,
          otherRoot,
        ]),
      ).rejects.toThrow("LAST_SUPER_ADMIN_PROTECTED");
    });
    it("API de poderes rejeita anônimo, setor sem hierarquia e origem externa", async () => {
      expect(
        (
          await request(app).get(
            "/api/v1/admin/users/" + otherRoot + "/permissions",
          )
        ).status,
      ).toBe(401);
      const admin = await cookies(adminId, "platform_admin"),
        root = await cookies(rootId, "platform_super_admin");
      expect(
        (
          await request(app)
            .get("/api/v1/admin/users/" + otherRoot + "/permissions")
            .set("Cookie", admin)
        ).status,
      ).toBe(403);
      const view = await AdminPermissionService.get(otherRoot, actor());
      const rejected = await request(app)
        .patch("/api/v1/admin/users/" + otherRoot + "/permissions")
        .set("Cookie", root)
        .set("Origin", "https://untrusted.example")
        .set("Sec-Fetch-Site", "cross-site")
        .send({
          sectors: [],
          expectedRevision: view.revision,
          commandId: randomUUID(),
        });
      expect(rejected.status).toBe(403);
      expect(await AdminPermissionService.get(otherRoot, actor())).toEqual(
        view,
      );
    });
    it("administrador setorial tem setores retirados e devolvidos após cadastro sem ganhar hierarquia", async () => {
      await change(adminId, ["location_management"]);
      expect(
        (await AdminPermissionService.get(adminId, actor())).sectors,
      ).toEqual(["location_management"]);
      await expect(
        commerceTransaction((c) =>
          commerceAdmin(
            c,
            actor(adminId, "platform_admin"),
            "refund_management",
          ),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await change(adminId, ["refund_management"]);
      await commerceTransaction((c) =>
        commerceAdmin(c, actor(adminId, "platform_admin"), "refund_management"),
      );
      await expect(
        AdminPermissionService.update(
          otherRoot,
          actor(adminId, "platform_admin"),
          { sectors: [], commandId: randomUUID(), expectedRevision: 1 },
          context(),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("idempotência e versão preservam auditoria e notificações na repetição do comando", async () => {
      const before = await AdminPermissionService.get(otherRoot, actor());
      const commandId = randomUUID(),
        input = {
          sectors: ["refund_management"],
          expectedRevision: before.revision,
          commandId,
        };
      const first = await AdminPermissionService.update(
        otherRoot,
        actor(),
        input,
        context(),
      );
      expect(
        await AdminPermissionService.update(
          otherRoot,
          actor(),
          input,
          context(),
        ),
      ).toEqual(first);
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM app_audit_events WHERE action='admin.permissions_changed' AND command_id=$1",
            [commandId],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM app_notifications WHERE recipient_user_id=$1 AND event_key=$2",
            [otherRoot, "admin-powers:" + commandId],
          )
        ).rows[0].n,
      ).toBe(1);
      await expect(
        AdminPermissionService.update(
          otherRoot,
          actor(),
          { ...input, commandId: randomUUID() },
          context(),
        ),
      ).rejects.toMatchObject({ code: "AUTHORIZATION_CONFLICT" });
    });
    it("revogação é verificada em API e setores restantes continuam disponíveis", async () => {
      const rootCookie = await cookies(rootId, "platform_super_admin"),
        targetCookie = await cookies(otherRoot, "platform_super_admin");
      await change(
        otherRoot,
        sectors.filter((code) => code !== "platform_configuration"),
      );
      const config = await request(app)
        .get("/api/v1/admin/configuration")
        .set("Cookie", targetCookie);
      expect(config.status).toBe(403);
      const verify = await request(app)
        .get("/api/v1/admin/auth/verify-session")
        .set("Cookie", targetCookie);
      expect(verify.status).toBe(200);
      expect(verify.body.deniedSectors).toContain("platform_configuration");
      expect(
        (
          await request(app)
            .get("/api/v1/admin/users/" + otherRoot + "/permissions")
            .set("Cookie", rootCookie)
        ).status,
      ).toBe(200);
      await change(
        otherRoot,
        sectors.filter((code) => code !== "account_governance"),
      );
      expect(
        (
          await request(app)
            .get("/api/v1/admin/users")
            .set("Cookie", targetCookie)
        ).status,
      ).toBe(403);
    });
    it("cliente autenticado não altera campos compartilhados por grants de coluna antigos", async () => {
      for (const [table, column] of [
        ["app_people", "full_name"],
        ["app_people", "phone_e164"],
        ["app_producer_profiles", "property_name"],
        ["app_producer_profiles", "rural_activity_type"],
      ]) {
        const c = await db.connect();
        try {
          await c.query("BEGIN");
          await c.query("SET LOCAL ROLE authenticated");
          await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
            publicId,
          ]);
          await expect(
            c.query(`UPDATE public.${table} SET ${column}=$1`, [
              "Tentativa direta",
            ]),
          ).rejects.toThrow("permission denied");
        } finally {
          await c.query("ROLLBACK");
          c.release();
        }
      }
      expect(
        (await ProfilePrivacyService.getProfile(publicId, "consumer")).fullName,
      ).toBe(names.consumer);
      expect(
        (
          await db.query("SELECT full_name FROM app_people WHERE id=$1", [
            personId,
          ])
        ).rows[0].full_name,
      ).toBe(names.consumer);
    });
    it("RLS bloqueia consulta direta do setor retirado e nunca concede mutações de cliente", async () => {
      await change(
        otherRoot,
        sectors.filter((code) => code !== "account_governance"),
      );
      const c = await db.connect();
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE authenticated");
        await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
          otherRoot,
        ]);
        expect((await c.query("SELECT * FROM app_audit_events")).rowCount).toBe(
          0,
        );
        await expect(
          c.query("SELECT * FROM app_account_profiles"),
        ).rejects.toThrow();
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
      expect(
        (
          await db.query(
            "SELECT has_table_privilege('authenticated','app_account_profiles','UPDATE') allowed",
          )
        ).rows[0].allowed,
      ).toBe(false);
    });
    it("proíbe retirar a própria governança e preserva o último Super que pode restaurar poderes", async () => {
      await expect(change(rootId, [])).rejects.toMatchObject({
        code: "SELF_GOVERNANCE_PROTECTED",
      });
      await change(otherRoot, []);
      await db.query(
        "UPDATE app_admin_permission_overrides SET allowed=false WHERE user_id=$1 AND sector_code='account_governance'",
        [rootId],
      );
      await expect(
        AdminPermissionService.update(
          rootId,
          actor(otherRoot),
          { sectors: [], commandId: randomUUID(), expectedRevision: 1 },
          context(),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("história real: quatro perfis editados no React, poderes retirados/devolvidos e convites responsivos", async () => {
      const { default: express } = await import("express");
      const { resolve } = await import("node:path");
      const { mkdirSync } = await import("node:fs");
      const { chromium, expect: check } = await import("@playwright/test");
      const portable = (await import("@sparticuz/chromium")).default;
      const outer = express();
      outer.use(["/api", "/_hvm_api"], app);
      outer.use(express.static(resolve("dist")));
      outer.get("*", (_req, res) => res.sendFile(resolve("dist/index.html")));
      const server = await new Promise<import("node:http").Server>((done) => {
        const value = outer.listen(0, "127.0.0.1", () => done(value));
      });
      const base =
        "http://127.0.0.1:" +
        (server.address() as import("node:net").AddressInfo).port;
      const browser = await chromium.launch({
        executablePath: await portable.executablePath(),
        headless: true,
        args: ["--disable-gpu", "--no-zygote"],
      });
      const errors: string[] = [];
      const directory =
        process.env.HVM_PROFILES_STORY_OUTPUT ??
        "/workspace/scratch/profiles-story";
      mkdirSync(directory, { recursive: true });
      try {
        const pages = new Map<string, import("@playwright/test").Page>();
        for (const [role, id] of [
          ["consumer", publicId],
          ["producer", publicId],
          ["platform_admin", adminId],
          ["platform_super_admin", rootId],
        ]) {
          const context = await browser.newContext({
            viewport: { width: 390, height: 920 },
          });
          await context.addCookies(
            (await cookies(id, role)).split("; ").map((cookie) => {
              const [name, ...value] = cookie.split("=");
              return {
                name,
                value: value.join("="),
                url: base,
                httpOnly: true,
                sameSite: "Lax" as const,
              };
            }),
          );
          const page = await context.newPage();
          page.on("pageerror", (e) => errors.push(e.message));
          pages.set(role, page);
          await page.goto(
            base +
              (role.startsWith("platform")
                ? "/admin/conta/perfil"
                : "/conta/perfil"),
          );
          await check(
            page.getByLabel("Nome completo", { exact: true }),
          ).toHaveValue(names[role as keyof typeof names]);
          await page
            .getByLabel("Nome completo", { exact: true })
            .fill("Perfil individual " + role);
          await page
            .getByRole("button", { name: "Salvar alterações", exact: true })
            .click();
          await check(
            page.getByText("Perfil atualizado neste cadastro.", {
              exact: true,
            }),
          ).toBeVisible();
          expect(
            (await ProfilePrivacyService.getProfile(id, role)).fullName,
          ).toBe("Perfil individual " + role);
          await check(page.getByText("Conectado", { exact: true })).toHaveCount(
            0,
          );
        }
        // Reload each portal after all edits; no cross-role overwrite survives.
        for (const [role, page] of pages) {
          await page.reload();
          await check(
            page.getByLabel("Nome completo", { exact: true }),
          ).toHaveValue("Perfil individual " + role);
        }
        const rootPage = pages.get("platform_super_admin")!;
        await rootPage.goto(base + "/admin/usuarios");
        const row = rootPage
          .locator(".admin-users-table tbody tr")
          .filter({ hasText: "Outro Super original" });
        await row
          .getByRole("button", { name: "Gerenciar poderes", exact: true })
          .click();
        await check(
          rootPage.getByRole("heading", {
            name: "Poderes de Outro Super original",
          }),
        ).toBeVisible();
        await rootPage
          .getByLabel("Gestão de reembolsos", { exact: true })
          .uncheck();
        for (const width of [320, 390, 768, 1440]) {
          await rootPage.setViewportSize({ width, height: 920 });
          expect(
            await rootPage.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await rootPage.screenshot({
            path: directory + "/powers-" + width + ".png",
            fullPage: true,
          });
        }
        await rootPage
          .getByRole("button", { name: "Salvar poderes", exact: true })
          .click();
        await check(
          rootPage.getByText("Poderes atualizados.", { exact: true }),
        ).toBeVisible();
        await expect(
          commerceTransaction((c) =>
            commerceAdmin(c, actor(otherRoot), "refund_management"),
          ),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await row
          .getByRole("button", { name: "Gerenciar poderes", exact: true })
          .click();
        await rootPage
          .getByLabel("Gestão de reembolsos", { exact: true })
          .check();
        await rootPage
          .getByRole("button", { name: "Salvar poderes", exact: true })
          .click();
        await check(
          rootPage.getByText("Poderes atualizados.", { exact: true }),
        ).toBeVisible();
        await commerceTransaction((c) =>
          commerceAdmin(c, actor(otherRoot), "refund_management"),
        );
        const invite = randomUUID();
        await db.query(
          "INSERT INTO app_admin_invites(id,email,target_role,token_digest,invited_by,expires_at,identity_mode) VALUES($1,$2,'platform_admin',$3,$4,now()+interval '24 hours','new')",
          [
            invite,
            "email.administrativo.extenso.para.testar@example.test",
            "f".repeat(64),
            rootId,
          ],
        );
        for (const sector of sectors)
          await db.query(
            "INSERT INTO app_admin_invite_sectors(invite_id,sector_code) VALUES($1,$2)",
            [invite, sector],
          );
        await rootPage.goto(base + "/admin/governanca");
        await check(
          rootPage.getByRole("heading", { name: "Histórico de convites" }),
        ).toBeVisible();
        const history = rootPage.locator(".admin-invites-table");
        await check(
          history.getByText("Gestão de reembolsos", { exact: true }),
        ).toBeVisible();
        for (const width of [320, 390, 768, 1440]) {
          await rootPage.setViewportSize({ width, height: 920 });
          expect(
            await rootPage.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await check(history).not.toContainText("refund_management");
          await check(
            history.getByText("Pendente", { exact: true }),
          ).toBeVisible();
          await rootPage.screenshot({
            path: directory + "/invites-" + width + ".png",
            fullPage: true,
          });
        }
        const producer = pages.get("producer")!;
        await check(producer.locator(".hvm-offline-banner")).toHaveCount(0);
        await producer.context().setOffline(true);
        await check(
          producer.getByRole("complementary", {
            name: "Conexão e ações do produtor",
          }),
        ).toBeVisible();
        await producer.context().setOffline(false);
        await check(
          producer.getByRole("complementary", {
            name: "Conexão e ações do produtor",
          }),
        ).toHaveCount(0);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
        await new Promise<void>((done) => server.close(() => done()));
      }
    }, 90000);
    it("exclui outro Super sem encerrar cadastros da mesma pessoa; autoexclusão é protegida", async () => {
      const cookie = await cookies(otherRoot, "platform_super_admin");
      const self = await request(app)
        .post("/api/v1/admin/users/" + otherRoot + "/delete")
        .set("Cookie", cookie)
        .set("Sec-Fetch-Site", "same-origin")
        .send({ commandId: randomUUID() });
      expect(self.status).toBe(409);
      const deleted = await request(app)
        .post("/api/v1/admin/users/" + rootId + "/delete")
        .set("Cookie", cookie)
        .set("Sec-Fetch-Site", "same-origin")
        .send({ commandId: randomUUID() });
      expect(deleted.status).toBe(200);
      expect(
        (await db.query("SELECT 1 FROM auth.users WHERE id=$1", [rootId]))
          .rowCount,
      ).toBe(0);
      expect(
        (await ProfilePrivacyService.getProfile(publicId, "consumer")).fullName,
      ).toBe(names.consumer);
      expect(
        (await ProfilePrivacyService.getProfile(publicId, "producer")).fullName,
      ).toBe(names.producer);
      expect(
        (await ProfilePrivacyService.getProfile(adminId, "platform_admin"))
          .fullName,
      ).toBe(names.platform_admin);
    });
  },
);

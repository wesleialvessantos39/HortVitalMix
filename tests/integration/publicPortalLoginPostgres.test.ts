import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// GoTrue is only a local transport double. Passwords, profiles, authorization,
// sessions and portal binding are exercised against the real disposable DB.
const transport = vi.hoisted(() => ({
  pool: null as pg.Pool | null,
  issued: 0,
}));
vi.mock("../../server/db/pool.ts", () => ({
  dbPool: {
    query: (...args: any[]) => (transport.pool!.query as any)(...args),
    connect: () => transport.pool!.connect(),
  },
}));
vi.mock("../../server/supabase/client.ts", () => {
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      try {
        const values = Object.values(args);
        const result = await transport.pool!.query(
          `SELECT public.${name}(${values.map((_, i) => "$" + (i + 1)).join(",")}) AS result`,
          values,
        );
        return { data: result.rows[0].result, error: null };
      } catch {
        return { data: null, error: { code: "LOCAL_SQL_FAILURE" } };
      }
    },
    auth: {
      admin: {
        generateLink: async ({ email }: { email: string }) => {
          const result = await transport.pool!.query(
            "SELECT id FROM auth.users WHERE email=$1",
            [email],
          );
          return {
            data: {
              user: { id: result.rows[0]?.id },
              properties: { hashed_token: result.rows[0]?.id },
            },
            error: null,
          };
        },
        signOut: async () => ({ error: null }),
      },
    },
  };
  return {
    supabaseAdmin: admin,
    supabasePublic: {},
    createSupabasePublicClient: () => ({
      auth: {
        verifyOtp: async ({ token_hash }: { token_hash: string }) => {
          transport.issued++;
          const sid = randomUUID();
          await transport.pool!.query(
            "INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",
            [sid, token_hash],
          );
          const user = (
            await transport.pool!.query(
              "SELECT id,email,email_confirmed_at FROM auth.users WHERE id=$1",
              [token_hash],
            )
          ).rows[0];
          user.email_confirmed_at = user.email_confirmed_at?.toISOString();
          return {
            error: null,
            data: {
              user,
              session: {
                user,
                access_token:
                  "local." +
                  Buffer.from(
                    JSON.stringify({ sub: user.id, session_id: sid }),
                  ).toString("base64url") +
                  ".fixture",
                refresh_token: randomUUID(),
                expires_in: 3600,
              },
            },
          };
        },
        signOut: async () => ({ error: null }),
      },
    }),
  };
});
import { authRouter } from "../../server/routes/authRoutes.ts";
import { resolveIdentityAccess } from "../../server/services/IdentityAccessService.ts";

const url = process.env.HVM_PUBLIC_PORTALS_LOCAL_DATABASE_URL;
if (
  url &&
  (new URL(url).hostname !== "127.0.0.1" ||
    new URL(url).port !== "55432" ||
    new URL(url).pathname !== "/postgres")
)
  throw Error("LOCAL_DISPOSABLE_DATABASE_REQUIRED");
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.clientIpHash = "a".repeat(64);
  res.locals.requestId = randomUUID();
  next();
});
app.use("/auth", authRouter);
app.use((error: Error, _req: unknown, res: express.Response, _next: unknown) =>
  res.status(500).json({ error: error.message }),
);
let uid: string, email: string;
const password = {
  consumer: "ConsumerHTTP!Pass2026",
  producer: "ProducerHTTP!Pass2026",
};
describe.runIf(Boolean(url))(
  "Portal login: real HTTP, PostgreSQL and scoped sessions",
  () => {
    beforeAll(async () => {
      transport.pool = new pg.Pool({ connectionString: url });
      uid = randomUUID();
      email = uid + "@example.invalid";
      const digits = [...randomBytes(9)].map((v) => v % 10);
      for (let length = 9; length < 11; length++) {
        const value =
          (digits.reduce((s, d, i) => s + d * (length + 1 - i), 0) * 10) % 11;
        digits.push(value === 10 ? 0 : value);
      }
      await transport.pool.query(
        "INSERT INTO auth.users(id,email,encrypted_password,email_confirmed_at) VALUES($1,$2,extensions.crypt($3,extensions.gen_salt('bf',10)),now())",
        [uid, email, password.consumer],
      );
      await transport.pool.query(
        "INSERT INTO app_people(user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,$3,$4,'+5569988888888')",
        [uid, "HTTP fixture " + uid, digits.join(""), email],
      );
      await transport.pool.query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'consumer'),($1,'producer')",
        [uid],
      );
      await transport.pool.query(
        "UPDATE app_public_portal_credentials SET password_hash=extensions.crypt($2,extensions.gen_salt('bf',10)),email_verified_at=now() WHERE user_id=$1 AND role_code='producer'",
        [uid, password.producer],
      );
    });
    afterAll(async () => {
      if (!transport.pool) return;
      await transport.pool.query("DELETE FROM auth.users WHERE id=$1", [uid]);
      await transport.pool.query("DELETE FROM app_users WHERE id=$1", [uid]);
      await transport.pool.end();
    });
    it.each(["consumer", "producer"] as const)(
      "%s accepts only its password and the returned token cannot authorize the other portal",
      async (role) => {
        const other = role === "consumer" ? "producer" : "consumer";
        const count = transport.issued;
        expect(
          (
            await request(app)
              .post("/auth/login")
              .send({ email, password: password[other], portalRole: role })
          ).status,
        ).toBe(401);
        expect(transport.issued).toBe(count);
        const result = await request(app)
          .post("/auth/login")
          .send({ email, password: password[role], portalRole: role });
        expect(result.status, JSON.stringify(result.body)).toBe(200);
        expect(result.body).toMatchObject({
          userId: uid,
          email,
          roles: [role],
          activeRole: role,
        });
        const access = (result.headers["set-cookie"] as unknown as string[])
          .find((s) => s.startsWith("hvm_access="))!
          .split(";")[0]
          .slice(11);
        const sid = JSON.parse(
          Buffer.from(access.split(".")[1], "base64url").toString(),
        ).session_id;
        expect(await resolveIdentityAccess(uid, sid, access)).toMatchObject({
          roles: [role],
          liveSession: true,
        });
        expect(
          (
            await transport.pool!.query(
              "SELECT fn_bind_public_portal_session($1,$2,$3) AS allowed",
              [uid, sid, other],
            )
          ).rows[0].allowed,
        ).toBe(false);
      },
    );
    it("administrative login is never accepted by the public endpoint", async () => {
      expect(
        (
          await request(app).post("/auth/login").send({
            email,
            password: password.consumer,
            portalRole: "platform_super_admin",
          })
        ).status,
      ).toBe(403);
    });
  },
);

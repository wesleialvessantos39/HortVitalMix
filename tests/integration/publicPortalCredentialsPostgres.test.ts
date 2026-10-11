import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.HVM_PUBLIC_PORTALS_LOCAL_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    parsed.hostname !== "127.0.0.1" ||
    parsed.port !== "55432" ||
    parsed.pathname !== "/postgres"
  )
    throw new Error("PUBLIC_PORTALS_DISPOSABLE_LOCAL_DATABASE_REQUIRED");
}
const pool = url ? new pg.Pool({ connectionString: url, max: 4 }) : null;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const legacy = "OriginalPassword#2026";
let uid: string,
  email: string,
  person: string,
  cpf: string,
  originalName: string;
function uniqueCpf() {
  const digits = [...randomBytes(9)].map((v) => v % 10);
  for (let length = 9; length < 11; length++) {
    const remainder =
      (digits.reduce(
        (sum, digit, index) => sum + digit * (length + 1 - index),
        0,
      ) *
        10) %
      11;
    digits.push(remainder === 10 ? 0 : remainder);
  }
  return digits.join("");
}
async function call(name: string, values: unknown[]) {
  const result = await pool!.query(
    `SELECT public.${name}(${values.map((_, i) => "$" + (i + 1)).join(",")}) AS result`,
    values,
  );
  return result.rows[0].result;
}
async function session(role: string) {
  const id = randomUUID();
  await pool!.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)", [
    id,
    uid,
  ]);
  expect(await call("fn_bind_public_portal_session", [uid, id, role])).toBe(
    true,
  );
  return id;
}
async function challenge(role: string, token: string) {
  const id = randomUUID();
  await pool!.query(
    "INSERT INTO app_role_security_challenges(id,user_id,role_code,purpose,token_digest,expires_at,request_id) VALUES($1,$2,$3,'password_recovery',$4,now()+interval '15 minutes',$5)",
    [id, uid, role, digest(token), randomUUID()],
  );
  return id;
}

describe.runIf(Boolean(url))(
  "Independent public passwords and portal sessions on real PostgreSQL",
  () => {
    beforeAll(async () => {
      uid = randomUUID();
      email = uid + "@example.invalid";
      person = randomUUID();
      cpf = uniqueCpf();
      originalName = "Portal fixture " + uid;
      await pool!.query(
        "INSERT INTO auth.users(id,email,email_confirmed_at,encrypted_password) VALUES($1,$2,now(),extensions.crypt($3,extensions.gen_salt('bf',10)))",
        [uid, email, legacy],
      );
      await pool!.query(
        "INSERT INTO app_people(id,user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,$3,$4,$5,'+5569988888888')",
        [person, uid, originalName, cpf, email],
      );
      await pool!.query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'consumer')",
        [uid],
      );
    });
    afterAll(async () => {
      if (!pool) return;
      await pool.query("DELETE FROM auth.users WHERE id=$1", [uid]);
      await pool.query("DELETE FROM app_users WHERE id=$1", [uid]);
      await pool.end();
    });

    it("preserves the existing one-way password and authenticates only an assigned portal", async () => {
      expect(
        await call("fn_public_portal_login", [email, "consumer", legacy]),
      ).toMatchObject({ userId: uid, confirmed: true });
      expect(
        await call("fn_public_portal_login", [email, "producer", legacy]),
      ).toBeNull();
      expect(
        await call("fn_public_portal_login", [email, "consumer", "incorrect"]),
      ).toBeNull();
    });
    it("creates a second password without accepting it before mailbox proof", async () => {
      expect(
        await call("fn_register_independent_public_role", [
          uid,
          cpf,
          email,
          "producer",
          "Independent producer",
          "+5569988888888",
          "ProducerPassword#2026",
        ]),
      ).toBe(true);
      expect(
        await call("fn_public_portal_login", [
          email,
          "producer",
          "ProducerPassword#2026",
        ]),
      ).toMatchObject({ userId: uid, confirmed: false });
      expect(
        await call("fn_public_portal_login", [
          email,
          "consumer",
          "ProducerPassword#2026",
        ]),
      ).toBeNull();
      const token = randomUUID();
      expect(
        await call("fn_issue_public_portal_email_flow", [
          uid,
          "producer",
          "confirmation",
          digest(token),
        ]),
      ).toBe(true);
      expect(
        await call("fn_consume_public_portal_email_flow", [
          uid,
          "consumer",
          "confirmation",
          digest(token),
        ]),
      ).toBe(false);
      expect(
        await call("fn_consume_public_portal_email_flow", [
          uid,
          "producer",
          "confirmation",
          digest(token),
        ]),
      ).toBe(true);
      expect(
        await call("fn_consume_public_portal_email_flow", [
          uid,
          "producer",
          "confirmation",
          digest(token),
        ]),
      ).toBe(false);
      expect(
        await call("fn_public_portal_login", [
          email,
          "producer",
          "ProducerPassword#2026",
        ]),
      ).toMatchObject({ confirmed: true });
    });
    it("binds each token to one portal and refuses reassignment", async () => {
      const sid = await session("consumer");
      expect(
        await call("fn_bind_public_portal_session", [uid, sid, "producer"]),
      ).toBe(false);
      expect(await call("fn_public_portal_session_role", [uid, sid])).toBe(
        "consumer",
      );
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE authenticated");
        await client.query(
          "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
          [uid, JSON.stringify({ sub: uid, session_id: sid })],
        );
        expect(
          (
            await client.query(
              "SELECT has_role('consumer') AS consumer,has_role('producer') AS producer",
            )
          ).rows[0],
        ).toEqual({ consumer: true, producer: false });
        await expect(
          client.query(
            "SELECT password_hash FROM app_public_portal_credentials",
          ),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      const unbound = randomUUID();
      await pool!.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)", [
        unbound,
        uid,
      ]);
      expect(
        await call("fn_public_portal_session_role", [uid, unbound]),
      ).toBeNull();
    });
    it("resets only the requested password and sessions, with single-use recovery", async () => {
      const consumerSession = await session("consumer"),
        producerSession = await session("producer"),
        token = randomUUID();
      await challenge("consumer", token);
      expect(
        await call("fn_reset_public_portal_password", [
          uid,
          "producer",
          "WrongContext#2026",
          digest(token),
        ]),
      ).toBe(false);
      expect(
        await call("fn_reset_public_portal_password", [
          uid,
          "consumer",
          "ConsumerPassword#2026",
          digest(token),
        ]),
      ).toBe(true);
      expect(
        await call("fn_reset_public_portal_password", [
          uid,
          "consumer",
          "ReplayPassword#2026",
          digest(token),
        ]),
      ).toBe(false);
      expect(
        await call("fn_public_portal_login", [email, "consumer", legacy]),
      ).toBeNull();
      expect(
        await call("fn_public_portal_login", [
          email,
          "consumer",
          "ConsumerPassword#2026",
        ]),
      ).toMatchObject({ confirmed: true });
      expect(
        await call("fn_public_portal_login", [
          email,
          "producer",
          "ProducerPassword#2026",
        ]),
      ).toMatchObject({ confirmed: true });
      expect(
        await call("fn_public_portal_session_role", [uid, consumerSession]),
      ).toBeNull();
      expect(
        await call("fn_public_portal_session_role", [uid, producerSession]),
      ).toBe("producer");
      expect(
        (
          await pool!.query(
            "SELECT encrypted_password=extensions.crypt($2,encrypted_password) AS preserved FROM auth.users WHERE id=$1",
            [uid, legacy],
          )
        ).rows[0].preserved,
      ).toBe(true);
      expect(
        (
          await pool!.query("SELECT full_name FROM app_people WHERE id=$1", [
            person,
          ])
        ).rows[0].full_name,
      ).toBe(originalName);
    });
    it("creates a public login after an administrative account without changing its roles or password", async () => {
      const adminId = randomUUID(),
        publicId = randomUUID(),
        personId = randomUUID(),
        mail = adminId + "@outlook.com",
        newCpf = uniqueCpf();
      await pool!.query(
        "INSERT INTO auth.users(id,email,encrypted_password,email_confirmed_at) VALUES($1,$2,extensions.crypt($3,extensions.gen_salt('bf',10)),now()),($4,$5,extensions.crypt($6,extensions.gen_salt('bf',10)),NULL)",
        [
          adminId,
          mail,
          "AdminOwnPassword#2026",
          publicId,
          publicId + "@auth.hortvitalmix.invalid",
          "PublicOwnPassword#2026",
        ],
      );
      try {
        await pool!.query(
          "INSERT INTO app_people(id,user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,$3,$4,$5,'+5569988888888')",
          [
            personId,
            adminId,
            "Administrative fixture " + adminId,
            newCpf,
            mail,
          ],
        );
        await pool!.query(
          "INSERT INTO app_admin_principals(admin_user_id,person_id,admin_email,portal_role,auth_email,email_verified_at) VALUES($1,$2,$3,'platform_admin',$3,now())",
          [adminId, personId, mail],
        );
        await pool!.query(
          "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'platform_admin')",
          [adminId],
        );
        expect(
          await call("fn_attach_public_identity", [
            personId,
            publicId,
            newCpf,
            mail,
            "consumer",
            "Public fixture " + publicId,
            "+5569988888888",
            "PublicOwnPassword#2026",
          ]),
        ).toBe(true);
        expect(
          await call("fn_public_portal_login", [
            mail,
            "consumer",
            "AdminOwnPassword#2026",
          ]),
        ).toBeNull();
        expect(
          await call("fn_public_portal_login", [
            mail,
            "consumer",
            "PublicOwnPassword#2026",
          ]),
        ).toMatchObject({ userId: publicId, confirmed: false });
        expect(
          (
            await pool!.query(
              "SELECT role_code FROM app_user_role_assignments WHERE user_id=$1 AND revoked_at IS NULL",
              [adminId],
            )
          ).rows,
        ).toEqual([{ role_code: "platform_admin" }]);
        expect(
          (
            await pool!.query(
              "SELECT encrypted_password=extensions.crypt($2,encrypted_password) AS preserved FROM auth.users WHERE id=$1",
              [adminId, "AdminOwnPassword#2026"],
            )
          ).rows[0].preserved,
        ).toBe(true);
        expect(
          (
            await pool!.query(
              "SELECT person_id FROM app_admin_principals WHERE admin_user_id=$1",
              [adminId],
            )
          ).rows[0].person_id,
        ).toBe(personId);
      } finally {
        await pool!.query(
          "DELETE FROM app_admin_principals WHERE admin_user_id=$1",
          [adminId],
        );
        await pool!.query("DELETE FROM auth.users WHERE id=ANY($1::uuid[])", [
          [adminId, publicId],
        ]);
        await pool!.query("DELETE FROM app_users WHERE id=ANY($1::uuid[])", [
          [adminId, publicId],
        ]);
      }
    });
    it("serializes concurrent recovery without replacing the winner's password", async () => {
      const token = randomUUID();
      await challenge("consumer", token);
      const results = await Promise.all([
        call("fn_reset_public_portal_password", [
          uid,
          "consumer",
          "ConcurrentWinnerA#2026",
          digest(token),
        ]),
        call("fn_reset_public_portal_password", [
          uid,
          "consumer",
          "ConcurrentWinnerB#2026",
          digest(token),
        ]),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const winning = results[0]
        ? "ConcurrentWinnerA#2026"
        : "ConcurrentWinnerB#2026";
      expect(
        await call("fn_public_portal_login", [email, "consumer", winning]),
      ).toMatchObject({ userId: uid });
    });
  },
);

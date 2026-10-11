import { randomUUID } from "node:crypto";
import express from "express";
import pg from "pg";
import request from "supertest";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { scopedDatabasePool } from "../../server/db/offlineTransaction.ts";
const state = vi.hoisted(() => ({
  raw: null as pg.Pool | null,
  scoped: null as pg.Pool | null,
}));
vi.mock("../../server/db/pool.ts", () => ({
  rawDbPool: { connect: () => state.raw!.connect() },
  dbPool: {
    connect: () => state.scoped!.connect(),
    query: (...args: any[]) => (state.scoped!.query as any)(...args),
  },
}));
vi.mock("../../server/middleware/adminSession.ts", () => ({
  adminSessionMiddleware: async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (req.get("X-Test-Permission") === "denied") {
      res.status(403).json({ error: "FORBIDDEN" });
      return;
    }
    req.adminActor = {
      userId: req.get("X-Test-Actor")!,
      role: req.get("X-Test-Role") as any,
      sectors: ["catalog_moderation"],
      isSuperAdmin: req.get("X-Test-Role") === "platform_super_admin",
      sessionIssuedAt: new Date().toISOString(),
    };
    next();
  },
}));
import { offlineRequestMiddleware } from "../../server/middleware/offlineRequests.ts";
import { dbPool } from "../../server/db/pool.ts";
import { ProfilePrivacyService } from "../../server/services/ProfilePrivacyService.ts";
import { ruralPropertyRouter } from "../../server/routes/ruralPropertyRoutes.ts";
import {
  issueRecentAuthProof,
  RECENT_AUTH_WINDOW_MS,
} from "../../server/security/recentAuth.ts";
const url = process.env.HVM_OFFLINE_LOCAL_DATABASE_URL;
if (
  url &&
  (new URL(url).hostname !== "127.0.0.1" ||
    new URL(url).port !== "55432" ||
    new URL(url).pathname !== "/postgres")
)
  throw Error("LOCAL_DISPOSABLE_DATABASE_REQUIRED");
const uid = randomUUID(),
  role = "consumer";
const admins: Record<string, string> = {
  platform_admin: randomUUID(),
  platform_super_admin: randomUUID(),
};
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.requestId = randomUUID();
  req.clientIpHash = "a".repeat(64);
  req.actor = {
    userId: req.get("X-Test-Actor") ?? uid,
    roles: [req.get("X-Test-Role") ?? role],
    email: "offline@example.invalid",
    personId: null,
    fullName: "Offline fixture",
  };
  next();
});
app.use(offlineRequestMiddleware);
app.use("/v1", ruralPropertyRouter);
app.patch("/v1/account/profile", async (req, res) => {
  try {
    const result = await ProfilePrivacyService.updateProfile(
      req.actor!.userId,
      req.actor!.roles[0],
      req.body,
      req.requestId,
      req.clientIpHash,
    );
    res.status(result.status === "conflict" ? 409 : 200).json(result);
  } catch (error) {
    res
      .status((error as { status?: number }).status ?? 503)
      .json({ error: (error as { code?: string }).code ?? "FAILED" });
  }
});
for (const path of ["/v1/producer/offline-probe", "/v1/admin/categories"])
  app.post(path, async (req, res) => {
    const c = await dbPool!.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "UPDATE public.hvm_offline_probe SET value=value+1 WHERE id=$1",
        [uid],
      );
      if (req.body.rollback) {
        await c.query("ROLLBACK");
        res.status(409).json({ error: "REVISION_CONFLICT" });
        return;
      }
      await c.query("COMMIT");
      if (req.body.outerRollback) {
        res.status(422).json({ error: "VALIDATION_ERROR" });
        return;
      }
      res.json({
        value: (
          await dbPool!.query(
            "SELECT value FROM public.hvm_offline_probe WHERE id=$1",
            [uid],
          )
        ).rows[0].value,
      });
    } finally {
      c.release();
    }
  });
function send(
  path: string,
  id: string,
  r = "consumer",
  actor = admins[r] ?? uid,
) {
  return request(app)
    .post(path)
    .set({
      "X-Test-Actor": actor,
      "X-Test-Role": r,
      "X-HVM-Offline-Scope": `${actor}:${r}`,
      "X-HVM-Offline-Id": id,
      "X-HVM-Request": "1",
    });
}
const token =
  "local." +
  Buffer.from(JSON.stringify({ session_id: randomUUID() })).toString(
    "base64url",
  ) +
  ".fixture";
function complete(
  propertyId: string,
  revision: number,
  requestId = randomUUID(),
  expired = false,
) {
  const proof = issueRecentAuthProof(
    uid,
    token,
    Date.now() - (expired ? RECENT_AUTH_WINDOW_MS + 60000 : 0),
  );
  return send("/v1/producer/properties/wizard/complete", requestId, "producer")
    .set("Sec-Fetch-Site", "same-origin")
    .set(
      "Cookie",
      `hvm_access=${token}; hvm_reauth=${proof}; hvm_portal_role=producer`,
    );
}
function workflow(propertyId: string, expectedRevision: number) {
  const data = [
    {
      propertyName: "Imovel offline " + propertyId.slice(0, 8),
      registrationNumber: null,
      ruralZoneSector: "Gleba Jamari",
      lineVicinal: "Linha C-65",
      municipality: "Ariquemes",
      state: "RO",
      latitudeSede: -9.9132,
      longitudeSede: -63.0408,
      accessDirections: null,
    },
    { totalAreaHectares: 10, cultivatedAreaHectares: 4, boundaries: [] },
    { waterSource: "poco_artesiano", irrigationSystem: "gotejamento" },
    {
      activityCategory: "misto",
      productionSystem: "agroecologico_declarado",
      hasWashingFacility: true,
    },
    { agroecologicalCommitment: true },
  ];
  return {
    propertyId,
    expectedRevision,
    steps: data.map((stepData, i) => ({
      propertyId,
      expectedRevision,
      step: i + 2,
      stepData,
      commandId: randomUUID(),
      ...(i === 4 ? { completeOnly: true } : {}),
    })),
  };
}
async function seedProperty(document = false) {
  const producer = (
    await state.raw!.query(
      "SELECT pp.id FROM app_producer_profiles pp JOIN app_people pe ON pe.id=pp.person_id WHERE pe.user_id=$1",
      [uid],
    )
  ).rows[0].id;
  const id = randomUUID();
  const row = (
    await state.raw!.query(
      "INSERT INTO app_properties(id,producer_id,property_name,rural_zone_sector,line_vicinal,municipality,state) VALUES($1,$2,'Rascunho offline','Gleba Jamari','Linha C-65','Ariquemes','RO') RETURNING revision",
      [id, producer],
    )
  ).rows[0];
  if (document) {
    const doc = randomUUID();
    await state.raw!.query(
      "INSERT INTO app_documents(id,property_id,producer_id,document_type,file_name,file_size_bytes,mime_type,storage_path,file_hash_sha256,status,uploaded_by) VALUES($1,$2,$3,'car_sicar','local-only.pdf',2048,'application/pdf',$4,$5,'clean',$6)",
      [
        doc,
        id,
        producer,
        `properties/${id}/local-only.pdf`,
        "b".repeat(64),
        uid,
      ],
    );
    await state.raw!.query(
      "INSERT INTO app_document_extractions(document_id,property_id,producer_id,extraction_engine,payload_jsonb,confidence_score,raw_text,status,file_hash_sha256) VALUES($1,$2,$3,'local-fixture',$4,0.9,'Somente dado local de teste','completed',$5)",
      [
        doc,
        id,
        producer,
        JSON.stringify({
          propertyRegisteredName: "Imovel offline",
          municipality: "Ariquemes",
          totalAreaHectares: 10,
        }),
        "b".repeat(64),
      ],
    );
  }
  return { id, revision: row.revision };
}
describe.runIf(Boolean(url))(
  "Offline: real SQL, HTTP receipts and transaction recovery (Auth fixtures)",
  () => {
    beforeAll(async () => {
      state.raw = new pg.Pool({ connectionString: url });
      state.scoped = scopedDatabasePool(state.raw);
      await state.raw.query(
        "CREATE TABLE IF NOT EXISTS public.hvm_offline_probe(id uuid PRIMARY KEY,value integer NOT NULL DEFAULT 0); GRANT SELECT,INSERT,UPDATE,DELETE ON public.hvm_offline_probe TO service_role",
      );
      await state.raw.query(
        "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
        [uid, `${uid}@example.invalid`],
      );
      await state.raw.query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'consumer'),($1,'producer')",
        [uid],
      );
      const digits = [...randomUUID().replace(/-/g, "").slice(0, 9)].map(
        (v) => parseInt(v, 16) % 10,
      );
      for (let length = 9; length < 11; length++) {
        const v =
          (digits.reduce((sum, d, i) => sum + d * (length + 1 - i), 0) * 10) %
          11;
        digits.push(v === 10 ? 0 : v);
      }
      await state.raw.query(
        "INSERT INTO app_people(user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,'Offline SQL profile',$2,$3,'+5569988888888')",
        [uid, digits.join(""), `${uid}@example.invalid`],
      );
      await state.raw.query(
        "INSERT INTO app_account_profiles(user_id,role_code,person_id,full_name,cpf_normalized,email_normalized,phone_e164) SELECT $1,r.role_code,p.id,p.full_name,p.cpf_normalized,p.email_normalized,p.phone_e164 FROM app_people p CROSS JOIN (VALUES('consumer'),('producer')) r(role_code) WHERE p.user_id=$1 ON CONFLICT(user_id,role_code) DO NOTHING",
        [uid],
      );
      await state.raw.query(
        "INSERT INTO app_producer_profiles(person_id) SELECT id FROM app_people WHERE user_id=$1",
        [uid],
      );
      for (const [r, id] of Object.entries(admins)) {
        await state.raw.query(
          "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
          [id, `${id}@example.invalid`],
        );
        await state.raw.query(
          "INSERT INTO app_admin_principals(admin_user_id,person_id,admin_email,portal_role,auth_email,email_verified_at) SELECT $1,id,$2,$3,$4,now() FROM app_people WHERE user_id=$5",
          [id, `${uid}@example.invalid`, r, `${id}@example.invalid`, uid],
        );
        await state.raw.query(
          "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,$2)",
          [id, r],
        );
      }
      await state.raw.query(
        "INSERT INTO public.hvm_offline_probe(id) VALUES($1)",
        [uid],
      );
    });
    afterAll(async () => {
      if (!state.raw) return;
      await state.raw.query(
        "DELETE FROM public.hvm_offline_probe WHERE id=$1",
        [uid],
      );
      for (const id of Object.values(admins)) {
        await state.raw.query("DELETE FROM auth.users WHERE id=$1", [id]);
        await state.raw.query("DELETE FROM app_users WHERE id=$1", [id]);
      }
      await state.raw.query("SELECT erase_public_account($1,'producer',$2)", [
        uid,
        randomUUID(),
      ]);
      await state.raw.query("DELETE FROM auth.users WHERE id=$1", [uid]);
      await state.raw.query("DELETE FROM app_users WHERE id=$1", [uid]);
      await state.raw.end();
    });
    it("commits once, and returns the exact result after a lost response", async () => {
      const id = randomUUID();
      const path = "/v1/producer/offline-probe";
      const first = await send(path, id, "producer").send({});
      expect(first.status).toBe(200);
      const next = await send(path, id, "producer").send({});
      expect(next.body).toEqual(first.body);
      expect(
        (
          await state.raw!.query(
            "SELECT value FROM public.hvm_offline_probe WHERE id=$1",
            [uid],
          )
        ).rows[0].value,
      ).toBe(first.body.value);
    });
    it("real consumer profile mutation and exact receipt commit together", async () => {
      const id = randomUUID();
      const body = {
        fullName: "Consumidor alterado offline",
        profileRole: "consumer",
        expectedRevision: 1,
        commandId: randomUUID(),
      };
      const sendProfile = () =>
        request(app)
          .patch("/v1/account/profile")
          .set({
            "X-Test-Actor": uid,
            "X-Test-Role": "consumer",
            "X-HVM-Offline-Scope": `${uid}:consumer`,
            "X-HVM-Offline-Id": id,
            "X-HVM-Request": "1",
          })
          .send(body);
      const first = await sendProfile();
      expect(first.status).toBe(200);
      expect((await sendProfile()).body).toEqual(first.body);
      const profiles = (
        await state.raw!.query(
          "SELECT role_code,full_name,revision FROM app_account_profiles WHERE user_id=$1 ORDER BY role_code",
          [uid],
        )
      ).rows;
      expect(profiles[0]).toEqual({
        role_code: "consumer",
        full_name: body.fullName,
        revision: 2,
      });
      expect(profiles[1].revision).toBe(1);
    });
    it("a real profile conflict preserves the newer server value", async () => {
      const body = {
        fullName: "Este valor nao pode substituir",
        profileRole: "consumer",
        expectedRevision: 1,
        commandId: randomUUID(),
      };
      const result = await request(app)
        .patch("/v1/account/profile")
        .set({
          "X-Test-Actor": uid,
          "X-Test-Role": "consumer",
          "X-HVM-Offline-Scope": `${uid}:consumer`,
          "X-HVM-Offline-Id": randomUUID(),
          "X-HVM-Request": "1",
        })
        .send(body);
      expect(result.status).toBe(409);
      expect(
        (
          await state.raw!.query(
            "SELECT full_name FROM app_account_profiles WHERE user_id=$1 AND role_code='consumer'",
            [uid],
          )
        ).rows[0].full_name,
      ).toBe("Consumidor alterado offline");
    });
    it("concurrent tabs cannot apply the same action twice", async () => {
      const id = randomUUID();
      const results = await Promise.all([
        send("/v1/producer/offline-probe", id, "producer").send({}),
        send("/v1/producer/offline-probe", id, "producer").send({}),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(results[0].body).toEqual(results[1].body);
    });
    it("a nested COMMIT cannot escape the receipt transaction", async () => {
      const before = (
        await state.raw!.query(
          "SELECT value FROM public.hvm_offline_probe WHERE id=$1",
          [uid],
        )
      ).rows[0].value;
      const id = randomUUID();
      expect(
        (
          await send("/v1/producer/offline-probe", id, "producer").send({
            outerRollback: true,
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await state.raw!.query(
            "SELECT value FROM public.hvm_offline_probe WHERE id=$1",
            [uid],
          )
        ).rows[0].value,
      ).toBe(before);
      expect(
        (
          await state.raw!.query(
            "SELECT 1 FROM app_offline_request_receipts WHERE request_id=$1",
            [id],
          )
        ).rowCount,
      ).toBe(0);
    });
    it("domain rollback leaves no mutation or success receipt", async () => {
      const before = (
        await state.raw!.query(
          "SELECT value FROM public.hvm_offline_probe WHERE id=$1",
          [uid],
        )
      ).rows[0].value;
      expect(
        (
          await send(
            "/v1/producer/offline-probe",
            randomUUID(),
            "producer",
          ).send({ rollback: true })
        ).status,
      ).toBe(409);
      expect(
        (
          await state.raw!.query(
            "SELECT value FROM public.hvm_offline_probe WHERE id=$1",
            [uid],
          )
        ).rows[0].value,
      ).toBe(before);
    });
    it.each(["platform_admin", "platform_super_admin"])(
      "%s checks authorization again on reconnect",
      async (r) => {
        const id = randomUUID();
        const first = await send("/v1/admin/categories", id, r).send({});
        expect(first.status).toBe(200);
        const denied = await send("/v1/admin/categories", id, r)
          .set("X-Test-Permission", "denied")
          .send({});
        expect(denied.status).toBe(403);
      },
    );
    it("a different portal cannot reuse a receipt or modify the other scope", async () => {
      const id = randomUUID();
      await send("/v1/producer/offline-probe", id, "producer").send({});
      const result = await send("/v1/producer/offline-probe", id, "consumer")
        .set("X-HVM-Offline-Scope", `${uid}:producer`)
        .send({});
      expect(result.status).toBe(409);
      expect(result.body.error).toBe("OFFLINE_SCOPE_CHANGED");
    });
    it("reusing the ID with different data is rejected", async () => {
      const id = randomUUID();
      await send("/v1/producer/offline-probe", id, "producer").send({});
      expect(
        (
          await send("/v1/producer/offline-probe", id, "producer").send({
            altered: true,
          })
        ).status,
      ).toBe(409);
    });
    it("SQL receipt storage is closed to browser roles", async () => {
      const result = await state.raw!.query(
        "SELECT has_table_privilege('authenticated','public.app_offline_request_receipts','SELECT') AS readable,has_table_privilege('anon','public.app_offline_request_receipts','INSERT') AS writable",
      );
      expect(result.rows[0]).toEqual({ readable: false, writable: false });
    });
    it("completes all five real rural domain steps atomically and recovers the exact response", async () => {
      const p = await seedProperty(true),
        id = randomUUID(),
        body = workflow(p.id, p.revision);
      const first = await complete(p.id, p.revision, id).send(body);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.property.status).toBe("completed");
      expect(first.headers["x-hvm-offline-receipt"]).toBe(id);
      expect((await complete(p.id, p.revision, id).send(body)).body).toEqual(
        first.body,
      );
      expect(
        (
          await state.raw!.query(
            "SELECT count(*)::int AS n FROM app_audit_events WHERE actor_id=$1 AND command_id=ANY($2::uuid[])",
            [uid, body.steps.map((v) => v.commandId)],
          )
        ).rows[0].n,
      ).toBe(5);
    });
    it("a missing required document rolls back every earlier rural step and receipt", async () => {
      const p = await seedProperty(),
        id = randomUUID();
      const result = await complete(p.id, p.revision, id).send(
        workflow(p.id, p.revision),
      );
      expect(result.status, JSON.stringify(result.body)).toBe(422);
      expect(result.body.error).toBe("PROPERTY_DOCUMENTS_REQUIRED");
      const row = (
        await state.raw!.query(
          "SELECT property_name,revision,total_area_hectares FROM app_properties WHERE id=$1",
          [p.id],
        )
      ).rows[0];
      expect(row).toEqual({
        property_name: "Rascunho offline",
        revision: p.revision,
        total_area_hectares: null,
      });
      expect(
        (
          await state.raw!.query(
            "SELECT 1 FROM app_offline_request_receipts WHERE request_id=$1",
            [id],
          )
        ).rowCount,
      ).toBe(0);
    });
    it("rural completion never overwrites a newer connected revision", async () => {
      const p = await seedProperty();
      await state.raw!.query(
        "UPDATE app_properties SET property_name='Novo valor conectado' WHERE id=$1",
        [p.id],
      );
      expect(
        (await complete(p.id, p.revision).send(workflow(p.id, p.revision)))
          .status,
      ).toBe(409);
      expect(
        (
          await state.raw!.query(
            "SELECT property_name FROM app_properties WHERE id=$1",
            [p.id],
          )
        ).rows[0].property_name,
      ).toBe("Novo valor conectado");
    });
    it("rural completion rejects mixed property IDs before any domain write", async () => {
      const p = await seedProperty(),
        body = workflow(p.id, p.revision);
      body.steps[2].propertyId = randomUUID();
      expect((await complete(p.id, p.revision).send(body)).status).toBe(422);
      expect(
        (
          await state.raw!.query(
            "SELECT revision FROM app_properties WHERE id=$1",
            [p.id],
          )
        ).rows[0].revision,
      ).toBe(p.revision);
    });
    it("an expired rural authentication proof keeps the action unapplied", async () => {
      const p = await seedProperty(),
        id = randomUUID();
      expect(
        (
          await complete(p.id, p.revision, id, true).send(
            workflow(p.id, p.revision),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await state.raw!.query(
            "SELECT revision FROM app_properties WHERE id=$1",
            [p.id],
          )
        ).rows[0].revision,
      ).toBe(p.revision);
      expect(
        (
          await state.raw!.query(
            "SELECT 1 FROM app_offline_request_receipts WHERE request_id=$1",
            [id],
          )
        ).rowCount,
      ).toBe(0);
    });
    it("erasing one portal profile removes only its private receipts", async () => {
      const prior = (
        await state.raw!.query(
          "SELECT portal_role,count(*)::int AS count FROM app_offline_request_receipts WHERE user_id=$1 GROUP BY portal_role",
          [uid],
        )
      ).rows;
      expect(
        prior.find((r) => r.portal_role === "consumer").count,
      ).toBeGreaterThan(0);
      await state.raw!.query(
        "DELETE FROM app_account_profiles WHERE user_id=$1 AND role_code='consumer'",
        [uid],
      );
      const after = (
        await state.raw!.query(
          "SELECT portal_role,count(*)::int AS count FROM app_offline_request_receipts WHERE user_id=$1 GROUP BY portal_role",
          [uid],
        )
      ).rows;
      expect(after.find((r) => r.portal_role === "consumer")).toBeUndefined();
      expect(after.find((r) => r.portal_role === "producer").count).toBe(
        prior.find((r) => r.portal_role === "producer").count,
      );
    });
  },
);

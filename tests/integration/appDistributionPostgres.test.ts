import { randomInt, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
import type { UpdateAppDistributionRequest } from "../../shared/contracts/appDistribution.ts";

vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_DISTRIBUTION_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw new Error("DISTRIBUTION_DISPOSABLE_LOCAL_DATABASE_REQUIRED");
  const pg = (await import("pg")).default;
  return { dbPool: new pg.Pool({ connectionString: value, max: 8 }) };
});
import { dbPool } from "../../server/db/pool.ts";
import { AppDistributionService as distribution } from "../../server/services/AppDistributionService.ts";

const androidStore = "https://play.google.com/store/apps/details?id=br.com.hortivitalmix.app";
const unverifiedApk = "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/public/app-downloads/android/1.0.0/hvm.apk";
const apple = "https://apps.apple.com/br/app/hortivitalmix/id123456789";
const audit = () => ({ requestId: randomUUID(), ipHash: "a".repeat(64) });
const pool = () => dbPool as Pool;

describe.runIf(Boolean(process.env.HVM_DISTRIBUTION_LOCAL_DATABASE_URL))(
  "Distribuição com SQL real, permissões canônicas, transações e downloads atuais",
  () => {
    let root: AdminActorContext,
      delegated: AdminActorContext,
      other: AdminActorContext;
    let original: Record<string, unknown>, lock: PoolClient;
    const authIds: string[] = [],
      personIds: string[] = [];

    async function administrator(
      role: AdminActorContext["role"],
      grant = false,
    ) {
      const owner = randomUUID(),
        id = randomUUID(),
        person = randomUUID();
      authIds.push(id, owner);
      personIds.push(person);
      await pool().query(
        "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now()),($3,$4,now())",
        [owner, owner + "@example.invalid", id, id + "@example.invalid"],
      );
      await pool().query(
        "UPDATE app_users SET status='active' WHERE id=ANY($1::uuid[])",
        [[owner, id]],
      );
      await pool().query(
        `INSERT INTO app_people(id,user_id,full_name,cpf_normalized,email_normalized,phone_e164)
        VALUES($1,$2,$3,$4,$5,'+5569988888888')`,
        [
          person,
          owner,
          "Pessoa sintética distribuição " + person,
          String(randomInt(10000000000, 99999999999)),
          owner + "@example.invalid",
        ],
      );
      await pool().query(
        `INSERT INTO app_admin_principals(admin_user_id,person_id,admin_email,portal_role,email_verified_at)
        VALUES($1,$2,$3,$4,now())`,
        [id, person, id + "@example.invalid", role],
      );
      await pool().query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,$2)",
        [id, role],
      );
      if (grant)
        await pool().query(
          "INSERT INTO app_admin_sector_members(user_id,sector_code) VALUES($1,'platform_configuration')",
          [id],
        );
      return {
        userId: id,
        role,
        isSuperAdmin: role === "platform_super_admin",
        sectors: grant ? ["platform_configuration"] : [],
        deniedSectors: [],
        sessionIssuedAt: new Date().toISOString(),
      } as AdminActorContext;
    }

    beforeAll(async () => {
      lock = await pool().connect();
      await lock.query(
        "SELECT pg_advisory_lock(hashtext('hvm-distribution-local-test-suite'))",
      );
      original = (
        await pool().query(
          "SELECT android,ios,release_notes,revision,updated_at,updated_by FROM app_mobile_distribution WHERE singleton_guard",
        )
      ).rows[0];
      root = await administrator("platform_super_admin");
      delegated = await administrator("platform_admin", true);
      other = await administrator("platform_admin");
    });
    beforeEach(async () => {
      await pool().query(
        "DELETE FROM app_admin_permission_overrides WHERE user_id=ANY($1::uuid[])",
        [[root.userId, delegated.userId, other.userId]],
      );
      await pool().query(
        "UPDATE app_admin_sector_members SET revoked_at=null,expires_at=null WHERE user_id=$1 AND sector_code='platform_configuration'",
        [delegated.userId],
      );
      await pool().query(
        "UPDATE app_users SET status='active',block_starts_at=null,block_ends_at=null WHERE id=ANY($1::uuid[])",
        [[root.userId, delegated.userId, other.userId]],
      );
      await pool().query(
        "UPDATE app_mobile_distribution SET android=null,ios=null,release_notes='',revision=1,updated_by=null WHERE singleton_guard",
      );
    });
    afterAll(async () => {
      try {
        if (original)
          await pool().query(
            `UPDATE app_mobile_distribution
          SET android=$1,ios=$2,release_notes=$3,revision=$4,updated_at=$5,updated_by=$6 WHERE singleton_guard`,
            [
              original.android,
              original.ios,
              original.release_notes,
              original.revision,
              original.updated_at,
              original.updated_by,
            ],
          );
        if (authIds.length) {
          await pool().query(
            "DELETE FROM app_admin_principals WHERE admin_user_id=ANY($1::uuid[])",
            [authIds],
          );
          await pool().query(
            "DELETE FROM app_account_profiles WHERE user_id=ANY($1::uuid[])",
            [authIds],
          );
          await pool().query(
            "DELETE FROM app_people WHERE id=ANY($1::uuid[])",
            [personIds],
          );
          await pool().query(
            "DELETE FROM auth.users WHERE id=ANY($1::uuid[])",
            [authIds],
          );
        }
      } finally {
        if (lock) {
          await lock.query(
            "SELECT pg_advisory_unlock(hashtext('hvm-distribution-local-test-suite'))",
          );
          lock.release();
        }
        await dbPool?.end();
      }
    });

    function command(
      releaseNotes = "Atualização sintética disponível.",
    ): UpdateAppDistributionRequest {
      return {
        commandId: randomUUID(),
        expectedRevision: 1,
        payload: {
          android: { version: "1.0.0", url: androidStore },
          ios: { version: "1.0.0", url: apple },
          releaseNotes,
        },
      };
    }
    it("por padrão não há APK/IPA inventado e o público não recebe o operador", async () => {
      const response = await distribution.getPublic();
      expect(response).not.toHaveProperty("updatedBy");
      expect(response.android).toMatchObject({ available: false, url: null });
      expect(response.ios).toMatchObject({ available: false, url: null });
      expect(await distribution.getDownload("android")).toBeNull();
    });
    it("APK manual sem verificação de assinatura pelo pipeline não é publicado", async () => {
      const input = command();
      input.payload.android = { version: "1.0.0", url: unverifiedApk };
      await expect(distribution.update(input, root, audit())).rejects.toMatchObject({ code: "APP_PACKAGE_NOT_VERIFIED", status: 422 });
      expect((await distribution.getPublic()).revision).toBe(1);
      expect(await distribution.getDownload("android")).toBeNull();
      expect((await pool().query("SELECT 1 FROM app_commerce_receipts WHERE command_id=$1", [input.commandId])).rowCount).toBe(0);
    });
    it("admin delegado publica, gera um evento auditado e mantém links estáveis", async () => {
      const input = command(),
        result = await distribution.update(input, delegated, audit());
      expect(result).toMatchObject({ status: "success", revision: 2 });
      const publicManifest = await distribution.getPublic(),
        administrative = await distribution.getAdmin(delegated);
      expect(publicManifest).not.toHaveProperty("updatedBy");
      expect(administrative.updatedBy).toBe(delegated.userId);
      expect(publicManifest.android).toMatchObject({
        available: true,
        url: androidStore,
        downloadUrl: "/downloads/android",
        channel: "play_store",
      });
      expect(await distribution.getDownload("ios")).toBe(apple);
      const events = (
        await pool().query(
          "SELECT actor_id,action,payload_before,payload_after FROM app_audit_events WHERE command_id=$1",
          [input.commandId],
        )
      ).rows;
      expect(events).toHaveLength(1);
      expect(events[0].actor_id).toBe(delegated.userId);
      expect(events[0].action).toBe("app.distribution.updated");
      expect(events[0].payload_before.revision).toBe(1);
      expect(events[0].payload_after.revision).toBe(2);
    });
    it("link permanente mantém a versão publicada do canal de loja", async () => {
      await distribution.update(command(), root, audit());
      const next = command();
      next.expectedRevision = 2;
      next.payload.android = {
        version: "1.1.0",
        url: androidStore,
      };
      next.payload.ios = null;
      await distribution.update(next, root, audit());
      expect(await distribution.getDownload("android")).toBe(
        next.payload.android.url,
      );
      expect(await distribution.getDownload("ios")).toBeNull();
      expect((await distribution.getPublic()).android.version).toBe("1.1.0");
      expect((await distribution.getPublic()).android.downloadUrl).toBe(
        "/downloads/android",
      );
    });
    it("mesmo comando é replay sem segunda gravação ou auditoria", async () => {
      const input = command(),
        first = await distribution.update(input, root, audit());
      expect(await distribution.update(input, root, audit())).toEqual({
        ...first,
        status: "idempotent_replay",
      });
      expect((await distribution.getPublic()).revision).toBe(2);
      expect(
        (
          await pool().query(
            "SELECT 1 FROM app_audit_events WHERE command_id=$1",
            [input.commandId],
          )
        ).rowCount,
      ).toBe(1);
    });
    it("reutilização por outro ator ou outro payload não aplica nenhum dado", async () => {
      const input = command();
      await distribution.update(input, root, audit());
      await expect(
        distribution.update(input, delegated, audit()),
      ).rejects.toMatchObject({
        code: "COMMAND_ID_PAYLOAD_MISMATCH",
        status: 409,
      });
      await expect(
        distribution.update(
          {
            ...input,
            payload: { ...input.payload, releaseNotes: "Texto diferente." },
          },
          root,
          audit(),
        ),
      ).rejects.toMatchObject({
        code: "COMMAND_ID_PAYLOAD_MISMATCH",
        status: 409,
      });
      expect((await distribution.getPublic()).releaseNotes).toBe(
        input.payload.releaseNotes,
      );
    });
    it("duas revisões simultâneas aplicam exatamente uma mudança", async () => {
      const results = await Promise.allSettled([
        distribution.update(command("Primeiro."), root, audit()),
        distribution.update(command("Segundo."), delegated, audit()),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find(
        (result) => result.status === "rejected",
      ) as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({
        code: "DISTRIBUTION_REVISION_CONFLICT",
        status: 409,
        currentRevision: 2,
      });
      expect((await distribution.getPublic()).revision).toBe(2);
    });
    it("sem mudança grava recibo e preserva revisão/operador/auditoria", async () => {
      const input = command();
      input.payload = { android: null, ios: null, releaseNotes: "" };
      expect(await distribution.update(input, root, audit())).toEqual({
        status: "no_change",
        revision: 1,
      });
      expect(await distribution.update(input, root, audit())).toEqual({
        status: "no_change",
        revision: 1,
      });
      expect(
        (
          await pool().query(
            "SELECT 1 FROM app_audit_events WHERE command_id=$1",
            [input.commandId],
          )
        ).rowCount,
      ).toBe(0);
      expect((await distribution.getAdmin(root)).updatedBy).toBeNull();
    });
    it("revalida poder canônico: arrays forjados no ator não concedem acesso", async () => {
      const forged = {
        ...other,
        isSuperAdmin: true,
        sectors: ["platform_configuration"],
      } as AdminActorContext;
      await expect(distribution.getAdmin(forged)).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
      await expect(
        distribution.update(command(), forged, audit()),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect((await distribution.getPublic()).revision).toBe(1);
    });
    it("revogação do departamento bloqueia inclusive replay de recibo antigo", async () => {
      const input = command();
      await distribution.update(input, delegated, audit());
      await pool().query(
        "UPDATE app_admin_sector_members SET revoked_at=now() WHERE user_id=$1 AND sector_code='platform_configuration'",
        [delegated.userId],
      );
      await expect(
        distribution.update(input, delegated, audit()),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      await expect(distribution.getAdmin(delegated)).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
    });
    it("negação explícita aplica-se também ao Super administrador", async () => {
      await pool().query(
        "INSERT INTO app_admin_permission_overrides(user_id,sector_code,allowed) VALUES($1,'platform_configuration',false)",
        [root.userId],
      );
      await expect(
        distribution.update(command(), root, audit()),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      await expect(distribution.getAdmin(root)).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
    });
    it("sessão antiga e conta bloqueada preservam a configuração", async () => {
      await expect(
        distribution.update(
          command(),
          {
            ...root,
            sessionIssuedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
          },
          audit(),
        ),
      ).rejects.toMatchObject({ code: "ADMIN_REAUTHENTICATION_REQUIRED" });
      await pool().query("UPDATE app_users SET status='blocked' WHERE id=$1", [
        root.userId,
      ]);
      await expect(
        distribution.update(command(), root, audit()),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect((await distribution.getPublic()).revision).toBe(1);
    });
    it("roles browser não leem nem alteram a tabela; singleton/RLS/índice estão ativos", async () => {
      for (const role of ["anon", "authenticated"] as const) {
        const connection = await pool().connect();
        try {
          await connection.query("BEGIN");
          await connection.query("SET LOCAL ROLE " + role);
          await expect(
            connection.query(
              "SELECT android FROM public.app_mobile_distribution",
            ),
          ).rejects.toMatchObject({ code: "42501" });
          await connection.query("ROLLBACK");
          await connection.query("BEGIN");
          await connection.query("SET LOCAL ROLE " + role);
          await expect(
            connection.query(
              "UPDATE public.app_mobile_distribution SET release_notes='forged' WHERE singleton_guard",
            ),
          ).rejects.toMatchObject({ code: "42501" });
        } finally {
          await connection.query("ROLLBACK");
          connection.release();
        }
      }
      const flags = (
        await pool().query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.app_mobile_distribution'::regclass",
        )
      ).rows[0];
      expect(flags).toEqual({
        relrowsecurity: true,
        relforcerowsecurity: true,
      });
      expect(
        (
          await pool().query(
            "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ix_app_mobile_distribution_updated_by'",
          )
        ).rowCount,
      ).toBe(1);
      await expect(
        pool().query(
          "INSERT INTO app_mobile_distribution(singleton_guard) VALUES(false)",
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool().query(
          "INSERT INTO app_mobile_distribution(singleton_guard) VALUES(true)",
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });
  },
);

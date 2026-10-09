import { createHash, randomInt, randomUUID } from "node:crypto";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Pool, PoolClient } from "pg";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
import type {
  PublishMobileCiRequest,
  MobileReleaseCommand,
} from "../../shared/contracts/mobileReleases.ts";
import type { MobileCiIdentity } from "../../server/security/mobileCiIdentity.ts";
import { FOUNDATION_SCHEMA_VERSION } from "../../shared/contracts/foundation.ts";

vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_MOBILE_RELEASE_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw new Error("MOBILE_DISPOSABLE_LOCAL_DATABASE_REQUIRED");
  const pg = (await import("pg")).default;
  return { dbPool: new pg.Pool({ connectionString: value, max: 8 }) };
});
vi.mock("../../server/supabase/client.ts", () => ({ supabaseAdmin: null }));
import { dbPool } from "../../server/db/pool.ts";
import {
  MobileReleaseService as service,
  validateVerifiedPackage,
} from "../../server/services/MobileReleaseService.ts";
const pool = () => dbPool as Pool;
const audit = () => ({ requestId: randomUUID(), ipHash: "a".repeat(64) });
const bytes = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(204, 7),
]);
const sha = createHash("sha256").update(bytes).digest("hex");

describe.runIf(Boolean(process.env.HVM_MOBILE_RELEASE_LOCAL_DATABASE_URL))(
  "Ledger mobile real em PostgreSQL local",
  () => {
    let root: AdminActorContext,
      delegated: AdminActorContext,
      other: AdminActorContext;
    let original: Record<string, unknown>, lock: PoolClient;
    const authIds: string[] = [],
      peopleIds: string[] = [],
      runIds: string[] = [];
    async function admin(role: AdminActorContext["role"], granted = false) {
      const owner = randomUUID(),
        id = randomUUID(),
        person = randomUUID();
      authIds.push(owner, id);
      peopleIds.push(person);
      await pool().query(
        "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now()),($3,$4,now())",
        [owner, owner + "@example.invalid", id, id + "@example.invalid"],
      );
      await pool().query(
        "UPDATE app_users SET status='active' WHERE id=ANY($1::uuid[])",
        [[owner, id]],
      );
      await pool().query(
        "INSERT INTO app_people(id,user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,$3,$4,$5,'+5569988888888')",
        [
          person,
          owner,
          "Pessoa sintética mobile " + person,
          String(randomInt(10000000000, 99999999999)),
          owner + "@example.invalid",
        ],
      );
      await pool().query(
        "INSERT INTO app_admin_principals(admin_user_id,person_id,admin_email,portal_role,email_verified_at) VALUES($1,$2,$3,$4,now())",
        [id, person, id + "@example.invalid", role],
      );
      await pool().query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,$2)",
        [id, role],
      );
      if (granted)
        await pool().query(
          "INSERT INTO app_admin_sector_members(user_id,sector_code) VALUES($1,'platform_configuration')",
          [id],
        );
      return {
        userId: id,
        role,
        isSuperAdmin: role === "platform_super_admin",
        sectors: granted ? ["platform_configuration"] : [],
        deniedSectors: [],
        sessionIssuedAt: new Date().toISOString(),
      } as AdminActorContext;
    }
    async function cleanReleases() {
      if (runIds.length) {
        await pool().query(
          "DELETE FROM app_mobile_release_events WHERE release_id IN(SELECT id FROM app_mobile_releases WHERE ci_run_id=ANY($1::text[]))",
          [runIds],
        );
        await pool().query(
          "DELETE FROM app_mobile_releases WHERE ci_run_id=ANY($1::text[])",
          [runIds],
        );
        await pool().query(
          "DELETE FROM app_mobile_uploads WHERE ci_run_id=ANY($1::text[])",
          [runIds],
        );
      }
      if (authIds.length)
        await pool().query(
          "DELETE FROM app_mobile_release_events WHERE actor_id=ANY($1::uuid[])",
          [authIds],
        );
    }
    beforeAll(async () => {
      lock = await pool().connect();
      await lock.query(
        "SELECT pg_advisory_lock(hashtext('hvm-mobile-local-test-suite'))",
      );
      original = (
        await pool().query(
          "SELECT * FROM app_mobile_release_policy WHERE singleton_guard",
        )
      ).rows[0];
      if (
        (await pool().query("SELECT 1 FROM app_mobile_releases LIMIT 1"))
          .rowCount
      )
        throw new Error("MOBILE_LOCAL_LEDGER_MUST_BE_EMPTY");
      root = await admin("platform_super_admin");
      delegated = await admin("platform_admin", true);
      other = await admin("platform_admin");
    });
    beforeEach(async () => {
      await cleanReleases();
      await pool().query(
        "UPDATE app_mobile_release_policy SET revision=1,android_minimum_build=0,ios_minimum_build=0,android_auto_publish=false,ios_auto_publish=false,android_signing_identity=null,ios_signing_identity=null,updated_by=null WHERE singleton_guard",
      );
      await pool().query(
        "DELETE FROM app_admin_permission_overrides WHERE user_id=ANY($1::uuid[])",
        [[root.userId, delegated.userId, other.userId]],
      );
      await pool().query(
        "UPDATE app_admin_sector_members SET revoked_at=null WHERE user_id=$1",
        [delegated.userId],
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(bytes, {
              headers: { "Content-Length": String(bytes.length) },
            }),
        ),
      );
    });
    afterAll(async () => {
      try {
        await cleanReleases();
        if (original)
          await pool().query(
            "UPDATE app_mobile_release_policy SET revision=$1,android_minimum_build=$2,ios_minimum_build=$3,android_auto_publish=$4,ios_auto_publish=$5,android_signing_identity=$6,ios_signing_identity=$7,updated_at=$8,updated_by=$9 WHERE singleton_guard",
            [
              original.revision,
              original.android_minimum_build,
              original.ios_minimum_build,
              original.android_auto_publish,
              original.ios_auto_publish,
              original.android_signing_identity,
              original.ios_signing_identity,
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
            [peopleIds],
          );
          await pool().query(
            "DELETE FROM auth.users WHERE id=ANY($1::uuid[])",
            [authIds],
          );
        }
      } finally {
        vi.unstubAllGlobals();
        if (lock) {
          await lock.query(
            "SELECT pg_advisory_unlock(hashtext('hvm-mobile-local-test-suite'))",
          );
          lock.release();
        }
        await dbPool?.end();
      }
    });
    async function candidate(
      build = 10,
      minimum = 1,
      signer = "c".repeat(64),
      platform: "android" | "ios" = "android",
    ) {
      const identity: MobileCiIdentity = {
        sourceCommit: "b".repeat(40),
        runId: String(randomInt(100000000000, 999999999999)),
        runAttempt: 1,
      };
      runIds.push(identity.runId);
      const input: PublishMobileCiRequest = {
        platform,
        version: `1.0.${build}`,
        buildNumber: build,
        minSupportedBuild: minimum,
        runtimeFingerprint: "a".repeat(64),
        sourceCommit: identity.sourceCommit,
        schemaVersion: FOUNDATION_SCHEMA_VERSION,
        sha256: sha,
        sizeBytes: bytes.length,
        channel: platform === "android" ? "apk" : "testflight",
        url:
          platform === "android"
            ? `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/public/app-downloads/android/${build}/${sha}.apk`
            : "https://testflight.apple.com/join/AbC123",
        releaseNotes: "Teste sintético",
        signingIdentity: platform === "android" ? signer : "ABC1234567",
      };
      if (platform === "android")
        await pool().query(
          "INSERT INTO app_mobile_uploads(ci_run_id,ci_run_attempt,source_commit,build_number,sha256,size_bytes,storage_path,expires_at) VALUES($1,1,$2,$3,$4,$5,$6,now()+interval '1 hour')",
          [
            identity.runId,
            identity.sourceCommit,
            build,
            sha,
            bytes.length,
            `android/${build}/${sha}.apk`,
          ],
        );
      return {
        input,
        identity,
        result: await service.acceptCi(input, identity),
      };
    }
    async function cmd(
      action: MobileReleaseCommand["action"],
      releaseId?: string,
      actor = root,
      autoPublish?: { android: boolean; ios: boolean },
    ) {
      const input: MobileReleaseCommand = {
        commandId: randomUUID(),
        expectedRevision: (await service.getPublic()).revision,
        action,
        ...(releaseId ? { releaseId } : {}),
        ...(autoPublish ? { autoPublish } : {}),
      };
      return { input, result: await service.command(input, actor, audit()) };
    }
    it("não inventa builds e público não recebe identidade do operador", async () => {
      expect(await service.getPublic()).toMatchObject({
        revision: 1,
        android: null,
        ios: null,
        minimumSupportedBuild: { android: 0, ios: 0 },
      });
      expect(await service.getAdmin(delegated)).toMatchObject({
        releases: [],
        sync: { state: "awaiting_first_release", pendingUploads: 0 },
      });
      expect(await service.getPublic()).not.toHaveProperty("updatedBy");
    });
    it("CI confere bytes e registra imutável; primeira assinatura aguarda aprovação", async () => {
      const value = await candidate();
      expect(value.result.status).toBe("verified");
      expect((await service.getPublic()).android).toBeNull();
      expect((await service.getAdmin(root)).releases[0]).toMatchObject({
        buildNumber: 10,
        status: "verified",
        signingIdentity: "c".repeat(64),
      });
      expect(
        (
          await pool().query(
            "SELECT consumed_at FROM app_mobile_uploads WHERE ci_run_id=$1",
            [value.identity.runId],
          )
        ).rows[0].consumed_at,
      ).not.toBeNull();
      expect(await service.acceptCi(value.input, value.identity)).toMatchObject(
        { status: "idempotent_replay", releaseId: value.result.releaseId },
      );
      await expect(
        service.acceptCi(
          { ...value.input, releaseNotes: "alterado" },
          value.identity,
        ),
      ).rejects.toMatchObject({ code: "MOBILE_CI_RELEASE_MISMATCH" });
    });
    it("administrador delegado publica versão real e pino de certificado", async () => {
      const value = await candidate();
      const command = await cmd("publish", value.result.releaseId, delegated);
      expect(command.result.status).toBe("success");
      expect(await service.getPublished("android")).toMatchObject({
        buildNumber: 10,
        downloadUrl: "/downloads/android",
      });
      expect(
        (
          await pool().query(
            "SELECT android_signing_identity FROM app_mobile_release_policy",
          )
        ).rows[0].android_signing_identity,
      ).toBe("c".repeat(64));
      expect(
        (
          await pool().query(
            "SELECT action FROM app_audit_events WHERE command_id=$1",
            [command.input.commandId],
          )
        ).rows[0].action,
      ).toBe("app.mobile.release.publish");
    });
    it("Android novo com assinatura aprovada sincroniza automaticamente; iOS continua aguardando Apple", async () => {
      const first = await candidate();
      await cmd("publish", first.result.releaseId);
      await cmd("configure", undefined, root, { android: true, ios: false });
      const second = await candidate(11);
      expect(second.result.status).toBe("published");
      expect((await service.getPublic()).android?.buildNumber).toBe(11);
      const apple = await candidate(20, 1, "", "ios");
      expect(apple.result.status).toBe("verified");
      expect((await service.getPublic()).ios).toBeNull();
      await expect(
        cmd("configure", undefined, root, { android: true, ios: true }),
      ).rejects.toMatchObject({
        code: "MOBILE_IOS_PUBLICATION_REQUIRES_APPROVAL",
        status: 422,
      });
    });
    it("retirada não restaura link antigo nem reduz mínimo; restore abaixo do mínimo é bloqueado", async () => {
      const first = await candidate(10, 1);
      await cmd("publish", first.result.releaseId);
      const next = await candidate(20, 15);
      await cmd("publish", next.result.releaseId);
      await cmd("withdraw", next.result.releaseId);
      expect(await service.getPublic()).toMatchObject({
        android: null,
        minimumSupportedBuild: { android: 15, ios: 0 },
      });
      await expect(
        cmd("restore", first.result.releaseId),
      ).rejects.toMatchObject({ code: "MOBILE_BUILD_BELOW_MINIMUM" });
      await cmd("restore", next.result.releaseId);
      expect((await service.getPublic()).android?.buildNumber).toBe(20);
    });
    it("CI atrasado não desfaz retirada nem publica pacote anterior; somente build novo é automático", async () => {
      const first = await candidate(10);
      await cmd("publish", first.result.releaseId);
      await cmd("withdraw", first.result.releaseId);
      await cmd("configure", undefined, root, { android: true, ios: false });
      const delayed = await candidate(9);
      expect(delayed.result.status).toBe("verified");
      expect((await service.getPublic()).android).toBeNull();
      const next = await candidate(11);
      expect(next.result.status).toBe("published");
      expect((await service.getPublic()).android?.buildNumber).toBe(11);
    });
    it("rerun idêntico é replay sem substituir bytes ou certificado; diferente exige novo build", async () => {
      const value = await candidate();
      const retry = { ...value.identity, runAttempt: 2 };
      expect(await service.acceptCi(value.input, retry)).toMatchObject({
        status: "idempotent_replay",
        releaseId: value.result.releaseId,
      });
      await expect(
        service.acceptCi(
          { ...value.input, signingIdentity: "d".repeat(64) },
          retry,
        ),
      ).rejects.toMatchObject({ code: "MOBILE_CI_RELEASE_MISMATCH" });
      expect((await service.getAdmin(root)).releases).toHaveLength(1);
    });
    it("URL adulterada no banco falha fechada, sem gerar redirecionamento externo", async () => {
      const value = await candidate();
      await cmd("publish", value.result.releaseId);
      await pool().query(
        "UPDATE app_mobile_releases SET url='https://attacker.invalid/app.apk' WHERE id=$1",
        [value.result.releaseId],
      );
      await expect(service.getPublic()).rejects.toMatchObject({
        code: "MOBILE_RELEASES_UNAVAILABLE",
        status: 503,
      });
    });
    it("não publica certificado diferente; CI desvia para candidato sem alterar latest", async () => {
      const first = await candidate();
      await cmd("publish", first.result.releaseId);
      await cmd("configure", undefined, root, { android: true, ios: false });
      const otherSigner = await candidate(11, 1, "d".repeat(64));
      expect(otherSigner.result.status).toBe("verified");
      await expect(
        cmd("publish", otherSigner.result.releaseId),
      ).rejects.toMatchObject({ code: "MOBILE_SIGNING_IDENTITY_MISMATCH" });
      expect((await service.getPublic()).android?.buildNumber).toBe(10);
    });
    it("replay de comando é único e rejeita ator/payload diferentes", async () => {
      const first = await candidate();
      const result = await cmd("publish", first.result.releaseId);
      expect(await service.command(result.input, root, audit())).toMatchObject({
        status: "idempotent_replay",
        revision: result.result.revision,
      });
      await expect(
        service.command(result.input, delegated, audit()),
      ).rejects.toMatchObject({ code: "COMMAND_ID_PAYLOAD_MISMATCH" });
      await expect(
        service.command({ ...result.input, action: "withdraw" }, root, audit()),
      ).rejects.toMatchObject({ code: "COMMAND_ID_PAYLOAD_MISMATCH" });
      expect(
        (
          await pool().query(
            "SELECT 1 FROM app_audit_events WHERE command_id=$1",
            [result.input.commandId],
          )
        ).rowCount,
      ).toBe(1);
    });
    it("CAS concorrente aceita exatamente um operador", async () => {
      const first = await candidate();
      const revision = (await service.getPublic()).revision;
      const results = await Promise.allSettled([
        service.command(
          {
            commandId: randomUUID(),
            expectedRevision: revision,
            action: "publish",
            releaseId: first.result.releaseId,
          },
          root,
          audit(),
        ),
        service.command(
          {
            commandId: randomUUID(),
            expectedRevision: revision,
            action: "withdraw",
            releaseId: first.result.releaseId,
          },
          delegated,
          audit(),
        ),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        (
          results.find(
            (result) => result.status === "rejected",
          ) as PromiseRejectedResult
        ).reason,
      ).toMatchObject({ code: "MOBILE_RELEASE_REVISION_CONFLICT" });
    });
    it("permissão canônica bloqueia ator forjado, revogação e deny de super inclusive replay", async () => {
      await expect(
        service.getAdmin({
          ...other,
          isSuperAdmin: true,
          sectors: ["platform_configuration"],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const first = await candidate();
      const command = await cmd("publish", first.result.releaseId, delegated);
      await pool().query(
        "UPDATE app_admin_sector_members SET revoked_at=now() WHERE user_id=$1",
        [delegated.userId],
      );
      await expect(
        service.command(command.input, delegated, audit()),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await pool().query(
        "INSERT INTO app_admin_permission_overrides(user_id,sector_code,allowed) VALUES($1,'platform_configuration',false)",
        [root.userId],
      );
      await expect(service.getAdmin(root)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
    it("reautenticação antiga preserva pacote e revisão", async () => {
      const first = await candidate();
      await expect(
        cmd("publish", first.result.releaseId, {
          ...root,
          sessionIssuedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        }),
      ).rejects.toMatchObject({ code: "ADMIN_REAUTHENTICATION_REQUIRED" });
      expect((await service.getPublic()).android).toBeNull();
    });
    it("somente APK verificado publicado pode entrar na distribuição manual", async () => {
      const first = await candidate();
      await expect(
        validateVerifiedPackage(pool(), {
          version: first.input.version,
          url: first.input.url,
        }),
      ).rejects.toMatchObject({
        code: "APP_PACKAGE_NOT_VERIFIED",
        status: 422,
      });
      await cmd("publish", first.result.releaseId);
      await validateVerifiedPackage(pool(), {
        version: first.input.version,
        url: first.input.url,
      });
      await cmd("withdraw", first.result.releaseId);
      await expect(
        validateVerifiedPackage(pool(), {
          version: first.input.version,
          url: first.input.url,
        }),
      ).rejects.toMatchObject({ code: "APP_PACKAGE_NOT_VERIFIED" });
    });
    it("não aceita callback fora do commit/JWKS identity nem schema futura", async () => {
      const value = await candidate();
      await expect(
        service.acceptCi(
          { ...value.input, sourceCommit: "f".repeat(40) },
          value.identity,
        ),
      ).rejects.toMatchObject({ code: "MOBILE_CI_COMMIT_MISMATCH" });
      await expect(
        service.acceptCi(
          { ...value.input, schemaVersion: FOUNDATION_SCHEMA_VERSION + 1 },
          value.identity,
        ),
      ).rejects.toMatchObject({ code: "MOBILE_SERVER_SCHEMA_INCOMPATIBLE" });
    });
    it("RLS, grants de coluna imutável e índices de FK estão ativos", async () => {
      const value = await candidate();
      const connection = await pool().connect();
      try {
        for (const role of ["anon", "authenticated"]) {
          await connection.query("BEGIN");
          await connection.query("SET LOCAL ROLE " + role);
          await expect(
            connection.query("SELECT * FROM app_mobile_releases"),
          ).rejects.toMatchObject({ code: "42501" });
          await connection.query("ROLLBACK");
        }
        await connection.query("BEGIN");
        await connection.query("SET LOCAL ROLE service_role");
        await expect(
          connection.query(
            "UPDATE app_mobile_releases SET sha256=$1 WHERE id=$2",
            ["f".repeat(64), value.result.releaseId],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await connection.query("ROLLBACK");
      } finally {
        await connection.query("ROLLBACK");
        connection.release();
      }
      const flags = (
        await pool().query(
          "SELECT bool_and(relrowsecurity AND relforcerowsecurity) AS protected FROM pg_class WHERE oid=ANY(ARRAY['public.app_mobile_release_policy'::regclass,'public.app_mobile_releases'::regclass,'public.app_mobile_uploads'::regclass,'public.app_mobile_release_events'::regclass])",
        )
      ).rows[0];
      expect(flags.protected).toBe(true);
      expect(
        (
          await pool().query(
            "SELECT 1 FROM pg_indexes WHERE indexname=ANY($1::text[])",
            [
              [
                "ix_app_mobile_release_policy_updated_by",
                "ix_app_mobile_release_events_release",
                "ix_app_mobile_release_events_actor",
              ],
            ],
          )
        ).rowCount,
      ).toBe(3);
    });
  },
);

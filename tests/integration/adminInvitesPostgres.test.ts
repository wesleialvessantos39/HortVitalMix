import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  inviteUserByEmail: vi.fn(),
  createUser: vi.fn(),
  signInWithOtp: vi.fn(),
  deleteUser: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_ADMIN_INVITES_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw new Error("ADMIN_INVITES_DISPOSABLE_LOCAL_DATABASE_REQUIRED");
  const pg = (await import("pg")).default;
  return { dbPool: new pg.Pool({ connectionString: value, max: 5 }) };
});

vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: { auth: { admin: auth } },
  supabasePublic: null,
  createSupabasePublicClient: () => ({ auth: { signInWithOtp: auth.signInWithOtp } }),
}));

import { dbPool } from "../../server/db/pool.ts";
import { AdminGovernanceService } from "../../server/services/AdminGovernanceService.ts";

const ipHash = "b".repeat(64);
const pool = () => dbPool as Pool;
const syntheticUsers: string[] = [];
const syntheticActors: string[] = [];
let actorId: string;

async function authUser(email = randomUUID() + "@example.invalid") {
  const id = randomUUID();
  await pool().query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
    id,
    email,
  ]);
  syntheticUsers.push(id);
  return id;
}

function syntheticCpf() {
  const digits = [...randomBytes(9)].map(value => value % 10);
  for (let length = 9; length < 11; length++) {
    const remainder = (digits.reduce((sum, digit, index) => sum + digit * (length + 1 - index), 0) * 10) % 11;
    digits.push(remainder === 10 ? 0 : remainder);
  }
  return digits.join("");
}

async function issue(
  email = randomUUID() + "@example.invalid",
  targetRole: "platform_admin" | "platform_super_admin" = "platform_admin",
) {
  const result = await AdminGovernanceService.createInvite(
    {
      email,
      targetRole,
      sectors: ["document_verification"],
      commandId: randomUUID(),
    },
    actorId,
    "platform_super_admin",
    [],
    randomUUID(),
    ipHash,
    "https://hortvitalmix.vercel.app",
  );
  expect(result.status).toBe("created");
  if (result.status !== "created")
    throw new Error("SYNTHETIC_INVITE_CREATION_FAILED");
  return result.invite;
}

async function seedInvite(
  options: {
    accepted?: boolean;
    expired?: boolean;
    invalidated?: boolean;
    owner?: string;
  } = {},
) {
  const id = randomUUID();
  const token = randomBytes(32).toString("hex");
  const digest = createHash("sha256").update(token).digest("hex");
  await pool().query(
    `INSERT INTO app_admin_invites(id,email,target_role,token_digest,invited_by,is_accepted,created_at,expires_at,invalidated_at)
     VALUES($1,$2,'platform_admin',$3,$4,$5,now()-interval '48 hours',
       CASE WHEN $6 THEN now()-interval '24 hours' ELSE now()+interval '24 hours' END,
       CASE WHEN $7 THEN now() ELSE NULL END)`,
    [
      id,
      id + "@example.invalid",
      digest,
      options.owner ?? actorId,
      options.accepted ?? false,
      options.expired ?? false,
      options.invalidated ?? false,
    ],
  );
  return id;
}

const remove = (
  id: string,
  expectedRevision: number,
  role: "platform_admin" | "platform_super_admin" = "platform_admin",
  commandId = randomUUID(),
) =>
  AdminGovernanceService.removeInvite(
    id,
    { expectedRevision, commandId },
    actorId,
    role,
    randomUUID(),
    ipHash,
  );

describe.runIf(!!process.env.HVM_ADMIN_INVITES_LOCAL_DATABASE_URL)(
  "Convites com SQL e triggers reais em Postgres descartável",
  () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      actorId = await authUser();
      syntheticActors.push(actorId);
      auth.inviteUserByEmail.mockImplementation(
        async (email: string, options: { data: unknown }) => {
          const existing = await pool().query(
            "SELECT id FROM auth.users WHERE email=$1",
            [email],
          );
          if (existing.rowCount)
            return { data: { user: null }, error: { status: 422 } };
          const id = await authUser(email);
          await pool().query(
            "UPDATE auth.users SET raw_user_meta_data=$2::jsonb WHERE id=$1",
            [id, JSON.stringify(options.data)],
          );
          return { data: { user: { id, email } }, error: null };
        },
      );
      auth.createUser.mockImplementation(async (input: { email: string; user_metadata: unknown }) => auth.inviteUserByEmail(input.email, { data: input.user_metadata }));
      auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
      auth.deleteUser.mockImplementation(async (id: string) => {
        const deleted = await pool().query(
          "DELETE FROM auth.users WHERE id=$1 RETURNING id",
          [id],
        );
        return { data: {}, error: deleted.rowCount ? null : { status: 404 } };
      });
      auth.updateUserById.mockResolvedValue({ data: {}, error: null });
    });

    afterAll(async () => {
      try {
        // All rows belong to synthetic users created above; audit stays immutable.
        await pool().query(
          "DELETE FROM app_admin_invites WHERE invited_by=ANY($1::uuid[])",
          [syntheticActors],
        );
        for (const id of [...syntheticUsers].reverse())
          await pool().query("DELETE FROM auth.users WHERE id=$1", [id]);
      } finally {
        await dbPool?.end();
      }
    });

    it("cancela o link antigo e permite convidar novamente o mesmo e-mail", async () => {
      const email = randomUUID() + "@example.invalid";
      const first = await issue(email);
      const firstDelivery = { redirectTo: auth.signInWithOtp.mock.calls[0]?.[0].options.emailRedirectTo ?? auth.inviteUserByEmail.mock.calls[0][1].redirectTo };
      const token = new URL(firstDelivery.redirectTo).searchParams.get(
        "token",
      )!;
      expect(
        await AdminGovernanceService.validateInviteToken(token),
      ).toMatchObject({ status: "valid" });
      const before = await pool().query(
        "SELECT auth_user_id FROM app_admin_invites WHERE id=$1",
        [first.id],
      );
      expect(await remove(first.id, first.revision)).toEqual({
        status: "deleted",
        cleanupPending: false,
      });
      expect(await AdminGovernanceService.validateInviteToken(token)).toEqual({
        status: "invalidated",
      });
      expect(
        (
          await pool().query("SELECT 1 FROM auth.users WHERE id=$1", [
            before.rows[0].auth_user_id,
          ])
        ).rowCount,
      ).toBe(0);
      const replacement = await issue(email);
      expect(replacement.id).not.toBe(first.id);
      expect(
        (
          await AdminGovernanceService.listInvites(actorId, "platform_admin")
        ).map((row) => row.id),
      ).toEqual([replacement.id]);
      expect(
        (
          await pool().query("SELECT 1 FROM app_admin_invites WHERE id=$1", [
            first.id,
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await pool().query(
            "SELECT 1 FROM app_audit_events WHERE target_id=$1 AND action='admin.invite.archived'",
            [first.id],
          )
        ).rowCount,
      ).toBe(1);
    });

    for (const publicRole of ["consumer", "producer"] as const) for (const provider of ["gmail.com", "outlook.com"]) {
      it(`convida ${provider} de ${publicRole} sem CPF prévio e ativa outra credencial`, async () => {
        const email = randomUUID() + "@" + provider;
        const publicId = await authUser(email);
        const personId = randomUUID();
        await pool().query(
          "INSERT INTO app_people(id,user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,'Pessoa sintética','11144477735',$3,'+5569988888888')",
          [personId, publicId, email],
        );
        await pool().query(
          "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,$2)",
          [publicId, publicRole],
        );
        await pool().query("UPDATE app_users SET status='active' WHERE id=$1", [publicId]);
        const issued = await issue(email);
        expect(issued.identityMode).toBe("existing");
        const [authEmail, originalDelivery] = auth.inviteUserByEmail.mock.calls[0];
        const delivery = provider === "gmail.com" ? originalDelivery : { redirectTo: auth.signInWithOtp.mock.calls[0][0].options.emailRedirectTo };
        expect(authEmail).not.toBe(email);
        expect(authEmail).toContain(provider === "gmail.com" ? "+hvm-admin-" : "@auth.hortvitalmix.invalid");
        const token = new URL(delivery.redirectTo).searchParams.get("token")!;
        const accept = (cpf: string) =>
          AdminGovernanceService.acceptInvite(
            {
              token,
              cpf,
              password: "SyntheticLocal!Pass123",
              commandId: randomUUID(),
            },
            randomUUID(),
            ipHash,
          );
        expect(await accept("52998224725")).toMatchObject({
          status: "identity_conflict",
        });
        expect(auth.updateUserById).not.toHaveBeenCalled();
        const accepted = await accept("11144477735");
        expect(accepted, JSON.stringify(accepted)).toMatchObject({ status: "accepted" });
        if (accepted.status !== "accepted") throw new Error("ACCEPT_FAILED");
        expect(accepted.userId).not.toBe(publicId);
        expect(auth.updateUserById.mock.calls[0][0]).toBe(accepted.userId);
        expect(
          (
            await pool().query(
              "SELECT role_code FROM app_user_role_assignments WHERE user_id=$1 AND revoked_at IS NULL",
              [publicId],
            )
          ).rows,
        ).toEqual([{ role_code: publicRole }]);
        expect(
          (
            await pool().query(
              "SELECT admin_user_id,person_id FROM app_admin_principals WHERE admin_user_id=$1",
              [accepted.userId],
            )
          ).rows,
        ).toEqual([{ admin_user_id: accepted.userId, person_id: personId }]);
        await expect(
          pool().query(
            "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'platform_admin')",
            [publicId],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await expect(
          pool().query(
            "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'consumer')",
            [accepted.userId],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await expect(
          pool().query(
            "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'platform_super_admin')",
            [accepted.userId],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        // Remove only these synthetic credentials before the next CPF fixture.
        await pool().query("DELETE FROM app_admin_principals WHERE admin_user_id=$1", [accepted.userId]);
        await pool().query("DELETE FROM auth.users WHERE id=ANY($1::uuid[])", [
          [accepted.userId, publicId],
        ]);
      });
    }

    it("mantém convites simultâneos de admin e super independentes no mesmo Gmail", async () => {
      const email = randomUUID() + "@gmail.com";
      await issue(email, "platform_admin");
      await issue(email, "platform_super_admin");
      const ids: string[] = [];
      const cpf = syntheticCpf();
      const fullName = "Pessoa sintética " + randomUUID();
      for (const [, delivery] of auth.inviteUserByEmail.mock.calls) {
        const accepted = await AdminGovernanceService.acceptInvite(
          {
            token: new URL(delivery.redirectTo).searchParams.get("token")!,
            fullName,
            cpf,
            phone: "+5569988888888",
            password: "SyntheticLocal!Pass123",
            commandId: randomUUID(),
          },
          randomUUID(),
          ipHash,
        );
        expect(accepted.status, JSON.stringify(accepted)).toBe("accepted");
        if (accepted.status !== "accepted") throw new Error("ACCEPT_FAILED");
        ids.push(accepted.userId);
      }
      expect(new Set(ids).size).toBe(2);
      const roles = await pool().query(
        "SELECT user_id,role_code FROM app_user_role_assignments WHERE user_id=ANY($1::uuid[]) AND revoked_at IS NULL",
        [ids],
      );
      expect(roles.rows).toEqual(
        expect.arrayContaining([
          { user_id: ids[0], role_code: "platform_admin" },
          { user_id: ids[1], role_code: "platform_super_admin" },
        ]),
      );
      // Deleting principals first avoids a synthetic person-reference FK.
      await pool().query(
        "DELETE FROM app_admin_principals WHERE admin_user_id=ANY($1::uuid[])",
        [ids],
      );
      await pool().query("DELETE FROM auth.users WHERE id=ANY($1::uuid[])", [
        ids,
      ]);
    });

    it("recupera o histórico arquivado sem reativar links nem esconder pendentes antigos", async () => {
      const pending = [];
      for (let index = 0; index < 105; index++)
        pending.push(await seedInvite());
      const removed = await seedInvite();
      await remove(removed, 1);
      const visible = await AdminGovernanceService.listInvites(
        actorId,
        "platform_admin",
      );
      expect(visible).toHaveLength(105);
      expect(visible.map((invite) => invite.id)).toEqual(
        expect.arrayContaining(pending),
      );
      const history = await AdminGovernanceService.listInvites(
        actorId,
        "platform_admin",
        true,
      );
      expect(history).toHaveLength(106);
      expect(history.find((invite) => invite.id === removed)).toMatchObject({
        archived: true,
      });
    });

    it("não altera a senha ao aceitar convite antigo ligado a um consumidor", async () => {
      const issued = await issue();
      const token = new URL(
        auth.signInWithOtp.mock.calls[0]?.[0].options.emailRedirectTo ?? auth.inviteUserByEmail.mock.calls[0][1].redirectTo,
      ).searchParams.get("token")!;
      const credential = (
        await pool().query(
          "SELECT auth_user_id FROM app_admin_invites WHERE id=$1",
          [issued.id],
        )
      ).rows[0].auth_user_id;
      await pool().query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'consumer')",
        [credential],
      );
      expect(
        await AdminGovernanceService.acceptInvite(
          {
            token,
            cpf: "11144477735",
            fullName: "Teste local",
            phone: "+5569988888888",
            password: "SyntheticLocal!Pass123",
            commandId: randomUUID(),
          },
          randomUUID(),
          ipHash,
        ),
      ).toMatchObject({ status: "identity_conflict" });
      expect(auth.updateUserById).not.toHaveBeenCalled();
    });

    it("arquiva o convite aceito preservando Auth, perfil e poderes administrativos", async () => {
      const issued = await issue();
      const token = new URL(
        auth.signInWithOtp.mock.calls[0]?.[0].options.emailRedirectTo ?? auth.inviteUserByEmail.mock.calls[0][1].redirectTo,
      ).searchParams.get("token")!;
      const accepted = await AdminGovernanceService.acceptInvite(
        {
          token,
          fullName: "Administrador sintético local",
          cpf: "52998224725",
          phone: "+5569999999999",
          password: "SyntheticLocal!Pass123",
          commandId: randomUUID(),
        },
        randomUUID(),
        ipHash,
      );
      expect(accepted.status, JSON.stringify(accepted)).toBe("accepted");
      if (accepted.status !== "accepted")
        throw new Error("SYNTHETIC_ACCEPT_FAILED");
      const current = await pool().query(
        "SELECT revision FROM app_admin_invites WHERE id=$1",
        [issued.id],
      );
      expect(await remove(issued.id, current.rows[0].revision)).toEqual({
        status: "deleted",
      });
      expect(auth.deleteUser).not.toHaveBeenCalled();
      expect(
        (
          await pool().query("SELECT 1 FROM auth.users WHERE id=$1", [
            accepted.userId,
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await pool().query(
            "SELECT 1 FROM app_admin_principals WHERE admin_user_id=$1",
            [accepted.userId],
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await pool().query(
            "SELECT 1 FROM app_account_profiles WHERE user_id=$1",
            [accepted.userId],
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await pool().query(
            "SELECT 1 FROM app_user_role_assignments WHERE user_id=$1 AND revoked_at IS NULL",
            [accepted.userId],
          )
        ).rowCount,
      ).toBe(1);
      expect(
        await AdminGovernanceService.listInvites(actorId, "platform_admin"),
      ).toEqual([]);
    });

    it("recusa convite alheio e revisão desatualizada sem mudanças persistidas", async () => {
      const foreign = await authUser();
      syntheticActors.push(foreign);
      const id = await seedInvite({ owner: foreign });
      expect(await remove(id, 1)).toEqual({ status: "forbidden" });
      expect(await remove(id, 99, "platform_super_admin")).toEqual({
        status: "conflict",
      });
      const current = await pool().query(
        "SELECT revision,invalidated_at FROM app_admin_invites WHERE id=$1",
        [id],
      );
      expect(current.rows[0]).toEqual({ revision: 1, invalidated_at: null });
      expect(
        (
          await pool().query(
            "SELECT 1 FROM app_audit_events WHERE target_id=$1",
            [id],
          )
        ).rowCount,
      ).toBe(0);
    });

    it("preserva a identidade pública se uma credencial do convite já estiver vinculada a uma conta real", async () => {
      const userId = await authUser();
      const personId = randomUUID();
      await pool().query(
        "INSERT INTO app_people(id,user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,'Consumidor sintético local','11144477735',$3,'+5569988888888')",
        [personId, userId, userId + "@example.invalid"],
      );
      await pool().query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'consumer')",
        [userId],
      );
      const id = await seedInvite();
      await pool().query(
        "UPDATE app_admin_invites SET auth_user_id=$2 WHERE id=$1",
        [id, userId],
      );
      expect(await remove(id, 1)).toEqual({
        status: "deleted",
        cleanupPending: false,
      });
      expect(auth.deleteUser).not.toHaveBeenCalled();
      expect(
        (await pool().query("SELECT 1 FROM auth.users WHERE id=$1", [userId]))
          .rowCount,
      ).toBe(1);
      expect(
        (await pool().query("SELECT 1 FROM app_people WHERE id=$1", [personId]))
          .rowCount,
      ).toBe(1);
      expect(
        (
          await pool().query(
            "SELECT 1 FROM app_account_profiles WHERE user_id=$1 AND role_code='consumer'",
            [userId],
          )
        ).rowCount,
      ).toBe(1);
    });

    it("limpa apenas finalizados do emissor e repete o comando sem duplicar auditoria", async () => {
      const pending = await seedInvite();
      const finished = [
        await seedInvite({ accepted: true }),
        await seedInvite({ expired: true }),
        await seedInvite({ invalidated: true }),
      ];
      const foreign = await authUser();
      syntheticActors.push(foreign);
      const foreignInvite = await seedInvite({
        accepted: true,
        owner: foreign,
      });
      const commandId = randomUUID();
      const clear = () =>
        AdminGovernanceService.clearInviteHistory(
          { commandId },
          actorId,
          "platform_admin",
          randomUUID(),
          ipHash,
        );
      expect(await clear()).toEqual({ status: "cleared", count: 3 });
      expect(await clear()).toEqual({ status: "cleared", count: 3 });
      expect(
        (
          await AdminGovernanceService.listInvites(actorId, "platform_admin")
        ).map((row) => row.id),
      ).toEqual([pending]);
      expect(
        (
          await AdminGovernanceService.listInvites(foreign, "platform_admin")
        ).map((row) => row.id),
      ).toEqual([foreignInvite]);
      expect(
        (
          await pool().query(
            "SELECT 1 FROM app_admin_invites WHERE id=ANY($1::uuid[])",
            [finished],
          )
        ).rowCount,
      ).toBe(3);
      expect(
        (
          await pool().query(
            "SELECT 1 FROM app_audit_events WHERE target_id=ANY($1::uuid[]) AND action='admin.invite.archived'",
            [finished],
          )
        ).rowCount,
      ).toBe(3);
      expect(
        (
          await pool().query(
            "SELECT 1 FROM app_audit_events WHERE command_id=$1",
            [commandId],
          )
        ).rowCount,
      ).toBe(1);
      expect(auth.deleteUser).not.toHaveBeenCalled();
    });

    it("tenta novamente a limpeza Auth que falhou antes de enviar novo convite", async () => {
      const email = randomUUID() + "@example.invalid";
      const first = await issue(email);
      auth.deleteUser.mockResolvedValueOnce({ error: { status: 503 } });
      expect(await remove(first.id, first.revision)).toEqual({
        status: "deleted",
        cleanupPending: true,
      });
      const second = await issue(email);
      expect(second.id).not.toBe(first.id);
      expect(auth.deleteUser).toHaveBeenCalledTimes(2);
      expect(
        (await pool().query("SELECT 1 FROM auth.users WHERE id=(SELECT auth_user_id FROM app_admin_invites WHERE email=$1 AND invalidated_at IS NULL)", [email]))
          .rowCount,
      ).toBe(1);
    });

    it("mantém o convite invisível durante a entrega e serializa emissões concorrentes", async () => {
      let releaseDelivery!: () => void;
      let deliveryStarted!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseDelivery = resolve;
      });
      const started = new Promise<void>((resolve) => {
        deliveryStarted = resolve;
      });
      const deliver = auth.inviteUserByEmail.getMockImplementation()!;
      auth.inviteUserByEmail.mockImplementation(async (...args) => {
        deliveryStarted();
        await gate;
        return deliver(...args);
      });
      const email = randomUUID() + "@example.invalid";
      const creation = issue(email);
      await started;
      let competingSettled = false;
      const competing = AdminGovernanceService.createInvite(
        {
          email,
          targetRole: "platform_admin",
          sectors: ["document_verification"],
          commandId: randomUUID(),
        },
        actorId,
        "platform_super_admin",
        [],
        randomUUID(),
        ipHash,
        "https://hortvitalmix.vercel.app",
      ).then((result) => {
        competingSettled = true;
        return result;
      });
      try {
        expect(
          await AdminGovernanceService.listInvites(actorId, "platform_admin"),
        ).toEqual([]);
        expect(
          (
            await pool().query(
              "SELECT 1 FROM app_admin_invites WHERE email=$1",
              [email],
            )
          ).rowCount,
        ).toBe(0);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(competingSettled).toBe(false);
      } finally {
        releaseDelivery();
      }
      const first = await creation;
      expect(await competing).toMatchObject({ status: "conflict" });
      expect(auth.inviteUserByEmail).toHaveBeenCalledTimes(1);
      expect(await remove(first.id, first.revision)).toEqual({
        status: "deleted",
        cleanupPending: false,
      });
      const replacement = await issue(email);
      expect(replacement.id).not.toBe(first.id);
      expect(auth.inviteUserByEmail).toHaveBeenCalledTimes(2);
    });
  },
);

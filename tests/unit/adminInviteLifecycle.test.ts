import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
  deleteUser: vi.fn(),
  getUserById: vi.fn(),
}));

vi.mock("../../server/db/pool.ts", () => ({
  dbPool: { query: mock.query, connect: mock.connect },
}));
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        deleteUser: mock.deleteUser,
        getUserById: mock.getUserById,
      },
    },
  },
  supabasePublic: null,
  createSupabasePublicClient: vi.fn(),
}));

import { AdminGovernanceService } from "../../server/services/AdminGovernanceService.ts";

const actorId = "11111111-1111-4111-8111-111111111111";
const otherActorId = "22222222-2222-4222-8222-222222222222";
const inviteId = "33333333-3333-4333-8333-333333333333";
const authUserId = "44444444-4444-4444-8444-444444444444";
const requestId = "55555555-5555-4555-8555-555555555555";
const commandId = "66666666-6666-4666-8666-666666666666";
const ipHash = "a".repeat(64);

type InviteRow = {
  id: string;
  email: string;
  auth_email: string;
  invited_by: string;
  auth_user_id: string | null;
  target_role: "platform_admin" | "platform_super_admin";
  revision: number;
  is_accepted: boolean;
  invalidated_at: string | null;
  expires_at: string;
};

function invite(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: inviteId,
    email: "administrador@example.invalid",
    auth_email: "administrador@example.invalid",
    invited_by: actorId,
    auth_user_id: authUserId,
    target_role: "platform_admin",
    revision: 3,
    is_accepted: false,
    invalidated_at: null,
    expires_at: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

type AuditEvent = {
  action: string;
  targetId: string | null;
  commandId: string | null;
  payload_after: { count?: number };
};
let rows: InviteRow[];
let events: AuditEvent[];
let registeredUser: boolean;

const result = (items: unknown[] = []) => ({
  rows: items,
  rowCount: items.length,
});
const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").trim();

function auditEvents(action: string) {
  return events.filter((event) => event.action === action);
}

function recordedSql() {
  return mock.query.mock.calls.map(([sql]) => normalizeSql(String(sql)));
}

beforeEach(() => {
  vi.clearAllMocks();
  rows = [invite()];
  events = [];
  registeredUser = false;
  mock.connect.mockResolvedValue({ query: mock.query, release: mock.release });
  mock.deleteUser.mockResolvedValue({ data: { user: null }, error: null });
  mock.getUserById.mockResolvedValue({
    data: {
      user: {
        id: authUserId,
        email: "administrador@example.invalid",
        user_metadata: { hvm_admin_invite_id: inviteId },
      },
    },
    error: null,
  });
  mock.query.mockImplementation(
    async (source: string, values: unknown[] = []) => {
      const sql = normalizeSql(source);
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.includes("pg_advisory"))
        return result();
      if (sql.startsWith("INSERT INTO public.app_audit_events")) {
        events.push({
          action: String(values[3]),
          targetId: values[5] == null ? null : String(values[5]),
          commandId: values[8] == null ? null : String(values[8]),
          payload_after: JSON.parse(String(values[6])),
        });
        return result();
      }
      if (/^SELECT (1|payload_after) FROM public.app_audit_events/.test(sql)) {
        return result(
          events.filter(
            (event) =>
              event.commandId !== null &&
              values.includes(event.commandId) &&
              sql.includes("'" + event.action + "'"),
          ),
        );
      }
      if (
        sql.startsWith("SELECT") &&
        sql.includes("FROM public.app_admin_invites")
      ) {
        let matching = rows;
        if (values.includes(inviteId))
          matching = matching.filter((row) => row.id === inviteId);
        if (sql.includes("lower(i.email)=$1"))
          matching = matching.filter((row) => row.email === values[0]);
        if (sql.includes("NOT EXISTS") && sql.includes("app_admin_principals"))
          matching = matching.filter(
            (row) => !row.is_accepted && row.invalidated_at && row.auth_user_id,
          );
        if (
          sql.includes("expires_at<=now()") ||
          sql.includes("expires_at <= now()")
        )
          matching = matching.filter(
            (row) =>
              row.is_accepted ||
              row.invalidated_at ||
              Date.parse(row.expires_at) <= Date.now(),
          );
        if (
          (sql.includes("invited_by=$") || sql.includes("invited_by = $")) &&
          !values.includes("platform_super_admin")
        ) {
          const owner = values.find(
            (value) => value === actorId || value === otherActorId,
          );
          matching = matching.filter((row) => row.invited_by === owner);
        }
        if (sql.includes("admin.invite.archived"))
          matching = matching.filter(
            (row) =>
              !events.some(
                (event) =>
                  event.action === "admin.invite.archived" &&
                  event.targetId === row.id,
              ),
          );
        return result(
          matching.map((row) => ({ ...row, isolated: !registeredUser })),
        );
      }
      if (sql.startsWith("UPDATE public.app_admin_invites")) {
        const matching = rows.filter((row) => values.includes(row.id));
        for (const row of matching) {
          if (
            sql.includes("invalidated_at=clock_timestamp()") ||
            sql.includes("invalidated_at = clock_timestamp()")
          ) {
            row.invalidated_at = "2026-10-08T12:00:00.000Z";
            row.revision += 1;
          }
          if (
            sql.includes("auth_user_id=NULL") ||
            sql.includes("auth_user_id = NULL")
          )
            row.auth_user_id = null;
        }
        return result(matching.map((row) => ({ ...row })));
      }
      throw new Error("Unhandled SQL in invite lifecycle test: " + sql);
    },
  );
});

function remove(
  role: "platform_admin" | "platform_super_admin" = "platform_admin",
  revision = 3,
) {
  return AdminGovernanceService.removeInvite(
    inviteId,
    { expectedRevision: revision, commandId },
    actorId,
    role,
    requestId,
    ipHash,
  );
}

describe("Ciclo de vida dos convites administrativos", () => {
  it("cancela o convite próprio, remove a credencial provisória e preserva a auditoria", async () => {
    expect(await remove()).toEqual({
      status: "deleted",
      cleanupPending: false,
    });
    expect(rows[0].invalidated_at).not.toBeNull();
    expect(mock.deleteUser).toHaveBeenCalledWith(authUserId);
    expect(auditEvents("admin.invite.archived")).toHaveLength(1);
    expect(auditEvents("admin.invite.archived")[0].targetId).toBe(inviteId);
    expect(
      recordedSql().some((sql) =>
        /^(DELETE|TRUNCATE|UPDATE).*app_audit_events/.test(sql),
      ),
    ).toBe(false);
    expect(mock.release).toHaveBeenCalled();
  });

  it("impede que um administrador remova o convite emitido por outra pessoa", async () => {
    rows = [invite({ invited_by: otherActorId })];
    expect(await remove()).toEqual({ status: "forbidden" });
    expect(rows[0].invalidated_at).toBeNull();
    expect(mock.deleteUser).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("permite ao super administrador gerenciar o convite de outro emissor", async () => {
    rows = [invite({ invited_by: otherActorId })];
    expect(await remove("platform_super_admin")).toMatchObject({
      status: "deleted",
    });
    expect(auditEvents("admin.invite.archived")).toHaveLength(1);
  });

  it("recusa uma revisão desatualizada sem invalidar o convite", async () => {
    expect(await remove("platform_admin", 2)).toEqual({ status: "conflict" });
    expect(rows[0].invalidated_at).toBeNull();
    expect(mock.deleteUser).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("remove do histórico um convite aceito sem excluir o acesso ativado", async () => {
    rows = [invite({ is_accepted: true })];
    expect(await remove()).toMatchObject({ status: "deleted" });
    expect(rows[0].is_accepted).toBe(true);
    expect(rows[0].invalidated_at).toBeNull();
    expect(mock.deleteUser).not.toHaveBeenCalled();
    expect(auditEvents("admin.invite.archived")).toHaveLength(1);
  });

  it("repete o mesmo comando sem excluir novamente a credencial nem duplicar auditoria", async () => {
    expect(await remove()).toMatchObject({ status: "deleted" });
    expect(await remove()).toMatchObject({ status: "deleted" });
    expect(mock.deleteUser).toHaveBeenCalledTimes(1);
    expect(auditEvents("admin.invite.archived")).toHaveLength(1);
  });

  it("informa quando o convite não existe", async () => {
    rows = [];
    expect(await remove()).toEqual({ status: "not_found" });
    expect(mock.deleteUser).not.toHaveBeenCalled();
  });

  it("não exclui um usuário que já possui identidade ou perfil real", async () => {
    registeredUser = true;
    expect(await remove()).toMatchObject({ status: "deleted" });
    expect(mock.deleteUser).not.toHaveBeenCalled();
  });

  it("mantém o cancelamento e sinaliza limpeza pendente quando Auth falha", async () => {
    mock.deleteUser.mockResolvedValue({ error: { status: 503 } });
    expect(await remove()).toEqual({ status: "deleted", cleanupPending: true });
    expect(rows[0].invalidated_at).not.toBeNull();
    expect(rows[0].auth_user_id).toBe(authUserId);
    expect(auditEvents("admin.invite.archived")).toHaveLength(1);
  });

  it("considera credencial Auth já ausente como limpeza concluída", async () => {
    mock.deleteUser.mockResolvedValue({ error: { status: 404 } });
    expect(await remove()).toEqual({
      status: "deleted",
      cleanupPending: false,
    });
    expect(rows[0].auth_user_id).toBeNull();
  });

  it("arquiva um convite já invalidado sem alterar a revisão novamente", async () => {
    rows = [
      invite({
        invalidated_at: "2026-10-07T12:00:00.000Z",
        auth_user_id: null,
      }),
    ];
    expect(await remove()).toMatchObject({ status: "deleted" });
    expect(rows[0].revision).toBe(3);
    expect(mock.deleteUser).not.toHaveBeenCalled();
  });

  it("limpa somente convites finalizados do administrador, preservando pendentes e convites alheios", async () => {
    rows = [
      invite(),
      invite({ id: "77777777-7777-4777-8777-777777777777", is_accepted: true }),
      invite({
        id: "88888888-8888-4888-8888-888888888888",
        expires_at: "2025-01-01T00:00:00.000Z",
      }),
      invite({
        id: "99999999-9999-4999-8999-999999999999",
        invalidated_at: "2026-10-07T12:00:00.000Z",
      }),
      invite({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        is_accepted: true,
        invited_by: otherActorId,
      }),
    ];
    expect(
      await AdminGovernanceService.clearInviteHistory(
        { commandId },
        actorId,
        "platform_admin",
        requestId,
        ipHash,
      ),
    ).toEqual({ status: "cleared", count: 3 });
    expect(
      auditEvents("admin.invite.archived").map((event) => event.targetId),
    ).toEqual(rows.slice(1, 4).map((row) => row.id));
    expect(
      auditEvents("admin.invite.archived").every(
        (event) => event.commandId === null,
      ),
    ).toBe(true);
    expect(auditEvents("admin.invite.history_cleared")).toHaveLength(1);
    expect(mock.deleteUser).not.toHaveBeenCalled();
    expect(rows[0].invalidated_at).toBeNull();
  });

  it("a limpeza do super administrador inclui finalizados de outros emissores", async () => {
    rows = [
      invite(),
      invite({
        id: "77777777-7777-4777-8777-777777777777",
        is_accepted: true,
        invited_by: otherActorId,
      }),
    ];
    expect(
      await AdminGovernanceService.clearInviteHistory(
        { commandId },
        actorId,
        "platform_super_admin",
        requestId,
        ipHash,
      ),
    ).toEqual({ status: "cleared", count: 1 });
    expect(auditEvents("admin.invite.archived")[0].targetId).toBe(rows[1].id);
  });

  it("repetir limpeza retorna o total original sem duplicar registros de auditoria", async () => {
    rows = [invite({ is_accepted: true })];
    const clear = () =>
      AdminGovernanceService.clearInviteHistory(
        { commandId },
        actorId,
        "platform_admin",
        requestId,
        ipHash,
      );
    expect(await clear()).toEqual({ status: "cleared", count: 1 });
    expect(await clear()).toEqual({ status: "cleared", count: 1 });
    expect(auditEvents("admin.invite.archived")).toHaveLength(1);
    expect(auditEvents("admin.invite.history_cleared")).toHaveLength(1);
  });
});

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  audit: vi.fn(),
  identity: vi.fn(),
  storage: vi.fn(),
}));
vi.mock("../../server/config/runtime.ts", async (original) => {
  const actual =
    await original<typeof import("../../server/config/runtime.ts")>();
  return {
    ...actual,
    runtime: {
      ...actual.runtime,
      ipPepper: "synthetic-account-erasure-secret",
    },
  };
});
vi.mock("../../server/services/CommerceSupport.ts", async (original) => {
  const actual =
    await original<typeof import("../../server/services/CommerceSupport.ts")>();
  return {
    ...actual,
    commerceIdentity: state.identity,
    commerceAudit: state.audit,
    commerceTransaction: (work: (client: unknown) => Promise<unknown>) =>
      work({ query: state.query }),
  };
});
vi.mock("../../server/services/StorageDeletionQueueService.ts", () => ({
  drainStorageDeletionQueue: state.storage,
}));
import { profilePrivacyRouter } from "../../server/routes/profilePrivacyRoutes.ts";
import { subscriptionRouter } from "../../server/routes/subscriptionRoutes.ts";
import { issueRecentAuthProof } from "../../server/security/recentAuth.ts";
import { CommerceError } from "../../server/services/CommerceSupport.ts";

const uid = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const access =
  "synthetic." +
  Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url") +
  ".synthetic";
function app(role = "consumer", authenticated = true) {
  const value = express();
  value.use(express.json());
  value.use((req, _res, next) => {
    if (authenticated)
      req.actor = {
        userId: uid,
        email: "synthetic@example.invalid",
        roles: [role],
        personId: null,
        fullName: null,
      };
    next();
  });
  value.use("/v1", profilePrivacyRouter, subscriptionRouter);
  return value;
}
const input = () => ({
  commandId: crypto.randomUUID(),
  expectedUserId: uid,
  expectedRole: "consumer",
  confirmation: "EXCLUIR MINHA CONTA",
  acknowledgeLoss: true,
  acknowledgeRetention: true,
});
const proof = (owner = uid, time = Date.now()) =>
  issueRecentAuthProof(owner, access, time);
const erase = (value = app(), receipt = proof()) =>
  request(value)
    .delete("/v1/account")
    .set("Sec-Fetch-Site", "same-origin")
    .set(
      "Cookie",
      `hvm_access=${access}; hvm_portal_role=consumer; hvm_reauth=${receipt}`,
    );
beforeEach(() => {
  vi.clearAllMocks();
  state.query.mockResolvedValue({ rows: [] });
  state.identity.mockResolvedValue({ person_id: other, roles: ["consumer"] });
  state.audit.mockResolvedValue(undefined);
  state.storage.mockResolvedValue(undefined);
});
describe("Autoexclusão e identidade da contratação", () => {
  it("falha de limpeza externa preserva a fila e confirma a identidade já excluída", async () => {
    state.storage.mockRejectedValueOnce(
      new Error("synthetic storage unavailable"),
    );
    const res = await erase().send(input());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("deleted");
    expect(res.headers["set-cookie"]).toHaveLength(4);
  });
  it("remove somente a identidade pública confirmada e encerra seus cookies após commit", async () => {
    const body = input(),
      res = await erase().send(body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("deleted");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(state.identity).toHaveBeenCalledWith(
      expect.anything(),
      uid,
      "consumer",
    );
    expect(state.query).toHaveBeenCalledWith(
      "SELECT public.erase_public_account($1,$2,$3)",
      [uid, "consumer", body.commandId],
    );
    expect(state.audit).toHaveBeenCalledWith(
      expect.anything(),
      uid,
      "consumer",
      "account.self_deleted",
      "app_users",
      uid,
      expect.anything(),
      expect.anything(),
      body.commandId,
    );
    expect(state.storage).toHaveBeenCalledOnce();
    expect(res.headers["set-cookie"]).toHaveLength(4);
  });
  it.each(["identity", "role"])(
    "troca de %s não exclui a conta agora autenticada",
    async (kind) => {
      const body = {
        ...input(),
        ...(kind === "identity"
          ? { expectedUserId: other }
          : { expectedRole: "producer" }),
      };
      const res = await erase().send(body);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("SESSION_CHANGED");
      expect(state.query).not.toHaveBeenCalled();
    },
  );
  it.each(["absent", "expired", "other"])(
    "confirmação de senha %s não autoriza exclusão",
    async (kind) => {
      const receipt =
        kind === "absent"
          ? ""
          : kind === "expired"
            ? proof(uid, Date.now() - 16 * 60 * 1000)
            : proof(other);
      const res = await erase(app(), receipt).send(input());
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("RECENT_AUTH_REQUIRED");
      expect(state.query).not.toHaveBeenCalled();
    },
  );
  it("nega visitante e origem externa antes de tocar o banco", async () => {
    expect((await erase(app("consumer", false)).send(input())).status).toBe(
      401,
    );
    expect(
      (
        await erase()
          .set("Origin", "https://attacker.invalid")
          .set("Sec-Fetch-Site", "cross-site")
          .send(input())
      ).status,
    ).toBe(403);
    expect(state.query).not.toHaveBeenCalled();
  });
  it("nega perda de consentimento e falha canônica sem encerrar a sessão", async () => {
    expect(
      (await erase().send({ ...input(), acknowledgeLoss: false })).status,
    ).toBe(422);
    state.identity.mockRejectedValueOnce(
      new CommerceError("AUTH_REQUIRED", 401),
    );
    const res = await erase().send(input());
    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(state.query).not.toHaveBeenCalled();
  });
  it.each(["platform_admin", "platform_super_admin"])(
    "%s não contrata nem cancela como titular público",
    async (role) => {
      const value = app(role);
      for (const path of ["/subscriptions", `/subscriptions/${other}/cancel`]) {
        const res = await request(value)
          .post("/v1" + path)
          .set("Sec-Fetch-Site", "same-origin")
          .send({});
        expect(res.status).toBe(403);
        expect(res.body.error).toBe("FORBIDDEN");
      }
      const res = await request(value)
        .delete("/v1/account")
        .set("Sec-Fetch-Site", "same-origin")
        .send({ ...input(), expectedRole: role });
      expect(res.status).toBe(403);
      expect(state.query).not.toHaveBeenCalled();
    },
  );
});

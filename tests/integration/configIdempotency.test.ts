import { afterAll, beforeAll, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { dbPool } from "../../server/db/pool";
import { ConfigurationService, type ActorContext } from "../../server/services/ConfigurationService";
import { createEphemeralIdentity } from "../helpers/identity";
import { integrationDescribe, integrationIt } from "../helpers/integration";

integrationDescribe("ConfigurationService — idempotência", () => {
  let actor: ActorContext;
  let cleanup: () => Promise<void>;
  let originalSlogan = "";

  beforeAll(async () => {
    const identity = await createEphemeralIdentity();
    cleanup = identity.cleanup;
    actor = {
      userId: identity.userId,
      role: "platform_super_admin",
      sessionIssuedAt: new Date().toISOString(),
    };
    originalSlogan = (await ConfigurationService.getAdminConfig())!.slogan;
  });

  afterAll(async () => {
    if (dbPool && originalSlogan)
      await dbPool.query(
        "UPDATE public.app_global_config SET slogan=$1 WHERE singleton_guard=true",
        [originalSlogan],
      );
    await cleanup?.();
  });

  integrationIt("mesmo commandId + payload retorna idempotent_replay", async () => {
    const current = await ConfigurationService.getAdminConfig();
    const commandId = randomUUID();
    const payload = { slogan: `Idempotente ${Date.now()}` };

    const first = await ConfigurationService.updateConfig(
      { expectedRevision: current!.revision, commandId, payload },
      actor,
      randomUUID(),
      "a".repeat(64),
    );
    expect(first.status).toBe("success");

    const second = await ConfigurationService.updateConfig(
      { expectedRevision: current!.revision, commandId, payload },
      actor,
      randomUUID(),
      "a".repeat(64),
    );
    expect(second.status).toBe("idempotent_replay");

    const after = await ConfigurationService.getAdminConfig();
    const appliedRevision = first.status === "success" ? first.revision : 0;
    expect(after!.revision).toBe(appliedRevision);
  });

  integrationIt("mesmo commandId + payload diferente é rejeitado", async () => {
    const current = await ConfigurationService.getAdminConfig();
    const commandId = randomUUID();

    const first = await ConfigurationService.updateConfig(
      {
        expectedRevision: current!.revision,
        commandId,
        payload: { slogan: `Primeiro slogan ${Date.now()}` },
      },
      actor,
      randomUUID(),
      "a".repeat(64),
    );
    expect(first.status).toBe("success");

    const second = await ConfigurationService.updateConfig(
      {
        expectedRevision: current!.revision + 1,
        commandId,
        payload: { slogan: `Slogan diferente ${Date.now()}` },
      },
      actor,
      randomUUID(),
      "a".repeat(64),
    );
    expect(second.status).toBe("idempotent_mismatch");
  });

  integrationIt("commandIds distintos aplicam duas mutações", async () => {
    const before = await ConfigurationService.getAdminConfig();
    const r1 = await ConfigurationService.updateConfig(
      {
        expectedRevision: before!.revision,
        commandId: randomUUID(),
        payload: { slogan: `Distinto A ${Date.now()}` },
      },
      actor,
      randomUUID(),
      "a".repeat(64),
    );
    expect(r1.status).toBe("success");

    const mid = await ConfigurationService.getAdminConfig();
    const r2 = await ConfigurationService.updateConfig(
      {
        expectedRevision: mid!.revision,
        commandId: randomUUID(),
        payload: { slogan: `Distinto B ${Date.now()}` },
      },
      actor,
      randomUUID(),
      "a".repeat(64),
    );
    expect(r2.status).toBe("success");

    const after = await ConfigurationService.getAdminConfig();
    expect(after!.revision).toBe(before!.revision + 2);
  });
});

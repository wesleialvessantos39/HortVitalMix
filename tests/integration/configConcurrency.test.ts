import { afterAll, beforeAll, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { dbPool } from "../../server/db/pool";
import { ConfigurationService, type ActorContext } from "../../server/services/ConfigurationService";
import { createEphemeralIdentity } from "../helpers/identity";
import { integrationDescribe, integrationIt } from "../helpers/integration";

integrationDescribe("ConfigurationService — concorrência", () => {
  let actor: ActorContext;
  let cleanup: () => Promise<void>;
  let originalSlogan = "";

  beforeAll(async () => {
    const identity = await createEphemeralIdentity({ role: "producer" });
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

  integrationIt("duas mutações concorrentes: 1 sucesso + 1 conflito", async () => {
    const current = await ConfigurationService.getAdminConfig();
    expect(current).toBeTruthy();
    const baseRevision = current!.revision;

    const [a, b] = await Promise.all([
      ConfigurationService.updateConfig(
        {
          expectedRevision: baseRevision,
          commandId: randomUUID(),
          payload: { slogan: "Slogan A concorrente válido." },
        },
        actor,
        randomUUID(),
        "a".repeat(64),
      ),
      ConfigurationService.updateConfig(
        {
          expectedRevision: baseRevision,
          commandId: randomUUID(),
          payload: { slogan: "Slogan B concorrente válido." },
        },
        actor,
        randomUUID(),
        "b".repeat(64),
      ),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toContain("success");
    expect(statuses).toContain("conflict");

    const conflict = (a.status === "conflict" ? a : b) as {
      status: "conflict";
      currentRevision: number;
    };
    expect(conflict.currentRevision).toBe(baseRevision + 1);
  });

  integrationIt("revisão desatualizada retorna conflict sem aplicar", async () => {
    const current = await ConfigurationService.getAdminConfig();
    const beforeSlogan = current!.slogan;
    const result = await ConfigurationService.updateConfig(
      {
        expectedRevision: Math.max(0, current!.revision - 1),
        commandId: randomUUID(),
        payload: { slogan: "Nunca aplicado, revisão obsoleta." },
      },
      actor,
      randomUUID(),
      "a".repeat(64),
    );

    expect(result.status).toBe("conflict");
    const after = await ConfigurationService.getAdminConfig();
    expect(after!.revision).toBe(current!.revision);
    expect(after!.slogan).toBe(beforeSlogan);
  });
});

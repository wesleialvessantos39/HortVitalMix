import { afterAll, beforeAll, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { dbPool } from "../../server/db/pool";
import { ConfigurationService, type ActorContext } from "../../server/services/ConfigurationService";
import { ReauthRequiredError } from "../../server/services/reauthService";
import { createEphemeralIdentity } from "../helpers/identity";
import { integrationDescribe, integrationIt } from "../helpers/integration";

integrationDescribe("ConfigurationService — reautenticação", () => {
  let userId = "";
  let cleanup: () => Promise<void>;
  let originalSlogan = "";

  beforeAll(async () => {
    const identity = await createEphemeralIdentity();
    userId = identity.userId;
    cleanup = identity.cleanup;
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

  integrationIt("sessão antiga (>15 min) exige reautenticação", async () => {
    const actor: ActorContext = {
      userId,
      role: "platform_super_admin",
      sessionIssuedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    };
    const current = await ConfigurationService.getAdminConfig();

    await expect(
      ConfigurationService.updateConfig(
        {
          expectedRevision: current!.revision,
          commandId: randomUUID(),
          payload: { slogan: "Tentativa com sessão antiga válida." },
        },
        actor,
        randomUUID(),
        "a".repeat(64),
      ),
    ).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  integrationIt("sessão recente (<15 min) é aceita", async () => {
    const actor: ActorContext = {
      userId,
      role: "platform_super_admin",
      sessionIssuedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };
    const current = await ConfigurationService.getAdminConfig();
    const result = await ConfigurationService.updateConfig(
      {
        expectedRevision: current!.revision,
        commandId: randomUUID(),
        payload: { slogan: `Sessão recente ${Date.now()}` },
      },
      actor,
      randomUUID(),
      "a".repeat(64),
    );
    expect(result.status).toBe("success");
  });

  integrationIt("timestamp futuro exige reautenticação", async () => {
    const actor: ActorContext = {
      userId,
      role: "platform_super_admin",
      sessionIssuedAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const current = await ConfigurationService.getAdminConfig();

    await expect(
      ConfigurationService.updateConfig(
        {
          expectedRevision: current!.revision,
          commandId: randomUUID(),
          payload: {},
        },
        actor,
        randomUUID(),
        "a".repeat(64),
      ),
    ).rejects.toBeInstanceOf(ReauthRequiredError);
  });
});

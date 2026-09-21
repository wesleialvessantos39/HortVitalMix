import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import { ConfigurationService } from "../../server/services/ConfigurationService";
import { ReauthRequiredError } from "../../server/services/reauthService";
import {
  freshActor,
  integrationDescribe,
  integrationIt,
  requestContext,
} from "./configTestSupport";

integrationDescribe("ConfigurationService — reautenticação", () => {
  integrationIt("rejeita sessão mais antiga que 15 minutos", async () => {
    const current = await ConfigurationService.getAdminConfig();
    const actor = freshActor();
    actor.sessionIssuedAt = new Date(Date.now() - 16 * 60_000).toISOString();

    await expect(
      ConfigurationService.updateConfig(
        {
          expectedRevision: current!.revision,
          commandId: randomUUID(),
          payload: {},
        },
        actor,
        requestContext().requestId,
        requestContext().clientIpHash,
      ),
    ).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  integrationIt("rejeita sessão emitida no futuro", async () => {
    const current = await ConfigurationService.getAdminConfig();
    const actor = freshActor();
    actor.sessionIssuedAt = new Date(Date.now() + 60_000).toISOString();

    await expect(
      ConfigurationService.updateConfig(
        {
          expectedRevision: current!.revision,
          commandId: randomUUID(),
          payload: {},
        },
        actor,
        requestContext().requestId,
        requestContext().clientIpHash,
      ),
    ).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  integrationIt("aceita sessão recente sem criar UPDATE quando não há mudança", async () => {
    const current = await ConfigurationService.getAdminConfig();
    const result = await ConfigurationService.updateConfig(
      {
        expectedRevision: current!.revision,
        commandId: randomUUID(),
        payload: {},
      },
      freshActor(),
      requestContext().requestId,
      requestContext().clientIpHash,
    );
    expect(result).toEqual({
      status: "no_change",
      revision: current!.revision,
    });
  });
});

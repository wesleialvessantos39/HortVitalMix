import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import { ConfigurationService } from "../../server/services/ConfigurationService";
import {
  freshActor,
  integrationDescribe,
  integrationIt,
  requestContext,
} from "./configTestSupport";

integrationDescribe("ConfigurationService — concorrência", () => {
  integrationIt("uma mutação vence e a concorrente recebe conflito", async () => {
    const current = await ConfigurationService.getAdminConfig();
    expect(current).not.toBeNull();
    const base = current!;

    const a = ConfigurationService.updateConfig(
      {
        expectedRevision: base.revision,
        commandId: randomUUID(),
        payload: { slogan: base.slogan + " · T02-A" },
      },
      freshActor(),
      requestContext().requestId,
      requestContext().clientIpHash,
    );
    const b = ConfigurationService.updateConfig(
      {
        expectedRevision: base.revision,
        commandId: randomUUID(),
        payload: { slogan: base.slogan + " · T02-B" },
      },
      freshActor(),
      requestContext().requestId,
      requestContext().clientIpHash,
    );

    const results = await Promise.all([a, b]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "conflict",
      "success",
    ]);

    const after = await ConfigurationService.getAdminConfig();
    expect(after).not.toBeNull();
    await ConfigurationService.updateConfig(
      {
        expectedRevision: after!.revision,
        commandId: randomUUID(),
        payload: { slogan: base.slogan },
      },
      freshActor(),
      requestContext().requestId,
      requestContext().clientIpHash,
    );
  });
});

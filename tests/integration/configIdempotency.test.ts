import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import { ConfigurationService } from "../../server/services/ConfigurationService";
import {
  freshActor,
  integrationDescribe,
  integrationIt,
  requestContext,
} from "./configTestSupport";

integrationDescribe("ConfigurationService — idempotência", () => {
  integrationIt("replay não duplica mutação e payload divergente é rejeitado", async () => {
    const current = await ConfigurationService.getAdminConfig();
    expect(current).not.toBeNull();
    const base = current!;
    const commandId = randomUUID();
    const input = {
      expectedRevision: base.revision,
      commandId,
      payload: { slogan: base.slogan + " · T02-IDEM" },
    };

    const first = await ConfigurationService.updateConfig(
      input,
      freshActor(),
      requestContext().requestId,
      requestContext().clientIpHash,
    );
    expect(first.status).toBe("success");

    const replay = await ConfigurationService.updateConfig(
      input,
      freshActor(),
      requestContext().requestId,
      requestContext().clientIpHash,
    );
    expect(replay.status).toBe("idempotent_replay");

    const mismatch = await ConfigurationService.updateConfig(
      {
        ...input,
        payload: { slogan: base.slogan + " · OUTRO" },
      },
      freshActor(),
      requestContext().requestId,
      requestContext().clientIpHash,
    );
    expect(mismatch.status).toBe("idempotent_mismatch");

    const after = await ConfigurationService.getAdminConfig();
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

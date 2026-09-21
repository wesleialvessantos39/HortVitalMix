import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import { ConfigurationService } from "../../server/services/ConfigurationService";
import { dbPool } from "../../server/db/pool";
import {
  freshActor,
  integrationDescribe,
  integrationIt,
  requestContext,
} from "./configTestSupport";

integrationDescribe("ConfigurationService — auditoria", () => {
  integrationIt("cada UPDATE gera um evento único, redigido e imutável", async () => {
    expect(dbPool).not.toBeNull();
    const current = await ConfigurationService.getAdminConfig();
    expect(current).not.toBeNull();
    const base = current!;
    const commandId = randomUUID();
    const nextPhone = base.supportPhone ? null : "+5569999999999";
    const context = requestContext();

    const result = await ConfigurationService.updateConfig(
      {
        expectedRevision: base.revision,
        commandId,
        payload: { supportPhone: nextPhone },
      },
      freshActor(),
      context.requestId,
      context.clientIpHash,
    );
    expect(result.status).toBe("success");

    const audit = await dbPool!.query<{
      id: string;
      payload_before: unknown;
      payload_after: unknown;
    }>(
      "SELECT id,payload_before,payload_after FROM public.app_audit_events WHERE command_id=$1",
      [commandId],
    );
    expect(audit.rows).toHaveLength(1);
    const serialized = JSON.stringify(audit.rows[0]);
    if (base.supportPhone) expect(serialized).not.toContain(base.supportPhone);
    if (nextPhone) expect(serialized).not.toContain(nextPhone);

    await expect(
      dbPool!.query(
        "UPDATE public.app_audit_events SET actor_role='invalid' WHERE id=$1",
        [audit.rows[0].id],
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const after = await ConfigurationService.getAdminConfig();
    await ConfigurationService.updateConfig(
      {
        expectedRevision: after!.revision,
        commandId: randomUUID(),
        payload: { supportPhone: base.supportPhone },
      },
      freshActor(),
      requestContext().requestId,
      requestContext().clientIpHash,
    );
  });
});

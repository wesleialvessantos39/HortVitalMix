import { afterAll, beforeAll, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { dbPool } from "../../server/db/pool";
import { ConfigurationService, type ActorContext } from "../../server/services/ConfigurationService";
import { createEphemeralIdentity } from "../helpers/identity";
import { integrationDescribe, integrationIt } from "../helpers/integration";

integrationDescribe("ConfigurationService — auditoria", () => {
  let actor: ActorContext;
  let cleanup: () => Promise<void>;
  let originalPhone: string | null = null;
  let originalSlogan = "";

  beforeAll(async () => {
    const identity = await createEphemeralIdentity();
    cleanup = identity.cleanup;
    actor = {
      userId: identity.userId,
      role: "platform_super_admin",
      sessionIssuedAt: new Date().toISOString(),
    };
    const current = await ConfigurationService.getAdminConfig();
    originalPhone = current!.supportPhone;
    originalSlogan = current!.slogan;
  });

  afterAll(async () => {
    if (dbPool)
      await dbPool.query(
        "UPDATE public.app_global_config SET slogan=$1,support_phone=$2 WHERE singleton_guard=true",
        [originalSlogan, originalPhone],
      );
    await cleanup?.();
  });

  integrationIt("mutação bem-sucedida gera exatamente uma linha de auditoria", async () => {
    const current = await ConfigurationService.getAdminConfig();
    const commandId = randomUUID();

    const before = await dbPool!.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM public.app_audit_events WHERE target_entity='app_global_config' AND command_id=$1",
      [commandId],
    );
    expect(before.rows[0].count).toBe("0");

    const result = await ConfigurationService.updateConfig(
      {
        expectedRevision: current!.revision,
        commandId,
        payload: { slogan: `Auditado ${Date.now()}` },
      },
      actor,
      randomUUID(),
      "a".repeat(64),
    );
    expect(result.status).toBe("success");

    const after = await dbPool!.query<{
      count: string;
      actor_id: string;
      action: string;
    }>(
      `SELECT COUNT(*)::text AS count,
              MIN(actor_id::text) AS actor_id,
              MIN(action) AS action
         FROM public.app_audit_events
        WHERE target_entity='app_global_config' AND command_id=$1`,
      [commandId],
    );
    expect(after.rows[0].count).toBe("1");
    expect(after.rows[0].actor_id).toBe(actor.userId);
    expect(after.rows[0].action).toBe("config.updated");
  });

  integrationIt("registro de auditoria é imutável (UPDATE bloqueado)", async () => {
    const inserted = await dbPool!.query<{ id: string }>(
      `INSERT INTO public.app_audit_events
        (request_id,actor_id,actor_role,action,target_entity,client_ip_hash,command_id)
       VALUES ($1,$2,'platform_super_admin','config.updated','app_global_config',$3,$4)
       RETURNING id`,
      [randomUUID(), actor.userId, "a".repeat(64), randomUUID()],
    );

    await expect(
      dbPool!.query(
        "UPDATE public.app_audit_events SET action='tampered' WHERE id=$1",
        [inserted.rows[0].id],
      ),
    ).rejects.toThrow(/VIOLACAO_DE_AUDITORIA|append-only|audit/i);
  });

  integrationIt("payload de auditoria não contém PII bruta", async () => {
    const current = await ConfigurationService.getAdminConfig();
    const commandId = randomUUID();
    const sensitivePhone = "+5563988887777";

    await ConfigurationService.updateConfig(
      {
        expectedRevision: current!.revision,
        commandId,
        payload: { supportPhone: sensitivePhone },
      },
      actor,
      randomUUID(),
      "a".repeat(64),
    );

    const row = await dbPool!.query<{
      payload_before: unknown;
      payload_after: unknown;
    }>(
      "SELECT payload_before,payload_after FROM public.app_audit_events WHERE command_id=$1",
      [commandId],
    );

    const before = JSON.stringify(row.rows[0].payload_before);
    const after = JSON.stringify(row.rows[0].payload_after);
    expect(before).not.toContain(sensitivePhone);
    expect(after).not.toContain(sensitivePhone);
    expect(after).toContain("[REDACTED]");
  });
});

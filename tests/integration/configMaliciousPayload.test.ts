import { expect } from "vitest";
import { integrationDescribe, integrationIt } from "../helpers/integration";
import { UpdateGlobalConfigSchema } from "../../shared/contracts/adminConfig";

integrationDescribe("Rejeição de payloads maliciosos", () => {
  integrationIt('campo "role" é rejeitado', () => {
    const parsed = UpdateGlobalConfigSchema.safeParse({
      expectedRevision: 1,
      commandId: "123e4567-e89b-42d3-a456-426614174000",
      payload: {
        slogan: "Slogan válido com 5 caracteres",
        role: "platform_super_admin",
      },
    });
    expect(parsed.success).toBe(false);
  });

  integrationIt('campo "actor_id" no nível raiz é rejeitado', () => {
    const parsed = UpdateGlobalConfigSchema.safeParse({
      expectedRevision: 1,
      commandId: "123e4567-e89b-42d3-a456-426614174000",
      payload: { slogan: "Slogan válido com 5 caracteres" },
      actor_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(parsed.success).toBe(false);
  });

  integrationIt("expectedRevision negativo é rejeitado", () => {
    const parsed = UpdateGlobalConfigSchema.safeParse({
      expectedRevision: -1,
      commandId: "123e4567-e89b-42d3-a456-426614174000",
      payload: { slogan: "Slogan válido com 5 caracteres" },
    });
    expect(parsed.success).toBe(false);
  });

  integrationIt("slogan com espaços apenas é rejeitado", () => {
    const parsed = UpdateGlobalConfigSchema.safeParse({
      expectedRevision: 1,
      commandId: "123e4567-e89b-42d3-a456-426614174000",
      payload: { slogan: "     " },
    });
    expect(parsed.success).toBe(false);
  });
});

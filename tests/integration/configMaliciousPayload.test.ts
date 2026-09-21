import { describe, expect, it } from "vitest";
import { UpdateGlobalConfigSchema } from "../../shared/contracts/adminConfig";

describe("Trilha 02 — payloads administrativos maliciosos", () => {
  it.each(["actorId", "role", "token", "updatedBy"])(
    "rejeita campo extra %s no envelope",
    (field) => {
      const result = UpdateGlobalConfigSchema.safeParse({
        expectedRevision: 1,
        commandId: "33333333-3333-4333-8333-333333333333",
        payload: { slogan: "Configuração válida" },
        [field]: "malicious",
      });
      expect(result.success).toBe(false);
    },
  );

  it("rejeita campo extra dentro do payload", () => {
    const result = UpdateGlobalConfigSchema.safeParse({
      expectedRevision: 1,
      commandId: "33333333-3333-4333-8333-333333333333",
      payload: {
        slogan: "Configuração válida",
        actorId: "00000000-0000-4000-8000-000000000001",
      },
    });
    expect(result.success).toBe(false);
  });
});

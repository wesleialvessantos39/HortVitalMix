import { describe, expect, it } from "vitest";
import {
  hasAdminPermission,
  adminSectorLabel,
} from "../../shared/adminPermissions.ts";
import { UpdateAdminPermissionsSchema } from "../../shared/contracts/adminGovernance.ts";
const commandId = "11111111-1111-4111-8111-111111111111";
describe("Poderes revogáveis de administradores e Super administradores", () => {
  it("revogação explícita supera a hierarquia de Super administrador", () => {
    const root = {
      role: "platform_super_admin",
      sectors: [],
      deniedSectors: ["refund_management"],
    };
    expect(hasAdminPermission(root, "refund_management")).toBe(false);
    expect(hasAdminPermission(root, "payment_configuration")).toBe(true);
  });
  it("devolução ao Super restaura o poder; administrador exige concessão setorial", () => {
    expect(
      hasAdminPermission(
        { role: "platform_super_admin", sectors: [], deniedSectors: [] },
        "refund_management",
      ),
    ).toBe(true);
    expect(
      hasAdminPermission(
        { role: "platform_admin", sectors: [] },
        "refund_management",
      ),
    ).toBe(false);
    expect(
      hasAdminPermission(
        { role: "platform_admin", sectors: ["refund_management"] },
        "refund_management",
      ),
    ).toBe(true);
  });
  it("permissões vazias retiram poderes sem elevar ou mudar a conta", () => {
    expect(
      UpdateAdminPermissionsSchema.parse({
        sectors: [],
        expectedRevision: 1,
        commandId,
      }).sectors,
    ).toEqual([]);
    expect(
      UpdateAdminPermissionsSchema.safeParse({
        sectors: [],
        expectedRevision: 1,
        commandId,
        role: "platform_super_admin",
      }).success,
    ).toBe(false);
  });
  it("rejeita nomes de setor desconhecidos, repetidos e revisão ausente", () => {
    for (const sectors of [
      ["unknown"],
      ["refund_management", "refund_management"],
    ])
      expect(
        UpdateAdminPermissionsSchema.safeParse({
          sectors,
          expectedRevision: 1,
          commandId,
        }).success,
      ).toBe(false);
    expect(
      UpdateAdminPermissionsSchema.safeParse({ sectors: [], commandId })
        .success,
    ).toBe(false);
  });
  it("rótulos internos jamais são usados como texto para o usuário", () => {
    expect(adminSectorLabel("refund_management")).toBe("Gestão de reembolsos");
    expect(adminSectorLabel("new_future_key")).toBe("Setor administrativo");
  });
});

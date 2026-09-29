import { describe, expect, it } from "vitest";
import {
  ClaimVerificationRequestSchema,
  DecideVerificationRequestSchema,
  VerificationFilterSchema,
} from "../../shared/contracts/verificationQueue";

const commandId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("T11 contratos da fila de verificação", () => {
  it("aceita filtro de abas", () => {
    expect(VerificationFilterSchema.parse({ tab: "pending" }).tab).toBe("pending");
    expect(VerificationFilterSchema.parse({}).tab).toBe("pending");
  });

  it("exige commandId no claim", () => {
    expect(ClaimVerificationRequestSchema.safeParse({}).success).toBe(false);
    expect(
      ClaimVerificationRequestSchema.parse({ commandId }).commandId,
    ).toBe(commandId);
  });

  it("bloqueia aprovação com checklist incompleto", () => {
    const parsed = DecideVerificationRequestSchema.safeParse({
      commandId,
      decision: "approved",
      technicalOpinion: "Parecer técnico fundamentado.",
      assignedTrustLevel: 3,
      checklistEnvironmentalOk: true,
      checklistLandTenureOk: true,
      checklistWaterQualityOk: false,
    });
    expect(parsed.success).toBe(false);
  });

  it("aceita aprovação com os três itens e parecer", () => {
    const parsed = DecideVerificationRequestSchema.parse({
      commandId,
      decision: "approved",
      technicalOpinion: "CAR regular, posse e água conferidos.",
      assignedTrustLevel: 4,
      checklistEnvironmentalOk: true,
      checklistLandTenureOk: true,
      checklistWaterQualityOk: true,
    });
    expect(parsed.decision).toBe("approved");
  });

  it("aceita pedido de ajustes sem checklist completo", () => {
    const parsed = DecideVerificationRequestSchema.parse({
      commandId,
      decision: "adjustments_required",
      technicalOpinion: "Falta laudo de água potável atualizado.",
      assignedTrustLevel: 2,
      checklistEnvironmentalOk: true,
      checklistLandTenureOk: true,
      checklistWaterQualityOk: false,
    });
    expect(parsed.decision).toBe("adjustments_required");
  });
});

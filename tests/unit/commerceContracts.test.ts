import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  CreatePosSaleSchema,
  CommercePolicySchema,
  CreateRefundSchema,
  RefundDecisionSchema,
  CaseEvidenceSchema,
} from "../../shared/contracts/commerce.ts";
describe("Compras protegidas: limites dos contratos", () => {
  const pos = {
    commandId: randomUUID(),
    paymentMethod: "pix",
    paymentChannel: "system_pix",
    items: [{ productId: randomUUID(), quantity: 2 }],
  };
  it("aceita Pix, crédito e débito nos canais corretos", () => {
    expect(CreatePosSaleSchema.parse(pos).paymentMethod).toBe("pix");
    for (const paymentMethod of ["credit_card", "debit_card"])
      expect(
        CreatePosSaleSchema.safeParse({
          ...pos,
          paymentMethod,
          paymentChannel: "terminal",
        }).success,
      ).toBe(true);
  });
  it("não aceita dinheiro, PAN, CVV nem campos extras", () => {
    expect(
      CreatePosSaleSchema.safeParse({ ...pos, paymentMethod: "cash" }).success,
    ).toBe(false);
    expect(
      CreatePosSaleSchema.safeParse({
        ...pos,
        cardNumber: "4111111111111111",
        cvv: "123",
      }).success,
    ).toBe(false);
    expect(
      CreatePosSaleSchema.safeParse({
        ...pos,
        paymentMethod: "pix",
        paymentChannel: "terminal",
      }).success,
    ).toBe(false);
  });
  it("impede duplicidade e quantidades inválidas", () => {
    expect(
      CreatePosSaleSchema.safeParse({
        ...pos,
        items: [...pos.items, ...pos.items],
      }).success,
    ).toBe(false);
    expect(
      CreatePosSaleSchema.safeParse({
        ...pos,
        items: [{ productId: randomUUID(), quantity: 0 }],
      }).success,
    ).toBe(false);
  });
  it("a política comercial preserva sete dias e retenção mínima", () => {
    const policy = {
      version: 1,
      onlineWithdrawalDays: 7,
      inPersonReturnDays: 0,
      holdingDays: 7,
      additionalTerms: "",
    };
    expect(CommercePolicySchema.safeParse(policy).success).toBe(true);
    expect(
      CommercePolicySchema.safeParse({ ...policy, onlineWithdrawalDays: 6 })
        .success,
    ).toBe(false);
    expect(
      CommercePolicySchema.safeParse({ ...policy, holdingDays: 0 }).success,
    ).toBe(false);
  });
  it("decisão exige justificativa e valor para aprovação", () => {
    const decision = {
      commandId: randomUUID(),
      expectedRevision: 1,
      decision: "approve",
      notes: "Análise detalhada registrada no histórico.",
    };
    expect(RefundDecisionSchema.safeParse(decision).success).toBe(false);
    expect(
      RefundDecisionSchema.safeParse({ ...decision, approvedAmountCents: 100 })
        .success,
    ).toBe(true);
    expect(
      RefundDecisionSchema.safeParse({ ...decision, notes: "" }).success,
    ).toBe(false);
  });
  it("reembolso exige compra e valor positivo", () => {
    expect(
      CreateRefundSchema.safeParse({
        commandId: randomUUID(),
        orderId: randomUUID(),
        reason: "quality",
        description: "Alimento em condição inadequada para consumo.",
        requestedAmountCents: 0,
      }).success,
    ).toBe(false);
  });
  it("anexos não aceitam SVG, HTML ou arquivos executáveis", () => {
    const value = {
      commandId: randomUUID(),
      caseType: "complaint",
      caseId: randomUUID(),
      fileName: "arquivo",
      base64: "YWJj",
    };
    for (const mimeType of [
      "text/html",
      "image/svg+xml",
      "application/x-msdownload",
    ])
      expect(CaseEvidenceSchema.safeParse({ ...value, mimeType }).success).toBe(
        false,
      );
  });
});

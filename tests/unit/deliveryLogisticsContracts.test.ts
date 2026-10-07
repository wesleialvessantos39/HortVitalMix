import { describe, expect, it } from "vitest";
import {
  DeliveryWindowSchema,
  DeliveryWindowUpdateSchema,
  AllocateDeliverySchema,
  DeliveryProofSchema,
} from "../../shared/contracts/deliveryLogistics.ts";
const window = { dayOfWeek: 1, startTime: "08:00", endTime: "12:00" };
describe("T22 contratos estritos", () => {
  it("capacidade inicial 15 e atualização com revisão mantém validação de horários", () => {
    expect(DeliveryWindowSchema.parse(window).maxOrdersCapacity).toBe(15);
    expect(
      DeliveryWindowUpdateSchema.safeParse({
        ...window,
        expectedRevision: 1,
        endTime: "07:00",
      }).success,
    ).toBe(false);
  });
  it.each([
    { dayOfWeek: 7 },
    { dayOfWeek: -1 },
    { startTime: "8:00" },
    { endTime: "24:00" },
    { endTime: "08:00" },
    { maxOrdersCapacity: 0 },
    { maxOrdersCapacity: 2147483648 },
    { storeId: "forged" },
  ])("rejeita janela inválida %j", (change) =>
    expect(
      DeliveryWindowSchema.safeParse({ ...window, ...change }).success,
    ).toBe(false),
  );
  it("nome obrigatório, coordenadas em par e documento reduzido", () => {
    const proof = { expectedRevision: 4, receivedByName: " Maria " };
    expect(DeliveryProofSchema.parse(proof).receivedByName).toBe("Maria");
    for (const bad of [
      { receivedByName: " " },
      { receiverDocumentLastDigits: "12345678900" },
      { latitude: 0 },
      { latitude: -91, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { actorUserId: "forged" },
      { notes: "x".repeat(501) },
    ])
      expect(DeliveryProofSchema.safeParse({ ...proof, ...bad }).success).toBe(
        false,
      );
  });
  it("datas impossíveis e revisão ausente não passam", () => {
    for (const scheduledDate of ["2026-02-30", "07/10/2026", "2026-13-01"])
      expect(
        AllocateDeliverySchema.safeParse({
          scheduledDate,
          windowId: crypto.randomUUID(),
          expectedRevision: 3,
        }).success,
      ).toBe(false);
  });
});

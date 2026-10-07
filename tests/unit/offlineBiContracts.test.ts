import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  SyncCommandSchema,
  ReconcileBatchSchema,
  HarvestSyncPayloadSchema,
  OrderSyncPayloadSchema,
  ProofSyncPayloadSchema,
  canonicalSyncJson,
} from "../../shared/contracts/offlineSync.ts";
import {
  KpiCalculationSchema,
  KpiPeriodSchema,
} from "../../shared/contracts/kpi.ts";
const command = () => ({
  commandId: randomUUID(),
  commandType: "inventory.harvest",
  baseRevision: 1,
  payload: {
    productId: randomUUID(),
    harvest: {
      lotCode: "LOCAL",
      harvestDate: "2026-10-07",
      expirationDate: "2026-10-12",
      quantity: 7,
    },
  },
});
describe("T25 limites, formatos e segurança dos contratos", () => {
  it("envelope estrito não aceita identidade, setor ou device escolhido no comando", () => {
    expect(
      SyncCommandSchema.safeParse({ ...command(), userId: randomUUID() })
        .success,
    ).toBe(false);
    expect(
      ReconcileBatchSchema.safeParse({
        deviceFingerprint: "local-device",
        commands: [command()],
        userId: randomUUID(),
      }).success,
    ).toBe(false);
  });
  it.each([-1, 0.5, 2147483647])("revisão inválida %s", (baseRevision) =>
    expect(
      SyncCommandSchema.safeParse({ ...command(), baseRevision }).success,
    ).toBe(false),
  );
  it("lote é limitado a 50 IDs distintos e fingerprint opaco", () => {
    const commands = Array.from({ length: 50 }, command);
    expect(
      ReconcileBatchSchema.safeParse({
        deviceFingerprint: "local-device",
        commands,
      }).success,
    ).toBe(true);
    expect(
      ReconcileBatchSchema.safeParse({
        deviceFingerprint: "local-device",
        commands: [...commands, command()],
      }).success,
    ).toBe(false);
    expect(
      ReconcileBatchSchema.safeParse({
        deviceFingerprint: "local-device",
        commands: [commands[0], commands[0]],
      }).success,
    ).toBe(false);
    expect(
      ReconcileBatchSchema.safeParse({
        deviceFingerprint: "<script>",
        commands: [command()],
      }).success,
    ).toBe(false);
  });
  it("payload excessivo é recusado e colheita conserva as regras T15", () => {
    expect(
      SyncCommandSchema.safeParse({
        ...command(),
        payload: { text: "x".repeat(5000) },
      }).success,
    ).toBe(false);
    const p = command().payload;
    expect(HarvestSyncPayloadSchema.safeParse(p).success).toBe(true);
    expect(
      HarvestSyncPayloadSchema.safeParse({
        ...p,
        harvest: { ...p.harvest, quantity: 0 },
      }).success,
    ).toBe(false);
    expect(
      HarvestSyncPayloadSchema.safeParse({
        ...p,
        harvest: { ...p.harvest, expirationDate: "2026-10-01" },
      }).success,
    ).toBe(false);
  });
  it("cancelamento mantém motivo obrigatório e prova conserva coordenadas em par", () => {
    expect(
      OrderSyncPayloadSchema.safeParse({
        orderId: randomUUID(),
        transition: { expectedRevision: 1, toStatus: "cancelled" },
      }).success,
    ).toBe(false);
    expect(
      ProofSyncPayloadSchema.safeParse({
        orderId: randomUUID(),
        proof: {
          expectedRevision: 4,
          receivedByName: "Recebedor",
          latitude: 1,
        },
      }).success,
    ).toBe(false);
  });
  it("ordem de chaves não altera hash e mudanças de array alteram", () => {
    expect(canonicalSyncJson({ b: 2, a: { z: 1, y: 2 } })).toBe(
      canonicalSyncJson({ a: { y: 2, z: 1 }, b: 2 }),
    );
    expect(canonicalSyncJson([1, 2])).not.toBe(canonicalSyncJson([2, 1]));
  });
  it("datas reais, período até 31 dias e identidade fora do cálculo", () => {
    expect(
      KpiPeriodSchema.safeParse({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      }).success,
    ).toBe(true);
    expect(
      KpiPeriodSchema.safeParse({
        startDate: "2026-10-01",
        endDate: "2026-11-01",
      }).success,
    ).toBe(false);
    expect(
      KpiPeriodSchema.safeParse({
        startDate: "2026-10-08",
        endDate: "2026-10-07",
      }).success,
    ).toBe(false);
    expect(
      KpiCalculationSchema.safeParse({ referenceDate: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      KpiCalculationSchema.safeParse({
        referenceDate: "2026-10-07",
        isSuperAdmin: true,
      }).success,
    ).toBe(false);
  });
});

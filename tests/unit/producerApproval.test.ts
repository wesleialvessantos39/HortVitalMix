import { describe, expect, it } from "vitest";
import {
  AccessScopeError,
  assertProducerApproved,
  producerIsApproved,
} from "../../server/services/AccessScopeService";
import type { PoolClient } from "pg";

describe("autorização de publicação do produtor", () => {
  it("só permite a loja e publicação após aprovação", () => {
    expect(producerIsApproved("verified")).toBe(true);
    for (const status of ["declared", "pending", "partial", "rejected", null]) {
      expect(producerIsApproved(status)).toBe(false);
    }
  });

  it("aplica o bloqueio no backend para perfis ainda não verificados", async () => {
    const client = {
      query: async () => ({ rows: [{ verification_status: "declared" }] }),
    } as unknown as PoolClient;
    await expect(assertProducerApproved(client, "producer-id")).rejects.toMatchObject({
      code: "PRODUCER_NOT_APPROVED",
      status: 403,
    } satisfies Partial<AccessScopeError>);
  });

  it("permite operações protegidas somente quando o backend encontra aprovação", async () => {
    const client = {
      query: async () => ({ rows: [{ verification_status: "verified" }] }),
    } as unknown as PoolClient;
    await expect(assertProducerApproved(client, "producer-id")).resolves.toBeUndefined();
  });
});

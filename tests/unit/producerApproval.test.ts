import { describe, expect, it } from "vitest";
import { producerIsApproved } from "../../server/services/AccessScopeService";

describe("autorização de publicação do produtor", () => {
  it("só permite a loja e publicação após aprovação", () => {
    expect(producerIsApproved("verified")).toBe(true);
    for (const status of ["declared", "pending", "partial", "rejected", null]) {
      expect(producerIsApproved(status)).toBe(false);
    }
  });
});

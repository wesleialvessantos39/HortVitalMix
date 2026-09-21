import { describe, expect, it } from "vitest";
import {
  assertRecentAuth,
  ReauthRequiredError,
} from "../../server/services/reauthService";
import type { ActorContext } from "../../server/services/ConfigurationService";

function actor(sessionIssuedAt: string): ActorContext {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    role: "platform_super_admin",
    sessionIssuedAt,
  };
}

describe("ConfigurationService — reautenticação", () => {
  it("sessão antiga (>15 min) exige reautenticação", async () => {
    await expect(
      assertRecentAuth(
        actor(new Date(Date.now() - 20 * 60 * 1000).toISOString()),
      ),
    ).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  it("sessão recente (<15 min) é aceita", async () => {
    await expect(
      assertRecentAuth(
        actor(new Date(Date.now() - 5 * 60 * 1000).toISOString()),
      ),
    ).resolves.toBeUndefined();
  });

  it("timestamp futuro exige reautenticação", async () => {
    await expect(
      assertRecentAuth(actor(new Date(Date.now() + 60_000).toISOString())),
    ).rejects.toBeInstanceOf(ReauthRequiredError);
  });
});

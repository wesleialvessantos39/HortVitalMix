import { describe, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { ActorContext } from "../../server/services/ConfigurationService";

const enabled = process.env.HVM_INTEGRATION_ENABLED === "true";
export const integrationDescribe = enabled ? describe : describe.skip;
export const integrationIt = enabled ? it : it.skip;

export function freshActor(): ActorContext {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    role: "platform_super_admin",
    sessionIssuedAt: new Date().toISOString(),
  };
}

export function requestContext() {
  return {
    requestId: randomUUID(),
    clientIpHash: "a".repeat(64),
  };
}

import { describe, it, expect } from "vitest";
import {
  issueConfirmationContext,
  readConfirmationContext,
} from "../../server/security/confirmationContext.ts";
const uid = "11111111-1111-4111-8111-111111111111",
  key = "test-key-never-production";
describe("confirmation link context", () => {
  it("binds identity and public role without including email or password", () => {
    const token = issueConfirmationContext(uid, "producer", 1000, key);
    expect(readConfirmationContext(token, 2000, key)).toMatchObject({
      uid,
      role: "producer",
    });
    expect(token).not.toContain("@");
  });
  it("rejects changed identity, signature and signing key", () => {
    const token = issueConfirmationContext(uid, "consumer", 1000, key);
    expect(readConfirmationContext(token + "a", 2000, key)).toBeNull();
    expect(readConfirmationContext(token, 2000, "other")).toBeNull();
    expect(
      readConfirmationContext(token.split(".")[0] + ".bad", 2000, key),
    ).toBeNull();
  });
  it("expires context after 24 hours without changing the authentication token", () => {
    const token = issueConfirmationContext(uid, "consumer", 1000, key);
    expect(
      readConfirmationContext(token, 1000 + 24 * 60 * 60_000, key),
    ).toBeNull();
  });
  it("matches the Edge WebCrypto signing format", async () => {
    const token = issueConfirmationContext(uid, "producer", 1000, key);
    const value = token.split(".")[0];
    const k = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign(
      "HMAC",
      k,
      new TextEncoder().encode("hvm:confirmation:v1:" + value),
    );
    expect(
      Array.from(new Uint8Array(mac), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
    ).toBe(token.split(".")[1]);
  });
});

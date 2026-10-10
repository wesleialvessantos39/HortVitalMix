import { describe, expect, it } from "vitest";
import { PwaVersionSchema } from "../../shared/contracts/pwa";
const valid = {
  format: 1,
  buildId: "a".repeat(64),
  commitSha: "b".repeat(40),
  frontendVersion: "0.1.0",
  resourceIdentity: "a".repeat(64),
  publishedAt: null,
  resources: [
    "/index.html",
    "/manifest.webmanifest",
    "/favicon.svg",
    "/app-icons/icon-192.png",
    "/app-icons/icon-512.png",
  ].map((url) => ({ url, sha256: "c".repeat(64), bytes: 5 })),
};
describe("public resource version contract", () => {
  it("accepts resource identity independent from native or canonical ledger versions", () =>
    expect(PwaVersionSchema.parse(valid).buildId).toBe(valid.buildId));
  it.each([
    "/api/v1/admin/documents",
    "/assets/../../secret.js",
    "https://evil.test/index.html",
    "/documents/private.png",
  ])("rejects private or foreign resource %s", (url) =>
    expect(
      PwaVersionSchema.safeParse({
        ...valid,
        resources: [
          ...valid.resources,
          { url, sha256: "a".repeat(64), bytes: 5 },
        ],
      }).success,
    ).toBe(false),
  );
  it("rejects missing icons, duplicate resources, mismatched identity and secrets", () => {
    expect(
      PwaVersionSchema.safeParse({
        ...valid,
        resources: valid.resources.slice(0, 4),
      }).success,
    ).toBe(false);
    expect(
      PwaVersionSchema.safeParse({
        ...valid,
        resources: [...valid.resources, valid.resources[0]],
      }).success,
    ).toBe(false);
    expect(
      PwaVersionSchema.safeParse({ ...valid, resourceIdentity: "d".repeat(64) })
        .success,
    ).toBe(false);
    expect(
      PwaVersionSchema.safeParse({ ...valid, token: "secret" }).success,
    ).toBe(false);
  });
});

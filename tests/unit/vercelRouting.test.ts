import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { vercelRequestUrl } from "../../server/vercelRequestUrl.ts";

describe("Vercel API dispatcher", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  it("routes nested API paths before the SPA fallback", () => {
    expect(config.rewrites[0]).toEqual({
      source: "/api/:path*", destination: "/api?__hvm_path=:path*",
    });
  });
  it.each([
    "v1/admin/auth/login", "v1/admin/auth/mfa/verify",
    "v1/admin/auth/verify-session", "v1/auth/login",
    "v1/auth/register-consumer", "v1/auth/register-producer",
    "v1/admin/bootstrap/status", "v1/admin/invites",
  ])("restores %s for both rewrite and direct function invocations", (path) => {
    expect(vercelRequestUrl(`/api?__hvm_path=${path}`)).toBe(`/${path}`);
    expect(vercelRequestUrl(`/api/${path}?__hvm_path=${path}`)).toBe(`/${path}`);
    expect(vercelRequestUrl(`/api/${path}`)).toBe(`/${path}`);
  });
  it("preserves query parameters and removes only the internal routing parameter", () => {
    expect(vercelRequestUrl("/api?__hvm_path=v1/admin/invites&page=2&search=a%2Bb%40example.com"))
      .toBe("/v1/admin/invites?page=2&search=a%2Bb%40example.com");
  });
  it("does not let a supplied query override a direct API path", () => {
    expect(vercelRequestUrl("/api/v1/auth/session?__hvm_path=v1/admin/auth/login"))
      .toBe("/v1/auth/session");
  });
});

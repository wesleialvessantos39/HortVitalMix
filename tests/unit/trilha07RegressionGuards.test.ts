import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("guardas de regressão T07", () => {
  it("mantém package-lock compatível com npm ci do Vercel", () => {
    expect(existsSync("package-lock.json")).toBe(true);
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    expect(lock.name).toBe(pkg.name);
    expect(lock.packages?.[""]?.name).toBe(pkg.name);

    const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(vercel.installCommand).toBe("npm ci --no-audit --no-fund");
  });

  it("mantém extensões ESM explícitas nos imports críticos da T07", () => {
    const service = readFileSync(
      "server/services/AddressManagementService.ts",
      "utf8",
    );
    const geocoding = readFileSync(
      "server/services/GeocodingHelper.ts",
      "utf8",
    );

    expect(service).toContain(
      'from "../../shared/contracts/addressAdvanced.ts"',
    );
    expect(service).toContain('from "./GeocodingHelper.ts"');
    expect(geocoding).toContain(
      'from "../../shared/contracts/addressAdvanced.ts"',
    );
  });

  it("mantém o buildCommand do Vercel Hobby enxuto", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(vercel.buildCommand).toBe(
      "npm run migrations:verify && npm run typecheck:app && npm run security:check && vite build && node --import tsx scripts/check-bundle.ts",
    );
    expect(vercel.buildCommand).toContain("typecheck:app");
    expect(vercel.buildCommand).not.toContain("test:t07");
  });
});

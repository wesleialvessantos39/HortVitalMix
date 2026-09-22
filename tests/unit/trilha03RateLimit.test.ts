import { beforeEach, describe, expect, it } from "vitest";
import { consumeLoginAttempt, resetAllLoginRateLimitsForTests } from "../../server/security/loginRateLimit";

describe("Trilha 03 — rate limit de login", () => {
  beforeEach(() => resetAllLoginRateLimitsForTests());
  it("permite dez tentativas", () => {
    const now=1_700_000_000_000;
    for(let i=0;i<10;i++) expect(consumeLoginAttempt("ip",now).allowed).toBe(true);
  });
  it("bloqueia a décima primeira por 15 minutos", () => {
    const now=1_700_000_000_000;
    for(let i=0;i<10;i++) consumeLoginAttempt("ip",now);
    const x=consumeLoginAttempt("ip",now);
    expect(x.allowed).toBe(false);
    expect(x.retryAfterSeconds).toBe(900);
  });
  it("reinicia a janela", () => {
    const now=1_700_000_000_000;
    for(let i=0;i<10;i++) consumeLoginAttempt("ip",now);
    expect(consumeLoginAttempt("ip",now+900_000).allowed).toBe(true);
  });
});

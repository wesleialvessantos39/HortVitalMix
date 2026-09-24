import { describe, expect, it } from "vitest";
import { authEmailRetryAfter } from "../../server/security/authEmailRateLimit";

describe("Supabase Auth e-mail cooldown", () => {
  it("extrai o tempo restante informado pelo provedor", () => {
    expect(
      authEmailRetryAfter({
        status: 429,
        code: "over_email_send_rate_limit",
        message:
          "For security purposes, you can only request this after 18 seconds.",
      }),
    ).toBe(18);
  });

  it("usa fallback seguro de 60 segundos quando o provedor não informa tempo", () => {
    expect(
      authEmailRetryAfter({
        status: 429,
        code: "over_email_send_rate_limit",
        message: "Email rate limit exceeded",
      }),
    ).toBe(60);
  });

  it("não classifica falhas comuns como cooldown", () => {
    expect(
      authEmailRetryAfter({
        status: 500,
        code: "unexpected_failure",
        message: "unexpected",
      }),
    ).toBeNull();
  });
});

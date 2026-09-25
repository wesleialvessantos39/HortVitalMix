import { describe, expect, it } from "vitest";
import {
  issueRecentAuthProof,
  RECENT_AUTH_WINDOW_MS,
  verifyRecentAuthProof,
} from "../../server/security/recentAuth";

const secret = "0123456789abcdef0123456789abcdef";
const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

function token(sid = sessionId) {
  const head = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ session_id: sid })).toString(
    "base64url",
  );
  return head + "." + body + ".signature";
}

describe("T06 recent auth proof", () => {
  it("aceita prova íntegra na mesma sessão", () => {
    const now = 1_800_000_000_000;
    const proof = issueRecentAuthProof(userId, token(), now, secret);
    expect(verifyRecentAuthProof(proof, userId, token(), now, secret)).toBe(true);
  });

  it("rejeita prova expirada", () => {
    const issued = 1_800_000_000_000;
    const proof = issueRecentAuthProof(userId, token(), issued, secret);
    expect(
      verifyRecentAuthProof(
        proof,
        userId,
        token(),
        issued + RECENT_AUTH_WINDOW_MS + 1,
        secret,
      ),
    ).toBe(false);
  });

  it("rejeita prova de outra sessão", () => {
    const now = 1_800_000_000_000;
    const proof = issueRecentAuthProof(userId, token(), now, secret);
    expect(
      verifyRecentAuthProof(
        proof,
        userId,
        token("33333333-3333-4333-8333-333333333333"),
        now,
        secret,
      ),
    ).toBe(false);
  });

  it("rejeita prova de outro usuário", () => {
    const now = 1_800_000_000_000;
    const proof = issueRecentAuthProof(userId, token(), now, secret);
    expect(
      verifyRecentAuthProof(
        proof,
        "44444444-4444-4444-8444-444444444444",
        token(),
        now,
        secret,
      ),
    ).toBe(false);
  });

  it("rejeita prova emitida mais de 30 segundos no futuro", () => {
    const now = 1_800_000_000_000;
    const proof = issueRecentAuthProof(userId, token(), now + 30_001, secret);
    expect(verifyRecentAuthProof(proof, userId, token(), now, secret)).toBe(false);
  });

  it("rejeita assinatura adulterada", () => {
    const now = 1_800_000_000_000;
    const proof = issueRecentAuthProof(userId, token(), now, secret);
    expect(
      verifyRecentAuthProof(proof.slice(0, -1) + "0", userId, token(), now, secret),
    ).toBe(false);
  });
});

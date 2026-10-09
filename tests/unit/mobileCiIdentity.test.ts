import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMobileCiToken } from "../../server/security/mobileCiIdentity.ts";
import {
  MOBILE_CI_AUDIENCE,
  MOBILE_CI_REPOSITORY,
  MOBILE_CI_REPOSITORY_ID,
  MOBILE_CI_REPOSITORY_OWNER_ID,
  MOBILE_CI_ENVIRONMENT,
  MOBILE_CI_SUBJECT,
  MOBILE_CI_WORKFLOW,
} from "../../shared/contracts/mobileReleases.ts";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = {
  ...keys.publicKey.export({ format: "jwk" }),
  kid: "synthetic-key",
  alg: "RS256",
  use: "sig",
};
const now = 1800000000000,
  seconds = now / 1000;
const claims = {
  iss: "https://token.actions.githubusercontent.com",
  aud: MOBILE_CI_AUDIENCE,
  sub: MOBILE_CI_SUBJECT,
  repository: MOBILE_CI_REPOSITORY,
  repository_id: MOBILE_CI_REPOSITORY_ID,
  repository_owner: "wesleialvessantos39",
  repository_owner_id: MOBILE_CI_REPOSITORY_OWNER_ID,
  environment: MOBILE_CI_ENVIRONMENT,
  ref: "refs/heads/main",
  ref_type: "branch",
  workflow_ref: `${MOBILE_CI_REPOSITORY}/${MOBILE_CI_WORKFLOW}@refs/heads/main`,
  sha: "b".repeat(40),
  run_id: "12345",
  run_attempt: "2",
  event_name: "push",
  runner_environment: "github-hosted",
  iat: seconds - 10,
  nbf: seconds - 10,
  exp: seconds + 290,
};
function token(
  change: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
) {
  const head = Buffer.from(
    JSON.stringify({
      alg: "RS256",
      kid: "synthetic-key",
      typ: "JWT",
      ...header,
    }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...claims, ...change })).toString(
    "base64url",
  );
  return (
    head +
    "." +
    body +
    "." +
    sign(
      "RSA-SHA256",
      Buffer.from(head + "." + body),
      keys.privateKey,
    ).toString("base64url")
  );
}
describe("GitHub OIDC de publicação mobile", () => {
  it("valida assinatura e subject imutável e extrai somente o workflow aprovado", async () => {
    expect(
      await verifyMobileCiToken(token(), async () => [publicJwk], now),
    ).toEqual({ sourceCommit: "b".repeat(40), runId: "12345", runAttempt: 2 });
  });
  it.each([
    { aud: "https://attacker.invalid" },
    { iss: "https://attacker.invalid" },
    { repository: "another-owner/HortVitalMix" },
    { repository_owner: "another-owner" },
    { repository_id: "1376634640" },
    { repository_id: undefined },
    { repository_owner_id: "210783436" },
    { repository_owner_id: undefined },
    { environment: "another-environment" },
    { environment: undefined },
    { ref: "refs/pull/8/merge" },
    { ref_type: "tag" },
    {
      workflow_ref: `${MOBILE_CI_REPOSITORY}/.github/workflows/untrusted.yml@refs/heads/main`,
    },
    { sub: `repo:${MOBILE_CI_REPOSITORY}:ref:refs/heads/main` },
    { sub: `repo:${MOBILE_CI_REPOSITORY}:environment:mobile-release` },
    { sub: "repo:wesleialvessantos39@210783436/HortVitalMix@1376634639:environment:mobile-release" },
    { sub: "repo:wesleialvessantos39@210783435/HortVitalMix@1376634640:environment:mobile-release" },
    { sub: "repo:wesleialvessantos39@210783435/HortVitalMix@1376634639:environment:another-environment" },
    { event_name: "pull_request" },
    { runner_environment: "self-hosted" },
    { exp: seconds },
    { nbf: seconds + 31 },
    { iat: seconds + 31 },
    { iat: seconds - 601 },
    { exp: seconds + 1000 },
    { run_attempt: "0" },
    { sha: "not-a-commit" },
  ])("recusa claim fora da confiança: %j", async (change) => {
    await expect(
      verifyMobileCiToken(token(change), async () => [publicJwk], now),
    ).rejects.toMatchObject({ code: "MOBILE_CI_UNAUTHORIZED", status: 401 });
  });
  it.each([
    { alg: "HS256" },
    { alg: "none" },
    { jku: "https://attacker.invalid/jwks" },
    { x5u: "https://attacker.invalid/cert" },
    { crit: ["unknown"] },
    { kid: "unknown" },
  ])("recusa cabeçalho perigoso: %j", async (header) => {
    await expect(
      verifyMobileCiToken(token({}, header), async () => [publicJwk], now),
    ).rejects.toMatchObject({ code: "MOBILE_CI_UNAUTHORIZED" });
  });
  it("recusa conteúdo alterado mesmo com claims aparentemente corretos", async () => {
    const parts = token().split(".");
    parts[1] = Buffer.from(
      JSON.stringify({ ...claims, run_id: "555" }),
    ).toString("base64url");
    await expect(
      verifyMobileCiToken(parts.join("."), async () => [publicJwk], now),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("falha fechada se JWKS está indisponível, sem expor token", async () => {
    await expect(
      verifyMobileCiToken(
        token(),
        async () => {
          throw new Error("upstream private detail");
        },
        now,
      ),
    ).rejects.toThrow("MOBILE_CI_UNAUTHORIZED");
  });
});

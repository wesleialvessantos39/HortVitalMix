import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import {
  MOBILE_CI_AUDIENCE,
  MOBILE_CI_REPOSITORY,
  MOBILE_CI_WORKFLOW,
} from "../../shared/contracts/mobileReleases.ts";

export class MobileCiIdentityError extends Error {
  code = "MOBILE_CI_UNAUTHORIZED";
  status = 401;
  constructor() {
    super("MOBILE_CI_UNAUTHORIZED");
  }
}
const ClaimsSchema = z.object({
  iss: z.literal("https://token.actions.githubusercontent.com"),
  aud: z.literal(MOBILE_CI_AUDIENCE),
  sub: z.literal(`repo:${MOBILE_CI_REPOSITORY}:environment:mobile-release`),
  repository: z.literal(MOBILE_CI_REPOSITORY),
  repository_owner: z.literal("wesleialvessantos39"),
  ref: z.literal("refs/heads/main"),
  ref_type: z.literal("branch"),
  workflow_ref: z.literal(
    `${MOBILE_CI_REPOSITORY}/${MOBILE_CI_WORKFLOW}@refs/heads/main`,
  ),
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  run_id: z.string().regex(/^\d{1,30}$/),
  run_attempt: z.string().regex(/^\d{1,9}$/),
  event_name: z.enum(["push", "workflow_dispatch"]),
  runner_environment: z.literal("github-hosted"),
  exp: z.number().int(),
  iat: z.number().int(),
  nbf: z.number().int(),
});
export type MobileCiIdentity = {
  sourceCommit: string;
  runId: string;
  runAttempt: number;
};
type Jwk = JsonWebKey & { kid: string; alg?: string; use?: string };
let cached: { keys: Jwk[]; expires: number } | null = null;
async function githubKeys(): Promise<Jwk[]> {
  if (cached && cached.expires > Date.now()) return cached.keys;
  const response = await fetch(
    "https://token.actions.githubusercontent.com/.well-known/jwks",
    { signal: AbortSignal.timeout(8000), redirect: "error" },
  );
  if (!response.ok) throw new MobileCiIdentityError();
  const result = (await response.json()) as { keys?: Jwk[] };
  if (!Array.isArray(result.keys) || result.keys.length > 100)
    throw new MobileCiIdentityError();
  cached = { keys: result.keys, expires: Date.now() + 5 * 60_000 };
  return cached.keys;
}

/** Verify signature before consuming claims; never fetch a token-provided jku/x5u. */
export async function verifyMobileCiToken(
  token: string,
  getKeys: () => Promise<Jwk[]> = githubKeys,
  now = Date.now(),
): Promise<MobileCiIdentity> {
  try {
    if (token.length > 20_000) throw new MobileCiIdentityError();
    const segments = token.split(".");
    if (
      segments.length !== 3 ||
      segments.some((segment) => !/^[a-zA-Z0-9_-]+$/.test(segment))
    )
      throw new MobileCiIdentityError();
    const header = JSON.parse(
      Buffer.from(segments[0], "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      header.kid.length > 200 ||
      header.jku ||
      header.x5u ||
      header.crit
    )
      throw new MobileCiIdentityError();
    const keys = await getKeys();
    const key = keys.find(
      (candidate) =>
        candidate.kid === header.kid &&
        candidate.kty === "RSA" &&
        (!candidate.alg || candidate.alg === "RS256") &&
        (!candidate.use || candidate.use === "sig"),
    );
    if (
      !key ||
      !verify(
        "RSA-SHA256",
        Buffer.from(segments[0] + "." + segments[1]),
        createPublicKey({ key, format: "jwk" }),
        Buffer.from(segments[2], "base64url"),
      )
    )
      throw new MobileCiIdentityError();
    const claims = ClaimsSchema.parse(
      JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")),
    );
    const seconds = Math.floor(now / 1000);
    if (
      claims.exp <= seconds ||
      claims.nbf > seconds + 30 ||
      claims.iat > seconds + 30 ||
      claims.iat < seconds - 600 ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 600 ||
      Number(claims.run_attempt) < 1
    )
      throw new MobileCiIdentityError();
    return {
      sourceCommit: claims.sha,
      runId: claims.run_id,
      runAttempt: Number(claims.run_attempt),
    };
  } catch {
    throw new MobileCiIdentityError();
  }
}

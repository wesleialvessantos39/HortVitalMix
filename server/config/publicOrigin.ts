import { runtime } from "./runtime.ts";

const CANONICAL_PRODUCTION_ORIGIN = "https://hortivitalmix.vercel.app";
const BASE_ALLOWLIST = new Set([
  CANONICAL_PRODUCTION_ORIGIN,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...runtime.origins,
]);

export function resolvePublicOrigin(): string {
  const explicit = process.env.PUBLIC_ORIGIN?.replace(/\/$/, "");
  if (explicit && BASE_ALLOWLIST.has(explicit)) return explicit;
  return runtime.appEnv === "production"
    ? CANONICAL_PRODUCTION_ORIGIN
    : "http://localhost:3000";
}

export function buildContactConfirmLink(token: string): string {
  return `${resolvePublicOrigin()}/confirmar-contato?token=${encodeURIComponent(token)}`;
}

export function buildPasswordResetLink(
  token: string,
  portalRole?: string,
  flowToken?: string,
): string {
  const url = new URL("/redefinir-senha", resolvePublicOrigin());
  url.searchParams.set("token", token);
  if (portalRole) url.searchParams.set("portal", portalRole);
  if (flowToken) url.searchParams.set("flow", flowToken);
  return url.toString();
}

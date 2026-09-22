import { runtime } from "./runtime.ts";

const CANONICAL_PRODUCTION_ORIGIN = "https://hortvitalmix.vercel.app";

export function resolvePublicOrigin(): string {
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

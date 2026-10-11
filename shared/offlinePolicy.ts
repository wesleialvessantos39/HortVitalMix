import type { PortalRole } from "./contracts/auth.ts";
import type { AdminSectorCode } from "./contracts/adminGovernance.ts";

export type OfflineMode = "atomic" | "idempotent" | "online";
const admin = (role: string) =>
  role === "platform_admin" || role === "platform_super_admin";
export function offlinePath(path: string) {
  const url = new URL(path, "https://offline.hortivitalmix.invalid");
  if (
    url.origin !== "https://offline.hortivitalmix.invalid" ||
    !url.pathname.startsWith("/v1/")
  )
    throw Error("OFFLINE_PATH_INVALID");
  return url;
}
/** One policy shared by transport and server; credentials are never queued. */
export function offlineMutationMode(path: string, role: string): OfflineMode {
  const p = offlinePath(path).pathname;
  if (
    /^\/v1\/(?:auth|mobile-ci)(?:\/|$)/.test(p) ||
    /\/auth(?:\/|$)|\/invites\/(?:accept|validate)|\/bootstrap/.test(p)
  )
    return "online";
  if (/^\/v1\/admin\//.test(p) !== admin(role) && !p.startsWith("/v1/account/"))
    return "online";
  // Provider execution and erasure require a connected, explicit review.
  if (
    p === "/v1/account" ||
    /\/delete$|\/payments\/[^/]+\/start$|\/checkout\/confirm$|\/(?:subscription-refunds|refunds)\/[^/]+\/(?:execute|process)$|\/billing-cycles(?:\/|$)|\/subscriptions\/[^/]+\/(?:bill|billing|run)$|\/verification-queue\/archives\//.test(
      p,
    )
  )
    return "online";
  if (p.startsWith("/v1/account/")) return "atomic";
  if (admin(role)) {
    if (
      /^\/v1\/admin\/(?:notifications|configuration|categories|localities|access-blocks|finance|catalog|reviews|bi|subscription-plans|subscription-refund-policy|subscription-refunds|verification-queue|commerce\/(?:policy|complaints|refund-policy))(?:\/|$)/.test(
        p,
      )
    )
      return "atomic";
    if (
      /^\/v1\/admin\/(?:users|invites|registration-reviews|rural-properties|documents|mobile-releases|app-distribution|commerce|subscriptions)(?:\/|$)/.test(
        p,
      )
    )
      return "idempotent";
    return "online";
  }
  if (role === "producer" && p.startsWith("/v1/producer/")) {
    if (/\/media\/(?:upload|remove)$|\/documents(?:\/|$)/.test(p))
      return "idempotent";
    return "atomic";
  }
  if (
    role === "consumer" &&
    /^\/v1\/(?:cart|favorites|reviews|orders|consumer|commerce|subscriptions|subscription-refunds|payments)(?:\/|$)/.test(
      p,
    )
  ) {
    if (/\/evidence$/.test(p)) return "idempotent";
    return "atomic";
  }
  if (role === "consumer" && p === "/v1/checkout/quotes") return "atomic";
  if (p.startsWith("/v1/notifications")) return "atomic";
  if (role === "producer" && p.startsWith("/v1/commerce/"))
    return p.endsWith("/evidence") ? "idempotent" : "atomic";
  return "online";
}
export function offlineReadAllowed(path: string, role?: string | null) {
  const url = offlinePath(path),
    p = url.pathname;
  if (
    url.searchParams.has("export") ||
    /\/(?:file|download|upload-url|identity-lookup|lookup-identity)(?:\/|$)/.test(
      p,
    )
  )
    return false;
  if (p === "/v1/admin/auth/verify-session")
    return Boolean(role && admin(role));
  if (
    /^\/v1\/(?:auth|mobile-ci)(?:\/|$)/.test(p) ||
    /\/auth(?:\/|$)|\/invites\/(?:validate|accept)|\/bootstrap/.test(p)
  )
    return false;
  if (p.startsWith("/v1/admin/")) return Boolean(role && admin(role));
  if (p.startsWith("/v1/producer/")) return role === "producer";
  if (
    /^\/v1\/(?:account|cart|favorites|consumer|orders|checkout|payments|subscriptions|subscription-refunds|notifications)(?:\/|$)/.test(
      p,
    )
  )
    return Boolean(role);
  if (p.startsWith("/v1/commerce/") && p !== "/v1/commerce/policy")
    return Boolean(role);
  return /^\/v1\/(?:config|categories|localities|discovery|products|stores|producer-stores|commerce|subscription-plans|subscription-options|subscription-refund-policy|reviews|app-distribution|mobile-releases)(?:\/|$)/.test(
    p,
  );
}
export function offlineScope(userId: string, role: string) {
  if (
    !/^[0-9a-f-]{36}$/i.test(userId) ||
    ![
      "consumer",
      "producer",
      "platform_admin",
      "platform_super_admin",
    ].includes(role)
  )
    throw Error("OFFLINE_IDENTITY_INVALID");
  return `${userId.toLowerCase()}:${role as PortalRole}`;
}
export function containsOfflineSecret(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) =>
      /password|token|secret|otp|mfaCode|apiKey|privateKey/i.test(key) ||
      containsOfflineSecret(child),
  );
}
export function offlineAdministrativeSector(
  path: string,
  body?: unknown,
): AdminSectorCode | null {
  const p = offlinePath(path).pathname.replace(/^\/v1\/admin\//, "");
  if (/^(?:users|invites|registration-reviews|sectors)(?:\/|$)/.test(p))
    return "account_governance";
  if (/^(?:documents|rural-properties|verification-queue)(?:\/|$)/.test(p))
    return "document_verification";
  if (/^(?:localities|access-blocks)(?:\/|$)/.test(p))
    return "location_management";
  if (/^(?:categories|catalog)(?:\/|$)/.test(p)) return "catalog_moderation";
  if (/^finance(?:\/|$)/.test(p)) return "finance_ops";
  if (/^reviews(?:\/|$)/.test(p)) return "review_management";
  if (/^(?:subscriptions|subscription-plans)(?:\/|$)/.test(p))
    return "subscription_management";
  if (
    /^(?:subscription-refund-policy|commerce\/(?:subscription-refund-policy|refund-policy|policy))(?:\/|$)/.test(
      p,
    )
  )
    return "refund_policy";
  if (/^subscription-refunds(?:\/|$)/.test(p)) return "refund_management";
  if (p === "commerce/evidence" && body && typeof body === "object")
    return (body as { caseType?: string }).caseType === "refund"
      ? "refund_management"
      : "complaint_management";
  if (/^commerce\/complaints(?:\/|$)/.test(p)) return "complaint_management";
  if (/^commerce\/refunds(?:\/|$)/.test(p)) return "refund_management";
  if (/^commerce\/(?:payment-config|settings)(?:\/|$)/.test(p))
    return "payment_configuration";
  if (/^(?:configuration|bi|app-distribution|mobile-releases)(?:\/|$)/.test(p))
    return "platform_configuration";
  return null;
}

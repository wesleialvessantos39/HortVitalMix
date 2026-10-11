import { describe, expect, it } from "vitest";
import {
  containsOfflineSecret,
  offlineMutationMode,
  offlineReadAllowed,
  offlineScope,
  offlineAdministrativeSector,
} from "../../shared/offlinePolicy.ts";
const roles = [
  "consumer",
  "producer",
  "platform_admin",
  "platform_super_admin",
];
describe("Offline portal boundaries", () => {
  it.each([
    [
      "/v1/admin/verification-queue/123/decide",
      "atomic",
      "document_verification",
    ],
    [
      "/v1/admin/subscription-refunds/123/decision",
      "atomic",
      "refund_management",
    ],
    ["/v1/admin/subscription-refund-policy", "atomic", "refund_policy"],
    ["/v1/admin/commerce/refund-policy", "atomic", "refund_policy"],
    ["/v1/admin/commerce/settings", "idempotent", "payment_configuration"],
  ])(
    "%s retains its actual administrative route and live sector check",
    (path, mode, sector) => {
      expect(offlineMutationMode(path, "platform_admin")).toBe(mode);
      expect(offlineAdministrativeSector(path)).toBe(sector);
    },
  );
  it.each([
    "/v1/admin/commerce/refunds/123/process",
    "/v1/admin/subscription-refunds/123/process",
    "/v1/subscriptions/123/billing",
    "/v1/admin/verification-queue/archives/123",
  ])("%s retains a connected confirmation", (path) => {
    expect(
      offlineMutationMode(
        path,
        path.includes("/admin/") ? "platform_super_admin" : "consumer",
      ),
    ).toBe("online");
  });
  it("producer evidence uses storage idempotency and the case's real sector", () => {
    expect(offlineMutationMode("/v1/commerce/evidence", "producer")).toBe(
      "idempotent",
    );
    expect(
      offlineAdministrativeSector("/v1/admin/commerce/evidence", {
        caseType: "refund",
      }),
    ).toBe("refund_management");
    expect(
      offlineAdministrativeSector("/v1/admin/commerce/evidence", {
        caseType: "complaint",
      }),
    ).toBe("complaint_management");
    expect(offlineReadAllowed("/v1/subscription-refund-policy")).toBe(true);
  });
  it.each(roles)("%s can persist own profile and notifications", (role) => {
    expect(offlineReadAllowed("/v1/account/profile", role)).toBe(true);
    expect(offlineMutationMode("/v1/account/profile", role)).toBe("atomic");
    expect(
      offlineMutationMode(
        role.startsWith("platform_")
          ? "/v1/admin/notifications/read-all"
          : "/v1/notifications/read-all",
        role,
      ),
    ).toBe("atomic");
  });
  it.each(roles)(
    "%s never queues credentials, erasure or live charging",
    (role) => {
      expect(offlineMutationMode("/v1/auth/login", role)).toBe("online");
      expect(offlineMutationMode("/v1/account", role)).toBe("online");
      expect(offlineMutationMode("/v1/payments/123/start", role)).toBe(
        "online",
      );
      expect(offlineReadAllowed("/v1/account/profile?export=1", role)).toBe(
        false,
      );
      expect(offlineReadAllowed("/v1/auth/session", role)).toBe(false);
    },
  );
  it("one public user has two distinct scopes", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(offlineScope(id, "producer")).not.toBe(offlineScope(id, "consumer"));
    expect(() => offlineScope(id, "root")).toThrow();
  });
  it("never caches private reads under the guest scope", () => {
    for (const path of [
      "/v1/account/profile",
      "/v1/cart",
      "/v1/notifications",
      "/v1/commerce/purchases",
      "/v1/producer/products",
      "/v1/admin/dashboard",
      "/v1/admin/auth/verify-session",
    ])
      expect(offlineReadAllowed(path)).toBe(false);
    expect(offlineReadAllowed("/v1/commerce/policy")).toBe(true);
  });
  it("administrative cached access cannot authorize a public portal", () => {
    expect(
      offlineReadAllowed("/v1/admin/auth/verify-session", "producer"),
    ).toBe(false);
    expect(offlineMutationMode("/v1/admin/users/123/status", "producer")).toBe(
      "online",
    );
    expect(offlineMutationMode("/v1/producer/products", "consumer")).toBe(
      "online",
    );
  });
  it("never stores nested credential material", () => {
    expect(
      containsOfflineSecret({ payload: { payment: { apiKey: "fixture" } } }),
    ).toBe(true);
    expect(containsOfflineSecret([{ password: "fixture" }])).toBe(true);
    expect(
      containsOfflineSecret({
        payload: { fullName: "Teste", marketingConsent: true },
      }),
    ).toBe(false);
  });
});

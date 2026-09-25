import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: null,
  createSupabasePublicClient: () => null,
}));

import { register } from "../../server/services/AuthService";

const registration = {
  fullName: "Test User",
  cpf: "00000000000",
  email: "test@example.invalid",
  password: "test-only",
  phone: "+5500000000000",
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("server public registration Edge fallback", () => {
  it("uses Edge when the privileged Vercel client is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          userId: "11111111-1111-4111-8111-111111111111",
          confirmationRequired: true,
          confirmationDispatchAccepted: true,
          confirmationDispatchDeferred: false,
          existingIdentity: false,
          roleAdded: true,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await register(
      registration as any,
      "consumer",
      "server-fallback-test",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/functions/v1/public-registration",
    );
    expect(result).toMatchObject({
      confirmationRequired: true,
      confirmationDispatchAccepted: true,
      transport: "supabase_edge",
    });
  });

  it("maps Edge identity conflict to canonical registration error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "IDENTITY_CONFLICT" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      register(registration as any, "consumer", "server-conflict-test"),
    ).rejects.toMatchObject({
      message: "REGISTRATION_IDENTITY_CONFLICT",
      status: 409,
    });
  });
});

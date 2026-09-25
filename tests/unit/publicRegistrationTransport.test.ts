import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/lib/api", () => ({ api: mocks.api }));

import {
  PUBLIC_REGISTRATION_EDGE_URL,
  registerPublicAccount,
} from "../../src/lib/publicRegistrationTransport";

const payload = {
  fullName: "Test User",
  cpf: "00000000000",
  email: "test@example.invalid",
  password: "test-only",
  phone: "+5500000000000",
};

const failure = (code: string, status?: number) =>
  Object.assign(new Error(code), { status });

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("public registration resilient transport", () => {
  it("uses Edge first and never touches the environment API when Edge succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          confirmationRequired: true,
          confirmationDispatchAccepted: true,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await registerPublicAccount("consumer", payload);

    expect(fetchMock).toHaveBeenCalledWith(
      PUBLIC_REGISTRATION_EDGE_URL,
      expect.objectContaining({ method: "POST", credentials: "omit" }),
    );
    expect(mocks.api).not.toHaveBeenCalled();
    expect(result.transport).toBe("supabase_edge");
  });

  it("uses the same Edge-first path for producer registration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            confirmationRequired: true,
            confirmationDispatchAccepted: true,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      registerPublicAccount("producer", {
        ...payload,
        propertyName: "Test Property",
        activityType: "misto",
      }),
    ).resolves.toMatchObject({ transport: "supabase_edge" });

    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("falls back to Express only when the Edge infrastructure is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "AUTH_UNAVAILABLE",
            requestId: "edge-unavailable",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    mocks.api.mockResolvedValue({
      confirmationRequired: true,
      confirmationDispatchAccepted: true,
    });

    const result = await registerPublicAccount("consumer", payload);

    expect(mocks.api).toHaveBeenCalledOnce();
    expect(result.transport).toBe("express");
  });

  it("does not mask Edge validation errors with an API retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "VALIDATION_ERROR",
            fields: [{ field: "cpf", message: "CPF inválido" }],
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(registerPublicAccount("consumer", payload)).rejects.toMatchObject({
      message: "VALIDATION_ERROR",
      status: 400,
    });
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("does not mask Edge identity conflicts with an API retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "IDENTITY_CONFLICT" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(registerPublicAccount("consumer", payload)).rejects.toMatchObject({
      message: "IDENTITY_CONFLICT",
      status: 409,
    });
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("preserves structured Edge rate-limit failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "REGISTRATION_RATE_LIMITED",
            requestId: "edge-test-request",
          }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(registerPublicAccount("consumer", payload)).rejects.toMatchObject({
      message: "REGISTRATION_RATE_LIMITED",
      status: 429,
      requestId: "edge-test-request",
    });
    expect(mocks.api).not.toHaveBeenCalled();
  });
});

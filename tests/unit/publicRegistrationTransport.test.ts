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
  it("uses Express first when it succeeds", async () => {
    mocks.api.mockResolvedValue({
      confirmationRequired: true,
      confirmationDispatchAccepted: true,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await registerPublicAccount("consumer", payload);
    expect(mocks.api).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.transport).toBe("express");
  });

  it("falls back to Edge after Studio proxy 403", async () => {
    mocks.api.mockRejectedValue(failure("HTTP_403", 403));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          confirmationRequired: true,
          confirmationDispatchAccepted: true,
          transport: "supabase_edge",
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
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(body.role).toBe("consumer");
    expect(result.transport).toBe("supabase_edge");
  });

  it("falls back to Edge after Vercel HTTP 500", async () => {
    mocks.api.mockRejectedValue(failure("HTTP_500", 500));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            confirmationRequired: true,
            confirmationDispatchAccepted: true,
            transport: "supabase_edge",
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
  });

  it("does not mask validation errors", async () => {
    mocks.api.mockRejectedValue(failure("VALIDATION_ERROR", 400));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(registerPublicAccount("consumer", payload)).rejects.toThrow(
      "VALIDATION_ERROR",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not mask identity conflicts", async () => {
    mocks.api.mockRejectedValue(failure("IDENTITY_CONFLICT", 409));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(registerPublicAccount("consumer", payload)).rejects.toThrow(
      "IDENTITY_CONFLICT",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves structured Edge failures", async () => {
    mocks.api.mockRejectedValue(failure("HTTP_500", 500));
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
    await expect(
      registerPublicAccount("consumer", payload),
    ).rejects.toMatchObject({
      message: "REGISTRATION_RATE_LIMITED",
      status: 429,
      requestId: "edge-test-request",
    });
  });
});

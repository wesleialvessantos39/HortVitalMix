import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserById: vi.fn(),
  from: vi.fn(),
  resend: vi.fn(),
  read: vi.fn(),
}));
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: {
    auth: { getUser: mocks.getUser, admin: { getUserById: mocks.getUserById } },
    from: mocks.from,
  },
  createSupabasePublicClient: () => ({ auth: { resend: mocks.resend } }),
}));
vi.mock("../../server/security/confirmationContext.ts", () => ({
  readConfirmationContext: mocks.read,
  issueConfirmationContext: () => "signed-context",
}));
vi.mock("../../server/security/loginRateLimit.ts", () => ({
  loginRateLimit: (_q: any, _s: any, n: any) => n(),
}));
vi.mock("../../server/security/origin.ts", () => ({
  safeRequestOrigin: () => "https://hortvitalmix.vercel.app",
}));
import { confirmationRouter } from "../../server/routes/confirmationRoutes.ts";
const app = express();
app.use(express.json());
app.use(confirmationRouter);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockReturnValue({ uid: "user-1", role: "producer" });
  mocks.getUserById.mockResolvedValue({
    data: {
      user: {
        id: "user-1",
        email: "person@example.com",
        email_confirmed_at: "2026-09-26",
      },
    },
    error: null,
  });
  mocks.from.mockImplementation((name: string) => {
    const data =
      name === "app_people"
        ? {
            full_name: "Pessoa Cadastrada",
            email_normalized: "person@example.com",
          }
        : name === "app_users" ? { status: "active" }
        : [{ role_code: "producer", expires_at: null }];
    const q: any = {
      select: () => q,
      eq: () => q,
      is: () => q,
      in: () => Promise.resolve({ data, error: null }),
      maybeSingle: () => Promise.resolve({ data, error: null }),
      single: () => Promise.resolve({ data, error: null }),
    };
    return q;
  });
  mocks.resend.mockResolvedValue({ error: null });
});
it("recognizes already confirmed proof, returns database name and never sets login cookies", async () => {
  const r = await request(app)
    .post("/confirmation")
    .send({ context: "valid", resend: true });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({
    status: "confirmed",
    fullName: "Pessoa Cadastrada",
    role: "producer",
  });
  expect(r.headers["set-cookie"]).toBeUndefined();
  expect(mocks.resend).not.toHaveBeenCalled();
});
it("refuses arbitrary user identification without a valid proof", async () => {
  mocks.read.mockReturnValue(null);
  const r = await request(app)
    .post("/confirmation")
    .send({ context: "tampered" });
  expect(r.status).toBe(401);
  expect(mocks.getUserById).not.toHaveBeenCalled();
});
it("resends to the signed identity without requiring another email entry", async () => {
  mocks.getUserById.mockResolvedValue({
    data: {
      user: {
        id: "user-1",
        email: "person@example.com",
        email_confirmed_at: null,
      },
    },
  });
  const r = await request(app)
    .post("/confirmation")
    .send({ context: "valid", resend: true });
  expect(r.status).toBe(202);
  expect(mocks.resend).toHaveBeenCalledWith(
    expect.objectContaining({
      email: "person@example.com",
      options: {
        emailRedirectTo: expect.stringContaining("context=signed-context"),
      },
    }),
  );
});
it("does not label a provider outage as an expired link", async () => {
  mocks.getUserById.mockRejectedValue(new Error("network"));
  const r = await request(app).post("/confirmation").send({ context: "valid" });
  expect(r.status).toBe(503);
  expect(r.body.error).toBe("DEPENDENCY_UNAVAILABLE");
});

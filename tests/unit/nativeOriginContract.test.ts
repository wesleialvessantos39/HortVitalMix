import { describe, expect, it, vi } from "vitest";
import request from "supertest";
vi.mock("../../server/config/runtime.ts", async (original) => {
  const module = await original<typeof import("../../server/config/runtime.ts")>();
  return { ...module, runtime: module.buildRuntime({ APP_ENV: "production" }) };
});
vi.mock("../../server/db/pool.ts", () => ({ dbPool: null }));
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: null, createSupabasePublicClient: () => null,
}));
import { app } from "../../server/app";

describe("native request contracts preserve production origin protection", () => {
  it.each(["https://hortvitalmix.vercel.app", "https://future-owned.example"])(
    "accepts bridge transport Origin equal to actual HTTPS backend %s", async (origin) => {
      const host = new URL(origin).host;
      const response = await request(app).post("/v1/auth/login")
        .set("Host", host).set("X-Forwarded-Host", host).set("X-Forwarded-Proto", "https")
        .set("Origin", origin).set("X-HVM-Request", "1").send({});
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("VALIDATION_ERROR");
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
      expect(response.headers["access-control-allow-origin"]).not.toBe("*");
    },
  );

  it.each(["capacitor://localhost", "http://localhost", "https://attacker.example", "null"])(
    "does not relax authenticated CORS for %s", async (origin) => {
      const response = await request(app).post("/v1/auth/login")
        .set("Host", "hortvitalmix.vercel.app").set("X-Forwarded-Host", "hortvitalmix.vercel.app")
        .set("X-Forwarded-Proto", "https").set("Origin", origin).set("X-HVM-Request", "1").send({});
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("ORIGIN_NOT_ALLOWED");
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    },
  );

  it("does not make X-HVM-Request alone an origin bypass in production", async () => {
    const response = await request(app).post("/v1/auth/logout")
      .set("X-HVM-Request", "1").send({});
    expect(response.status).toBe(403);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects a browser's cross-site mutation even if it resembles the native header set", async () => {
    const response = await request(app).post("/v1/auth/login")
      .set("Host", "hortvitalmix.vercel.app").set("X-Forwarded-Host", "hortvitalmix.vercel.app")
      .set("X-Forwarded-Proto", "https").set("Origin", "https://hortvitalmix.vercel.app")
      .set("Sec-Fetch-Site", "cross-site").set("X-HVM-Request", "1").send({});
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("ORIGIN_NOT_ALLOWED");
  });
});

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { z } from "zod";
import { describe, it, expect, vi } from "vitest";

describe("Cadastro Edge: confirmação fora do caminho crítico", () => {
  it.each(["consumer", "producer"])(
    "responde %s após o commit mesmo com envio de e-mail pendente",
    async (role) => {
      let handler: (req: Request) => Promise<Response> = () => {
        throw Error("NOT_LOADED");
      };
      const background: Promise<unknown>[] = [];
      const send = vi.fn(() => new Promise(() => {}));
      const rpc = vi.fn(async () => ({
        data: { status: "active", lgpdRecorded: true },
        error: null,
      }));
      const createUser = vi.fn(async () => ({
        data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
        error: null,
      }));
      const query = {
        select() {
          return this;
        },
        or() {
          return this;
        },
        limit: async () => ({ data: [], error: null }),
      };
      const source = readFileSync(
        "supabase/functions/public-registration/index.ts",
        "utf8",
      ).replace(/^import .*;\n/gm, "");
      const compiled = stripTypeScriptTypes(source, { mode: "transform" });
      const sandbox = {
        z,
        createClient: () => ({
          from: () => query,
          rpc,
          auth: { admin: { createUser }, resend: send },
        }),
        Deno: {
          env: {
            get: (name: string) =>
              ({
                SUPABASE_URL: "https://example.test",
                SUPABASE_ANON_KEY: "local-only",
                SUPABASE_SERVICE_ROLE_KEY: "local-secret-only",
              })[name as "SUPABASE_URL"],
          },
          serve: (fn: typeof handler) => {
            handler = fn;
          },
        },
        EdgeRuntime: { waitUntil: (p: Promise<unknown>) => background.push(p) },
        crypto: webcrypto,
        TextEncoder,
        Request,
        Response,
        performance,
        console,
        btoa,
      };
      vm.runInNewContext(compiled, sandbox);
      const before = performance.now();
      const response = await handler(
        new Request("https://example.test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            role,
            data: {
              fullName: "Maria Aparecida Silva",
              cpf: "52998224725",
              email: "local@example.test",
              password: "Local-only123!",
              phone: "+5569999999999",
              municipality: "Ariquemes",
              state: "RO",
            },
            consent: { policyVersion: "lgpd-cadastro-2026-10-02" },
          }),
        }),
      );
      expect(performance.now() - before).toBeLessThan(1000);
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body).toMatchObject({
        role,
        confirmationRequired: true,
        lgpdRecorded: true,
        confirmationDispatchAccepted: false,
        confirmationDispatchScheduled: true,
      });
      expect(body.confirmationContext).toMatch(/^[\w-]+\.[a-f0-9]{64}$/);
      expect(rpc).toHaveBeenCalledWith(
        "complete_public_registration_with_consent",
        expect.objectContaining({
          p_role: role,
          p_policy_version: "lgpd-cadastro-2026-10-02",
        }),
      );
      expect(createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email_confirm: false,
          user_metadata: expect.objectContaining({
            hvm_registration_role: role,
          }),
        }),
      );
      expect(send).toHaveBeenCalledOnce();
      expect(background).toHaveLength(1);
    },
  );
});

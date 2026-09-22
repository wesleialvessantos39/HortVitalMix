import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { dbPool } from "../../server/db/pool";
import { runtime } from "../../server/config/runtime";
import { asIdentity, createEphemeralIdentity } from "../helpers/identity";
import { integrationDescribe, integrationIt } from "../helpers/integration";

integrationDescribe("Trilha 04 — RLS", () => {
  integrationIt("autenticado lê apenas o próprio desafio e anônimo não lê", async () => {
    if (!dbPool) throw new Error("db indisponível");
    const identity = await createEphemeralIdentity({ role: "consumer" });
    try {
      await dbPool.query(
        `INSERT INTO public.app_contact_verification_challenges
         (user_id,channel,destination_masked,destination_fingerprint,
          otp_hash,otp_salt,token_digest,expires_at,request_id,command_id)
         VALUES ($1,'email','t***@example.test',$2,$3,$4,$5,
                 clock_timestamp()+interval '30 min',$6,$7)`,
        [
          identity.userId,
          "a".repeat(64),
          "b".repeat(64),
          "c".repeat(32),
          "d".repeat(64),
          randomUUID(),
          randomUUID(),
        ],
      );

      const own = await asIdentity(identity)
        .from("app_contact_verification_challenges")
        .select("channel,destination_masked");
      expect(own.error).toBeNull();
      expect(own.data).toHaveLength(1);

      const anon = createClient(runtime.supabaseUrl, runtime.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const anonymousRead = await anon
        .from("app_contact_verification_challenges")
        .select("id");
      expect(anonymousRead.error).not.toBeNull();
    } finally {
      await identity.cleanup();
    }
  });
});

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dbPool } from "../../server/db/pool";
import { runtime } from "../../server/config/runtime";
import { supabaseAdmin } from "../../server/supabase/client";
import { decryptPayload } from "../../server/communication/securePayload";
import { PasswordRecoveryService } from "../../server/services/PasswordRecoveryService";
import { createEphemeralIdentity } from "../helpers/identity";
import { HAS_INTEGRATION } from "../setup/globalSetup";

const enabled =
  HAS_INTEGRATION &&
  /^[0-9a-fA-F]{64}$/.test(runtime.outboxKey) &&
  Boolean(supabaseAdmin);
const suite = enabled ? describe : describe.skip;

suite("Trilha 04 — recuperação de senha", () => {
  it("mantém resposta pública genérica para identidade inexistente", async () => {
    const result = await PasswordRecoveryService.requestRecovery(
      {
        email: "nao-existe-t04@invalid.example",
        portalRole: "consumer",
        commandId: randomUUID(),
      },
      randomUUID(),
      "e".repeat(64),
    );
    expect(result.status).toBe("accepted");
  });

  it("redefine senha por token+perfil+flow e consome o token uma única vez", async () => {
    if (!dbPool || !supabaseAdmin) throw new Error("dependências indisponíveis");
    const identity = await createEphemeralIdentity({ role: "producer" });
    try {
      const commandId = randomUUID();
      const requested = await PasswordRecoveryService.requestRecovery(
        {
          email: identity.email,
          portalRole: "producer",
          commandId,
        },
        randomUUID(),
        "f".repeat(64),
      );
      expect(requested.status).toBe("accepted");

      const outbox = await dbPool.query<{
        encrypted_payload: Buffer;
        payload_nonce: string;
        payload_auth_tag: string;
      }>(
        `SELECT encrypted_payload,payload_nonce,payload_auth_tag
           FROM public.app_outbox_events WHERE command_id=$1`,
        [commandId],
      );
      const payload = decryptPayload(
        outbox.rows[0].encrypted_payload,
        outbox.rows[0].payload_nonce,
        outbox.rows[0].payload_auth_tag,
        runtime.outboxKey,
      ) as { text: string };
      const urlText = payload.text.match(/https?:\/\/\S+/)?.[0];
      expect(urlText).toBeTruthy();
      const url = new URL(urlText!);
      const token = url.searchParams.get("token")!;
      const flowToken = url.searchParams.get("flow")!;
      expect(url.searchParams.get("portal")).toBe("producer");

      const newPassword = "NovaSenhaT04#2026!";
      const reset = await PasswordRecoveryService.resetPassword(
        {
          token,
          flowToken,
          portalRole: "producer",
          newPassword,
        },
        randomUUID(),
        "1".repeat(64),
      );
      expect(reset.status).toBe("success");

      const reused = await PasswordRecoveryService.resetPassword(
        {
          token,
          flowToken,
          portalRole: "producer",
          newPassword: "OutraSenhaT04#2026!",
        },
        randomUUID(),
        "2".repeat(64),
      );
      expect(reused.status).toBe("reused_token");

      const oldLogin = await supabaseAdmin.auth.signInWithPassword({
        email: identity.email,
        password: identity.password,
      });
      expect(oldLogin.error).not.toBeNull();

      const newLogin = await supabaseAdmin.auth.signInWithPassword({
        email: identity.email,
        password: newPassword,
      });
      expect(newLogin.error).toBeNull();
    } finally {
      await identity.cleanup();
    }
  });
});

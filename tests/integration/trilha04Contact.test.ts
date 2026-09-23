import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dbPool } from "../../server/db/pool";
import { runtime } from "../../server/config/runtime";
import { decryptPayload } from "../../server/communication/securePayload";
import { ContactVerificationService } from "../../server/services/ContactVerificationService";
import { createEphemeralIdentity } from "../helpers/identity";
import { HAS_INTEGRATION } from "../setup/globalSetup";

const outboxKey = process.env.OUTBOX_ENCRYPTION_KEY ?? "";
const enabled = HAS_INTEGRATION && /^[0-9a-fA-F]{64}$/.test(outboxKey);
const suite = enabled ? describe : describe.skip;

suite("Trilha 04 — confirmação dupla de contato", () => {
  it("emite OTP+token cifrados e confirma e-mail por OTP", async () => {
    if (!dbPool) throw new Error("db indisponível");
    const identity = await createEphemeralIdentity({ role: "consumer" });
    try {
      const commandId = randomUUID();
      const issued = await ContactVerificationService.requestChallenge({
        userId: identity.userId,
        channel: "email",
        commandId,
        requestId: randomUUID(),
        clientIpHash: "a".repeat(64),
      });
      expect(issued.status).toBe("issued");

      const row = await dbPool.query<{
        encrypted_payload: Buffer;
        payload_nonce: string;
        payload_auth_tag: string;
        otp_hash: string;
        token_digest: string;
      }>(
        `SELECT o.encrypted_payload,o.payload_nonce,o.payload_auth_tag,
                c.otp_hash,c.token_digest
           FROM public.app_outbox_events o
           JOIN public.app_contact_verification_challenges c
             ON c.command_id=o.command_id
          WHERE o.command_id=$1`,
        [commandId],
      );
      expect(row.rowCount).toBe(1);
      const record = row.rows[0];
      const payload = decryptPayload(
        record.encrypted_payload,
        record.payload_nonce,
        record.payload_auth_tag,
        outboxKey,
      ) as { text: string };
      const otp = payload.text.match(/\b(\d{6})\b/)?.[1];
      expect(otp).toMatch(/^\d{6}$/);
      expect(record.otp_hash).not.toBe(otp);
      expect(record.token_digest).not.toContain("http");

      const confirmed = await ContactVerificationService.confirmOtp({
        userId: identity.userId,
        channel: "email",
        otp: otp!,
        commandId: randomUUID(),
        requestId: randomUUID(),
        clientIpHash: "b".repeat(64),
      });
      expect(confirmed).toEqual({ status: "confirmed", channel: "email" });

      const person = await dbPool.query<{ email_verified_at: Date | null }>(
        "SELECT email_verified_at FROM public.app_people WHERE user_id=$1",
        [identity.userId],
      );
      expect(person.rows[0].email_verified_at).toBeInstanceOf(Date);
    } finally {
      await identity.cleanup();
    }
  });

  it("limita cinco tentativas OTP e invalida o desafio", async () => {
    if (!dbPool) throw new Error("db indisponível");
    const identity = await createEphemeralIdentity({ role: "consumer" });
    try {
      const issued = await ContactVerificationService.requestChallenge({
        userId: identity.userId,
        channel: "phone",
        commandId: randomUUID(),
        requestId: randomUUID(),
        clientIpHash: "c".repeat(64),
      });
      expect(issued.status).toBe("issued");

      for (let attempt = 1; attempt <= 5; attempt++) {
        const result = await ContactVerificationService.confirmOtp({
          userId: identity.userId,
          channel: "phone",
          otp: "000000",
          commandId: randomUUID(),
          requestId: randomUUID(),
          clientIpHash: "d".repeat(64),
        });
        expect(result.status).toBe("invalid_code");
      }
      const invalidated = await dbPool.query<{ invalidated: boolean }>(
        `SELECT invalidated_at IS NOT NULL AS invalidated
           FROM public.app_contact_verification_challenges
          WHERE user_id=$1 AND channel='phone'
          ORDER BY created_at DESC LIMIT 1`,
        [identity.userId],
      );
      expect(invalidated.rows[0].invalidated).toBe(true);
    } finally {
      await identity.cleanup();
    }
  });
});

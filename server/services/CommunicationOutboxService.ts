import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import { runtime } from "../config/runtime.ts";
import { reportFailure } from "../config/reportFailure.ts";
import { encryptPayload, decryptPayload } from "../communication/securePayload.ts";
import {
  resolveEmailTransport,
  resolveSmsTransport,
  type EmailMessage,
  type SmsMessage,
  type TransportResult,
} from "../communication/transports.ts";

interface OutboxPayload {
  to: string;
  subject?: string;
  html?: string;
  text: string;
  [key: string]: unknown;
}

export interface EnqueueOptions {
  channel: "email" | "sms";
  recipientUserId: string | null;
  recipientMasked: string;
  templateCode: string;
  payload: OutboxPayload;
  requestId: string;
  commandId: string;
}

export class CommunicationOutboxService {
  static async enqueue(client: PoolClient, options: EnqueueOptions): Promise<string> {
    const encrypted = encryptPayload(options.payload, runtime.outboxKey);
    const res = await client.query<{ id: string }>(
      `INSERT INTO public.app_outbox_events
       (channel, recipient_user_id, recipient_masked, template_code,
        encrypted_payload, payload_nonce, payload_auth_tag, request_id, command_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        options.channel,
        options.recipientUserId,
        options.recipientMasked,
        options.templateCode,
        encrypted.ciphertext,
        encrypted.nonceHex,
        encrypted.authTagHex,
        options.requestId,
        options.commandId,
      ],
    );
    return res.rows[0].id;
  }

  static async dispatch(
    outboxEventId: string,
    requestId: string,
  ): Promise<"dispatched" | "failed" | "abandoned" | "not_found"> {
    if (!dbPool) return "not_found";
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const row = await client.query<{
        id: string;
        channel: "email" | "sms";
        encrypted_payload: Buffer;
        payload_nonce: string;
        payload_auth_tag: string;
        attempts_count: number;
        max_attempts: number;
        status: string;
      }>(
        `SELECT id, channel, encrypted_payload, payload_nonce, payload_auth_tag,
                attempts_count, max_attempts, status
           FROM public.app_outbox_events
          WHERE id = $1
          FOR UPDATE`,
        [outboxEventId],
      );
      if (!row.rowCount) {
        await client.query("ROLLBACK");
        return "not_found";
      }
      const event = row.rows[0];
      if (event.status === "dispatched") {
        await client.query("ROLLBACK");
        return "dispatched";
      }
      if (event.status === "abandoned") {
        await client.query("ROLLBACK");
        return "abandoned";
      }

      let payload: OutboxPayload;
      try {
        payload = decryptPayload(
          event.encrypted_payload,
          event.payload_nonce,
          event.payload_auth_tag,
          runtime.outboxKey,
        ) as OutboxPayload;
      } catch {
        await client.query(
          `UPDATE public.app_outbox_events
              SET status='abandoned', last_error='decrypt_failed'
            WHERE id=$1`,
          [outboxEventId],
        );
        await client.query("COMMIT");
        return "abandoned";
      }

      let result: TransportResult;
      let provider: string;
      if (event.channel === "email") {
        const transport = resolveEmailTransport();
        if (!transport) {
          await this.recordMissingTransport(client, outboxEventId, event, "no_email_transport_configured");
          await client.query("COMMIT");
          return "failed";
        }
        provider = transport.name;
        const message: EmailMessage = {
          to: payload.to,
          subject: payload.subject ?? "HortiVitalMix",
          html: payload.html ?? "",
          text: payload.text,
        };
        result = await transport.send(message);
      } else {
        const transport = resolveSmsTransport();
        if (!transport) {
          await this.recordMissingTransport(client, outboxEventId, event, "no_sms_transport_configured");
          await client.query("COMMIT");
          return "failed";
        }
        provider = transport.name;
        const message: SmsMessage = { to: payload.to, text: payload.text };
        result = await transport.send(message);
      }

      const attempt = event.attempts_count + 1;
      await client.query(
        `INSERT INTO public.app_delivery_attempts
         (outbox_event_id, attempt_number, provider, provider_message_id, outcome, error_category)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          outboxEventId,
          attempt,
          provider,
          result.providerMessageId ?? null,
          result.outcome,
          result.errorCategory ?? null,
        ],
      );

      if (result.outcome === "success") {
        await client.query(
          `UPDATE public.app_outbox_events
              SET status='dispatched', attempts_count=$2,
                  dispatched_at=clock_timestamp(), last_error=NULL
            WHERE id=$1`,
          [outboxEventId, attempt],
        );
        await client.query("COMMIT");
        return "dispatched";
      }

      if (attempt >= event.max_attempts || result.outcome === "permanent_failure") {
        await client.query(
          `UPDATE public.app_outbox_events
              SET status='abandoned', attempts_count=$2, last_error=$3
            WHERE id=$1`,
          [outboxEventId, attempt, result.errorCategory ?? "unknown"],
        );
        await client.query("COMMIT");
        return "abandoned";
      }

      const backoffSeconds = Math.min(300, Math.pow(2, attempt) * 10);
      await client.query(
        `UPDATE public.app_outbox_events
            SET status='failed', attempts_count=$2,
                next_attempt_at=clock_timestamp() + ($3 || ' seconds')::interval,
                last_error=$4
          WHERE id=$1`,
        [outboxEventId, attempt, String(backoffSeconds), result.errorCategory ?? "transient"],
      );
      await client.query("COMMIT");
      return "failed";
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      reportFailure({
        category: "external_timeout",
        requestId,
        detail: (error as Error).message,
      });
      return "failed";
    } finally {
      client.release();
    }
  }

  private static async recordMissingTransport(
    client: PoolClient,
    id: string,
    event: { attempts_count: number; max_attempts: number },
    reason: string,
  ) {
    const attempt = event.attempts_count + 1;
    const abandoned = attempt >= event.max_attempts;
    await client.query(
      `UPDATE public.app_outbox_events
          SET status=$2, attempts_count=$3,
              next_attempt_at=clock_timestamp() + interval '5 minutes',
              last_error=$4
        WHERE id=$1`,
      [id, abandoned ? "abandoned" : "failed", attempt, reason],
    );
  }

  static async dispatchDue(batchSize: number, requestId: string) {
    if (!dbPool) return { processed: 0, dispatched: 0, failed: 0, abandoned: 0 };
    const due = await dbPool.query<{ id: string }>(
      `SELECT id FROM public.app_outbox_events
        WHERE status IN ('pending','failed')
          AND next_attempt_at <= clock_timestamp()
        ORDER BY next_attempt_at ASC
        LIMIT $1`,
      [Math.max(1, Math.min(batchSize, 100))],
    );
    let dispatched = 0;
    let failed = 0;
    let abandoned = 0;
    for (const row of due.rows) {
      const result = await this.dispatch(row.id, requestId);
      if (result === "dispatched") dispatched++;
      else if (result === "abandoned") abandoned++;
      else if (result === "failed") failed++;
    }
    return { processed: due.rows.length, dispatched, failed, abandoned };
  }
}

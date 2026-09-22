import type { PoolClient } from "pg";

// Estrutura preservada para compatibilidade com a Trilha 04 e evolução futura.
// No estado operacional atual, autenticação e segurança enviam mensagens
// exclusivamente pelo Supabase Auth + SMTP configurado no próprio Supabase.
// Por isso a aplicação não mantém provider externo nem chave de outbox em runtime.

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
  static async enqueue(
    _client: PoolClient,
    _options: EnqueueOptions,
  ): Promise<string> {
    throw new Error("SUPABASE_AUTH_ONLY_DELIVERY");
  }

  static async dispatch(
    _outboxEventId: string,
    _requestId: string,
  ): Promise<"dispatched" | "failed" | "abandoned" | "not_found"> {
    return "not_found";
  }

  static async dispatchDue(_batchSize: number, _requestId: string) {
    return { processed: 0, dispatched: 0, failed: 0, abandoned: 0 };
  }
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}
export interface SmsMessage { to: string; text: string; }
export interface TransportResult {
  outcome: "success" | "transient_failure" | "permanent_failure";
  providerMessageId?: string;
  errorCategory?: string;
}
export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<TransportResult>;
}
export interface SmsTransport {
  readonly name: string;
  send(message: SmsMessage): Promise<TransportResult>;
}

export class ResendTransport implements EmailTransport {
  readonly name = "resend";
  constructor(private readonly apiKey: string, private readonly fromAddress: string) {}
  async send(message: EmailMessage): Promise<TransportResult> {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          from: this.fromAddress,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const body = await res.json() as { id?: string };
        return { outcome: "success", providerMessageId: body.id };
      }
      return res.status >= 500
        ? { outcome: "transient_failure", errorCategory: `http_${res.status}` }
        : { outcome: "permanent_failure", errorCategory: `http_${res.status}` };
    } catch {
      return { outcome: "transient_failure", errorCategory: "network" };
    }
  }
}

export class GmailTransport implements EmailTransport {
  readonly name = "gmail";
  constructor(private readonly accessToken: string, private readonly fromAddress: string) {}
  private buildRawMessage(message: EmailMessage) {
    const boundary = `hvm-${Date.now().toString(36)}`;
    const raw = [
      `From: ${this.fromAddress}`,
      `To: ${message.to}`,
      `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString("base64")}?=`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      message.text,
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "",
      message.html,
      `--${boundary}--`,
    ].join("\r\n");
    return Buffer.from(raw, "utf8").toString("base64url");
  }
  async send(message: EmailMessage): Promise<TransportResult> {
    try {
      const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.accessToken}` },
        body: JSON.stringify({ raw: this.buildRawMessage(message) }),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const body = await res.json() as { id?: string };
        return { outcome: "success", providerMessageId: body.id };
      }
      return res.status >= 500 || res.status === 429
        ? { outcome: "transient_failure", errorCategory: `http_${res.status}` }
        : { outcome: "permanent_failure", errorCategory: `http_${res.status}` };
    } catch {
      return { outcome: "transient_failure", errorCategory: "network" };
    }
  }
}

export class TwilioTransport implements SmsTransport {
  readonly name = "twilio";
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
  ) {}
  async send(message: SmsMessage): Promise<TransportResult> {
    try {
      const body = new URLSearchParams({ To: message.to, From: this.fromNumber, Body: message.text });
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (res.ok) {
        const payload = await res.json() as { sid?: string };
        return { outcome: "success", providerMessageId: payload.sid };
      }
      return res.status >= 500 || res.status === 429
        ? { outcome: "transient_failure", errorCategory: `http_${res.status}` }
        : { outcome: "permanent_failure", errorCategory: `http_${res.status}` };
    } catch {
      return { outcome: "transient_failure", errorCategory: "network" };
    }
  }
}

export function resolveEmailTransport(): EmailTransport | null {
  const provider = (process.env.EMAIL_PROVIDER ?? (process.env.NODE_ENV === "development" ? "gmail" : "resend")).toLowerCase();
  if (provider === "gmail") {
    const token = process.env.GMAIL_ACCESS_TOKEN;
    const from = process.env.GMAIL_FROM_EMAIL;
    return token && from ? new GmailTransport(token, from) : null;
  }
  if (provider === "resend") {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM;
    return key && from ? new ResendTransport(key, from) : null;
  }
  return null;
}

export function resolveSmsTransport(): SmsTransport | null {
  if ((process.env.SMS_PROVIDER ?? "").toLowerCase() !== "twilio") return null;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  return sid && token && from ? new TwilioTransport(sid, token, from) : null;
}

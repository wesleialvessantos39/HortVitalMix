/** Provider boundary. No simulated provider is installed in production.
 * Credentials, PAN/CVV and custodial transfers never cross the client/API.
 * The future adapter must verify the provider signature AND retrieve the
 * payment from its authenticated API before returning this trusted record.
 */
export type VerifiedPayment = {
  provider: string;
  eventId: string;
  paymentReference: string;
  intentId: string;
  status: "approved";
  amountCents: number;
  currency: "BRL";
  method: "pix" | "credit_card" | "debit_card";
  paidAt: string;
};
export interface PaymentGateway {
  readonly provider: string;
  readonly supportsPlatformRetention: true;
  verifyAndRetrievePayment(input: {
    body: unknown;
    headers: Record<string, unknown>;
    query: Record<string, unknown>;
  }): Promise<VerifiedPayment>;
  createPayment(input: {
    intentId: string;
    amountCents: number;
    method: "pix" | "credit_card" | "debit_card";
    expiresAt: string;
    channel: "online" | "terminal";
  }): Promise<{
    reference: string;
    pixCopyPaste: string | null;
    pixQrCodeBase64: string | null;
    hostedPaymentUrl: string | null;
  }>;
  refund(input: {
    paymentReference: string;
    refundId: string;
    amountCents: number;
  }): Promise<{ reference: string; status: "pending" | "refunded" }>;
}
// Deliberately fail closed until an account, its retention contract and its
// provider-specific adapter are available. Settings alone cannot activate it.
export function getPaymentGateway(): PaymentGateway | null {
  return null;
}

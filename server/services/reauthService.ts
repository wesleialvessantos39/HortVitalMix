import type { ActorContext } from "./ConfigurationService.ts";

export const REAUTH_WINDOW_MINUTES = 15;

export class ReauthRequiredError extends Error {
  readonly code = "ADMIN_REAUTHENTICATION_REQUIRED";

  constructor() {
    super("Reautenticação recente requerida (janela 15 minutos).");
    this.name = "ReauthRequiredError";
  }
}

export async function assertRecentAuth(actor: ActorContext): Promise<void> {
  const issued = new Date(actor.sessionIssuedAt).getTime();
  if (Number.isNaN(issued)) throw new ReauthRequiredError();

  const ageMs = Date.now() - issued;
  const maxMs = REAUTH_WINDOW_MINUTES * 60 * 1000;
  if (ageMs > maxMs || ageMs < 0) throw new ReauthRequiredError();
}

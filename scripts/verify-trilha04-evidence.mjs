import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260922024933_trilha04_contact_recovery.sql");
const contracts = read("shared/contracts/contactRecovery.ts");
const routes = read("server/routes/contactRecoveryRoutes.ts");
const contact = read("server/services/ContactVerificationService.ts");
const recovery = read("server/services/PasswordRecoveryService.ts");
const outbox = read("server/services/CommunicationOutboxService.ts");
const secure = read("server/communication/securePayload.ts");
const app = read("src/App.tsx");
const otp = read("src/components/forms/OtpInput.tsx");
const css = read("src/pages/auth/auth.css");

const checks = {
  fourTables: [
    "app_contact_verification_challenges",
    "app_password_recovery_requests",
    "app_outbox_events",
    "app_delivery_attempts",
  ].every((name) => migration.includes(`CREATE TABLE public.${name}`)),
  forcedRls: (migration.match(/FORCE ROW LEVEL SECURITY/g) ?? []).length === 4,
  dualEmail: contact.includes("renderContactVerificationEmail") && contact.includes("buildContactConfirmLink"),
  otpHash: contact.includes("hashOtp") && !migration.includes("otp_plain"),
  tokenDigest: contact.includes("digestToken") && !migration.includes("raw_token"),
  encryptedOutbox: secure.includes("aes-256-gcm") && outbox.includes("encrypted_payload"),
  retryBackoff: outbox.includes("Math.pow(2, attempt)"),
  roleScopedRecovery:
    recovery.includes("findActiveIdentityForRole") &&
    recovery.includes("validateRecoveryChallenge"),
  globalRevoke: recovery.includes("DELETE FROM auth.sessions WHERE user_id=$1"),
  canonicalRoutes:
    routes.includes('"/contact/confirm-token"') &&
    routes.includes('"/password/recovery"') &&
    routes.includes('"/password/reset"'),
  frontendRoutes:
    app.includes('path === "/confirmar-contato"') &&
    app.includes('path === "/recuperar-senha"') &&
    app.includes('path === "/redefinir-senha"'),
  otpUx:
    otp.includes('autoComplete={index === 0 ? "one-time-code"') &&
    otp.includes('event.key === "Backspace"') &&
    otp.includes("onPaste"),
  responsive:
    css.includes("@media (max-width:767px)") &&
    css.includes("@media (min-width:768px) and (max-width:1199px)") &&
    css.includes("@media (min-width:1200px)"),
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks }, null, 2));

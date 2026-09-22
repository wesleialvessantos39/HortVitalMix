import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260922024933_trilha04_contact_recovery.sql");
const authRoutes = read("server/routes/authRoutes.ts");
const appServer = read("server/app.ts");
const env = read(".env.example");
const runtime = read("server/config/runtime.ts");
const transports = read("server/communication/transports.ts");
const app = read("src/App.tsx");
const account = read("src/components/Account.tsx");

const forbiddenRuntimeVars = [
  "EMAIL_PROVIDER",
  "RESEND_API_KEY",
  "MAIL_FROM",
  "GMAIL_ACCESS_TOKEN",
  "GMAIL_FROM_EMAIL",
  "SMS_PROVIDER",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "PUBLIC_ORIGIN",
  "OUTBOX_ENCRYPTION_KEY",
];

const combinedRuntime = [env, runtime, transports].join("\n");

const checks = {
  fourTables: [
    "app_contact_verification_challenges",
    "app_password_recovery_requests",
    "app_outbox_events",
    "app_delivery_attempts",
  ].every((name) => migration.includes(`CREATE TABLE public.${name}`)),
  forcedRls: (migration.match(/FORCE ROW LEVEL SECURITY/g) ?? []).length === 4,
  supabaseConfirmation:
    authRoutes.includes('auth.resend({') &&
    authRoutes.includes('type: "signup"'),
  supabaseRecovery:
    authRoutes.includes("auth.resetPasswordForEmail("),
  supabaseReauthentication:
    authRoutes.includes("auth.reauthenticate()"),
  providerPolicy:
    transports.includes('securityMailProvider: SecurityMailProvider = "supabase_auth"') &&
    transports.includes("smsSecurityEnabled = false"),
  noExternalProviderVars:
    forbiddenRuntimeVars.every((name) => !combinedRuntime.includes(name)),
  noParallelT04Router:
    !appServer.includes("contactRecoveryRouter"),
  frontendUsesCanonicalAccountFlow:
    !app.includes("ContactConfirmationPage") &&
    !app.includes("RecoverPasswordPage") &&
    !app.includes("ResetPasswordPage") &&
    account.includes('mode === "confirmation"') &&
    account.includes('mode === "recovery"') &&
    account.includes('mode === "reset"'),
  aliasCompatibility:
    account.includes('path === "/confirmarcontato"') &&
    account.includes('path === "/redefinirsenha"'),
};

const failed = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);

if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks }, null, 2));

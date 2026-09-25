import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const edge = read("supabase/functions/public-registration/index.ts");
const transport = read("src/lib/publicRegistrationTransport.ts");
const account = read("src/components/Account.tsx");
const service = read("server/services/AuthService.ts");
const routes = read("server/routes/authRoutes.ts");
const app = read("server/app.ts");
const vercel = JSON.parse(read("vercel.json"));
const manifest = JSON.parse(read("supabase/manifest.json"));

function requireTokens(source, tokens, prefix) {
  for (const token of tokens)
    if (!source.includes(token)) throw new Error(prefix + ":" + token);
}

requireTokens(
  edge,
  [
    'z.enum(["consumer", "producer"])',
    ".strict()",
    "admin.auth.admin.createUser",
    "publicClient.auth.resend",
    "complete_public_registration",
    "add_public_role_to_existing_identity",
    "SUPABASE_SERVICE_ROLE_KEY",
    "REGISTRATION_RATE_LIMITED",
    "EXISTING_ACCOUNT_CREDENTIALS_INVALID",
    'hvm_portal: "public"',
  ],
  "REGISTRATION_EDGE_EVIDENCE_MISSING",
);

if (
  edge.includes("platform_admin") ||
  edge.includes("platform_super_admin") ||
  /mapbox|googleapis\.com\/maps|twilio|resend/i.test(edge)
)
  throw new Error("REGISTRATION_EDGE_SCOPE_VIOLATION");

requireTokens(
  transport,
  [
    "public-registration",
    "credentials: \"omit\"",
    "[401, 403, 404, 405, 500, 502, 503, 504]",
    "shouldUseExpressFallback",
    "return await edgeRegistration(role, data)",
    "PUBLIC_REGISTRATION_EDGE_URL",
  ],
  "REGISTRATION_TRANSPORT_EVIDENCE_MISSING",
);

if (
  transport.includes("import.meta.env.VITE_SUPABASE_URL") ||
  !transport.includes("https://xipbsazvymkqqfmfegwu.supabase.co")
)
  throw new Error("REGISTRATION_CANONICAL_EDGE_TARGET_MISSING");

if (!account.includes("registerPublicAccount"))
  throw new Error("REGISTRATION_ACCOUNT_TRANSPORT_MISSING");

requireTokens(
  service,
  [
    "CANONICAL_PUBLIC_REGISTRATION_EDGE",
    "registration_privileged_client_unavailable",
    "registerThroughEdge",
  ],
  "REGISTRATION_SERVER_FALLBACK_MISSING",
);

if (
  !routes.includes("!confirmationDispatchAccepted") ||
  !routes.includes("result.confirmationDispatchAccepted")
)
  throw new Error("REGISTRATION_DUPLICATE_CONFIRMATION_GUARD_MISSING");

if (/Access-Control-Allow-Origin[^\n]+\*/.test(app))
  throw new Error("REGISTRATION_EXPRESS_WILDCARD_CORS_REGRESSION");

if (
  vercel.git?.deploymentEnabled?.main !== true ||
  vercel.git?.deploymentEnabled?.["*"] !== false
)
  throw new Error("REGISTRATION_VERCEL_FREE_POLICY_REGRESSION");

if (manifest.schemaVersion !== 29)
  throw new Error("REGISTRATION_SCHEMA_MUST_REMAIN_29");

console.log(
  JSON.stringify({
    status: "registration-hotfix-evidence-ok",
    schemaVersion: 29,
    freeTierOnly: true,
    edgePrimary: true,
    expressFallbackOnly: true,
  }),
);

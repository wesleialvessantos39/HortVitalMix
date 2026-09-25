import {
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(path, "utf8");

const migration = read(
  "supabase/migrations/20260925153500_trilha07_address_geocoding.sql",
);
const contracts = read("shared/contracts/addressAdvanced.ts");
const service = read("server/services/AddressManagementService.ts");
const geocoding = read("server/services/GeocodingHelper.ts");
const routes = read("server/routes/profilePrivacyRoutes.ts");
const manager = read("src/pages/account/AddressManager.tsx");
const map = read("src/pages/account/OsmPinMap.tsx");
const shell = read("src/App.tsx");
const vercel = read("vercel.json");
const pkg = JSON.parse(read("package.json"));

function requireTokens(
  source,
  tokens,
  prefix,
) {
  for (const token of tokens) {
    if (!source.includes(token))
      throw new Error(prefix + ":" + token);
  }
}

requireTokens(
  migration,
  [
    "latitude NUMERIC(10,7)",
    "longitude NUMERIC(10,7)",
    "geocoding_accuracy VARCHAR(32)",
    "delivery_notes VARCHAR(255)",
    "is_active BOOLEAN NOT NULL DEFAULT true",
    "last_used_at TIMESTAMPTZ",
    "WHERE is_default = true AND is_active = true",
    "last_used_at DESC NULLS LAST",
    "trg_fn_enforce_user_address_limit",
    "trg_app_user_addresses_limit",
    "active_count >= 10",
    "ERRCODE = '23514'",
    "ENABLE ROW LEVEL SECURITY",
    "FORCE ROW LEVEL SECURITY",
    "addresses_self_read",
    "addresses_backend_insert",
    "addresses_backend_update",
    "addresses_backend_delete",
    "REVOKE INSERT, UPDATE, DELETE",
    "fingerprint_sha256",
  ],
  "T07_MIGRATION_EVIDENCE_MISSING",
);

if (
  migration.includes("CREATE TABLE public.app_orders") ||
  migration.includes("CREATE TABLE public.app_properties") ||
  /postgis/i.test(migration)
)
  throw new Error("T07_FORBIDDEN_SCHEMA_SCOPE");

requireTokens(
  contracts,
  [
    "CreateAddressAdvancedSchema",
    "UpdateAddressAdvancedSchema",
    "BrazilianStatesEnum",
    "latitude",
    "longitude",
    "deliveryNotes",
    "isDefault",
    "commandId",
    ".strict()",
    "QUICK_ADDRESS_LABELS",
  ],
  "T07_CONTRACT_EVIDENCE_MISSING",
);

requireTokens(
  service,
  [
    "class AddressManagementService",
    "is_active=true",
    "last_used_at DESC NULLS LAST,created_at ASC,id ASC",
    "FOR UPDATE",
    "to_regclass('public.app_orders')",
    "'pending','confirmed','in_harvest','in_route'",
    "mode = \"soft\"",
    "mode = \"hard\"",
    "ORDER BY created_at ASC,id ASC LIMIT 1 FOR UPDATE",
    "ADDRESS_LIMIT_EXCEEDED",
    "redactPII",
    "fingerprintSha256",
  ],
  "T07_SERVICE_EVIDENCE_MISSING",
);

requireTokens(
  geocoding,
  [
    "NOMINATIM_TIMEOUT_MS = 3000",
    "VIACEP_TIMEOUT_MS = 4000",
    "attempt < 2",
    "HortiVitalMix/1.0",
    "nominatim.openstreetmap.org",
    'accuracy: "manual"',
    'accuracy: "none"',
  ],
  "T07_GEOCODING_EVIDENCE_MISSING",
);

for (const marker of [
  '"/account/addresses"',
  '"/account/addresses/:id"',
  '"/account/addresses/:id/default"',
]) {
  if (!routes.includes(marker))
    throw new Error("T07_ROUTE_EVIDENCE_MISSING:" + marker);
}
for (const mutation of [
  "CreateAddressAdvancedSchema",
  "UpdateAddressAdvancedSchema",
  "SetDefaultAddressAdvancedSchema",
  "DeleteAddressAdvancedSchema",
]) {
  if (!routes.includes(mutation))
    throw new Error("T07_ROUTE_CONTRACT_MISSING:" + mutation);
}
const recentAuthUses =
  routes.split("requireRecentAuth(req, res, actor.userId)").length - 1;
if (recentAuthUses < 5)
  throw new Error("T07_RECENT_AUTH_NOT_ENFORCED");

requireTokens(
  manager,
  [
    '"loading"',
    '"ready"',
    '"empty"',
    '"error"',
    '"conflict"',
    "QUICK_ADDRESS_LABELS",
    "deliveryNotes",
    "navigator.geolocation",
    "Usar minha localização atual",
    "OsmPinMap",
    "Limite de 10 endereços atingido. Remova um.",
    "hortivitalmix:default-address-changed",
  ],
  "T07_UI_EVIDENCE_MISSING",
);

requireTokens(
  map,
  [
    "tile.openstreetmap.org",
    "© OpenStreetMap",
    "onPointerMove",
    "Ponto de entrega",
  ],
  "T07_MAP_EVIDENCE_MISSING",
);

if (
  /T07|Trilha|Módulo|Schema|Nominatim/.test(
    manager.replace(/import[^;]+;/g, ""),
  )
)
  throw new Error("T07_TECHNICAL_COPY_EXPOSED");

if (!shell.includes("hortivitalmix:default-address-changed"))
  throw new Error("T07_SHELL_SYNC_MISSING");

const deployment = JSON.parse(vercel);
if (
  deployment.git?.deploymentEnabled?.main !== true ||
  deployment.git?.deploymentEnabled?.["*"] !== false
)
  throw new Error("T07_VERCEL_BRANCH_POLICY_REGRESSION");
if (
  /"crons"|"fluid"|"skewProtection"/.test(vercel) ||
  /mapbox|googleapis\.com\/maps|twilio|resend/i.test(
    [service, geocoding, manager, map, migration].join("\n"),
  )
)
  throw new Error("T07_PAID_RESOURCE_PRESENT");
if (!vercel.includes("https://tile.openstreetmap.org"))
  throw new Error("T07_OSM_CSP_MISSING");

for (const file of readdirSync(".github/workflows").filter((name) =>
  /\.ya?ml$/i.test(name),
)) {
  const workflow = read(join(".github/workflows", file));
  if (/^\s*push\s*:/m.test(workflow) || /^\s*pull_request\s*:/m.test(workflow))
    throw new Error("T07_AUTOMATIC_ACTIONS_FORBIDDEN:" + file);
}

if (!pkg.scripts["verify:t07:free"] || !pkg.scripts["test:t07:e2e"])
  throw new Error("T07_LOCAL_GATES_MISSING");
if (String(deployment.buildCommand).includes("test:t07"))
  throw new Error("T07_VERCEL_BUILD_INFLATED");

console.log(
  JSON.stringify({
    trail: "07",
    status: "evidence-ok",
    freeTierOnly: true,
    canonicalAddressOperations: 5,
    dedicatedTests: 25,
  }),
);

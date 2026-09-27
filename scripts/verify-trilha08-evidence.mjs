import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260926190000_trilha08_rural_properties.sql");
const manifest = JSON.parse(read("supabase/manifest.json"));
const contracts = read("shared/contracts/ruralProperty.ts");
const service = read("server/services/RuralPropertyService.ts");
const routes = read("server/routes/ruralPropertyRoutes.ts");
const ui = read("src/pages/producer/ProducerPropertiesPage.tsx");
const app = read("src/App.tsx");
const account = read("src/pages/account/AccountHub.tsx");
const map = read("src/pages/account/OsmPinMap.tsx");
const css = read("src/index.css");
const vercel = JSON.parse(read("vercel.json"));
const pkg = JSON.parse(read("package.json"));

const required = (source, tokens, code) => {
  for (const token of tokens)
    if (!source.includes(token))
      throw new Error(code + ":" + token);
};

if (manifest.schemaVersion !== 32)
  throw new Error("T08_SCHEMA_VERSION_MUST_BE_32");
if (manifest.migrations.length !== 33)
  throw new Error("T08_MIGRATION_COUNT_MUST_BE_33");
if (
  manifest.migrations.at(-1)?.file !==
  "20260927143315_access_blocks_rural_lifecycle.sql"
)
  throw new Error("T08_LAST_MIGRATION_MISMATCH");
if (
  manifest.migrationHistoryHash !==
  "7f6db57329a8f39ed9b4fbf681438811ce80c45a39f1f4f6ae6a8cad6253c422"
)
  throw new Error("T08_MIGRATION_HASH_MISMATCH");

required(
  migration,
  [
    "CREATE TABLE public.app_properties",
    "CREATE TABLE public.app_property_boundaries",
    "CREATE TABLE public.app_rural_activities",
    "ix_app_properties_producer",
    "ix_app_properties_location",
    "latitude_sede BETWEEN -14 AND -7",
    "longitude_sede BETWEEN -67 AND -59",
    "cultivated_area_hectares <= total_area_hectares",
    "trg_app_properties_revision",
    "trg_app_properties_status_guard",
    "ENABLE ROW LEVEL SECURITY",
    "FORCE ROW LEVEL SECURITY",
    "properties_self_read",
    "properties_admin_read",
    "properties_backend_insert",
    "WITH CHECK (false)",
    "GRANT SELECT",
    "REVOKE INSERT, UPDATE, DELETE",
  ],
  "T08_MIGRATION_EVIDENCE_MISSING",
);

if (migration.includes("REFERENCES public.app_user_addresses"))
  throw new Error("T08_PROPERTY_MUST_NOT_REFERENCE_PERSONAL_ADDRESS");
if (/CREATE EXTENSION\s+.*postgis/i.test(migration))
  throw new Error("T08_POSTGIS_PROHIBITED");
if (/0\.1\s*(?:,|\))/i.test(migration))
  throw new Error("T08_FAKE_AREA_PLACEHOLDER_PROHIBITED");

required(
  contracts,
  [
    "SaveWizardStepSchema",
    "Step1IdentificationSchema",
    "Step2DimensionsSchema",
    "Step3WaterSchema",
    "Step4ActivitySchema",
    "Step5ReviewSchema",
    "GeoJsonPolygonSchema",
    ".min(-14).max(-7)",
    ".min(-67).max(-59)",
    "legumes_picados",
    "hasWashingFacility",
    "expectedRevision",
    "commandId",
  ],
  "T08_CONTRACT_EVIDENCE_MISSING",
);

required(
  service,
  [
    "PRODUCER_PROFILE_REQUIRED",
    "pg_advisory_xact_lock",
    "PROPERTY_REVISION_CONFLICT",
    "PROPERTY_REHOMOLOGATION_REQUIRED",
    "rural_property.step_saved",
    "rural_property.submitted",
    "GREATEST(wizard_current_step,",
    "app_property_boundaries",
    "app_rural_activities",
    "assertComplete",
    "redactPII",
  ],
  "T08_SERVICE_EVIDENCE_MISSING",
);

if (service.includes("app_user_addresses"))
  throw new Error("T08_SERVICE_ADDRESS_COUPLING_PROHIBITED");

required(
  routes,
  [
    '"/producer/properties"',
    '"/producer/properties/:id"',
    '"/producer/properties/wizard/save-step"',
    '"/producer/properties/:id/submit"',
    "originProtection",
    "requireRecentAuth",
    "verifyRecentAuthProof",
  ],
  "T08_ROUTE_EVIDENCE_MISSING",
);

required(
  ui,
  [
    "/produtor/propriedades",
    "Etapa {step} de 5",
    "2000",
    "Rascunho salvo",
    "Rascunho salvo localmente",
    "Continuar mais tarde",
    "GeoJsonPolygonSchema",
    "OsmPinMap",
    "initialCenter={{ latitude: -9.9132, longitude: -63.0408 }}",
    "Legumes picados",
    "agroecologicalCommitment",
  ],
  "T08_UI_EVIDENCE_MISSING",
);

required(
  app,
  [
    "ProducerPropertiesPage",
    'path === "/produtor/propriedades"',
    'path === "/produtor/propriedades/novo"',
  ],
  "T08_APP_ROUTE_EVIDENCE_MISSING",
);

required(
  account,
  [
    "Imóveis rurais",
    'onNavigate("/produtor/propriedades")',
  ],
  "T08_ACCOUNT_LINK_EVIDENCE_MISSING",
);

required(
  map,
  [
    "initialCenter?: Coordinates",
    "initialZoom?: number",
  ],
  "T08_MAP_REUSE_EVIDENCE_MISSING",
);

for (const breakpoint of ["1024px", "768px", "360px", "320px"])
  if (!css.includes(breakpoint))
    throw new Error("T08_BREAKPOINT_MISSING:" + breakpoint);

if (
  vercel.git?.deploymentEnabled?.main !== true ||
  vercel.git?.deploymentEnabled?.["*"] !== false
)
  throw new Error("T08_VERCEL_MUST_REMAIN_MAIN_ONLY");

const buildCommand = String(vercel.buildCommand ?? "");
if (buildCommand.includes("test:t08") || buildCommand.includes("typecheck"))
  throw new Error("T08_VERCEL_HOBBY_BUILD_REGRESSION");

for (const token of [
  "Google Maps",
  "Mapbox",
  "Twilio",
  "Resend",
  "Supabase Branch",
])
  if (migration.includes(token) && !migration.includes("Não cria"))
    throw new Error("T08_PAID_DEPENDENCY_REGRESSION:" + token);

for (const script of [
  "test:t08:unit",
  "test:t08:e2e",
  "verify:t08:evidence",
  "verify:t08:free",
])
  if (!pkg.scripts?.[script])
    throw new Error("T08_PACKAGE_SCRIPT_MISSING:" + script);

console.log(
  JSON.stringify({
    status: "trilha08-evidence-ok",
    schemaVersion: manifest.schemaVersion,
    migrationCount: manifest.migrations.length,
    baselineTests: 32,
    freeTierOnly: true,
    scope: "repository-structure-only",
  }),
);

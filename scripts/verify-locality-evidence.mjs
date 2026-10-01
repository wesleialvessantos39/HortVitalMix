import { readFileSync } from "node:fs";

/**
 * Evidência da rodada de localidades (base pré-T12, itens 1 a 7 do proprietário).
 *
 * Prova os quatro pilares: banco (cobertura, escopo de entrega, bloqueio
 * parcial), contratos, servidor/Edge e superfície de interface — incluindo a
 * remoção do destaque visual do ícone administrativo (item 6) e o bloco de
 * configuração inicial dirigido pelo estado real do banco (item 7).
 */

const read = (path) => readFileSync(path, "utf8");
const manifest = JSON.parse(read("supabase/manifest.json"));
const foundation = read(
  "supabase/migrations/20261001154144_locality_coverage_foundation.sql",
);
const enforcement = read(
  "supabase/migrations/20261001154343_registration_locality_enforcement.sql",
);
const contracts = read("shared/contracts/locality.ts");
const localityService = read("server/services/LocalityService.ts");
const accessScopeService = read("server/services/AccessScopeService.ts");
const localityRoutes = read("server/routes/localityRoutes.ts");
const adminRoutes = read("server/routes/adminLocalityRoutes.ts");
const app = read("server/app.ts");
const authService = read("server/services/AuthService.ts");
const authRoutes = read("server/routes/authRoutes.ts");
const authContracts = read("shared/contracts/auth.ts");
const edge = read("supabase/functions/public-registration/index.ts");
const ruralService = read("server/services/RuralPropertyService.ts");
const addressService = read("server/services/AddressManagementService.ts");
const store = read("src/lib/localityStore.ts");
const hook = read("src/hooks/useLocality.ts");
const catalog = read("src/services/LocalityCatalogService.ts");
const appShell = read("src/App.tsx");
const account = read("src/components/Account.tsx");
const router = read("src/pages/admin/AdminRouter.tsx");
const shell = read("src/components/admin/AdminPortalShell.tsx");
const hub = read("src/pages/account/AccountHub.tsx");
const indexCss = read("src/index.css");
const governance = read("shared/contracts/adminGovernance.ts");

const required = (source, tokens, code) => {
  for (const token of tokens)
    if (!source.includes(token)) throw new Error(code + ":" + token);
};

const files = [
  "src/pages/admin/locality/AdminLocalitiesPage.tsx",
  "src/pages/admin/AdminAccessBlocksPage.tsx",
  "src/pages/producer/DeliveryScopePage.tsx",
];
for (const file of files) read(file);

if (manifest.schemaVersion < 42)
  throw new Error("LOCALITY_SCHEMA_VERSION_MUST_BE_AT_LEAST_42");
if (!/^[0-9a-f]{64}$/.test(manifest.migrationHistoryHash))
  throw new Error("LOCALITY_MIGRATION_HASH_MALFORMED");
for (const file of [
  "20261001154144_locality_coverage_foundation.sql",
  "20261001154343_registration_locality_enforcement.sql",
]) {
  if (!manifest.migrations.some((entry) => entry.file === file))
    throw new Error("LOCALITY_MIGRATION_MISSING_FROM_MANIFEST:" + file);
}

// Banco — itens 1, 2, 3 e 5.
required(
  foundation,
  [
    "CREATE TABLE public.app_municipalities",
    "CREATE TABLE public.app_producer_delivery_scopes",
    "CREATE TABLE public.app_producer_delivery_municipalities",
    "CREATE TABLE public.app_access_partial_blocks",
    "CREATE TABLE public.app_access_partial_block_municipalities",
    "CREATE TABLE public.app_access_partial_block_properties",
    "Ariquemes",
    "1100023",
    "Machadinho D''Oeste",
    "1100130",
    "Rio Crespo",
    "Cacaulândia",
    "Cujubim",
    "Vale do Anari",
    "fn_locality_normalize",
    "fn_resolve_municipality",
    "fn_locality_coverage",
    "fn_producer_delivers_to",
    "fn_is_publish_blocked",
    "fn_is_purchase_blocked",
    "fn_partial_block_kind",
    "location_management",
    "FORCE ROW LEVEL SECURITY",
    "ON public.app_access_partial_blocks(user_id, subject) WHERE is_active",
  ],
  "LOCALITY_FOUNDATION_MISSING",
);

required(
  enforcement,
  [
    "fn_assert_locality_covered",
    "DROP FUNCTION IF EXISTS public.complete_public_registration(",
    "p_municipality",
    "p_state",
    "app_people",
    "municipality_id",
  ],
  "LOCALITY_ENFORCEMENT_MISSING",
);

// Contratos — mensagens literais e modelo completo.
required(
  contracts,
  [
    "essa região está desativada, dúvidas entre em contato conosco hortivitalmix@gmail.com",
    '"active", "inactive", "unknown"',
    '"property_municipality",',
    '"all",',
    '"custom",',
    '"producer_publishing",',
    '"consumer_purchasing",',
    "CreatePartialBlockSchema",
    "UpdateProducerDeliveryScopeSchema",
    "MunicipalityImpactSchema",
    "PartialBlockSubjectLookupSchema",
  ],
  "LOCALITY_CONTRACTS_MISSING",
);

required(
  governance,
  ['"location_management"'],
  "LOCALITY_SECTOR_NOT_DECLARED",
);

// Servidor — guardas, auditoria e travas de cadastro/publicação/endereço.
required(
  localityService,
  [
    "listMunicipalities",
    "listAdminMunicipalities",
    "resolveCoverage",
    "assertOperational",
    "deactivationImpact",
    "app_audit_events",
    "pg_advisory_xact_lock",
  ],
  "LOCALITY_SERVICE_MISSING",
);

required(
  accessScopeService,
  [
    "getDeliveryScope",
    "updateDeliveryScope",
    "canPublishIn",
    "canPurchaseIn",
    "listPartialBlocks",
    "createPartialBlock",
    "revokePartialBlock",
  ],
  "ACCESS_SCOPE_SERVICE_MISSING",
);

required(
  localityRoutes,
  [
    'localityRouter.get("/localities"',
    '"/localities/coverage"',
    '"/producer/delivery-scope"',
    "verifyRecentAuthProof",
  ],
  "LOCALITY_PUBLIC_ROUTES_MISSING",
);

required(
  adminRoutes,
  [
    "requireLocationManagement",
    'adminLocalityRouter.get("/localities", ...guard',
    '"/localities/:municipalityId/impact"',
    'adminLocalityRouter.patch(',
    '"/access-blocks/subject"',
    '"/access-blocks/subject-properties"',
    '"/access-blocks/:blockId/revoke"',
    "location_management",
  ],
  "LOCALITY_ADMIN_ROUTES_MISSING",
);

required(
  app,
  [
    "adminLocalityRouter",
    "/v1/admin",
    "/api/v1/admin",
    "/_hvm_api/v1/admin",
  ],
  "LOCALITY_ROUTES_NOT_MOUNTED",
);

required(
  authService,
  [
    "assertLocalityActive",
    "REGISTRATION_LOCALITY_DISABLED",
    "REGISTRATION_LOCALITY_NOT_COVERED",
    "p_municipality",
    "p_state",
  ],
  "AUTH_LOCALITY_ENFORCEMENT_MISSING",
);

required(
  authRoutes,
  ["LOCALITY_DISABLED", "LOCALITY_NOT_COVERED"],
  "AUTH_ROUTES_LOCALITY_MAPPING_MISSING",
);

required(
  authContracts,
  ["municipality", "state"],
  "AUTH_CONTRACTS_LOCALITY_MISSING",
);

required(
  edge,
  [
    "assertLocalityActive",
    "fn_locality_coverage",
    "LOCALITY_DISABLED_MESSAGE",
    "p_municipality",
  ],
  "EDGE_LOCALITY_ENFORCEMENT_MISSING",
);

required(
  ruralService,
  ["assertPropertyLocality", "PUBLISHING_BLOCKED", "fn_is_publish_blocked"],
  "RURAL_PROPERTY_LOCALITY_MISSING",
);

required(
  addressService,
  ["assertAddressLocality"],
  "ADDRESS_LOCALITY_MISSING",
);

// Interface — itens 1, 3, 4, 5, 6 e 7.
required(
  store,
  [
    "hvm.locality.v1",
    "hvm:locality-changed",
    "readStoredLocality",
    "writeStoredLocality",
    "localityLabel",
  ],
  "LOCALITY_STORE_MISSING",
);

required(
  catalog,
  [
    '"/v1/localities"',
    "/v1/localities/coverage?state=",
    '"/v1/producer/delivery-scope"',
    "fetchMunicipalities",
    "saveDeliveryScope",
  ],
  "LOCALITY_CATALOG_SERVICE_MISSING",
);

required(
  hook,
  ["useLocality", "coverage", "unavailable", "select"],
  "LOCALITY_HOOK_MISSING",
);

required(
  appShell,
  [
    "useLocality",
    "localityBlockedMessage",
    "locality-list",
    "Alterar localização",
    "DeliveryScopePage",
    "/produtor/entrega",
  ],
  "LOCALITY_APPSHELL_MISSING",
);

required(
  account,
  [
    "LOCALITY_DISABLED_MESSAGE",
    "LOCALITY_NOT_COVERED_MESSAGE",
    'name="municipality"',
    'name="state"',
    'adminBootstrapStatus === "open" &&',
  ],
  "LOCALITY_ACCOUNT_MISSING",
);

if (account.includes("Configuração inicial concluída"))
  throw new Error("ITEM7_BOOTSTRAP_BLOCK_NOT_REMOVED");
if (account.includes("Verificar configuração inicial"))
  throw new Error("ITEM7_LEGACY_BOOTSTRAP_ACTION_STILL_PRESENT");

required(
  hub,
  ['onNavigate("/produtor/entrega")'],
  "DELIVERY_SCOPE_ENTRY_MISSING",
);

required(
  router,
  [
    "AdminLocalitiesPage",
    "AdminAccessBlocksPage",
    '"location_management"',
    'path==="/admin/localidades"',
    'path==="/admin/bloqueios"',
  ],
  "ADMIN_LOCALITY_ROUTES_MISSING",
);

required(
  shell,
  ['["/admin/localidades"', '["/admin/bloqueios"', "location_management"],
  "ADMIN_LOCALITY_MENU_MISSING",
);

if (indexCss.includes("admin-home-entry"))
  throw new Error("ITEM6_ADMIN_ICON_STYLE_STILL_PRESENT");
required(
  appShell,
  ['className="icon admin-home-entry"'],
  "ITEM6_ADMIN_ICON_CLASS_MISSING",
);

required(
  appShell,
  ["locality-option"],
  "LOCALITY_SELECTOR_STYLE_MISSING",
);
required(indexCss, [".locality-option", ".locality-list"], "LOCALITY_CSS_MISSING");

console.log(
  JSON.stringify({
    status: "locality-evidence-ok",
    schemaVersion: manifest.schemaVersion,
    migrationCount: manifest.migrations.length,
    items: {
      1: "cobertura por município com gestão do Super administrador",
      2: "trava de cadastro e publicação por localidade",
      3: "escopo de entrega do produtor",
      4: "troca de região independente do login",
      5: "bloqueios parciais por localidade",
      6: "ícone administrativo sem círculo e sem cor",
      7: "bloco de configuração inicial dirigido pelo banco",
    },
    scope: "repository-structure-only",
  }),
);

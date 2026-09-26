import {readFileSync} from "node:fs";
const read=p=>readFileSync(p,"utf8");
const migration=read("supabase/migrations/20260925002000_trilha06_profile_privacy.sql");
const hardening=read("supabase/migrations/20260925010000_trilha06_homologation_hardening.sql");
const fingerprintFix=read("supabase/migrations/20260925011000_trilha06_fingerprint_normalization_fix.sql");
const service=read("server/services/ProfilePrivacyService.ts");
const resolver=read("server/services/AccountPersonResolver.ts");
const addressService=read("server/services/AddressManagementService.ts");
const routes=read("server/routes/profilePrivacyRoutes.ts");
const recentAuth=read("server/security/recentAuth.ts");
const adminRoutes=read("server/routes/adminGovernanceRoutes.ts");
const ui=read("src/pages/account/AccountHub.tsx");
const accountGate=read("src/pages/account/AccountSessionGate.tsx");
const privacyUi=read("src/pages/account/PrivacyExportButton.tsx");
const validationDoc=read("docs/TRILHA06_VALIDACAO.md");
const vercel=read("vercel.json");
for(const token of ["app_user_addresses","app_user_preferences","app_consent_records","FORCE ROW LEVEL SECURITY","uq_app_user_addresses_default","trg_app_consent_records_immutable"])if(!migration.includes(token))throw new Error("T06_MIGRATION_EVIDENCE_MISSING:"+token);
for(const token of ["trg_fn_t06_touch_address","extensions.digest","fingerprint_sha256","REVOKE INSERT, UPDATE, DELETE"])if(!hardening.includes(token))throw new Error("T06_HARDENING_EVIDENCE_MISSING:"+token);
for(const token of ["[[:space:]]+","extensions.digest","fingerprint_sha256"])if(!fingerprintFix.includes(token))throw new Error("T06_FINGERPRINT_FIX_EVIDENCE_MISSING:"+token);
for(const token of ["FOR UPDATE","policyVersion","exportData","redactPII","includeInactive: true","getPreferences(userId, role, true)"])if(!service.includes(token))throw new Error("T06_SERVICE_EVIDENCE_MISSING:"+token);
for(const token of ["app_people p","app_admin_principals","u.status='active'","r.role_code=ap.portal_role","ap.portal_role=$2","PERSON_NOT_FOUND"])if(!resolver.includes(token))throw new Error("T06_PERSON_RESOLVER_EVIDENCE_MISSING:"+token);
if(/cpf_normalized|email_normalized/.test(resolver))throw new Error("T06_PERSON_RESOLVER_MUST_NOT_INFER_IDENTITY");
for(const token of ["replacementDefaultId","ORDER BY created_at ASC,id ASC","is_active=false",">= 10","resolveAccountPersonId"])if(!addressService.includes(token))throw new Error("T07_ADDRESS_REGRESSION_EVIDENCE_MISSING:"+token);
for(const token of ["/account/profile","/account/addresses","/account/preferences","verifyRecentAuthProof","adminSessionMiddleware","req.adminActor","hvm_portal_role","ACTIVE_ROLE_REQUIRED"])if(!routes.includes(token))throw new Error("T06_ROUTE_EVIDENCE_MISSING:"+token);
for(const token of ["RECENT_AUTH_WINDOW_MS","timingSafeEqual","session_id","hvm:recent-auth:v1"])if(!recentAuth.includes(token))throw new Error("T06_REAUTH_EVIDENCE_MISSING:"+token);
for(const token of ["/conta/perfil","/conta/enderecos","/conta/preferencias","/conta/privacidade","hortivitalmix:default-address-changed","PostalLookupService","PrivacyExportButton","Promise.allSettled"])if(!ui.includes(token))throw new Error("T06_UI_EVIDENCE_MISSING:"+token);
for(const token of ["current-password","Confirmar e exportar","/v1/auth/login","/v1/admin/auth/login","platform_admin","platform_super_admin"])if(!privacyUi.includes(token))throw new Error("T06_PRIVACY_UI_EVIDENCE_MISSING:"+token);
for(const token of ["/v1/admin/auth/verify-session","portalKind: \"administrative\""])if(!accountGate.includes(token))throw new Error("T06_ACCOUNT_GATE_EVIDENCE_MISSING:"+token);
if(accountGate.includes("/v1/auth/session"))throw new Error("T06_ADMIN_HANDOFF_MUST_NOT_USE_PUBLIC_SESSION");
for(const token of ["issueRecentAuthProof","RECENT_AUTH_WINDOW_MS",'res.cookie("hvm_reauth"'])if(!adminRoutes.includes(token))throw new Error("T06_ADMIN_REAUTH_EVIDENCE_MISSING:"+token);
const authRoutes=read("server/routes/authRoutes.ts");
for(const token of ["setRecentAuth","issueRecentAuthProof","hvm_reauth"])if(!authRoutes.includes(token))throw new Error("T06_LOGIN_REAUTH_EVIDENCE_MISSING:"+token);
if(vercel.includes("|| true"))throw new Error("T06_VERCEL_TYPECHECK_BYPASS_PRESENT");
if(!vercel.includes('"main": true')||!vercel.includes('"*": false'))throw new Error("T06_VERCEL_FREE_BRANCH_POLICY_MISSING");
if(/"crons"|"fluid"|"skewProtection"/.test(vercel))throw new Error("T06_VERCEL_PAID_FEATURE_PRESENT");
if(validationDoc.includes("Schema lógico do repositório: 26."))throw new Error("T06_DOC_SCHEMA_STALE");
for(const token of ["T06 foi selada em schema 28","schema 29","T07 aditiva"])if(!validationDoc.includes(token))throw new Error("T06_DOC_EVIDENCE_MISSING:"+token);
const canonicalOperations=[
  ["GET","/account/profile"],["PATCH","/account/profile"],
  ["GET","/account/addresses"],["POST","/account/addresses"],
  ["PATCH","/account/addresses/:id/default"],["DELETE","/account/addresses/:id"],
  ["GET","/account/preferences"],["PATCH","/account/preferences"],
];
if(canonicalOperations.length!==8)throw new Error("T06_CANONICAL_ROUTE_COUNT");
console.log(JSON.stringify({trail:"06",status:"evidence-ok",freeTierOnly:true}));

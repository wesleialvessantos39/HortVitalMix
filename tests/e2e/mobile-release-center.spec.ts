import { expect, test, type Page } from "@playwright/test";
import type { AdminMobileRelease, AdminMobileReleases, MobileReleaseCommand, PublicMobileReleases } from "../../shared/contracts/mobileReleases";
import { MOBILE_CI_AUDIENCE } from "../../shared/contracts/mobileReleases";
import { emulateCapacitorBridge } from "./helpers/capacitorBridge";

const actorId = "11111111-1111-4111-8111-111111111111";
const oldCommit = "a".repeat(40);
const nativeFingerprint = "a".repeat(64);
function release(overrides: Partial<AdminMobileRelease> = {}): AdminMobileRelease {
  const item: AdminMobileRelease = { id: "22222222-2222-4222-8222-222222222222", platform: "android", version: "1.3.0", buildNumber: 3, minSupportedBuild: 2, runtimeFingerprint: nativeFingerprint, sourceCommit: "b".repeat(40), schemaVersion: 68, sha256: "c".repeat(64), sizeBytes: 5100000, channel: "apk", url: "", downloadUrl: "/downloads/android", publishedAt: null, releaseNotes: "Correções de sincronização e melhorias de navegação.", status: "verified", verifiedAt: "2026-10-09T16:00:00Z", signingIdentity: "d".repeat(64), ciRunId: "123456789", ciRunAttempt: 1, ...overrides };
  if (item.platform === "android") item.url = `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/public/app-downloads/android/${item.buildNumber}/${item.sha256}.apk`;
  return item;
}
function center(releases = [release()]): AdminMobileReleases {
  return { revision: 1, updatedAt: "2026-10-09T16:00:00Z", minimumSupportedBuild: { android: 0, ios: 0 }, autoPublish: { android: false, ios: false }, releases, sync: { state: releases.length ? "ready" : "awaiting_first_release", lastVerifiedAt: releases.length ? "2026-10-09T16:00:00Z" : null, pendingUploads: 0, webCommit: oldCommit, webSchema: 68, storageConfigured: true, oidcAudience: MOBILE_CI_AUDIENCE } };
}
function publicPolicy(item: AdminMobileRelease | null, minimumBuild = 0): PublicMobileReleases {
  if (!item) return { revision: 1, updatedAt: "2026-10-09T16:00:00Z", minimumSupportedBuild: { android: minimumBuild, ios: 0 }, android: null, ios: null };
  const { status: _status, verifiedAt: _verified, signingIdentity: _signer, ciRunId: _run, ciRunAttempt: _attempt, ...publicRelease } = item;
  return { revision: 1, updatedAt: "2026-10-09T16:00:00Z", minimumSupportedBuild: { android: item.platform === "android" ? minimumBuild : 0, ios: item.platform === "ios" ? minimumBuild : 0 }, android: item.platform === "android" ? publicRelease : null, ios: item.platform === "ios" ? publicRelease : null };
}
async function fixture(page: Page, options: {
  role?: "platform_admin" | "platform_super_admin" | "producer";
  denied?: boolean;
  data?: () => AdminMobileReleases;
  policy?: () => PublicMobileReleases;
  publicStatus?: () => number;
  command?: (body: MobileReleaseCommand) => { status: number; data: unknown };
  reauth?: (body: { password: string }) => { status: number; data: unknown };
} = {}) {
  page.on("pageerror", (error) => console.warn("LOCAL_LEGACY_COMPONENT_ERROR", error.message));
  const commands: MobileReleaseCommand[] = [];
  let adminReads = 0;
  const role = options.role ?? "platform_super_admin";
  await page.addInitScript(() => localStorage.setItem("hvm.admin.session", JSON.stringify({ accessToken: "synthetic-mobile-admin", refreshToken: "synthetic-mobile-refresh", expiresAt: Date.now() + 3600000 })));
  // Native management is retained as a legacy component, no longer presented
  // in the PWA department. Verify it in an isolated LOCAL Vite harness.
  if (!options.denied) await page.route("**/admin/aplicativos", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';const {createRoot}=ReactDOM;
    const {AdminMobileReleaseCenter}=await import('/src/pages/admin/AdminMobileReleaseCenter.tsx');
    const {NotificationProvider}=await import('/src/components/notifications/NotificationProvider.tsx');
    import '/src/index.css';import '/src/pages/admin/admin.css';
    createRoot(document.getElementById('root')).render(React.createElement(NotificationProvider,{session:${JSON.stringify({ userId: actorId, email: 'synthetic@example.invalid', roles: [role], activeRole: role, portalKind: 'administrative' })}},React.createElement(AdminMobileReleaseCenter,{access:${JSON.stringify({ authorized: true, role, sectors: ["platform_configuration"], deniedSectors: [], requiresReauth: false })}})));
    </script></body></html>` }));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/(?:api|_hvm_api)/, "");
    if (!path.startsWith("/v1/")) return route.fallback();
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (path === "/v1/config") return json({ platformName: "HortiVitalMix", slogan: "Tudo fresco.", defaultMunicipality: "Ariquemes", defaultState: "RO", currency: "BRL", timezone: "America/Cuiaba", supportEmail: "suporte@example.invalid", supportPhone: null, revision: 1 });
    if (path === "/v1/auth/session") return json({ userId: actorId, email: "synthetic@example.invalid", fullName: "Pessoa Sintética", roles: [role], activeRole: role, portalKind: role === "producer" ? "public" : "administrative" });
    if (path === "/v1/admin/auth/verify-session") return json({ authorized: true, role, sectors: ["platform_configuration"], deniedSectors: options.denied ? ["platform_configuration"] : [], requiresReauth: false });
    if (path === "/v1/admin/auth/reauthenticate") {
      const response = options.reauth?.(request.postDataJSON()) ?? { status: 401, data: { error: "INVALID_ADMIN_CREDENTIALS" } };
      return json(response.data, response.status);
    }
    if (path === "/v1/admin/mobile-releases") { adminReads++; return json(options.data?.() ?? center()); }
    if (path === "/v1/admin/mobile-releases/commands") {
      const command = request.postDataJSON() as MobileReleaseCommand;
      commands.push(command);
      const response = options.command?.(command) ?? { status: 503, data: { error: "DEPENDENCY_UNAVAILABLE" } };
      return json(response.data, response.status);
    }
    if (path === "/v1/mobile-releases") {
      const status = options.publicStatus?.() ?? 200;
      return json(status === 200 ? options.policy?.() ?? publicPolicy(null) : { error: "DEPENDENCY_UNAVAILABLE" }, status);
    }
    if (path === "/v1/app-distribution" || path === "/v1/admin/app-distribution") {
      const empty = { available: false, version: null, url: null, downloadUrl: null, channel: null, updatedAt: null };
      return json({ revision: 1, updatedAt: "2026-10-09T16:00:00Z", ...(path.includes("/admin/") ? { updatedBy: null } : {}), releaseNotes: "", web: { version: "synthetic-web", commitSha: oldCommit, schemaVersion: 68, available: true, updatedAt: "2026-10-09T16:00:00Z", updateMode: "hosted_web", requiresStoreUpdateForNativeChanges: true }, android: empty, ios: empty });
    }
    if (path.includes("notifications")) return json({ notifications: [], unreadCount: 0, total: 0, page: 1, pageSize: 20, asOf: "2026-10-09T16:00:00Z", hasMore: false });
    if (path === "/v1/producer/sync") return json({ error: "DEPENDENCY_UNAVAILABLE" }, 503);
    return json({});
  });
  return { commands, adminReads: () => adminReads };
}

async function compileNativeFingerprint(page: Page) {
  // Build configuration is an explicit boundary fixture, not a runtime API setting.
  await page.route("**/src/lib/installedApp.ts*", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const match = body.match(/^import\.meta\.env = (\{[^\n]*\});/);
    expect(match, "Vite exposes compile-time native metadata").not.toBeNull();
    const environment = { ...JSON.parse(match![1]), VITE_HVM_NATIVE_RUNTIME_HASH: nativeFingerprint };
    await route.fulfill({ response, body: body.replace(match![0], `import.meta.env = ${JSON.stringify(environment)};`) });
  });
}

for (const width of [320, 390, 768, 1440]) {
  test(`central de versões assinadas permanece organizada em ${width}px`, async ({ page }, info) => {
    const data = center([release({ status: "published", publishedAt: "2026-10-09T16:00:00Z" }), release({ id: "33333333-3333-4333-8333-333333333333", platform: "ios", version: "1.2.0", buildNumber: 2, channel: "testflight", url: "https://testflight.apple.com/join/AbCd1234", downloadUrl: "/downloads/ios", signingIdentity: "APPLE:TEAM123456" })]);
    await fixture(page, { data: () => data });
    await page.setViewportSize({ width, height: width >= 768 ? 900 : 844 });
    await page.goto("/admin/aplicativos");
    const central = page.locator(".admin-mobile-release-center");
    await expect(central.getByRole("heading", { name: "Versões assinadas e atualizações" })).toBeVisible();
    await expect(central).toContainText("Publicação aaaaaaaa");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`central-pagina-${width}.png`), fullPage: true });
    await central.getByText("Política de sincronização automática", { exact: true }).click();
    await expect(central.getByLabel("iOS: publicar após confirmação na Apple")).toBeDisabled();
    await central.getByText("Histórico e recuperação de versões", { exact: true }).click();
    await expect(central.locator(".admin-mobile-release-list > li")).toHaveCount(2);
    await central.locator(".admin-mobile-package-detail > summary").first().click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await central.screenshot({ path: info.outputPath(`central-versoes-${width}.png`) });
  });
}

for (const role of ["platform_admin", "platform_super_admin"] as const) {
  test(`${role}: confirma a mesma identidade e publica exatamente a versão revisada`, async ({ page }) => {
    let data = center();
    let confirmed = false;
    const mocked = await fixture(page, { role, data: () => data, command: (command) => {
      if (!confirmed) return { status: 401, data: { error: "ADMIN_REAUTHENTICATION_REQUIRED", actorId } };
      data = { ...data, revision: 2, releases: data.releases.map((item) => ({ ...item, status: "published", publishedAt: "2026-10-09T16:05:00Z" })) };
      return { status: 200, data: { status: "success", revision: 2 } };
    }, reauth: ({ password }) => {
      if (password !== "synthetic-correct-password") return { status: 401, data: { error: "INVALID_ADMIN_CREDENTIALS" } };
      confirmed = true;
      return { status: 200, data: { status: "session_created", userId: actorId, role, accessToken: "synthetic-confirmed", refreshToken: "synthetic-confirmed-refresh", expiresIn: 3600 } };
    } });
    await page.goto("/admin/aplicativos");
    const central = page.locator(".admin-mobile-release-center");
    await central.getByText("Histórico e recuperação de versões", { exact: true }).click();
    await central.getByRole("button", { name: "Publicar versão", exact: true }).click();
    await expect(central.getByRole("group", { name: "Confirmar alteração da versão" })).toContainText("compilação 3");
    await central.getByRole("button", { name: "Confirmar publicação", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Confirmar operação administrativa" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Senha administrativa", { exact: true }).fill("synthetic-wrong-password");
    await dialog.getByRole("button", { name: "Confirmar identidade", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Confira sua senha administrativa");
    expect(mocked.commands).toHaveLength(1);
    await dialog.getByLabel("Senha administrativa", { exact: true }).fill("synthetic-correct-password");
    await dialog.getByRole("button", { name: "Confirmar identidade", exact: true }).click();
    await expect(central.getByRole("status")).toContainText("Versão publicada");
    expect(mocked.commands).toHaveLength(2);
    expect(mocked.commands[0]).toEqual(mocked.commands[1]);
    await expect(central.locator(".admin-mobile-current-grid article").first()).toContainText("Versão 1.3.0");
  });
}

test("conflito conserva a política editada até descarte explícito e a Apple continua sob revisão", async ({ page }) => {
  let data = center();
  const mocked = await fixture(page, { data: () => data, command: () => ({ status: 409, data: { error: "REVISION_CONFLICT" } }) });
  await page.goto("/admin/aplicativos");
  const central = page.locator(".admin-mobile-release-center");
  await central.getByText("Política de sincronização automática", { exact: true }).click();
  await central.getByLabel("Publicar automaticamente no Android").check();
  await central.getByRole("button", { name: "Salvar sincronização", exact: true }).click();
  await expect(central.getByRole("alert")).toContainText("Seu rascunho foi preservado");
  await expect(central.getByLabel("Publicar automaticamente no Android")).toBeChecked();
  await expect(central.getByRole("button", { name: "Salvar sincronização", exact: true })).toBeDisabled();
  expect(mocked.commands[0].autoPublish).toEqual({ android: true, ios: false });
  data = { ...data, revision: 2 };
  await central.getByRole("button", { name: "Descartar rascunho e verificar versões atuais" }).click();
  await expect(central.getByLabel("Publicar automaticamente no Android")).not.toBeChecked();
});

test("retirada não escolhe uma versão antiga automaticamente e restauração mantém a política mínima", async ({ page }) => {
  let data = center([release({ status: "published", publishedAt: "2026-10-09T16:00:00Z" })]);
  data.minimumSupportedBuild.android = 2;
  const mocked = await fixture(page, { data: () => data, command: (command) => {
    data = { ...data, revision: data.revision + 1, releases: data.releases.map((item) => ({ ...item, status: command.action === "withdraw" ? "withdrawn" : "published" })) };
    return { status: 200, data: { status: "success", revision: data.revision } };
  } });
  await page.goto("/admin/aplicativos");
  const central = page.locator(".admin-mobile-release-center");
  await central.getByText("Histórico e recuperação de versões", { exact: true }).click();
  await central.getByRole("button", { name: "Retirar versão", exact: true }).click();
  await expect(central.getByRole("group", { name: "Confirmar alteração da versão" })).toContainText("compilação mínima de segurança serão preservados");
  await central.getByRole("button", { name: "Confirmar retirada", exact: true }).click();
  await expect(central.getByRole("status")).toContainText("download desta plataforma foi suspenso");
  await expect(central.locator(".admin-mobile-current-grid article").first()).toContainText("Sem versão publicada");
  await central.getByRole("button", { name: "Restaurar versão", exact: true }).click();
  await central.getByRole("button", { name: "Confirmar restauração", exact: true }).click();
  await expect(central.locator(".admin-mobile-current-grid article").first()).toContainText("Versão 1.3.0");
  expect(mocked.commands.map((command) => command.action)).toEqual(["withdraw", "restore"]);
  await expect(central).toContainText("Compilação mínima 2");
});

test("negação explícita do super oculta a central e evita consultar configurações protegidas", async ({ page }) => {
  const mocked = await fixture(page, { denied: true });
  await page.goto("/admin/aplicativos");
  await expect(page.getByText("Seu perfil não tem permissão para acessar esta área.")).toBeVisible();
  await expect(page.locator(".admin-mobile-release-center")).toHaveCount(0);
  expect(mocked.adminReads()).toBe(0);
});

for (const platform of ["android", "ios"] as const) {
  test(`${platform}: usa o pacote instalado e abre a atualização somente por ação explícita`, async ({ page }, info) => {
    await emulateCapacitorBridge(page, platform);
    await compileNativeFingerprint(page);
    const item = release({ platform, status: "published", publishedAt: "2026-10-09T16:00:00Z", ...(platform === "ios" ? { channel: "testflight", url: "https://testflight.apple.com/join/AbCd1234", downloadUrl: "/downloads/ios", signingIdentity: "APPLE:TEAM123456" } : {}) });
    await fixture(page, { policy: () => publicPolicy(item, 2) });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/aplicativos");
    const notice = page.getByRole("complementary", { name: "Atualização do aplicativo instalado" });
    await expect(notice).toContainText("Atualização necessária");
    await expect(notice.getByRole("button", { name: "Mais tarde" })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Atualização da plataforma" })).toHaveCount(0);
    const opened = () => page.evaluate(() => (globalThis as unknown as { __HVM_TEST_NATIVE_CALLS: Array<{ plugin: string; method: string; options: { url?: string } }> }).__HVM_TEST_NATIVE_CALLS.filter((call) => call.plugin === "Browser" && call.method === "open"));
    expect(await opened()).toHaveLength(0);
    await notice.getByRole("button", { name: "Ver atualização" }).click();
    const dialog = page.getByRole("dialog", { name: "Atualização necessária" });
    await expect(dialog).toContainText("1.0.0 · compilação 1");
    await expect(dialog).toContainText("1.3.0 · compilação 3");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.screenshot({ path: info.outputPath(`aviso-nativo-${platform}-390.png`) });
    await dialog.getByRole("button", { name: platform === "ios" ? "Abrir canal oficial da Apple" : "Abrir instalação Android", exact: true }).click();
    await expect.poll(opened).toEqual([{ plugin: "Browser", method: "open", options: { url: `https://hortvitalmix.vercel.app/downloads/${platform}` } }]);
    await expect(page.getByRole("heading", { name: "Aplicativos e atualizações", exact: true })).toBeVisible();
  });
}

test("aviso opcional pode ser adiado; retirada não oferece instalação antiga e mínimo conhecido continua visível", async ({ page }) => {
  await emulateCapacitorBridge(page, "android");
  await compileNativeFingerprint(page);
  let policy = publicPolicy(release({ status: "published" }), 0);
  let status = 200;
  await fixture(page, { policy: () => policy, publicStatus: () => status });
  await page.goto("/aplicativos");
  const notice = page.getByRole("complementary", { name: "Atualização do aplicativo instalado" });
  await expect(notice).toContainText("Nova versão do aplicativo");
  await notice.getByRole("button", { name: "Mais tarde" }).click();
  await expect(notice).toHaveCount(0);
  policy = publicPolicy(release({ id: "44444444-4444-4444-8444-444444444444", version: "1.4.0", buildNumber: 4, status: "published" }), 2);
  await page.evaluate(() => window.dispatchEvent(new Event("hvm:mobile-releases-changed")));
  await expect(notice).toContainText("Atualização necessária");
  status = 503;
  await page.evaluate(() => window.dispatchEvent(new Event("hvm:mobile-releases-changed")));
  await expect(notice).toContainText("temporariamente indisponível");
  await notice.getByRole("button", { name: "Ver atualização" }).click();
  await expect(page.getByRole("button", { name: "Abrir instalação Android" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Verificar disponibilidade" })).toBeVisible();
});

test("atualização instalada conserva o rascunho e a fila durável do produtor", async ({ page }) => {
  await emulateCapacitorBridge(page, "android");
  await compileNativeFingerprint(page);
  await fixture(page, { role: "producer", policy: () => publicPolicy(release({ status: "published" }), 2) });
  await page.goto("/aplicativos");
  await expect(page.getByRole("complementary", { name: "Atualização do aplicativo instalado" })).toBeVisible();
  await page.evaluate(() => { const form = document.createElement("form"); form.id = "native-draft"; const input = document.createElement("input"); input.setAttribute("aria-label", "Rascunho local preservado"); form.append(input); document.body.append(form); });
  await page.getByLabel("Rascunho local preservado").fill("Minha alteração permanece.");
  await page.getByRole("button", { name: "Ver atualização" }).click();
  const dialog = page.getByRole("dialog", { name: "Atualização necessária" });
  await expect(dialog).toContainText("Salve ou conclua suas alterações");
  await expect(dialog.getByRole("button", { name: "Abrir instalação Android" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Voltar ao aplicativo" }).click();
  await expect(page.getByLabel("Rascunho local preservado")).toHaveValue("Minha alteração permanece.");
  await page.evaluate(async (userId) => { document.getElementById("native-draft")!.remove(); const modulePath = "/src/lib/offlineDb.ts"; const { enqueueCommand } = await import(modulePath); await enqueueCommand(userId, { commandId: "55555555-5555-4555-8555-555555555555", commandType: "order.transition", baseRevision: 1, payload: { orderId: "66666666-6666-4666-8666-666666666666", transition: { status: "accepted" } } }); }, actorId);
  await page.getByRole("button", { name: "Ver atualização" }).click();
  await expect(dialog).toContainText("ações salvas sem internet");
  await expect(dialog.getByRole("button", { name: "Abrir instalação Android" })).toBeDisabled();
  expect(await page.evaluate(async (userId) => { const modulePath = "/src/lib/offlineDb.ts"; const { listPending } = await import(modulePath); return (await listPending(userId)).length; }, actorId)).toBe(1);
});

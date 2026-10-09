import { expect, test, type Page } from "@playwright/test";
import { AdminSectorCodeSchema, type AdminSectorCode } from "../../shared/contracts/adminGovernance";
import type { AdminAppDistributionResponse } from "../../shared/contracts/appDistribution";

const actorId = "11111111-1111-4111-8111-111111111111";
const oldCommit = "a".repeat(40);
const newCommit = "b".repeat(40);
const sectors = AdminSectorCodeSchema.options;
function manifest(commit = oldCommit): AdminAppDistributionResponse {
  const empty = { available: false, version: null, url: null, downloadUrl: null, channel: null, updatedAt: null } as const;
  return { revision: 1, updatedAt: "2026-10-09T02:00:00Z", updatedBy: null, releaseNotes: "", web: { version: "synthetic-web-1", commitSha: commit, schemaVersion: 67, available: true, updatedAt: "2026-10-09T02:00:00Z", updateMode: "hosted_web", requiresStoreUpdateForNativeChanges: true }, android: empty, ios: empty };
}

async function fixture(page: Page, options: {
  role?: "platform_admin" | "platform_super_admin" | "producer";
  allowed?: AdminSectorCode[];
  denied?: AdminSectorCode[];
  distribution?: () => AdminAppDistributionResponse;
  publicStatus?: () => number;
  patch?: (input: unknown) => { status: number; data: unknown };
  reauth?: (input: unknown) => { status: number; data: unknown };
  mutation?: () => Promise<void>;
} = {}) {
  const role = options.role ?? "platform_super_admin";
  const writes: unknown[] = [];
  let reads = 0;
  await page.addInitScript(() => localStorage.setItem("hvm.admin.session", JSON.stringify({ accessToken: "synthetic-admin", refreshToken: "synthetic-refresh", expiresAt: Date.now() + 3600000 })));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/(?:api|_hvm_api)/, "");
    if (!path.startsWith("/v1/")) return route.continue();
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (path === "/v1/config") return json({ platformName: "HortiVitalMix", slogan: "Tudo fresco.", defaultMunicipality: "Ariquemes", defaultState: "RO", currency: "BRL", timezone: "America/Cuiaba", supportEmail: "suporte@example.invalid", supportPhone: null, revision: 1 });
    if (path === "/v1/auth/session") return json({ userId: actorId, email: "synthetic@example.invalid", fullName: "Pessoa Sintética", roles: [role], activeRole: role, portalKind: role === "producer" ? "public" : "administrative" });
    if (path === "/v1/admin/auth/verify-session") return json({ authorized: true, role, sectors: options.allowed ?? [], deniedSectors: options.denied ?? [], requiresReauth: false });
    if (path === "/v1/admin/auth/reauthenticate") {
      const result = options.reauth?.(request.postDataJSON()) ?? { status: 401, data: { error: "INVALID_ADMIN_CREDENTIALS" } };
      return json(result.data, result.status);
    }
    if (path === "/v1/admin/mobile-releases") return json({ revision: 1, updatedAt: "2026-10-09T02:00:00Z", minimumSupportedBuild: { android: 0, ios: 0 }, autoPublish: { android: false, ios: false }, releases: [], sync: { state: "awaiting_first_release", lastVerifiedAt: null, pendingUploads: 0, webCommit: oldCommit, webSchema: 67, storageConfigured: false, oidcAudience: "https://hortvitalmix.vercel.app/mobile-ci" } });
    if (path === "/v1/app-distribution" || path === "/v1/admin/app-distribution") {
      if (request.method() === "PATCH") {
        writes.push(request.postDataJSON());
        const result = options.patch?.(request.postDataJSON()) ?? { status: 503, data: { error: "DEPENDENCY_UNAVAILABLE" } };
        return json(result.data, result.status);
      }
      reads++;
      const result = options.distribution?.() ?? manifest();
      if (path === "/v1/admin/app-distribution") return json(result);
      const { updatedBy: _actor, ...publicData } = result;
      const status = options.publicStatus?.() ?? 200;
      return json(status === 200 ? publicData : { error: "DEPENDENCY_UNAVAILABLE" }, status);
    }
    if (path === "/v1/admin/dashboard") return json({ generatedAt: "2026-10-09T02:00:00Z", refreshAfterSeconds: 30, scope: { role, sectors }, departments: sectors.map((sector) => ({ sector, title: sector === "finance_ops" ? "Operações financeiras" : sector === "catalog_moderation" ? "Catálogo e lojas" : sector, description: "Indicadores sintéticos deste departamento.", actionPath: "/admin/painel", metrics: [{ key: "active", label: "Registros ativos", value: 23, unit: "count", attention: false }, { key: "pending", label: "Pendências", value: 2, unit: "count", attention: true }] })) });
    if (path === "/v1/test/mutation") { await options.mutation?.(); return json({ status: "success" }); }
    if (path.includes("notifications")) return json({ notifications: [], unreadCount: 0, total: 0, page: 1, pageSize: 20, asOf: "2026-10-09T02:00:00Z", hasMore: false });
    if (path === "/v1/producer/sync") return json({ error: "DEPENDENCY_UNAVAILABLE" }, 503);
    return json({});
  });
  return { writes, reads: () => reads };
}

async function publishChangedVersion(page: Page, change: () => void) {
  change();
  await page.evaluate(() => window.dispatchEvent(new Event("hvm:app-distribution-changed")));
  await expect(page.getByRole("complementary", { name: "Atualização da plataforma" })).toBeVisible();
}

for (const width of [320, 390, 768, 1440]) {
  test(`downloads, departamentos e distribuição cabem em ${width}px`, async ({ page }, info) => {
    await fixture(page);
    await page.setViewportSize({ width, height: width >= 768 ? 900 : 844 });
    await page.goto("/aplicativos");
    await expect(page.getByRole("heading", { name: "Aplicativos e atualizações", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Aplicativo Android: Publicação em preparação", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`downloads-${width}.png`), fullPage: true });
    await page.goto("/admin/departamentos");
    await expect(page.locator(".admin-department-hub-card")).toHaveCount(9);
    await expect(page.getByRole("link", { name: "Financeiro", exact: true })).toHaveAttribute("href", "/admin/financeiro");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`departamentos-${width}.png`), fullPage: true });
    await page.goto("/admin/aplicativos");
    await expect(page.getByLabel("Versão Android", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tudo atualizado", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`distribuicao-${width}.png`), fullPage: true });
  });
}

test("downloads usam endereços estáveis, acompanham versão e retiram canais indisponíveis", async ({ page }) => {
  let data = manifest();
  let status = 200;
  const mocked = await fixture(page, { distribution: () => data, publicStatus: () => status });
  await page.goto("/aplicativos");
  await expect(page.locator(".hvm-app-download-platforms a")).toHaveCount(0);
  const initialReads = mocked.reads();
  data = { ...data, android: { available: true, version: "1.0.0", url: "https://play.google.com/store/apps/details?id=br.com.hortvitalmix.app", downloadUrl: "/downloads/android", channel: "play_store", updatedAt: "2026-10-09T02:00:00Z" } };
  await page.evaluate(() => window.dispatchEvent(new Event("hvm:app-distribution-changed")));
  await expect(page.getByRole("link", { name: "Instalar HortiVitalMix para Android, versão 1.0.0" })).toHaveAttribute("href", "/downloads/android");
  expect(mocked.reads() - initialReads).toBe(1); // a página e o aviso global compartilham uma consulta
  data = { ...data, android: { ...data.android, version: "1.1.0" } };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("link", { name: "Instalar HortiVitalMix para Android, versão 1.1.0" })).toBeVisible();
  status = 503;
  await page.evaluate(() => window.dispatchEvent(new Event("hvm:app-distribution-changed")));
  await expect(page.getByRole("alert")).toContainText("Não foi possível verificar");
  await expect(page.locator(".hvm-app-download-platforms a")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Aplicativo Android: Verifique em instantes", exact: true })).toBeDisabled();
});

test("downloads mobile mantém a explicação completa em detalhe fechado e acessível", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/aplicativos");
  const details = page.locator(".app-downloads-note");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(details.getByText(/Quando uma nova versão do aplicativo precisar ser instalada/)).not.toBeVisible();
  const summary = page.getByText("Como funcionam as atualizações", { exact: true });
  await expect(summary).toBeVisible();
  expect(await summary.evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThan(772);
  await summary.click();
  await expect(details.getByText(/Quando uma nova versão do aplicativo precisar ser instalada/)).toBeVisible();
  await expect(details.getByText(/registros e pedidos permanecem no sistema/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Mais tarde libera o conteúdo, conserva o rascunho e reaparece apenas na próxima versão", async ({ page }) => {
  let data = manifest();
  await fixture(page, { distribution: () => data });
  await page.goto("/aplicativos");
  await expect(page.locator(".hvm-app-download-platforms")).toBeVisible();
  await publishChangedVersion(page, () => { data = manifest(newCommit); });
  await page.evaluate(() => { const form = document.createElement("form"); form.id = "postpone-form"; const input = document.createElement("input"); input.setAttribute("aria-label", "Rascunho para adiar"); form.append(input); document.body.append(form); });
  await page.getByLabel("Rascunho para adiar").fill("Manter esta edição.");
  await expect(page.getByRole("button", { name: "Atualizar agora", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Mais tarde", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Atualização da plataforma" })).toHaveCount(0);
  await expect(page.getByLabel("Rascunho para adiar")).toHaveValue("Manter esta edição.");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("complementary", { name: "Atualização da plataforma" })).toHaveCount(0);
  await publishChangedVersion(page, () => { data = manifest("c".repeat(40)); });
  await expect(page.getByRole("button", { name: "Atualizar agora", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Rascunho para adiar")).toHaveValue("Manter esta edição.");
});

test("hub filtra respostas antigas por poderes atuais e pelas negativas do super", async ({ page }) => {
  await fixture(page, { role: "platform_admin", allowed: ["catalog_moderation", "finance_ops"], denied: ["finance_ops"] });
  await page.goto("/admin/departamentos");
  await expect(page.locator(".admin-department-hub-card")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Catálogo", exact: true })).toHaveAttribute("href", "/admin/catalogo");
  await expect(page.getByRole("link", { name: "Categorias", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Financeiro", exact: true })).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
  await fixture(page, { denied: ["finance_ops", "platform_configuration"] });
  await page.reload();
  await expect(page.locator(".admin-department-hub-card")).toHaveCount(7);
  await expect(page.locator(".admin-department-hub").getByRole("link", { name: "Aplicativos", exact: true })).toHaveCount(0);
});

test("publicação preserva o rascunho e a intenção na falha de rede", async ({ page }) => {
  const mocked = await fixture(page);
  await page.goto("/admin/aplicativos");
  await page.getByLabel("Versão Android", { exact: true }).fill("1.0.0");
  await page.getByLabel("Link de instalação Android", { exact: true }).fill("https://play.google.com/store/apps/details?id=br.com.hortvitalmix.app");
  await page.getByLabel("Novidades da versão", { exact: true }).fill("Novidades da versão preparada.");
  await page.getByRole("button", { name: "Publicar distribuição", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("O rascunho foi preservado");
  await expect(page.getByLabel("Versão Android", { exact: true })).toHaveValue("1.0.0");
  await page.getByRole("button", { name: "Publicar distribuição", exact: true }).click();
  await expect.poll(() => mocked.writes.length).toBe(2);
  expect(mocked.writes[0]).toEqual(mocked.writes[1]);
});

test("conflito mantém edição até descarte explícito e poder revogado esconde configuração", async ({ page }) => {
  let data = manifest();
  let status = 409;
  await fixture(page, { distribution: () => data, patch: () => ({ status, data: { error: status === 409 ? "REVISION_CONFLICT" : "ADMIN_SECTOR_REQUIRED", currentRevision: 2 } }) });
  await page.goto("/admin/aplicativos");
  await page.getByLabel("Novidades da versão", { exact: true }).fill("Minha edição pendente.");
  await page.getByRole("button", { name: "Publicar distribuição", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Outra sessão alterou");
  await expect(page.getByRole("textbox", { name: "Novidades da versão", exact: true })).toHaveValue("Minha edição pendente.");
  await expect(page.getByRole("button", { name: "Publicar distribuição", exact: true })).toBeDisabled();
  data = { ...data, revision: 2, releaseNotes: "Publicação concorrente." };
  await page.getByRole("button", { name: "Descartar rascunho e carregar versão atual" }).click();
  await expect(page.getByRole("textbox", { name: "Novidades da versão", exact: true })).toHaveValue("Publicação concorrente.");
  status = 403;
  await page.getByRole("textbox", { name: "Novidades da versão", exact: true }).fill("Nova edição.");
  await page.getByRole("button", { name: "Publicar distribuição", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Seus poderes não permitem");
  await expect(page.getByLabel("Link de instalação Android", { exact: true })).toHaveCount(0);
});

for (const role of ["platform_admin", "platform_super_admin"] as const) {
  test(`${role}: publicação confirma a mesma identidade, preserva senha incorreta e repete a intenção`, async ({ page }) => {
    let data = manifest();
    let confirmed = false;
    const confirmations: unknown[] = [];
    const mocked = await fixture(page, {
      role, allowed: ["platform_configuration"], distribution: () => data,
      patch: (input) => {
        if (!confirmed) return { status: 401, data: { error: "ADMIN_REAUTHENTICATION_REQUIRED", actorId } };
        data = { ...data, revision: data.revision + 1, releaseNotes: (input as { payload: { releaseNotes: string } }).payload.releaseNotes };
        return { status: 200, data: { status: "success", revision: data.revision, auditEventId: "44444444-4444-4444-8444-444444444444" } };
      },
      reauth: (input) => {
        confirmations.push(input);
        if ((input as { password: string }).password !== "synthetic-correct-password") return { status: 401, data: { error: "INVALID_ADMIN_CREDENTIALS" } };
        confirmed = true;
        return { status: 200, data: { status: "session_created", userId: actorId, role, accessToken: "synthetic-confirmed", refreshToken: "synthetic-confirmed-refresh", expiresIn: 3600 } };
      },
    });
    await page.goto("/admin/aplicativos");
    await page.getByRole("textbox", { name: "Novidades da versão", exact: true }).fill("Publicação com identidade confirmada.");
    await page.getByRole("button", { name: "Publicar distribuição", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Confirmar publicação dos aplicativos", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Senha administrativa", { exact: true }).fill("synthetic-wrong-password");
    await dialog.getByRole("button", { name: "Confirmar identidade", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Confira sua senha administrativa");
    await expect(page.getByRole("textbox", { name: "Novidades da versão", exact: true })).toHaveValue("Publicação com identidade confirmada.");
    expect(mocked.writes).toHaveLength(1);
    await dialog.getByLabel("Senha administrativa", { exact: true }).fill("synthetic-correct-password");
    await dialog.getByRole("button", { name: "Confirmar identidade", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("status")).toContainText("Distribuição publicada");
    expect(mocked.writes).toHaveLength(2);
    expect(mocked.writes[0]).toEqual(mocked.writes[1]);
    expect(confirmations).toEqual([{ password: "synthetic-wrong-password" }, { password: "synthetic-correct-password" }]);
    // A confirmação bem-sucedida não pode deixar o próximo diálogo preso.
    confirmed = false;
    await page.getByRole("textbox", { name: "Novidades da versão", exact: true }).fill("Segundo rascunho preservado.");
    await page.getByRole("button", { name: "Publicar distribuição", exact: true }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("textbox", { name: "Novidades da versão", exact: true })).toHaveValue("Segundo rascunho preservado.");
    expect(confirmations).toHaveLength(2);
  });
}

test("versão nova exige ação explícita em uma rota segura e recarrega uma vez", async ({ page }) => {
  let data = manifest();
  let navigations = 0;
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations++; });
  await fixture(page, { distribution: () => data });
  await page.goto("/aplicativos");
  await expect(page.getByRole("button", { name: "Aplicativo Android: Publicação em preparação" })).toBeVisible();
  await publishChangedVersion(page, () => { data = manifest(newCommit); });
  expect(navigations).toBe(1);
  await expect(page.getByRole("button", { name: "Atualizar agora", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Atualizar agora", exact: true }).click();
  await expect.poll(() => navigations).toBe(2);
  await expect(page.getByRole("complementary", { name: "Atualização da plataforma" })).toHaveCount(0);
});

test("atualização preserva formulário alterado, arquivo selecionado e janela aberta", async ({ page }) => {
  let data = manifest();
  await fixture(page, { distribution: () => data });
  await page.goto("/aplicativos");
  await expect(page.locator(".hvm-app-download-platforms")).toBeVisible();
  await page.evaluate(() => {
    const form = document.createElement("form"); form.id = "synthetic-form";
    const input = document.createElement("input"); input.setAttribute("aria-label", "Rascunho sintético"); form.append(input); document.body.append(form);
  });
  await page.getByLabel("Rascunho sintético").fill("Preservar minha edição.");
  await publishChangedVersion(page, () => { data = manifest(newCommit); });
  await expect(page.getByRole("button", { name: "Atualizar agora", exact: true })).toBeDisabled();
  await expect(page.getByRole("complementary", { name: "Atualização da plataforma" })).toContainText("Salve ou conclua");
  await page.evaluate(() => document.getElementById("synthetic-form")!.remove());
  await page.evaluate(() => { const dialog = document.createElement("dialog"); dialog.id = "synthetic-dialog"; dialog.textContent = "Janela sintética aberta"; document.body.append(dialog); dialog.showModal(); });
  await expect(page.getByRole("complementary", { name: "Atualização da plataforma" })).toContainText("Feche a janela");
  await page.evaluate(() => { const dialog = document.getElementById("synthetic-dialog") as HTMLDialogElement; dialog.close(); dialog.remove(); const input = document.createElement("input"); input.type = "file"; input.id = "synthetic-file"; input.setAttribute("aria-label", "Arquivo sintético"); document.body.append(input); });
  await page.getByLabel("Arquivo sintético").setInputFiles({ name: "evidencia.txt", mimeType: "text/plain", buffer: Buffer.from("sintetico") });
  await expect(page.getByRole("complementary", { name: "Atualização da plataforma" })).toContainText("Conclua o envio dos arquivos");
  await page.evaluate(() => document.getElementById("synthetic-file")!.remove());
  await expect(page.getByRole("button", { name: "Atualizar agora", exact: true })).toBeEnabled();
});

test("atualização aguarda mutações reais e nunca força reload durante uma operação", async ({ page }) => {
  let data = manifest();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await fixture(page, { distribution: () => data, mutation: () => pending });
  await page.goto("/aplicativos");
  await expect(page.locator(".hvm-app-download-platforms")).toBeVisible();
  await page.evaluate(async () => { const modulePath = "/src/lib/api.ts"; const { api } = await import(modulePath); void api("/v1/test/mutation", { method: "POST", body: "{}" }); });
  await publishChangedVersion(page, () => { data = manifest(newCommit); });
  await expect(page.getByRole("button", { name: "Atualizar agora", exact: true })).toBeDisabled();
  await expect(page.getByRole("complementary", { name: "Atualização da plataforma" })).toContainText("operação em andamento");
  release();
  await expect(page.getByRole("button", { name: "Atualizar agora", exact: true })).toBeEnabled();
});

test("fila offline do produtor permanece durável e impede atualização", async ({ page }) => {
  let data = manifest();
  await fixture(page, { role: "producer", distribution: () => data });
  await page.goto("/aplicativos");
  await expect(page.locator(".hvm-app-download-platforms")).toBeVisible();
  await page.evaluate(async (userId) => { const modulePath = "/src/lib/offlineDb.ts"; const { enqueueCommand } = await import(modulePath); await enqueueCommand(userId, { commandId: "22222222-2222-4222-8222-222222222222", commandType: "order.transition", baseRevision: 1, payload: { orderId: "33333333-3333-4333-8333-333333333333", transition: { status: "accepted" } } }); }, actorId);
  await publishChangedVersion(page, () => { data = manifest(newCommit); });
  await expect(page.getByRole("complementary", { name: "Atualização da plataforma" })).toContainText("ações salvas para uso sem internet");
  await expect(page.getByRole("button", { name: "Atualizar agora", exact: true })).toBeDisabled();
  expect(await page.evaluate(async (userId) => { const modulePath = "/src/lib/offlineDb.ts"; const { listPending } = await import(modulePath); return (await listPending(userId)).length; }, actorId)).toBe(1);
});

test("troca de usuário durante a verificação durável cancela o reload", async ({ page }) => {
  let data = manifest();
  let navigations = 0;
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations++; });
  await fixture(page, { distribution: () => data });
  await page.goto("/aplicativos");
  await expect(page.locator(".hvm-app-download-platforms")).toBeVisible();
  await publishChangedVersion(page, () => { data = manifest(newCommit); });
  await expect(page.getByRole("button", { name: "Atualizar agora", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    const finishReads: Array<() => void> = [];
    (window as unknown as { syntheticFinishRead: () => void }).syntheticFinishRead = () => { for (const finish of finishReads.splice(0)) finish(); };
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args) {
      if (Array.isArray(args[0]) && args[0].includes("pending_commands") && args[1] === "readonly") {
        const request: { result: unknown[]; onsuccess?: () => void } = { result: [] };
        const tx = { objectStore: () => ({ index: () => ({ getAll: () => request }) }), oncomplete: null as (() => void) | null };
        finishReads.push(() => { request.onsuccess?.(); tx.oncomplete?.(); });
        return tx as unknown as IDBTransaction;
      }
      return original.apply(this, args);
    } as typeof IDBDatabase.prototype.transaction;
  });
  await page.getByRole("button", { name: "Atualizar agora", exact: true }).click();
  await expect(page.getByRole("button", { name: "Verificando…", exact: true })).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("hvm:session-cleared")));
  await page.evaluate(() => (window as unknown as { syntheticFinishRead: () => void }).syntheticFinishRead());
  await expect(page.getByRole("button", { name: "Verificando…", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Atualizar agora", exact: true })).toBeEnabled();
  expect(navigations).toBe(1);
});

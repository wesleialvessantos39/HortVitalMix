import { expect, test, type Page } from "@playwright/test";
import { AdminSectorCodeSchema, type AdminSectorCode } from "../../shared/contracts/adminGovernance";
import type { AdminDashboardResponse } from "../../shared/contracts/adminDashboard";

const sectors = AdminSectorCodeSchema.options;
const cfg = { platformName: "HortiVitalMix", slogan: "Tudo fresco. Tudo da sua região.", defaultMunicipality: "Ariquemes", defaultState: "RO", currency: "BRL", timezone: "America/Porto_Velho", supportEmail: "suporte@example.test", supportPhone: null, revision: 7 };
const adminCfg = () => ({ ...cfg, updatedAt: "2026-10-08T12:00:00Z", updatedBy: null });
const titles: Record<AdminSectorCode, string> = { account_governance: "Contas e acessos", document_verification: "Documentos e imóveis", catalog_moderation: "Catálogo e lojas", finance_ops: "Operações financeiras", location_management: "Localidades e cobertura", platform_configuration: "Identidade e operação", refund_management: "Reembolsos", complaint_management: "Denúncias e avaliações", payment_configuration: "Pagamentos e assinaturas" };
const paths: Record<AdminSectorCode, string> = { account_governance: "/admin/usuarios", document_verification: "/admin/documentos/fila", catalog_moderation: "/admin/categorias", finance_ops: "/admin/painel", location_management: "/admin/localidades", platform_configuration: "/admin/configuracao", refund_management: "/admin/reembolsos", complaint_management: "/admin/denuncias", payment_configuration: "/admin/pagamentos" };
function dashboard(scope: readonly AdminSectorCode[], count = 17): AdminDashboardResponse {
  return { generatedAt: "2026-10-08T12:00:00Z", refreshAfterSeconds: 30, scope: { role: "platform_super_admin", sectors: [...scope] }, departments: scope.map(sector => ({ sector, title: titles[sector], description: "Situação atual dos registros deste departamento, conforme seus poderes administrativos.", actionPath: paths[sector], metrics: [
    { key: "active", label: "Registros ativos", value: count, unit: "count", attention: false },
    { key: "pending", label: "Solicitações que aguardam análise", value: 3, unit: "count", attention: true },
    { key: "confirmed", label: "Valor confirmado", value: 123456, unit: "currency_cents", attention: false, note: "Somente pagamentos confirmados no sistema." },
    { key: "done", label: "Registros concluídos", value: 8, unit: "count", attention: false },
  ] })) };
}
async function mock(page: Page, options: { role?: "platform_admin" | "platform_super_admin"; allowed?: AdminSectorCode[]; denied?: AdminSectorCode[]; dashboard?: () => unknown | Promise<unknown>; config?: (method: string, body: unknown) => unknown | Promise<unknown>; dashboardStatus?: () => number } = {}) {
  const role = options.role ?? "platform_super_admin";
  await page.addInitScript(() => localStorage.setItem("hvm.admin.session", JSON.stringify({ accessToken: "synthetic-admin-test", refreshToken: "synthetic-refresh-test", expiresAt: Date.now() + 3600000 })));
  await page.route("**/*", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/(api|_hvm_api)/, "");
    if (!path.startsWith("/v1/")) return route.continue();
    if (path === "/v1/admin/dashboard") return route.fulfill({ json: await (options.dashboard?.() ?? dashboard(options.allowed ?? sectors)), status: options.dashboardStatus?.() ?? 200 });
    if (path === "/v1/config") return route.fulfill({ json: cfg });
    if (path === "/v1/auth/session") return route.fulfill({ json: { userId: "11111111-1111-4111-8111-111111111111", fullName: "Pessoa de Teste", email: "admin@example.test", activeRole: role, roles: [role], portalKind: "administrative" } });
    if (path === "/v1/admin/auth/verify-session") return route.fulfill({ json: { authorized: true, role, sectors: options.allowed ?? [], deniedSectors: options.denied ?? [], requiresReauth: false } });
    if (path === "/v1/admin/configuration") return route.fulfill({ json: await (options.config?.(route.request().method(), route.request().postDataJSON()) ?? adminCfg()) });
    if (path.includes("notifications")) return route.fulfill({ json: { notifications: [], unreadCount: 0, total: 0, page: 1, pageSize: 20, asOf: "2026-10-08T12:00:00Z", hasMore: false } });
    return route.fulfill({ json: {} });
  });
}

for (const width of [320, 390, 768, 1280, 1440]) test(`painel e configuração compactos sem transbordar em ${width}px`, async ({ page }, info) => {
  await mock(page);
  await page.setViewportSize({ width, height: width >= 768 ? 768 : 844 });
  await page.goto("/admin/painel");
  await expect(page.getByRole("group", { name: "Departamentos disponíveis" }).getByRole("button")).toHaveCount(9);
  await expect(page.locator(".admin-dashboard-detail")).toHaveCount(0);
  await page.getByRole("button", { name: /Contas e acessos.*Registros ativos/ }).click();
  await expect(page.getByRole("heading", { name: "Contas e acessos" })).toBeVisible();
  await expect(page.locator(".admin-dashboard-metrics")).toContainText("R$ 1.234,56");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".admin-dashboard-departments").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  if (width >= 1280) expect(await page.locator(".admin-dashboard-page").evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(720);
  await page.screenshot({ path: info.outputPath(`painel-${width}.png`), fullPage: true });
  await page.goto("/admin/configuracao");
  await expect(page.getByRole("heading", { name: "Configuração Global" })).toBeVisible();
  await expect(page.getByText("Visão operacional", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Slogan institucional")).toHaveValue(cfg.slogan);
  for (const tab of ["Operação", "Suporte", "Identidade"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator(".admin-config-form").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  if (width === 1440) expect(await page.locator(".admin-config-page").evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(768);
  await page.screenshot({ path: info.outputPath(`config-${width}.png`), fullPage: true });
});

test("administrador recebe apenas seus setores e super com poder retirado não o exibe", async ({ page }) => {
  await mock(page, { role: "platform_admin", allowed: ["document_verification"] });
  await page.goto("/admin/painel");
  await expect(page.getByRole("group", { name: "Departamentos disponíveis" }).getByRole("button")).toHaveCount(1);
  await expect(page.getByText("Visão dos seus poderes")).toBeVisible();
  await expect(page.getByRole("button", { name: /Financeiro.*Registros ativos/ })).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
  await mock(page, { denied: ["finance_ops"], dashboard: () => dashboard(sectors) });
  await page.reload();
  await expect(page.getByRole("group", { name: "Departamentos disponíveis" }).getByRole("button")).toHaveCount(8);
  await expect(page.getByRole("button", { name: /Financeiro.*Registros ativos/ })).toHaveCount(0);
});

test("painel atualiza ao receber mudança sem retirar os dados carregados e preserva-os em falha", async ({ page }) => {
  let release!: () => void;
  let pending: Promise<void> | undefined;
  let count = 17;
  let status = 200;
  await mock(page, { allowed: ["document_verification"], dashboard: async () => { await pending; return status === 200 ? dashboard(["document_verification"], count) : { error: "DASHBOARD_UNAVAILABLE" }; }, dashboardStatus: () => status });
  await page.goto("/admin/painel");
  await expect(page.locator(".admin-dashboard-headline strong")).toHaveText("17");
  pending = new Promise<void>(resolve => { release = resolve; }); count = 23;
  await page.evaluate(() => window.dispatchEvent(new Event("hvm:departments-changed")));
  await expect(page.getByLabel("Atualizar indicadores")).toBeDisabled();
  await expect(page.locator(".admin-dashboard-headline strong")).toHaveText("17");
  await expect(page.getByLabel("Carregando painel")).toHaveCount(0);
  release(); pending = undefined;
  await expect(page.locator(".admin-dashboard-headline strong")).toHaveText("23");
  status = 503;
  await page.getByLabel("Atualizar indicadores").click();
  await expect(page.getByRole("alert")).toContainText("Exibindo a última atualização recebida");
  await expect(page.locator(".admin-dashboard-headline strong")).toHaveText("23");
});

test("painel consulta novamente após 30 segundos e ao retornar à janela", async ({ page }) => {
  await page.clock.install();
  let count = 17;
  await mock(page, { allowed: ["document_verification"], dashboard: () => dashboard(["document_verification"], count) });
  await page.goto("/admin/painel");
  await expect(page.locator(".admin-dashboard-headline strong")).toHaveText("17");
  count = 29;
  await page.clock.fastForward(30_001);
  await expect(page.locator(".admin-dashboard-headline strong")).toHaveText("29");
  count = 31;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".admin-dashboard-headline strong")).toHaveText("31");
});

test("carregamento inicial consistente e configuração conserva campos durante sincronização após salvar", async ({ page }) => {
  let release!: () => void;
  let pending = new Promise<void>(resolve => { release = resolve; });
  let revision = 7;
  await mock(page, { config: async method => {
    if (method === "PATCH") { revision = 8; return { status: "success", revision }; }
    await pending;
    return { ...adminCfg(), revision, slogan: revision === 8 ? "Novo slogan sincronizado." : cfg.slogan };
  } });
  await page.goto("/admin/configuracao");
  await expect(page.getByLabel("Carregando configuração")).toBeVisible();
  release();
  await expect(page.getByLabel("Slogan institucional")).toHaveValue(cfg.slogan);
  await page.getByLabel("Slogan institucional").fill("Novo slogan sincronizado.");
  await expect(page.getByLabel("Atualizar configuração")).toBeDisabled();
  pending = new Promise<void>(resolve => { release = resolve; });
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText("Configuração sincronizada com sucesso.")).toBeVisible();
  await expect(page.getByLabel("Slogan institucional")).toHaveValue("Novo slogan sincronizado.");
  await expect(page.getByLabel("Carregando configuração")).toHaveCount(0);
  release();
  await expect(page.getByText("Revisão 8", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nenhuma alteração" })).toBeDisabled();
});

test("configuração valida também valores editados em uma aba que foi fechada", async ({ page }) => {
  let writes = 0;
  await mock(page, { config: method => { if (method === "PATCH") writes++; return adminCfg(); } });
  await page.goto("/admin/configuracao");
  await page.getByRole("tab", { name: "Suporte", exact: true }).click();
  await page.getByLabel("Telefone de suporte (opcional)").fill("telefone-invalido");
  await page.getByRole("tab", { name: "Identidade", exact: true }).click();
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("tab", { name: "Suporte", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("alert")).toContainText("Revise os campos");
  expect(writes).toBe(0);
});

test("configuração conserva mudanças entre abas e envia revisão com os campos alterados", async ({ page }) => {
  let current = adminCfg();
  let writes = 0;
  await mock(page, { config: (method, body) => {
    if (method === "PATCH") {
      const input = body as { expectedRevision: number; commandId: string; payload: Record<string, unknown> };
      expect(input.expectedRevision).toBe(7);
      expect(input.commandId).toMatch(/^[0-9a-f-]{36}$/);
      expect(input.payload).toEqual({ slogan: "Mensagem institucional atualizada.", defaultMunicipality: "Porto Velho", supportPhone: "+5569999999999" });
      current = { ...current, ...input.payload, revision: 8 }; writes++;
      return { status: "success", revision: 8 };
    }
    return current;
  } });
  await page.goto("/admin/configuracao");
  await page.getByRole("tab", { name: "Suporte", exact: true }).click();
  await page.getByLabel("Telefone de suporte (opcional)").fill("+5569999999999");
  expect(await page.getByLabel("Telefone de suporte (opcional)").evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(true);
  await page.getByRole("tab", { name: "Operação", exact: true }).click();
  await page.getByLabel("Município padrão").fill("Porto Velho");
  await page.getByRole("tab", { name: "Identidade", exact: true }).click();
  await page.getByLabel("Slogan institucional").fill("Mensagem institucional atualizada.");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText("Revisão 8", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nenhuma alteração" })).toBeDisabled();
  expect(writes).toBe(1);
});

test("falha inicial do painel mostra erro recuperável sem inventar contagens", async ({ page }) => {
  let failed = true;
  await mock(page, { dashboard: () => failed ? { error: "DASHBOARD_UNAVAILABLE" } : dashboard(["document_verification"]), dashboardStatus: () => failed ? 503 : 200 });
  await page.goto("/admin/painel");
  await expect(page.getByRole("alert")).toContainText("Não foi possível atualizar os indicadores");
  await expect(page.locator(".admin-dashboard-department")).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.locator(".admin-dashboard-headline strong")).toHaveText("17");
});

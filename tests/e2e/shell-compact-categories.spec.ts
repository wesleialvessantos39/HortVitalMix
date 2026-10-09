import { expect, test, type Page } from "@playwright/test";

const config = {
  platformName: "HortiVitalMix", slogan: "Alimentos frescos perto de você.",
  defaultMunicipality: "Ariquemes", defaultState: "RO", currency: "BRL",
  timezone: "America/Porto_Velho", supportEmail: "suporte@example.invalid",
  supportPhone: null, revision: 1,
};
const categoryNames = [
  "Hortaliças folhosas", "Legumes picados", "Mix prontos", "Frutas da estação",
  "Produtos frescos e orgânicos selecionados para toda a família",
  "CategoriaComUmNomeMuitoExtensoSemEspaçosParaValidarQuebra",
];
const sectors = ["account_governance", "document_verification", "catalog_moderation", "finance_ops", "location_management", "platform_configuration", "refund_management", "complaint_management", "payment_configuration"];
async function mock(page: Page, role: string | null = null, deniedSectors: string[] = []) {
  await page.route("**/*", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/(api|_hvm_api)/, "");
    if (!path.startsWith("/v1/")) return route.continue();
    const json = (body: unknown, status = 200) => route.fulfill({ json: body, status });
    if (path === "/v1/config") return json(config);
    if (path === "/v1/auth/session") return role ? json({
      userId: "11111111-1111-4111-8111-111111111111", email: "pessoa@example.invalid",
      fullName: "Pessoa de Teste", roles: [role], activeRole: role, portalKind: "administrative",
    }) : json({ error: "SESSION_REQUIRED" }, 401);
    if (path === "/v1/admin/auth/verify-session") return json({
      authorized: true, role, sectors, deniedSectors, requiresReauth: false,
    });
    if (path === "/v1/admin/users") return json({ users: [] });
    if (path === "/v1/admin/dashboard") {
      return json({ generatedAt: "2026-10-08T12:00:00Z", refreshAfterSeconds: 30,
        scope: { role, sectors: sectors.filter(sector => !deniedSectors.includes(sector)) },
        departments: sectors.filter(sector => !deniedSectors.includes(sector)).map((sector, i) => ({
          sector, title: "Departamento " + (i + 1), description: "Indicadores da operação conforme os poderes atribuídos.", actionPath: "/admin/usuarios",
          metrics: [
            { key: "total_records", label: "Registros ativos", value: 20 + i, unit: "count", attention: false },
            { key: "pending_records", label: "Aguardando análise", value: 3 + i, unit: "count", attention: true, actionPath: "/admin/usuarios" },
          ],
        })),
      });
    }
    if (path === "/v1/account/addresses") return json({ addresses: [] });
    if (path === "/v1/categories") return json({ categories: categoryNames.map((name, i) => ({
      id: `22222222-2222-4222-8222-${String(i + 1).padStart(12, "0")}`,
      name, slug: `categoria-${i + 1}`, iconName: "leaf", parentId: null,
      description: null, displayOrder: i, isActive: true, revision: 1, children: [],
    })) });
    if (path === "/v1/products") return json({ products: [] });
    if (path === "/v1/discovery/highlights") return json({ products: [], page: 1, hasMore: false });
    if (path === "/v1/discovery/stores") return json({ stores: [], page: 1, pageSize: 20, hasMore: false, distanceReference: null });
    if (path === "/v1/cart") return json({ stores: [], itemCount: 0, subtotalCents: 0 });
    if (path === "/v1/localities") return json({ municipalities: [] });
    if (path.includes("notifications")) return json({
      notifications: [], unreadCount: 0, total: 0, page: 1, pageSize: 20,
      asOf: "2026-10-08T12:00:00Z", hasMore: false,
    });
    return json({});
  });
}

for (const role of ["platform_admin", "platform_super_admin"]) {
for (const [width, height] of [[768, 844], [1280, 720], [1440, 768], [1024, 768]]) {
  test(`todas as áreas de ${role} estão acessíveis no desktop ${width}x${height}`, async ({ page }) => {
    await mock(page, role);
    await page.setViewportSize({ width, height });
    await page.goto("/admin/painel");
    const sidebar = page.locator(".admin-sidebar");
    const links = sidebar.locator(".admin-nav-item");
    await expect(links.first()).toBeVisible();
    for (const link of await links.all()) {
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeInViewport({ ratio: 1 });
    }
    expect(await sidebar.locator(".admin-sidebar-nav").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(sidebar.getByRole("button", { name: "Abrir vitrine", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(sidebar.getByRole("button", { name: "Sair", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(sidebar.getByRole("button", { name: /Notificações/ })).toHaveCount(0);
    await expect(page.getByRole("banner", { name: "Cabeçalho administrativo" }).getByRole("button", { name: /Notificações/ })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1280) await page.screenshot({ path: "/workspace/scratch/hort-admin-sidebar-1280x720.png" });
  });
}
}

for (const role of ["platform_admin", "platform_super_admin"]) {
for (const width of [320, 390, 430]) {
  test(`menu de ${role} mobile mantém o formato e todas as áreas do desktop em ${width}x844`, async ({ page }) => {
    await mock(page, role);
    await page.setViewportSize({ width: 1440, height: 844 });
    await page.goto("/admin/painel");
    const desktopLinks = page.locator(".admin-sidebar .admin-nav-item");
    await expect(desktopLinks.first()).toBeVisible();
    const desktopLabels = await desktopLinks.allTextContents();
    await page.setViewportSize({ width, height: 844 });
    const trigger = page.getByRole("button", { name: "Abrir menu administrativo", exact: true });
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Administração", exact: true });
    const links = drawer.locator(".admin-nav-item");
    expect(await links.allTextContents()).toEqual(desktopLabels);
    await expect(drawer.locator(".admin-brand strong")).toHaveText("HortiVitalMix");
    const firstBox = (await links.first().boundingBox())!;
    const secondBox = (await links.nth(1).boundingBox())!;
    expect(Math.abs(firstBox.x - secondBox.x)).toBeLessThan(1);
    expect(secondBox.y).toBeGreaterThanOrEqual(firstBox.y + firstBox.height);
    for (const link of await links.all()) {
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeInViewport({ ratio: 1 });
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await drawer.locator(".admin-sidebar-nav").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(drawer.getByRole("button", { name: "Sair", exact: true })).toBeInViewport({ ratio: 1 });
    const close = drawer.getByRole("button", { name: "Fechar menu administrativo", exact: true });
    await expect(close).toBeFocused();
    await close.press("Shift+Tab");
    await expect(drawer.locator(".admin-brand")).toBeFocused();
    await drawer.locator(".admin-brand").press("Shift+Tab");
    await expect(drawer.getByRole("button", { name: "Sair", exact: true })).toBeFocused();
    if (width === 390) await page.screenshot({ path: "/workspace/scratch/hort-admin-drawer-390x844.png" });
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}
}

for (const role of ["platform_admin", "platform_super_admin"]) test(`menu de ${role} em tela baixa mantém marca e rodapé fixos e todas as áreas alcançáveis`, async ({ page }) => {
  await mock(page, role);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/admin/painel");
  await page.getByRole("button", { name: "Abrir menu administrativo", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Administração", exact: true });
  const header = drawer.locator(".navigation-drawer-header");
  const footer = drawer.locator(".admin-sidebar-footer");
  const beforeHeader = (await header.boundingBox())!;
  const beforeFooter = (await footer.boundingBox())!;
  const last = drawer.locator(".admin-nav-item").last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 1 });
  await expect(drawer.getByRole("button", { name: "Sair", exact: true })).toBeInViewport({ ratio: 1 });
  const afterHeader = (await header.boundingBox())!;
  const afterFooter = (await footer.boundingBox())!;
  expect(Math.abs(afterHeader.y - beforeHeader.y)).toBeLessThan(1);
  expect(Math.abs(afterFooter.y - beforeFooter.y)).toBeLessThan(1);
  expect(await drawer.locator(".admin-sidebar-nav").evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const role of ["platform_admin", "platform_super_admin"]) test(`grupos preservam os setores revogados de ${role}`, async ({ page }) => {
  await mock(page, role, ["account_governance", "platform_configuration", "location_management", "catalog_moderation", "finance_ops", "payment_configuration", "refund_management", "complaint_management"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/painel");
  await page.getByRole("button", { name: "Abrir menu administrativo", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Administração", exact: true });
  await expect(drawer.locator(".admin-nav-item")).toHaveCount(4);
  await expect(drawer.getByRole("button", { name: "Auditoria", exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Departamentos", exact: true })).toBeVisible();
  for (const name of ["Usuários", "Governança", "Configuração", "BI executivo", "Localidades", "Categorias", "Pagamentos", "Reembolsos", "Financeiro", "Catálogo", "Aplicativos"]) {
    await expect(drawer.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
});

for (const width of [320, 390, 600]) test(`categorias completas quebram em linhas sem rolagem lateral em ${width}px`, async ({ page }) => {
  await mock(page);
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Categorias de produtos", exact: true });
  await expect(nav.getByRole("button")).toHaveCount(7);
  expect(await nav.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const button of await nav.getByRole("button").all()) {
    expect(await button.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  const selected = nav.getByRole("button", { name: categoryNames[1], exact: true });
  await selected.click();
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (width === 390) await page.screenshot({ path: "/workspace/scratch/hort-categories-390.png" });
});

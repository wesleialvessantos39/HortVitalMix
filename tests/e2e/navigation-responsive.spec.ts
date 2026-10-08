import { expect, test, type Page } from "@playwright/test";

const config = {
  platformName: "HortiVitalMix", slogan: "Tudo fresco. Tudo da sua região.",
  defaultMunicipality: "Ariquemes", defaultState: "RO", currency: "BRL",
  timezone: "America/Porto_Velho", supportEmail: "suporte@example.test",
  supportPhone: null, revision: 1,
};

async function mock(page: Page, role: string | null = null, deniedSectors: string[] = []) {
  await page.route("**/*", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/(api|_hvm_api)/, "");
    if (!path.startsWith("/v1/")) return route.continue();
    const json = (body: unknown, status = 200) => route.fulfill({ json: body, status });
    if (path === "/v1/config") return json(config);
    if (path === "/v1/auth/session") return role ? json({
      userId: "11111111-1111-4111-8111-111111111111", email: "pessoa@example.test",
      fullName: "Pessoa de Teste", roles: [role], activeRole: role,
      portalKind: role.startsWith("platform_") ? "administrative" : "public",
    }) : json({ error: "SESSION_REQUIRED" }, 401);
    if (path === "/v1/admin/auth/verify-session") return json({
      authorized: true, role, sectors: ["document_verification"], deniedSectors, requiresReauth: false,
    });
    if (path === "/v1/admin/users") return json({ users: [] });
    if (path === "/v1/account/addresses") return json({ addresses: [] });
    if (path === "/v1/categories") return json({ categories: [] });
    if (path === "/v1/localities") return json({ municipalities: [] });
    if (path === "/v1/admin/bootstrap/status") return json({ status: "closed" });
    if (path.includes("notifications")) return json({
      notifications: [], unreadCount: 0, total: 0, page: 1, pageSize: 20,
      asOf: "2026-10-08T12:00:00Z", hasMore: false,
    });
    return json({});
  });
}

for (const width of [320, 390, 430]) test(`menu público cabe e mantém foco em ${width}px`, async ({ page }) => {
  await mock(page);
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/sobre");
  const bottom = page.locator(".bottom-nav");
  await expect(bottom.locator(":scope > *")).toHaveCount(5);
  expect(await bottom.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const trigger = page.getByRole("button", { name: "Abrir menu", exact: true });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Menu", exact: true });
  const close = drawer.getByRole("button", { name: "Fechar menu", exact: true });
  await expect(drawer).toBeVisible();
  await expect(close).toBeFocused();
  await expect(drawer.getByRole("link", { name: "Produtores", exact: true })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Planos", exact: true })).toBeVisible();
  if (width === 390) await page.screenshot({ path: "artifacts/auditoria-2026-10-08/menu-publico-390-fixture-depois.png" });
  await close.press("Shift+Tab");
  expect(await drawer.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
  await trigger.click();
  await page.mouse.click(width - 8, 90);
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await drawer.getByRole("link", { name: "Início", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(drawer).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("produtor encontra todas as áreas no menu e navegação fecha o drawer", async ({ page }) => {
  await mock(page, "producer");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sobre");
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Menu", exact: true });
  const navigation = drawer.getByRole("navigation", { name: "Área do produtor", exact: true });
  await expect(navigation.getByRole("link")).toHaveCount(11);
  await expect(navigation.getByRole("link", { name: "Propriedades e documentos" })).toBeVisible();
  await navigation.getByRole("link", { name: "Meus produtos", exact: true }).click();
  await expect(page).toHaveURL(/\/produtor\/produtos$/);
  await expect(drawer).toBeHidden();
});

test("localização abre pelo menu com foco e mantém rolagem de conteúdo necessário", async ({ page }) => {
  await mock(page);
  await page.setViewportSize({ width: 390, height: 568 });
  await page.goto("/sobre");
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Menu", exact: true });
  await drawer.getByRole("button", { name: /Região da vitrine/ }).click();
  const location = page.getByRole("dialog", { name: "Localização", exact: true });
  await expect(drawer).toBeHidden();
  await expect(location).toBeVisible();
  expect(await location.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(location).toBeHidden();
  await page.goto("/cadastro/produtor");
  await expect(page.getByRole("button", { name: "Criar cadastro", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
  await page.getByRole("button", { name: "Criar cadastro", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Criar cadastro", exact: true })).toBeInViewport();
});

for (const width of [320, 390, 430]) test(`admin possui somente quatro atalhos mobile em ${width}px`, async ({ page }) => {
  await mock(page, "platform_super_admin");
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/admin/painel");
  await expect(page.locator(".admin-action-grid")).toBeVisible();
  const bottom = page.locator(".admin-bottom-nav");
  await expect(bottom.getByRole("button")).toHaveCount(4);
  expect(await bottom.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const trigger = page.getByRole("button", { name: "Abrir menu administrativo", exact: true });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Administração", exact: true });
  await expect(drawer.locator(".admin-nav-item")).toHaveCount(17);
  const contrast = await drawer.evaluate(element => {
    const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (color: string) => rgb(color).map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const background = luminance(getComputedStyle(element).backgroundColor);
    const foreground = luminance(getComputedStyle(element.querySelector(".admin-nav-item")!).color);
    return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await expect(drawer.getByRole("button", { name: "Fechar menu administrativo" })).toBeFocused();
  if (width === 390) await page.screenshot({ path: "artifacts/auditoria-2026-10-08/menu-admin-390-fixture-depois.png" });
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await drawer.getByRole("button", { name: "Usuários", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/usuarios$/);
  await expect(drawer).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("menu administrativo conserva restrições por setor", async ({ page }) => {
  await mock(page, "platform_admin", ["account_governance", "location_management", "platform_configuration", "payment_configuration", "refund_management", "complaint_management"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/painel");
  await page.getByRole("button", { name: "Abrir menu administrativo", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Administração", exact: true });
  await expect(drawer.getByRole("button", { name: "Usuários", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Governança", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Categorias", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Auditoria", exact: true })).toBeVisible();
});

for (const path of ["/entrar/consumidor", "/entrar/produtor", "/entrar/administrador", "/entrar/super-administrador"]) test(`acesso ${path} cabe em 390x844 sem rolagem vazia`, async ({ page }) => {
  await mock(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Esqueci minha senha", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("painel desktop cabe e links laterais rolam independentemente", async ({ page }) => {
  await mock(page, "platform_super_admin");
  await page.setViewportSize({ width: 1440, height: 768 });
  await page.goto("/admin/painel");
  await expect(page.locator(".admin-action-grid")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(768);
  const navigation = page.locator(".admin-sidebar .admin-sidebar-nav");
  expect(await navigation.evaluate(el => getComputedStyle(el).overflowY)).toBe("auto");
  await page.locator(".admin-sidebar .admin-nav-item").last().scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator(".admin-sidebar .admin-logout")).toBeInViewport();
});

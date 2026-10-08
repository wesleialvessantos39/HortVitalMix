import { expect, test, type Page } from "@playwright/test";

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const stamp = "2026-10-08T10:00:00Z";
const roles = ["consumer", "producer", "platform_admin", "platform_super_admin"] as const;
type Role = typeof roles[number];
const labels: Record<Role, string> = { consumer: "Consumidor", producer: "Produtor", platform_admin: "Administrador", platform_super_admin: "Super administrador" };
const base = (role: Role) => role.startsWith("platform_") ? "/admin/notificacoes" : "/notificacoes";

async function fixtures(page: Page, initialRole: Role, options: { missing?: boolean; empty?: boolean; noAction?: boolean } = {}) {
  let role = initialRole;
  const read = new Set<string>();
  const actions: string[] = [];
  const notices = () => [{ id, category: "account", title: `Atualização da conta de ${labels[role]}`,
    message: "Os dados da sua conta foram atualizados. Confira as informações para acompanhar esta alteração.",
    actionPath: role.startsWith("platform_") ? "/admin/conta" : "/conta", createdAt: stamp, readAt: read.has(id) ? stamp : null },
    { id: other, category: role === "consumer" ? "purchases" : role === "producer" ? "sales" : "refunds",
      title: role === "producer" ? "Nova venda recebida" : role === "consumer" ? "Sua compra foi confirmada" : "Reembolso precisa de análise",
      message: "Uma atualização está disponível no departamento correspondente ao seu perfil.",
      actionPath: role.startsWith("platform_") ? "/admin/reembolsos" : role === "producer" ? "/produtor/vendas" : "/compras",
      createdAt: stamp, readAt: read.has(other) ? stamp : null }];
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/(?:api|_hvm_api)/, "");
    if (!path.startsWith("/v1/")) return route.continue();
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (path === "/v1/auth/session") return json({ userId: id, email: "notificacoes@example.invalid", fullName: "Pessoa de teste", roles: [role], activeRole: role, portalKind: role.startsWith("platform_") ? "administrative" : "public" });
    if (path === "/v1/admin/auth/verify-session") return json({ authorized: true, role, sectors: ["refund_management"], requiresReauth: false });
    if (path === "/v1/config") return json({ platformName: "HortiVitalMix", slogan: "Tudo fresco.", defaultMunicipality: "Ariquemes", defaultState: "RO", currency: "BRL", timezone: "America/Porto_Velho", supportEmail: "suporte@example.invalid", supportPhone: null, revision: 1 });
    if (path === "/v1/account/addresses") return json({ addresses: [] });
    const apiBase = role.startsWith("platform_") ? "/v1/admin/notifications" : "/v1/notifications";
    if (path === apiBase) {
      const all = options.empty ? [] : notices();
      const category = url.searchParams.get("category");
      const notifications = all.filter(n => (!category || n.category === category) && (url.searchParams.get("filter") !== "unread" || !n.readAt));
      return json({ notifications, unreadCount: all.filter(n => !n.readAt).length, total: notifications.length, page: 1, pages: 1, asOf: stamp, availableCategories: role === "consumer" ? ["account", "purchases"] : role === "producer" ? ["account", "sales"] : ["account", "refunds"] });
    }
    if (path === apiBase + "/read-all") { actions.push("read-all"); notices().forEach(n => read.add(n.id)); return json({ ok: true }); }
    if (path === apiBase + "/" + id + "/read") { actions.push("read:" + id); read.add(id); return json({ ok: true }); }
    if (path === apiBase + "/" + other + "/read") { actions.push("read:" + other); read.add(other); return json({ ok: true }); }
    if (path === apiBase + "/" + id || path === apiBase + "/" + other) {
      if (options.missing) return json({ error: "NOT_FOUND" }, 404);
      const notification = notices().find(n => path.endsWith(n.id))!;
      actions.push("detail:" + notification.id);
      return json({ ...notification, recipientRole: role,
        context: { categoryLabel: notification.category === "account" ? "Conta" : notification.category === "sales" ? "Vendas" : notification.category === "purchases" ? "Compras" : "Reembolsos", audienceLabel: labels[role], why: `Este aviso pertence aos serviços do seu perfil de ${labels[role]}.`, nextStep: "Confira a explicação. Se precisar consultar os dados, use o botão abaixo." },
        action: options.noAction ? null : { label: "Abrir área correspondente", path: notification.actionPath } });
    }
    if (path.startsWith("/v1/notifications") || path.startsWith("/v1/admin/notifications")) return json({ error: "NOT_FOUND" }, 404);
    return json({ error: "NOT_FOUND" }, 404);
  });
  return { actions, switchRole(next: Role) { role = next; read.clear(); } };
}

for (const role of roles) for (const width of [320, 1440]) {
  test(`${role}: sino, preview, lista e explicação ${width}px`, async ({ page }) => {
    const { actions } = await fixtures(page, role);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base(role));
    const bell = page.getByRole("button", { name: "Notificações, 2 não lidas", exact: true }).first();
    await expect(bell).toBeVisible();
    await bell.click();
    const preview = page.getByRole("dialog", { name: "Notificações", exact: true });
    await expect(preview).toBeVisible();
    await expect(preview.getByText(labels[role], { exact: true })).toBeVisible();
    await expect(preview.getByText(`Atualização da conta de ${labels[role]}`, { exact: true })).toBeVisible();
    expect(await preview.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(bell).toBeFocused();
    await bell.click();
    await preview.getByRole("button", { name: "Mostrar mais" }).click();
    await expect(page).toHaveURL(new RegExp(base(role) + "$"));
    await expect(preview).toHaveCount(0);
    await page.getByRole("combobox", { name: "Assunto", exact: true }).selectOption("account");
    await expect(page.locator(".hvm-notification-list li")).toHaveCount(1);
    await expect(bell).toBeVisible();
    // A filtered list must not hide the other department's unread notice.
    await expect(page.locator(".hvm-notification-count").first()).toHaveText("2");
    await page.locator(".hvm-notification-open").click();
    await expect(page).toHaveURL(new RegExp(base(role) + "/" + id + "$"));
    await expect(page.getByRole("heading", { name: "Por que recebi este aviso?", exact: true })).toBeVisible();
    await expect(page.getByText(`Este aviso pertence aos serviços do seu perfil de ${labels[role]}.`, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir área correspondente", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Notificações, 1 não lidas", exact: true }).first()).toBeVisible();
    expect(actions.indexOf("detail:" + id)).toBeLessThan(actions.indexOf("read:" + id));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/notificacoes-2026-10-09/${role}-detalhe-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Abrir área correspondente", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(role.startsWith("platform_") ? "/admin/conta$" : "/conta$"));
  });
}

test("preview abre a explicação antes da área e marcar todas atualiza o sino", async ({ page }) => {
  await fixtures(page, "consumer");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/notificacoes");
  await page.getByRole("button", { name: "Notificações, 2 não lidas", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button").filter({ hasText: "Sua compra foi confirmada" }).click();
  await expect(page).toHaveURL(new RegExp("/notificacoes/" + other + "$"));
  await expect(page.getByRole("heading", { name: "Sua compra foi confirmada", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Todas as notificações", exact: true }).click();
  await page.getByRole("button", { name: "Marcar todas como lidas", exact: true }).click();
  await expect(page.getByRole("button", { name: "Notificações", exact: true }).first()).toBeVisible();
  await expect(page.locator(".hvm-notification-count")).toHaveCount(0);
});

test("trocar o perfil remove imediatamente o preview anterior", async ({ page }) => {
  const state = await fixtures(page, "consumer");
  await page.goto("/notificacoes");
  await page.getByRole("button", { name: "Notificações, 2 não lidas", exact: true }).first().click();
  await expect(page.getByRole("dialog").getByText("Atualização da conta de Consumidor", { exact: true })).toBeVisible();
  state.switchRole("producer");
  await page.evaluate(() => window.dispatchEvent(new Event("hvm:session-changed")));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Atualização da conta de Consumidor", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Atualização da conta de Produtor", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Notificações, 2 não lidas", exact: true }).first().click();
  await expect(page.getByRole("dialog").getByText("Produtor", { exact: true })).toBeVisible();
});

test("aviso inacessível não apresenta dados nem botão de departamento", async ({ page }) => {
  await fixtures(page, "consumer", { missing: true });
  await page.goto("/notificacoes/" + id);
  await expect(page.getByRole("heading", { name: "Notificação indisponível", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir área correspondente", exact: true })).toHaveCount(0);
  await expect(page.getByText("Este aviso não está disponível para a sua conta.", { exact: true })).toBeVisible();
});

for (const role of ["consumer", "platform_admin"] as const) test(`${role}: link inválido não consulta o servidor nem expõe ação`, async ({ page }) => {
  const { actions } = await fixtures(page, role);
  const requests: string[] = [];
  page.on("request", request => { if (request.url().includes("/v1/") && request.url().includes("/notifications/")) requests.push(request.url()); });
  await page.goto(base(role) + "/aviso-invalido");
  await expect(page.getByRole("heading", { name: "Notificação indisponível", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar novamente", exact: true })).toHaveCount(0);
  expect(actions).toEqual([]);
  expect(requests).toEqual([]);
});

test("explicação preservada sem CTA quando o departamento não está mais disponível", async ({ page }) => {
  await fixtures(page, "platform_admin", { noAction: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/admin/notificacoes/" + id);
  await expect(page.getByRole("heading", { name: "Por que recebi este aviso?", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir área correspondente", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Voltar às notificações", exact: true })).toBeVisible();
});

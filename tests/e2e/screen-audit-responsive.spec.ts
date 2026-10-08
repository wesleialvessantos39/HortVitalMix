import { expect, test, type Page } from "@playwright/test";

const id = "11111111-1111-4111-8111-111111111111";
const stamp = "2026-10-08T10:00:00Z";
const longName = "ProdutorComNomeExtenso".repeat(5);
const plan = {
  id, slug: "cesta-local", name: longName, targetAudience: "consumer",
  deliveriesPerWeek: 2, priceCents: 12345678, billingPeriod: "monthly",
  description: "Produtos frescos para sua família, com entregas na região.",
  storeId: id, storeName: longName, isActive: true, revision: 1,
};

async function fixtures(page: Page, role: string) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/(?:api|_hvm_api)/, "");
    if (!path.startsWith("/v1/")) return route.continue();
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (path === "/v1/auth/session") return json({
      userId: id, email: "teste@example.invalid", fullName: longName,
      roles: [role], activeRole: role,
      portalKind: role.startsWith("platform_") ? "administrative" : "public",
    });
    if (path === "/v1/admin/auth/verify-session") return json({
      authorized: true, role, sectors: [], requiresReauth: false,
    });
    if (path === "/v1/config") return json({
      platformName: "HortiVitalMix", slogan: "Tudo fresco.",
      defaultMunicipality: "Ariquemes", defaultState: "RO", currency: "BRL",
      timezone: "America/Porto_Velho", supportEmail: "suporte@example.invalid",
      supportPhone: null, revision: 1,
    });
    if (path === "/v1/account/addresses") return json({ addresses: [] });
    if (path === "/v1/notifications" || path === "/v1/admin/notifications") return json({
      notifications: [{ id, category: "administration", title: longName,
        message: longName, actionPath: "/conta", createdAt: stamp, readAt: null }],
      unreadCount: 1, total: 1, page: 1, pages: 1, asOf: stamp,
    });
    if (path === "/v1/producer/sales") return json({
      sales: [{ id, orderNumber: "HVM-2026-001", source: "online", status: "confirmed",
        fulfillmentStatus: "delivered", totalCents: 12345678, refundedCents: 0,
        holdState: "held", createdAt: stamp, storeName: longName, storeSlug: "cesta-local",
        openRefundId: null, items: [{productId: id, title: longName, quantity: 1,
          unitType: "kg", unitPriceCents: 12345678, totalPriceCents: 12345678}] }],
      page: 1, pages: 1, total: 1, posRevisions: [],
      summary: {saleCount: 1, grossCents: 12345678, refundedCents: 0,
        heldCents: 12345678, disputedCents: 0, releasedCents: 0},
    });
    if (path === "/v1/producer/refunds") return json({
      cases: [{id, orderId: id, orderNumber: "HVM-2026-001", storeName: longName,
        status: "requested", reason: longName, requestedAmountCents: 12345678,
        approvedAmountCents: null, createdAt: stamp, updatedAt: stamp,
        history: [], contacts: []}], page: 1, pages: 1, total: 1,
    });
    if (path === "/v1/subscription-plans") return json({ plans: [plan], gatewayAvailable: false });
    if (path === "/v1/subscriptions") return json({ subscriptions: [], gatewayAvailable: false });
    if (path === "/v1/admin/subscription-plans") return json({plans: [plan], stores: [{id,name:longName}]});
    if (path === "/v1/admin/reviews") return json({
      reviews: [{id, rating: 5, comment: longName, createdAt: stamp, orderId: id,
        orderNumber: "HVM-2026-001", storeId: id, storeName: longName,
        isModerated: false, moderationReason: null, moderatedBy: null, moderatedAt: null}],
      page: 1, pages: 1, total: 1,
    });
    if (path === "/v1/admin/bi") return json({
      startDate: url.searchParams.get("startDate"), endDate: url.searchParams.get("endDate"),
      timezone: "America/Porto_Velho", today: "2026-10-08",
      definitions: ["gmv_cents", "avg_ticket_cents", "active_producers"].map(code => ({
        code, name: longName, formulaDescription: longName, aggregationInterval: "daily",
      })), metrics: [{code: "gmv_cents", value: 12345678,
        referenceDate: url.searchParams.get("endDate"), calculatedAt: stamp}],
    });
    return json({ error: "NOT_FOUND" }, 404);
  });
}

const screens = [
  {path: "/produtor/vendas", role: "producer", heading: "Minhas vendas", ready: "Total vendido"},
  {path: "/produtor/reembolsos", role: "producer", heading: "Reembolsos das minhas vendas", ready: "Ver andamento"},
  {path: "/notificacoes", role: "consumer", heading: "Notificações", ready: "Marcar todas como lidas"},
  {path: "/planos", role: "consumer", heading: "Clube de hortifrúti", ready: plan.name},
  {path: "/admin/notificacoes", role: "platform_super_admin", heading: "Notificações", ready: "Marcar todas como lidas"},
  {path: "/admin/assinaturas", role: "platform_super_admin", heading: "Planos de assinatura", ready: plan.name},
  {path: "/admin/avaliacoes", role: "platform_super_admin", heading: "Moderação de avaliações", ready: "HVM-2026-001"},
  {path: "/admin/bi", role: "platform_super_admin", heading: "BI executivo", ready: "GMV de alimentos"},
];

for (const width of [320, 768, 1440]) {
  for (const screen of screens) {
    test(`auditoria com conteúdo longo: ${screen.path} ${width}px`, async ({ page }) => {
      await fixtures(page, screen.role);
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(screen.path);
      await expect(page.getByRole("heading", {name: screen.heading, exact: true})).toBeVisible();
      const ready = screen.ready === plan.name
        ? page.getByRole("heading", {name: plan.name, exact: true}).first()
        : page.getByText(screen.ready, {exact: false}).first();
      await expect(ready).toBeVisible();
      await expect(page.getByText(/Carregando.*(vendas|reembolsos|métricas|planos|avaliações)/)).toHaveCount(0);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const overflowingCards = await page.locator(".commerce-card, .subscription-card, .hvm-notification-list li, .review-admin-card, .hvm-bi-charts article").evaluateAll(cards =>
        cards.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({class: el.className, width: el.clientWidth, scroll: el.scrollWidth})),
      );
      expect(overflowingCards).toEqual([]);
      await page.screenshot({path: `artifacts/auditoria-2026-10-08/${screen.path.slice(1).replaceAll("/", "-")}-${width}-fixture-depois.png`, fullPage: true});
    });
  }
}

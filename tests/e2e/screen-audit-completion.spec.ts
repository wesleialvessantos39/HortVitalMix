import { expect, test, type Page } from "@playwright/test";
import { DeliveryWindowsResponseSchema } from "../../shared/contracts/deliveryLogistics";
import {
  MunicipalityListSchema,
  PartialBlockListSchema,
  PartialBlockSubjectLookupSchema,
  ProducerDeliveryScopeSchema,
} from "../../shared/contracts/locality";
import { PlanSchema, type SubscriptionView } from "../../shared/contracts/subscription";
import type { CaseView, OrderView, PosSale } from "../../shared/contracts/commerce";

const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const stamp = "2026-10-08T10:00:00Z";
const longName = "NomeExtensoParaVerificarQuebraDeLinha".repeat(3);
const policy = { version: 1, onlineWithdrawalDays: 7, inPersonReturnDays: 0,
  holdingDays: 7, additionalTerms: longName };
const item = { productId: id(2), title: longName, quantity: 1, unitType: "un",
  unitPriceCents: 12345678, totalPriceCents: 12345678, priceVersionId: id(3) };
const sale: PosSale = { id: id(4), code: "a".repeat(32), storeName: longName,
  totalCents: 12345678, items: [item], paymentMethod: "pix", paymentChannel: "system_pix",
  status: "draft", expiresAt: "2099-10-08T10:00:00Z", policy, customerAccepted: false };
const order: OrderView = { id: id(5), orderNumber: "HVM-2026-001", storeName: longName,
  source: "online", status: "received", totalCents: 12345678, items: [item],
  createdAt: stamp, receivedAt: stamp, withdrawalDeadline: "2099-10-08T10:00:00Z",
  problemDeadline: "2099-10-08T10:00:00Z", policy, holdState: "held", customerUserId: id(1) };
const refund: CaseView = { id: id(6), kind: "refund", status: "requested", revision: 1,
  reason: "quality", description: longName, orderId: order.id,
  requestedAmountCents: 12345678, approvedAmountCents: null, createdAt: stamp,
  messages: [{ id: id(8), author: "admin", message: longName, createdAt: stamp }],
  history: [{ status: "requested", notes: longName, createdAt: stamp }], evidence: [] };
const complaint: CaseView = { ...refund, id: id(7), kind: "complaint", status: "submitted",
  reason: "unsafe_food", targetType: "product", targetId: item.productId,
  subjectUserId: id(9), requestedAmountCents: undefined };
const localities = MunicipalityListSchema.parse({ municipalities: [{ id: id(10),
  ibgeCode: "1100023", name: "Ariquemes", state: "RO", isActive: true, revision: 1 }],
  activeMunicipalityIds: [id(10)] });
const scope = ProducerDeliveryScopeSchema.parse({ mode: "custom", municipalityIds: [id(10)], revision: 1 });
const windows = DeliveryWindowsResponseSchema.parse({ windows: [{ id: id(11), storeId: id(12),
  dayOfWeek: 4, startTime: "08:00", endTime: "12:00", maxOrdersCapacity: 2147483647,
  isActive: true, revision: 1, allocatedCount: 1234567 }], today: "2026-10-08",
  date: "2026-10-08", timezone: "America/Porto_Velho" });
const subject = PartialBlockSubjectLookupSchema.parse({ found: true, user: {
  userId: id(9), personId: id(13), fullName: longName, cpf: "12345678901",
  email: "pessoa.com.endereco.muito.extenso.para.verificar.quebra.de.linha@example.invalid",
  status: "active", publicRoles: ["producer", "consumer"], municipalityId: id(10),
  municipalityName: "Ariquemes", municipalityState: "RO" } });
const blocks = PartialBlockListSchema.parse({ blocks: [{ id: id(14), userId: id(9),
  subject: "producer_publishing", scope: "custom", reason: longName, isActive: true,
  municipalityIds: [id(10)], propertyIds: [id(15)], createdAt: stamp, revokedAt: null }] });

async function fixtures(page: Page, role: string) {
  const audience = role === "producer" ? "producer" : "consumer";
  const plan = PlanSchema.parse({ id: id(16), slug: "cesta-local", name: longName,
    targetAudience: audience, deliveriesPerWeek: audience === "producer" ? 0 : 1,
    priceCents: 12345678, billingPeriod: "monthly", description: longName,
    storeId: audience === "producer" ? null : id(12), storeName: audience === "producer" ? null : longName,
    isActive: true, revision: 1 });
  const subscription: SubscriptionView = { id: id(17), plan, status: "active", revision: 1,
    currentPeriodStart: stamp, currentPeriodEnd: "2026-11-08T10:00:00Z", pausedAt: null,
    pauseUntil: null, cancelledAt: null, recurrences: [], cycles: [] };
  const errors: string[] = [], unhandled: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/(?:api|_hvm_api)/, "");
    if (!path.startsWith("/v1/")) return route.continue();
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (path === "/v1/auth/session") return json({ userId: id(1), email: "teste@example.invalid",
      fullName: longName, roles: [role], activeRole: role,
      portalKind: role.startsWith("platform_") ? "administrative" : "public" });
    if (path === "/v1/admin/auth/verify-session") return json({ authorized: true, role,
      sectors: ["location_management", "refund_management", "complaint_management"], requiresReauth: false });
    if (path === "/v1/config") return json({ platformName: "HortiVitalMix", slogan: "Tudo fresco.",
      defaultMunicipality: "Ariquemes", defaultState: "RO", currency: "BRL",
      timezone: "America/Porto_Velho", supportEmail: "suporte@example.invalid", supportPhone: null, revision: 1 });
    if (path === "/v1/account/addresses") return json({ addresses: [] });
    if (path === "/v1/notifications" || path === "/v1/admin/notifications") return json({
      notifications: [], unreadCount: 0, total: 0, page: 1, pages: 1, asOf: stamp });
    if (path === "/v1/producer/trial") return json({ trial: null, subscriptionRequired: false });
    if (path === "/v1/localities") return json(localities);
    if (path === "/v1/producer/delivery-scope") return json(scope);
    if (path === "/v1/producer/delivery-windows") return json(windows);
    if (path === "/v1/subscription-plans") return json({ plans: [plan], gatewayAvailable: false });
    if (path === "/v1/subscriptions") return json({ subscriptions: [subscription], gatewayAvailable: false });
    if (path === `/v1/commerce/pos/${sale.code}`) return json(sale);
    if (path === "/v1/commerce/policy") return json({ policy, gatewayAvailable: false });
    if (path === "/v1/commerce/purchases") return json({ orders: [order], sales: [], payments: [] });
    if (path === "/v1/admin/commerce/settings") return json({ revision: 1, policy,
      gateway: { provider: "unselected", accountLabel: longName, merchantReference: "",
        platformPixKey: "", terminalReference: "" }, gatewayAvailable: false });
    if (path === "/v1/admin/localities") return json(localities);
    if (path === "/v1/admin/access-blocks/subject") return json(subject);
    if (path === "/v1/admin/access-blocks/subject-properties") return json({ properties: [{
      id: id(15), name: longName, status: "active", municipality: "Ariquemes", state: "RO" }] });
    if (path === "/v1/admin/access-blocks") return json(blocks);
    for (const prefix of ["/v1/commerce", "/v1/admin/commerce"]) {
      for (const [plural, value] of [["refunds", refund], ["complaints", complaint]] as const) {
        if (path === `${prefix}/${plural}`) return json({ cases: [value], page: 1, pages: 1, total: 1 });
        if (path === `${prefix}/${plural}/${value.id}`) return json(value);
      }
    }
    unhandled.push(path);
    return json({ error: "NOT_FOUND" }, 404);
  });
  return { errors, unhandled };
}

const screens = [
  { path: "/produtor/entrega", role: "producer", heading: "Onde você entrega?", ready: "Salvar escopo de entrega" },
  { path: "/produtor/loja/janelas", role: "producer", heading: "Janelas de entrega", ready: "Editar janela" },
  { path: "/produtor/assinaturas", role: "producer", heading: "Planos do produtor", ready: "Pausar por até 14 dias" },
  { path: "/assinaturas/minhas", role: "consumer", heading: "Minhas assinaturas", ready: "Pausar por até 14 dias" },
  { path: "/assinaturas/minhas", role: "producer", heading: "Minhas assinaturas", ready: "Pausar por até 14 dias" },
  { path: `/pos/venda/${sale.code}`, role: "consumer", heading: "Revise sua compra presencial", ready: "Confirmar revisão e termos" },
  { path: "/admin/bloqueios", role: "platform_super_admin", heading: "Bloqueios por localidade", ready: "Revogar" },
  { path: "/admin/denuncias", role: "platform_super_admin", heading: "Denúncias e segurança", ready: "Protocolo" },
  { path: "/admin/politica-reembolso", role: "platform_super_admin", heading: "Política de reembolso", ready: "Proteção e retenção" },
  { path: "/reembolsos", role: "consumer", heading: "Meus reembolsos", ready: "Protocolo" },
];

for (const width of [320, 768, 1440]) for (const screen of screens) {
  test(`telas restantes autenticadas: ${screen.path} ${screen.role} ${width}px`, async ({ page }) => {
    const audit = await fixtures(page, screen.role);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(screen.path);
    await expect(page.getByRole("heading", { name: screen.heading, exact: true, level: 1 })).toBeVisible();
    if (screen.path === "/admin/bloqueios") {
      await page.getByLabel("CPF ou e-mail").fill("titular@example.invalid");
      await page.getByRole("button", { name: "Localizar", exact: true }).click();
      await expect(page.getByRole("button", { name: "Revogar", exact: true })).toBeVisible();
      await page.getByRole("radio", { name: "Personalizado", exact: true }).check();
      await expect(page.getByText(longName, { exact: false }).last()).toBeVisible();
    }
    await expect(page.getByText(screen.ready, { exact: false }).first()).toBeVisible();
    if (screen.path === "/produtor/loja/janelas") {
      const checkbox = page.getByRole("checkbox", { name: "Ativa para novos agendamentos" });
      const box = await checkbox.boundingBox();
      expect(box?.width).toBe(18);
      expect(box?.height).toBe(18);
      const label = page.locator(".logistics-check");
      expect((await label.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      expect(await label.evaluate(el => getComputedStyle(el).flexDirection)).toBe("row");
      const details = page.locator(".logistics-window > span");
      expect((await details.boundingBox())?.width).toBeGreaterThanOrEqual(160);
      expect(await details.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    if (screen.path === "/admin/denuncias" || screen.path === "/reembolsos") {
      await page.getByRole("button").filter({ hasText: "Protocolo" }).click();
      await expect(page.getByText(longName, { exact: true }).first()).toBeVisible();
    }
    expect(audit.errors).toEqual([]);
    expect(audit.unhandled).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const overflowing = await page.locator(".commerce-card, .subscription-card, .delivery-scope-option, .admin-card:not(.admin-card--table)").evaluateAll(cards =>
      cards.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({ className: el.className, width: el.clientWidth, scroll: el.scrollWidth })));
    expect(overflowing).toEqual([]);
    await page.screenshot({ path: `/workspace/scratch/hort-completion-evidence/${screen.path.slice(1).replaceAll("/", "-")}-${screen.role}-${width}.png`, fullPage: true });
  });
}

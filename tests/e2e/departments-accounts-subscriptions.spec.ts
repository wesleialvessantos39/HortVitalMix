import { expect, test, type Page } from "@playwright/test";
import { AdminSectorCodeSchema } from "../../shared/contracts/adminGovernance";
import { ADMIN_SECTOR_LABELS } from "../../shared/adminPermissions";
const id = "11111111-1111-4111-8111-111111111111",
  stamp = "2026-10-10T00:00:00.000Z";
const policy = {
  version: 1,
  withdrawalDays: 7,
  prorateUnused: false,
  additionalTerms:
    "Direitos legais aplicáveis são preservados. A aprovação não confirma uma transferência financeira.",
};
async function fixture(page: Page, role = "platform_super_admin") {
  await page.addInitScript(() =>
    localStorage.setItem(
      "hvm.admin.session",
      JSON.stringify({
        accessToken: "synthetic-local",
        refreshToken: "synthetic-refresh",
        expiresAt: Date.now() + 3600000,
        identityVersion: "local-departments",
      }),
    ),
  );
  const writes: Array<{ path: string; body: any }> = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace(/^\/(api|_hvm_api)/, "");
    if (!path.startsWith("/v1/")) return route.continue();
    const json = (value: unknown, status = 200) =>
      route.fulfill({ json: value, status });
    if (route.request().method() === "DELETE") {
      writes.push({ path, body: route.request().postDataJSON() });
      return json({ status: "deleted" });
    }
    if (path === "/v1/config")
      return json({
        platformName: "HortiVitalMix",
        slogan: "Tudo fresco.",
        defaultMunicipality: "Ariquemes",
        defaultState: "RO",
        currency: "BRL",
        timezone: "America/Porto_Velho",
        supportEmail: "local@example.invalid",
        supportPhone: null,
        revision: 1,
      });
    if (path === "/v1/auth/session" || path === "/v1/auth/login")
      return json({
        userId: id,
        email: "local@example.invalid",
        fullName: "Pessoa local",
        roles: [role],
        activeRole: role,
        portalKind: role.startsWith("platform_") ? "administrative" : "public",
      });
    if (path === "/v1/admin/auth/verify-session")
      return json({
        authorized: true,
        role,
        sectors: AdminSectorCodeSchema.options,
        deniedSectors: [],
        requiresReauth: false,
      });
    if (path === "/v1/admin/sectors")
      return json({
        sectors: AdminSectorCodeSchema.options.map((code) => ({
          code,
          name: ADMIN_SECTOR_LABELS[code],
          description: "Gestão específica do departamento.",
        })),
      });
    if (path === "/v1/admin/invites") return json({ invites: [] });
    if (path === "/v1/admin/dashboard")
      return json({
        generatedAt: stamp,
        refreshAfterSeconds: 30,
        scope: { role, sectors: AdminSectorCodeSchema.options },
        departments: AdminSectorCodeSchema.options.map((sector) => ({
          sector,
          title: ADMIN_SECTOR_LABELS[sector],
          description:
            "Dados do departamento conforme os poderes administrativos.",
          actionPath: "/admin/painel",
          metrics: [
            {
              key: "active",
              label: "Registros",
              value: 0,
              unit: "count",
              attention: false,
            },
          ],
        })),
      });
    if (path === "/v1/admin/subscription-plans")
      return json({ plans: [], stores: [] });
    if (path === "/v1/admin/subscriptions")
      return json({ subscriptions: [], page: 1, pageSize: 20, total: 0 });
    if (path === "/v1/admin/reviews")
      return json({
        reviews: [],
        total: 0,
        page: 1,
        pages: 1,
        metrics: { published: 0, moderated: 0, averageRating: 0 },
      });
    if (path === "/v1/admin/subscription-refund-policy")
      return json({ policy, history: [{ policy, created_at: stamp }] });
    if (path.endsWith("/subscription-refunds"))
      return json({
        refunds: [],
        total: 0,
        page: 1,
        pages: 1,
        gatewayAvailable: false,
      });
    if (path === "/v1/admin/commerce/settings")
      return json({
        revision: 1,
        policy: {
          version: 1,
          onlineWithdrawalDays: 7,
          inPersonReturnDays: 0,
          holdingDays: 7,
          additionalTerms: "Direitos legais preservados",
        },
        gateway: {
          provider: "unselected",
          accountLabel: "",
          merchantReference: "",
          platformPixKey: "",
          terminalReference: "",
        },
        gatewayAvailable: false,
      });
    if (path === "/v1/account/profile")
      return json({
        fullName: "Pessoa local",
        cpfMasked: "***.***.***-**",
        email: "local@example.invalid",
        phone: "+5569999999999",
        revision: 1,
        profileRole: role,
      });
    if (path === "/v1/account/consents") return json({ consents: [] });
    if (path === "/v1/account/preferences")
      return json({
        preferences: {
          marketingConsent: false,
          orderUpdatesChannel: "email",
          quietHoursEnabled: false,
          quietHoursStart: null,
          quietHoursEnd: null,
          revision: 1,
        },
        consents: [],
      });
    if (path === "/v1/account/addresses") return json({ addresses: [] });
    if (path === "/v1/producer/offline-sync") return json({ results: [] });
    if (path === "/v1/producer/store" || path === "/v1/producer/trial")
      return json({ store: null, trial: null });
    if (path === "/v1/subscription-plans")
      return json({
        plans: [
          {
            id,
            slug: "plano-local",
            name: "Plano local de demonstração",
            targetAudience: url.searchParams.get("audience") ?? "consumer",
            deliveriesPerWeek: 1,
            priceCents: 1000,
            billingPeriod: "monthly",
            description:
              "Benefícios de uma assinatura exibida para seu público.",
            storeId: id,
            storeName: "Loja local",
            isActive: true,
            revision: 1,
          },
        ],
        gatewayAvailable: false,
      });
    if (path.includes("notifications"))
      return json({
        notifications: [],
        unreadCount: 0,
        total: 0,
        page: 1,
        pageSize: 20,
        asOf: stamp,
        hasMore: false,
      });
    return json({ cases: [], requests: [], total: 0, page: 1, pages: 1 });
  });
  return writes;
}
for (const width of [320, 360, 390, 430, 768, 1024, 1440])
  test(`três departamentos completos e conta responsivos em ${width}px`, async ({
    page,
  }, info) => {
    await fixture(page);
    await page.setViewportSize({ width, height: width === 768 ? 430 : 850 });
    for (const [path, title] of [
      ["/admin/assinaturas", "Assinaturas e planos"],
      ["/admin/avaliacoes", "Moderação de avaliações"],
      ["/admin/politica-reembolso", "Política de reembolso"],
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`${path.split("/").at(-1)}-${width}.png`),
        fullPage: true,
      });
    }
    await page.goto("/admin/painel");
    await expect(
      page
        .getByRole("group", { name: "Departamentos disponíveis" })
        .getByRole("button"),
    ).toHaveCount(12);
    await page.unrouteAll({ behavior: "wait" });
    await fixture(page, "consumer");
    await page.goto("/conta/atualizacoes");
    await expect(
      page.getByRole("heading", { name: "Atualizações e sincronização" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sincronizar meus dados" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`conta-${width}.png`),
      fullPage: true,
    });
  });
test("administradores veem planos como demonstração e não podem contratar", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/planos");
  await expect(
    page.getByText(/visualização.*administrativ|prévia.*administrativ/i),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Prévia — contratação indisponível" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Planos para produtor" }).click();
  await expect(
    page.getByRole("heading", { name: /Planos do produtor/ }),
  ).toBeVisible();
});
test("convite administrativo oferece os doze departamentos e os três poderes independentes", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/admin/governanca");
  const fields = page.getByRole("checkbox");
  await expect(fields).toHaveCount(12);
  for (const code of [
    "subscription_management",
    "review_management",
    "refund_policy",
  ] as const) {
    const permission = page.getByRole("checkbox", {
      name: ADMIN_SECTOR_LABELS[code],
      exact: false,
    });
    await permission.check();
    await expect(permission).toBeChecked();
  }
});
test("exclusão exige consentimento, senha e identidade confirmada e limpa a sessão", async ({
  page,
}) => {
  const writes = await fixture(page, "consumer");
  await page.goto("/conta/privacidade");
  await page
    .getByRole("button", { name: "Solicitar exclusão da minha conta" })
    .click();
  await expect(
    page.getByRole("button", { name: "Excluir definitivamente minha conta" }),
  ).toBeDisabled();
  await page.getByLabel("Entendi a perda de acesso", { exact: false }).check();
  await page
    .getByLabel("Li as condições de retenção legal", { exact: false })
    .check();
  await page
    .getByLabel("Digite EXCLUIR MINHA CONTA")
    .fill("EXCLUIR MINHA CONTA");
  await page
    .getByLabel("Senha atual", { exact: true })
    .fill("synthetic-local-password");
  await page
    .getByRole("button", { name: "Excluir definitivamente minha conta" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Conta excluída. Para voltar" }),
  ).toBeVisible();
  expect(writes[0].body).toMatchObject({
    expectedUserId: id,
    expectedRole: "consumer",
    acknowledgeLoss: true,
    acknowledgeRetention: true,
  });
});

for (const role of ["consumer", "producer"]) {
  for (const width of [320, 390, 768, 1440]) {
    test(`exclusão legível, alinhada e sem cortes: ${role} ${width}px`, async ({page}, info) => {
      await fixture(page, role);
      await page.setViewportSize({width, height: 900});
      await page.goto("/conta/privacidade");
      await page.getByRole("button", {name:"Solicitar exclusão da minha conta"}).click();
      const form = page.locator(".account-erasure-form");
      await expect(form).toBeVisible();
      for (const checkbox of await form.getByRole("checkbox").all()) {
        const rect = await checkbox.boundingBox();
        expect(rect!.width).toBeGreaterThanOrEqual(20);
        expect(rect!.width).toBeLessThanOrEqual(24);
        expect(rect!.height).toBeLessThanOrEqual(24);
        const label = checkbox.locator("..");
        const spanWidth = await label.locator("span").evaluate(el => el.getBoundingClientRect().width);
        expect(spanWidth).toBeGreaterThan(100);
        await label.click();
        await expect(checkbox).toBeChecked();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.evaluate(() => window.scrollTo({top:0,behavior:"instant"}));
      await page.screenshot({path:info.outputPath(`exclusao-${role}-${width}.png`),fullPage:true});
    });
  }
}
for (const width of [320, 390, 768, 1440]) {
  test(`setores com caixas compactas e texto legível: ${width}px`, async ({page}, info) => {
    await fixture(page);
    await page.setViewportSize({width,height:900});
    await page.goto("/admin/governanca");
    const sectors = page.getByRole("group", {name:"Setores obrigatórios"});
    await expect(sectors.getByRole("checkbox")).toHaveCount(12);
    for (const input of await sectors.getByRole("checkbox").all()) {
      const box = await input.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(18);
      expect(box!.width).toBeLessThanOrEqual(24);
      expect(box!.height).toBeLessThanOrEqual(24);
      expect(await input.locator("..").locator("span").evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(100);
    }
    await sectors.getByRole("checkbox").first().check();
    await expect(sectors.getByRole("status")).toHaveText("1 setor selecionado");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo({top:0,behavior:"instant"}));
    await page.screenshot({path:info.outputPath(`governanca-${width}.png`),fullPage:true});
  });
}

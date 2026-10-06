import { expect, test, type Page } from "@playwright/test";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const policy = {
  version: 1,
  onlineWithdrawalDays: 7,
  inPersonReturnDays: 0,
  holdingDays: 7,
  additionalTerms: "",
};
const item = {
  productId: id(2),
  title: "Cenoura da horta",
  quantity: 1,
  unitType: "un",
  unitPriceCents: 700,
  totalPriceCents: 700,
  priceVersionId: id(3),
};
const sale = {
  id: id(4),
  code: "a".repeat(32),
  storeName: "Chácara Sol",
  totalCents: 700,
  items: [item],
  paymentMethod: "pix",
  paymentChannel: "system_pix",
  status: "draft",
  expiresAt: new Date(Date.now() + 900000).toISOString(),
  policy,
  customerAccepted: false,
};
const order = {
  id: id(5),
  orderNumber: "#HVM-2026-00001",
  storeName: "Chácara Sol",
  source: "online",
  status: "received",
  totalCents: 700,
  items: [item],
  createdAt: new Date().toISOString(),
  receivedAt: new Date().toISOString(),
  withdrawalDeadline: new Date(Date.now() + 7 * 86400000).toISOString(),
  problemDeadline: new Date(Date.now() + 30 * 86400000).toISOString(),
  policy,
  holdState: "held",
  customerUserId: id(1),
};
const refund = {
  id: id(6),
  kind: "refund",
  status: "requested",
  revision: 1,
  reason: "quality",
  description: "O alimento da compra apresentou um problema de qualidade.",
  orderId: order.id,
  requestedAmountCents: 700,
  approvedAmountCents: null,
  createdAt: new Date().toISOString(),
  messages: [],
  history: [
    {
      status: "requested",
      notes:
        "Solicitação registrada com bloqueio do repasse durante a análise.",
      createdAt: new Date().toISOString(),
    },
  ],
  evidence: [],
};
const complaint = {
  ...refund,
  id: id(7),
  kind: "complaint",
  status: "submitted",
  reason: "unsafe_food",
  targetType: "product",
  targetId: item.productId,
  subjectUserId: id(9),
  requestedAmountCents: undefined,
};
const gateway = {
  provider: "unselected",
  accountLabel: "",
  merchantReference: "",
  platformPixKey: "",
  terminalReference: "",
};
const capabilities = [
  "refund_management",
  "complaint_management",
  "payment_configuration",
  "account_governance",
];
async function mock(page: Page, role = "consumer", loggedIn = true) {
  const errors: string[] = [],
    posts: Array<{ path: string; body: Record<string, any> }> = [];
  let signedIn = loggedIn;
  let currentRefund = { ...refund },
    currentComplaint = { ...complaint };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (!url.pathname.includes("/v1/")) return route.continue();
    const path = url.pathname.replace(/^\/(?:api|_hvm_api)/, ""),
      json = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
    const session = {
      userId: id(1),
      email: "teste@example.test",
      fullName: "Pessoa de teste",
      roles: [role],
      activeRole: role,
      portalKind: role.startsWith("platform_") ? "administrative" : "public",
    };
    if (request.method() === "POST")
      posts.push({ path, body: request.postDataJSON() });
    if (path === "/v1/config")
      return json({
        platformName: "HortiVitalMix",
        slogan: "Tudo fresco. Tudo da sua região.",
        defaultMunicipality: "Ariquemes",
        defaultState: "RO",
        currency: "BRL",
        timezone: "America/Porto_Velho",
        supportEmail: "support@example.test",
        supportPhone: null,
        revision: 1,
      });
    if (path === "/v1/auth/session")
      return signedIn ? json(session) : json({ error: "AUTH_REQUIRED" }, 401);
    if (path === "/v1/auth/login") {
      signedIn = true;
      return json({ ...session, status: "authenticated" });
    }
    if (path === "/v1/admin/auth/login") {
      signedIn = true;
      return json({
        status: "session_created",
        role,
        sectors: capabilities,
        accessToken: "test-only",
        refreshToken: "test-only-refresh",
        expiresIn: 3600,
      });
    }
    if (path === "/v1/admin/auth/verify-session")
      return json({
        authorized: true,
        role,
        sectors: capabilities,
        requiresReauth: false,
      });
    if (path === "/v1/admin/bootstrap/status")
      return json({
        status: "closed",
        reason: null,
        authorizedEmailHint: null,
      });
    if (path === "/v1/localities") return json({ municipalities: [] });
    if (path === "/v1/categories") return json({ categories: [] });
    if (path === "/v1/commerce/policy")
      return json({ policy, gatewayAvailable: false });
    if (path === "/v1/payments/" + id(8))
      return json({
        id: id(8),
        method: url.searchParams.get("method") ?? "credit_card",
        status: "pending",
        amountCents: 700,
        expiresAt: sale.expiresAt,
        gatewayAvailable: false,
        pixCopyPaste: null,
        pixQrCodeBase64: null,
        orderIds: [],
        policy,
      });
    if (path === `/v1/payments/${id(8)}/policy`)
      return json({ accepted: true, version: 1 });
    if (path === "/v1/producer/pos")
      return json({
        store: { id: id(10), name: "Chácara Sol" },
        products: [
          {
            id: item.productId,
            title: item.title,
            unitType: "un",
            priceCents: 700,
            availableQuantity: 10,
          },
        ],
        sales: posts.some((value) => value.path.endsWith("/pos/sales"))
          ? [sale]
          : [],
        orders: [order],
        balance: { heldCents: 700, disputedCents: 0, refundedCents: 0 },
        gatewayAvailable: false,
      });
    if (path === "/v1/producer/pos/sales")
      return json(
        {
          ...sale,
          paymentMethod: request.postDataJSON().paymentMethod,
          paymentChannel: request.postDataJSON().paymentChannel,
        },
        201,
      );
    if (path === `/v1/commerce/pos/${sale.code}`) return json(sale);
    if (path === `/v1/commerce/pos/${sale.code}/accept`)
      return json({ accepted: true, gatewayAvailable: false, saleId: sale.id });
    if (path === "/v1/commerce/purchases")
      return json({ orders: [order], sales: [], payments: [] });
    if (path === "/v1/commerce/report-targets")
      return json({
        targets: [
          { id: item.productId, name: "Cenoura da horta", orderId: null },
        ],
      });
    for (const prefix of ["/v1/commerce", "/v1/admin/commerce"]) {
      if (path === `${prefix}/settings`)
        return json({ revision: 1, policy, gateway, gatewayAvailable: false });
      for (const [kind, plural] of [
        ["refund", "refunds"],
        ["complaint", "complaints"],
      ] as const) {
        let value = kind === "refund" ? currentRefund : currentComplaint;
        if (path === `${prefix}/${plural}`)
          return request.method() === "GET"
            ? json({ cases: [value], page: 1, pages: 1, total: 1 })
            : json(value, 201);
        if (path === `${prefix}/${plural}/${value.id}`) return json(value);
        if (path === `${prefix}/${plural}/${value.id}/messages`) {
          value = {
            ...value,
            messages: [
              ...value.messages,
              {
                id: id(22),
                author: role.startsWith("platform_") ? "admin" : "customer",
                message: request.postDataJSON().message,
                createdAt: new Date().toISOString(),
              },
            ],
          } as typeof value;
          if (kind === "refund") currentRefund = value as typeof refund;
          else currentComplaint = value as typeof complaint;
          return json(value);
        }
        if (path === `${prefix}/${plural}/${value.id}/decision`) {
          const input = request.postDataJSON();
          return json({
            ...value,
            status: input.decision === "approve" ? "approved" : "under_review",
            revision: 2,
            approvedAmountCents: input.approvedAmountCents ?? null,
            history: [
              ...value.history,
              {
                status: "approved",
                notes: input.notes,
                createdAt: new Date().toISOString(),
              },
            ],
          });
        }
      }
    }
    return json({ error: "NOT_FOUND" }, 404);
  });
  return { errors, posts };
}
async function noOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBe(true);
}
for (const width of [320, 390, 768, 1440]) {
  test(`pagamento preparado e campos protegidos em ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    const state = await mock(page);
    await page.goto("/pagamentos/" + id(8));
    await expect(
      page.getByRole("heading", { name: "Pagamento da compra", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Número do cartão", { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel("Código de segurança", { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Pagar com cartão", exact: true }),
    ).toBeDisabled();
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Registrar aceite dos termos" })
      .click();
    await expect(
      page.getByRole("button", { name: "Termos registrados" }),
    ).toBeDisabled();
    expect(
      state.posts.every(
        (value) =>
          !JSON.stringify(value.body).includes("cardNumber") &&
          !JSON.stringify(value.body).includes("cvv"),
      ),
    ).toBe(true);
    await noOverflow(page);
    expect(state.errors).toEqual([]);
  });
  test(`caixa presencial sem dinheiro em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const state = await mock(page, "producer");
    await page.goto("/produtor/caixa");
    await expect(
      page.getByRole("heading", { name: "Caixa do produtor", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Quantidade de Cenoura da horta").fill("2");
    await page
      .getByLabel("Cartão de débito · maquininha", { exact: true })
      .check();
    await page
      .getByRole("button", { name: "Preparar venda presencial", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Revisão para o cliente" }),
    ).toBeVisible();
    expect(
      state.posts.find((value) => value.path === "/v1/producer/pos/sales")
        ?.body,
    ).toMatchObject({
      paymentMethod: "debit_card",
      paymentChannel: "terminal",
    });
    await expect(
      page.getByText("Dinheiro em espécie não é aceito.", { exact: false }),
    ).toBeVisible();
    await noOverflow(page);
    expect(state.errors).toEqual([]);
  });
  test(`compra e prazos de proteção em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const state = await mock(page);
    await page.goto("/compras");
    await expect(
      page.getByRole("heading", { name: "Minhas compras", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Prazo de arrependimento desta compra:", { exact: false }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: "Solicitar reembolso", exact: true })
        .first(),
    ).toBeVisible();
    await noOverflow(page);
    expect(state.errors).toEqual([]);
  });
  test(`denúncia privada com histórico e mensagens em ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    const state = await mock(page);
    await page.goto(`/denuncias?targetType=product&targetId=${item.productId}`);
    await expect(
      page.getByRole("heading", { name: "Minhas denúncias", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Alimento impróprio ou inseguro/ })
      .click();
    await expect(
      page.getByText("Protocolo " + complaint.id, { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Adicionar informação", { exact: true })
      .fill("Informação adicional para a equipe analisar a denúncia.");
    await page
      .getByRole("button", { name: "Enviar mensagem", exact: true })
      .click();
    await expect(
      page.getByText("Mensagem enviada à solicitação."),
    ).toBeVisible();
    await noOverflow(page);
    expect(state.errors).toEqual([]);
  });
  test(`gestão de reembolsos em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const state = await mock(page, "platform_super_admin");
    await page.goto("/admin/reembolsos");
    await expect(
      page.getByRole("heading", { name: "Gestão de reembolsos", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Qualidade ou defeito/ }).click();
    await page
      .getByRole("combobox", { name: "Etapa", exact: true })
      .selectOption("approve");
    await page
      .getByLabel("Justificativa e orientação ao solicitante", { exact: true })
      .fill("Reembolso aprovado após a conferência dos fatos e comprovantes.");
    await page
      .getByRole("button", { name: "Registrar decisão", exact: true })
      .click();
    await expect(
      page.getByText("Decisão registrada com autor e data no histórico."),
    ).toBeVisible();
    await noOverflow(page);
    expect(state.errors).toEqual([]);
  });
  test(`configuração da conta e política em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const state = await mock(page, "platform_super_admin");
    await page.goto("/admin/pagamentos");
    await expect(
      page.getByRole("heading", {
        name: "Preparação dos pagamentos",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Chave Pix da conta central", { exact: true }),
    ).toBeEditable();
    await expect(
      page.getByLabel("Credenciais privadas do provedor", { exact: true }),
    ).toBeDisabled();
    await noOverflow(page);
    expect(state.errors).toEqual([]);
  });
}
for (const width of [390, 1440])
  for (const role of [
    "consumer",
    "producer",
    "platform_admin",
    "platform_super_admin",
  ]) {
    test(`login ${role} mantém destino e ícone em ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 950 });
      const state = await mock(page, role, false);
      const administrative = role.startsWith("platform_");
      await page.goto(
        administrative
          ? role === "platform_admin"
            ? "/entrar/administrador"
            : "/entrar/super-administrador"
          : role === "producer"
            ? "/entrar/produtor"
            : "/entrar/consumidor",
      );
      await page
        .getByLabel("E-mail", { exact: true })
        .fill("teste@example.test");
      await page
        .getByLabel("Senha", { exact: true })
        .fill("test-only-password");
      await page
        .getByRole("button", {
          name: administrative ? /^Entrar como / : "Entrar",
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(
        administrative ? new RegExp("/admin/painel$") : new RegExp("/$"),
      );
      await expect(
        page
          .locator(`[data-session-role="${role}"].is-connected:visible`)
          .first(),
      ).toBeVisible();
      await noOverflow(page);
      expect(state.errors).toEqual([]);
    });
  }

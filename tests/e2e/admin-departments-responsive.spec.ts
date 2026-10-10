import { expect, test, type Page } from "@playwright/test";

const actorId = "11111111-1111-4111-8111-111111111111";
const subjectId = "22222222-2222-4222-8222-222222222222";
const municipalityId = "33333333-3333-4333-8333-333333333333";
const recordId = "44444444-4444-4444-8444-444444444444";
const stamp = "2026-10-08T10:00:00.000Z";
const longName = "NomeExtensoParaConsultarSemCortarInformacoes".repeat(3);
const password = "synthetic-department-password";
const sectors = [
  "document_verification",
  "catalog_moderation",
  "finance_ops",
  "location_management",
  "account_governance",
  "platform_configuration",
  "refund_management",
  "complaint_management",
  "payment_configuration",
  "subscription_management",
  "review_management",
  "refund_policy",
];
type Command = { path: string; method: string; body: Record<string, unknown> };
type Options = {
  role?: "platform_admin" | "platform_super_admin";
  requiresReauth?: boolean;
  rejectAfterConfirmation?: boolean;
  differentActor?: boolean;
};

async function fixture(page: Page, options: Options = {}) {
  const role = options.role ?? "platform_super_admin";
  const commands: Command[] = [];
  let confirmed = !options.requiresReauth;
  let municipalities = [
    {
      id: municipalityId,
      ibgeCode: "1100023",
      name: "Ariquemes",
      state: "RO",
      isActive: true,
      revision: 1,
      deactivatedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  let blocks = [
    {
      id: recordId,
      userId: subjectId,
      subject: "producer_publishing",
      scope: "custom",
      reason: longName,
      isActive: true,
      municipalityIds: [municipalityId],
      propertyIds: [recordId],
      createdAt: stamp,
      revokedAt: null,
    },
  ];
  const caseView = (kind: "refund" | "complaint") => ({
    id: recordId,
    kind,
    status: "requested",
    revision: 1,
    reason: "other",
    description: longName,
    orderId: null,
    requestedAmountCents: 12345678,
    approvedAmountCents: null,
    createdAt: stamp,
    messages: [
      {
        id: subjectId,
        message: longName,
        author: "customer",
        createdAt: stamp,
      },
    ],
    history: [{ status: "requested", notes: longName, createdAt: stamp }],
    evidence: [],
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "hvm.admin.session",
      JSON.stringify({
        accessToken: "synthetic-old-token",
        refreshToken: "synthetic-old-refresh",
        expiresAt: Date.now() + 3600000,
      }),
    );
  });
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const path = url.pathname.replace(/^\/(?:api|_hvm_api)/, "");
    if (!path.startsWith("/v1/")) return route.continue();
    const method = request.method(),
      body = method === "GET" ? {} : (request.postDataJSON() ?? {});
    const json = (value: unknown, status = 200) =>
      route.fulfill({ json: value, status });
    if (method !== "GET") commands.push({ path, method, body });
    if (path === "/v1/auth/session")
      return json({
        userId: actorId,
        email: "admin@example.invalid",
        fullName: longName,
        roles: [role],
        activeRole: role,
        portalKind: "administrative",
      });
    if (path === "/v1/admin/auth/verify-session")
      return json({
        authorized: true,
        role,
        sectors,
        deniedSectors: [],
        requiresReauth: !confirmed,
      });
    if (path === "/v1/config")
      return json({
        platformName: "HortiVitalMix",
        slogan: "Alimentos frescos.",
        defaultMunicipality: "Ariquemes",
        defaultState: "RO",
        currency: "BRL",
        timezone: "America/Porto_Velho",
        supportEmail: "support@example.invalid",
        supportPhone: null,
        revision: 1,
      });
    if (path.endsWith("/notifications"))
      return json({
        notifications: [],
        unreadCount: 0,
        total: 0,
        page: 1,
        pages: 1,
        asOf: stamp,
      });
    if (path === "/v1/app-distribution")
      return json({
        revision: 1,
        updatedAt: stamp,
        releaseNotes: "",
        web: {
          version: "synthetic-test-release",
          commitSha: "a".repeat(40),
          schemaVersion: 67,
          available: true,
          updatedAt: stamp,
          updateMode: "hosted_web",
          requiresStoreUpdateForNativeChanges: true,
        },
        android: {
          available: false,
          version: null,
          url: null,
          downloadUrl: null,
          channel: null,
          updatedAt: null,
        },
        ios: {
          available: false,
          version: null,
          url: null,
          downloadUrl: null,
          channel: null,
          updatedAt: null,
        },
      });
    if (path === "/v1/account/addresses") return json({ addresses: [] });
    if (path === "/v1/auth/logout") return json({ status: "signed_out" });
    if (path === "/v1/admin/auth/reauthenticate") {
      if (body.password !== password)
        return json({ status: "invalid_credentials" }, 401);
      confirmed = true;
      return json({
        status: "session_created",
        userId: options.differentActor ? subjectId : actorId,
        role,
        accessToken: "synthetic-confirmed-token",
        refreshToken: "synthetic-confirmed-refresh",
        expiresIn: 3600,
        sectors,
        deniedSectors: [],
      });
    }
    if (
      method !== "GET" &&
      (path.startsWith("/v1/admin/localities") ||
        path.startsWith("/v1/admin/access-blocks"))
    ) {
      if (!confirmed || options.rejectAfterConfirmation)
        return json({ error: "ADMIN_REAUTHENTICATION_REQUIRED", actorId }, 401);
    }
    if (path === "/v1/admin/users")
      return json({
        users: [
          {
            id: subjectId,
            status: "active",
            full_name: longName,
            email_normalized: "endereco.extenso.para.consulta@example.invalid",
            role_code: "platform_admin",
            account_kind: "administrative",
            email_confirmed: true,
            sectors,
            public_roles: [],
          },
          {
            id: recordId,
            status: "blocked",
            full_name: "Cliente Teste",
            email_normalized: "cliente@example.invalid",
            role_code: null,
            account_kind: "public",
            email_confirmed: true,
            sectors: [],
            public_roles: ["consumer", "producer"],
          },
        ],
      });
    if (path === "/v1/admin/registration-reviews") return json({ reviews: [] });
    if (path === "/v1/admin/sectors")
      return json({
        sectors: sectors.map((code) => ({
          code,
          name: code,
          description: code,
        })),
      });
    if (path === "/v1/admin/localities" && method === "GET")
      return json({
        municipalities,
        activeMunicipalityIds: municipalities
          .filter((item) => item.isActive)
          .map((item) => item.id),
      });
    if (path === "/v1/admin/localities" && method === "POST") {
      const municipality = {
        id: recordId,
        name: body.name,
        state: "RO",
        ibgeCode: body.ibgeCode,
        isActive: true,
        revision: 1,
      };
      municipalities.push({
        ...municipality,
        createdAt: stamp,
        updatedAt: stamp,
        deactivatedAt: null,
      } as (typeof municipalities)[number]);
      return json({ status: "created", municipality });
    }
    if (path.endsWith("/impact"))
      return json({
        municipalityId,
        isActive: true,
        people: 2,
        properties: 1,
        deliveryScopes: 1,
        partialBlocks: 1,
      });
    if (
      path === `/v1/admin/localities/${municipalityId}` &&
      method === "PATCH"
    ) {
      municipalities = municipalities.map((item) => ({
        ...item,
        isActive: body.isActive as boolean,
        revision: item.revision + 1,
      }));
      const {
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        deactivatedAt: _deactivatedAt,
        ...municipality
      } = municipalities[0];
      return json({ status: "updated", municipality });
    }
    if (
      path === `/v1/admin/localities/${municipalityId}` &&
      method === "DELETE"
    ) {
      municipalities = [];
      return json({ status: "deleted", municipalityId });
    }
    if (path === "/v1/admin/access-blocks/subject")
      return json({
        found: true,
        user: {
          userId: subjectId,
          personId: subjectId,
          fullName: longName,
          cpf: "12345678901",
          email: "cliente@example.invalid",
          status: "active",
          publicRoles: ["producer", "consumer"],
          municipalityId,
          municipalityName: "Ariquemes",
          municipalityState: "RO",
        },
      });
    if (path === "/v1/admin/access-blocks/subject-properties")
      return json({
        properties: [
          {
            id: recordId,
            name: longName,
            status: "approved",
            municipality: "Ariquemes",
            state: "RO",
          },
        ],
      });
    if (path === "/v1/admin/access-blocks" && method === "GET")
      return json({ blocks });
    if (path === "/v1/admin/access-blocks" && method === "POST") {
      const block = {
        id: subjectId,
        userId: body.userId,
        subject: body.subject,
        scope: body.scope,
        reason: body.reason,
        isActive: true,
        municipalityIds: body.municipalityIds,
        propertyIds: body.propertyIds,
        createdAt: stamp,
        revokedAt: null,
      };
      return json({ status: "created", block });
    }
    if (path.endsWith("/revoke")) {
      blocks = [];
      return json({ status: "revoked" });
    }
    if (path === "/v1/admin/categories")
      return json({
        categories: [
          {
            id: recordId,
            parentId: null,
            slug: "hortalicas",
            name: longName.slice(0, 128),
            description: longName,
            iconName: "leaf",
            displayOrder: 0,
            isActive: true,
            revision: 1,
          },
        ],
      });
    if (path === "/v1/admin/subscription-plans")
      return json({
        plans: [
          {
            id: recordId,
            slug: "cesta-local",
            name: longName,
            targetAudience: "consumer",
            deliveriesPerWeek: 2,
            priceCents: 12345678,
            billingPeriod: "monthly",
            description: longName,
            storeId: subjectId,
            storeName: longName,
            isActive: true,
            revision: 1,
          },
        ],
        stores: [{ id: subjectId, name: longName }],
      });
    if (path === "/v1/admin/reviews")
      return json({
        reviews: [
          {
            id: recordId,
            rating: 5,
            comment: longName,
            createdAt: stamp,
            orderId: subjectId,
            orderNumber: "HVM-2026-0001",
            storeId: subjectId,
            storeName: longName,
            isModerated: false,
            moderationReason: null,
            moderatedBy: null,
            moderatedAt: null,
          },
        ],
        page: 1,
        pages: 2,
        total: 2,
      });
    if (path === "/v1/admin/bi")
      return json({
        startDate: url.searchParams.get("startDate"),
        endDate: url.searchParams.get("endDate"),
        timezone: "America/Porto_Velho",
        today: new Date().toISOString().slice(0, 10),
        definitions: ["gmv_cents", "avg_ticket_cents", "active_producers"].map(
          (code) => ({
            code,
            name: longName,
            formulaDescription: longName,
            aggregationInterval: "daily",
          }),
        ),
        metrics: [
          {
            code: "gmv_cents",
            value: 12345678,
            referenceDate: url.searchParams.get("endDate"),
            calculatedAt: stamp,
          },
        ],
      });
    if (path === "/v1/admin/verification-queue")
      return json({
        requests: [
          {
            id: recordId,
            status: "pending",
            property_name: longName,
            producer_name: longName,
            municipality: "Ariquemes",
            line_vicinal: longName,
            total_area_hectares: "123.45",
            cultivated_area_hectares: "12.34",
            latitude_sede: "-9.9",
            longitude_sede: "-63.0",
            draft_data: null,
            perimeter: null,
            documents: [],
            extraction: null,
            last_decision: null,
          },
        ],
      });
    if (path === "/v1/admin/commerce/settings")
      return json({
        revision: 1,
        policy: {
          version: 1,
          onlineWithdrawalDays: 7,
          inPersonReturnDays: 0,
          holdingDays: 7,
          additionalTerms: longName,
        },
        gateway: {
          provider: "unselected",
          accountLabel: longName.slice(0, 128),
          merchantReference: "",
          platformPixKey: "",
          terminalReference: "",
        },
        gatewayAvailable: false,
      });
    if (path.startsWith("/v1/admin/commerce/refunds"))
      return json(
        path.endsWith(recordId)
          ? caseView("refund")
          : { cases: [caseView("refund")], pages: 1 },
      );
    if (path.startsWith("/v1/admin/commerce/complaints"))
      return json(
        path.endsWith(recordId)
          ? caseView("complaint")
          : { cases: [caseView("complaint")], pages: 1 },
      );
    return json({ error: "NOT_FOUND" }, 404);
  });
  return { commands };
}

const screens = [
  { path: "/admin/usuarios", heading: "Usuários", ready: ".admin-data-table" },
  {
    path: "/admin/localidades",
    heading: "Localidades",
    ready: ".admin-data-table",
  },
  {
    path: "/admin/bloqueios",
    heading: "Bloqueios por localidade",
    ready: ".admin-data-table",
  },
  {
    path: "/admin/categorias",
    heading: "Categorias",
    ready: ".hvm-category-list li",
  },
  {
    path: "/admin/bi",
    heading: "BI executivo",
    ready: ".hvm-bi-table-scroll tbody",
  },
  {
    path: "/admin/imoveis",
    heading: "Fila de auditoria humana",
    ready: ".verification-triple",
  },
  {
    path: "/admin/avaliacoes",
    heading: "Moderação de avaliações",
    ready: ".review-admin-card",
  },
  {
    path: "/admin/assinaturas",
    heading: "Assinaturas e planos",
    ready: ".subscription-grid .subscription-card",
  },
  {
    path: "/admin/reembolsos",
    heading: "Gestão de reembolsos",
    ready: ".commerce-history",
  },
  {
    path: "/admin/denuncias",
    heading: "Denúncias e segurança",
    ready: ".commerce-history",
  },
  {
    path: "/admin/politica-reembolso",
    heading: "Política de reembolso",
    ready: "fieldset",
  },
  {
    path: "/admin/pagamentos",
    heading: "Preparação dos pagamentos",
    ready: "fieldset",
  },
];

async function openScreen(page: Page, screen: (typeof screens)[number]) {
  await page.goto(screen.path);
  await expect(
    page.getByRole("heading", { name: screen.heading, exact: true }),
  ).toBeVisible();
  if (screen.path === "/admin/bloqueios") {
    await page.getByLabel("CPF ou e-mail").fill("cliente@example.invalid");
    await page.getByRole("button", { name: "Localizar", exact: true }).click();
  }
  if (screen.path === "/admin/imoveis")
    await page.locator(".verification-item").click();
  if (screen.path === "/admin/reembolsos" || screen.path === "/admin/denuncias")
    await page.locator(".commerce-case-list button").click();
  await expect(page.locator(screen.ready).first()).toBeVisible();
}

for (const width of [320, 390, 768, 1440]) {
  for (const screen of screens) {
    test(`departamento profissional com conteúdo realista: ${screen.path} ${width}px`, async ({
      page,
    }) => {
      await fixture(page);
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await openScreen(page, screen);
      expect(errors).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const overflowing = await page
        .locator(
          ".admin-data-table, .commerce-card, .review-admin-card, .subscription-card, .hvm-category-list li, .verification-triple > article",
        )
        .evaluateAll((elements) =>
          elements
            .filter((element) => element.scrollWidth > element.clientWidth + 1)
            .map((element) => ({
              class: element.className,
              width: element.clientWidth,
              scroll: element.scrollWidth,
            })),
        );
      expect(overflowing).toEqual([]);
      if (screen.path === "/admin/bi") {
        const caption = await page
          .locator(".hvm-bi-table-scroll caption")
          .boundingBox();
        expect(caption!.width).toBeGreaterThan(220);
        expect(caption!.height).toBeLessThanOrEqual(110);
      }
      if (screen.ready === ".admin-data-table") {
        const layout = await page
          .locator(".admin-data-table tbody tr")
          .first()
          .evaluate((element) => getComputedStyle(element).display);
        expect(layout).toBe(width <= 768 ? "grid" : "table-row");
        if (width <= 390) {
          const record = page.locator(".admin-data-table tbody tr").first();
          expect(
            await record.evaluate(
              (element) =>
                getComputedStyle(element).gridTemplateColumns.split(" ").length,
            ),
          ).toBe(2);
          const actions = record.locator("td").last();
          const recordBox = await record.boundingBox();
          const actionsBox = await actions.boundingBox();
          expect(actionsBox!.width).toBeGreaterThan(recordBox!.width * 0.8);
        }
      }
      if (
        width === 390 ||
        width === 1440 ||
        screen.ready === ".admin-data-table" ||
        ["/admin/bi", "/admin/localidades", "/admin/assinaturas"].includes(
          screen.path,
        )
      )
        await page.screenshot({
          path: `/workspace/scratch/hort-departments-${screen.path.slice(7)}-${width}.png`,
          fullPage: true,
        });
    });
  }
}

test("filtros de usuários mantêm ações e recuperam a consulta vazia", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/usuarios");
  await expect(page.locator(".admin-data-table tbody tr")).toHaveCount(2);
  await page.getByLabel("Tipo de conta").selectOption("consumer");
  await expect(page.locator(".admin-data-table tbody tr")).toHaveCount(1);
  await expect(page.getByText("Cliente Teste", { exact: true })).toBeVisible();
  await page.getByLabel("Buscar usuário").fill("sem-correspondencia");
  await expect(page.getByText(/Nenhuma conta corresponde/)).toBeVisible();
  await page.getByLabel("Buscar usuário").fill("");
  await page.getByLabel("Tipo de conta").selectOption("all");
  await page.getByLabel("Situação da conta").selectOption("active");
  await expect(page.locator(".admin-data-table tbody tr")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Bloquear", exact: true }),
  ).toBeVisible();
});

test("busca por município conserva o controle de cobertura", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/admin/localidades");
  await page.getByLabel("Buscar município").fill("1100023");
  await expect(page.locator(".admin-data-table tbody tr")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Bloquear", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Buscar município").fill("inexistente");
  await expect(
    page.getByText("Nenhum município corresponde a esta busca."),
  ).toBeVisible();
  await page.getByLabel("Buscar município").fill("");
  await expect(
    page.getByRole("button", { name: "Bloquear", exact: true }),
  ).toBeVisible();
});

for (const role of ["platform_admin", "platform_super_admin"] as const) {
  test(`localidades exibem lista compacta e conservam cadastro recolhido: ${role}`, async ({
    page,
  }) => {
    const { commands } = await fixture(page, { role });
    await page.setViewportSize({
      width: role === "platform_admin" ? 390 : 1440,
      height: 900,
    });
    await page.goto("/admin/localidades");
    const editor = page.locator("#admin-municipality-editor");
    const open = page.getByRole("button", {
      name: "Novo município",
      exact: true,
    });
    await expect(open).toHaveAttribute("aria-expanded", "false");
    await expect(editor).toHaveCount(0);
    await expect(page.locator(".admin-data-table tbody tr")).toHaveCount(1);
    await open.click();
    await expect(page.getByLabel("Nome do município")).toBeFocused();
    await page.getByLabel("Nome do município").selectOption("Cacoal");
    await expect(page.getByLabel("Código IBGE")).toHaveValue("1100049");
    await page
      .getByRole("button", { name: "Recolher formulário", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    await expect(open).toBeFocused();
    await open.click();
    await expect(page.getByLabel("Nome do município")).toHaveValue("Cacoal");
    await expect(page.getByLabel("Código IBGE")).toHaveValue("1100049");
    expect(commands.filter((command) => command.method !== "GET")).toHaveLength(
      0,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test(`assinaturas exibem lista compacta e conservam edição recolhida: ${role}`, async ({
    page,
  }) => {
    const { commands } = await fixture(page, { role });
    await page.setViewportSize({
      width: role === "platform_admin" ? 390 : 1440,
      height: 900,
    });
    await page.goto("/admin/assinaturas");
    const editor = page.locator("#admin-plan-editor");
    const open = page.getByRole("button", { name: "Novo plano", exact: true });
    await expect(open).toHaveAttribute("aria-expanded", "false");
    await expect(editor).toHaveCount(0);
    await expect(
      page.locator(".subscription-grid .subscription-card"),
    ).toHaveCount(1);
    await page
      .getByRole("button", { name: `Editar ${longName}`, exact: true })
      .click();
    await expect(page.getByLabel("Nome do plano")).toBeFocused();
    await expect(page.getByLabel("Nome do plano")).toHaveValue(longName);
    await expect(page.getByLabel("Preço por ciclo (R$)")).toHaveValue(
      "123456.78",
    );
    await page.getByLabel("Nome do plano").fill("Rascunho preservado");
    await page
      .getByRole("button", { name: "Recolher formulário", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    const resume = page.getByRole("button", {
      name: "Continuar edição",
      exact: true,
    });
    await expect(resume).toBeFocused();
    await resume.click();
    await expect(page.getByLabel("Nome do plano")).toHaveValue(
      "Rascunho preservado",
    );
    await expect(page.getByLabel("Loja responsável")).toHaveValue(subjectId);
    await expect(page.getByLabel("Entregas por semana")).toHaveValue("2");
    await page
      .getByRole("button", { name: "Cancelar edição", exact: true })
      .click();
    await expect(page.getByLabel("Nome do plano")).toHaveValue("");
    await expect(
      page.getByRole("heading", { name: "Novo plano", exact: true }),
    ).toBeVisible();
    expect(commands.filter((command) => command.method !== "GET")).toHaveLength(
      0,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test(`bloqueio confirma a mesma conta e preserva o comando: ${role}`, async ({
    page,
  }) => {
    const { commands } = await fixture(page, { role, requiresReauth: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await openScreen(page, screens[2]);
    await page.getByLabel("Personalizado", { exact: true }).check();
    await page.getByLabel("Ariquemes – RO", { exact: true }).check();
    await page
      .locator("fieldset")
      .filter({ has: page.getByText("Imóveis bloqueados", { exact: true }) })
      .getByRole("checkbox")
      .check();
    await page
      .getByLabel("Motivo", { exact: true })
      .fill("Análise administrativa de teste");
    await page
      .getByRole("button", { name: "Aplicar bloqueio parcial", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Confirmar operação administrativa",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Senha administrativa").fill("senha-incorreta");
    await dialog
      .getByRole("button", { name: "Confirmar identidade", exact: true })
      .click();
    await expect(
      dialog.getByText(/Confira sua senha administrativa/),
    ).toBeVisible();
    expect(
      commands.filter((command) => command.path === "/v1/admin/access-blocks"),
    ).toHaveLength(1);
    await dialog.getByLabel("Senha administrativa").fill(password);
    await dialog
      .getByRole("button", { name: "Confirmar identidade", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByText("Bloqueio parcial aplicado.", { exact: true }),
    ).toBeVisible();
    const attempts = commands.filter(
      (command) => command.path === "/v1/admin/access-blocks",
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[1].body).toEqual(attempts[0].body);
    expect(attempts[1].body.municipalityIds).toEqual([municipalityId]);
    expect(attempts[1].body.propertyIds).toEqual([recordId]);
    expect(
      commands.filter((command) => command.path.endsWith("/auth/refresh")),
    ).toHaveLength(0);
    expect(page.url()).toContain("/admin/bloqueios");
  });

  test(`localidade mantém impacto/revisão e permite cancelar confirmação: ${role}`, async ({
    page,
  }) => {
    const { commands } = await fixture(page, { role, requiresReauth: true });
    await page.goto("/admin/localidades");
    await page.getByRole("button", { name: "Bloquear", exact: true }).click();
    await expect(page.getByText("Pessoas vinculadas: 2")).toBeVisible();
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Confirmar operação administrativa",
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Voltar sem confirmar", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("Pessoas vinculadas: 2")).toBeVisible();
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await dialog.getByLabel("Senha administrativa").fill(password);
    await dialog
      .getByRole("button", { name: "Confirmar identidade", exact: true })
      .click();
    await expect(
      page.getByText("Ariquemes – RO desativado.", { exact: true }),
    ).toBeVisible();
    const attempts = commands.filter((command) => command.method === "PATCH");
    expect(attempts).toHaveLength(3);
    expect(attempts[1].body).toEqual(attempts[0].body);
    expect(attempts[2].body).toEqual(attempts[0].body);
    expect(attempts[2].body.expectedRevision).toBe(1);
    expect(page.url()).toContain("/admin/localidades");
  });
}

test("confirmação que retorna outra conta não repete a decisão", async ({
  page,
}) => {
  const { commands } = await fixture(page, {
    requiresReauth: true,
    differentActor: true,
  });
  await openScreen(page, screens[2]);
  await page
    .getByLabel("Motivo", { exact: true })
    .fill("Análise administrativa de teste");
  await page
    .getByRole("button", { name: "Aplicar bloqueio parcial", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Confirmar operação administrativa",
  });
  await dialog.getByLabel("Senha administrativa").fill(password);
  await dialog
    .getByRole("button", { name: "Confirmar identidade", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/entrar$/);
  await expect(
    page.getByRole("heading", { name: "Escolha o acesso", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("hvm.admin.session")),
  ).toBeNull();
  expect(
    commands.filter((command) => command.path === "/v1/admin/access-blocks"),
  ).toHaveLength(1);
  expect(
    commands.filter((command) => command.path === "/v1/auth/logout"),
  ).toHaveLength(1);
});

test("nova exigência após confirmar encerra retry e conserva o motivo", async ({
  page,
}) => {
  const { commands } = await fixture(page, {
    requiresReauth: true,
    rejectAfterConfirmation: true,
  });
  await openScreen(page, screens[2]);
  await page
    .getByLabel("Motivo", { exact: true })
    .fill("Análise administrativa de teste");
  await page
    .getByRole("button", { name: "Aplicar bloqueio parcial", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Confirmar operação administrativa",
  });
  await dialog.getByLabel("Senha administrativa").fill(password);
  await dialog
    .getByRole("button", { name: "Confirmar identidade", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("alert")).toContainText("após a confirmação");
  await expect(page.getByLabel("Motivo", { exact: true })).toHaveValue(
    "Análise administrativa de teste",
  );
  const attempts = commands.filter(
    (command) => command.path === "/v1/admin/access-blocks",
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[1].body).toEqual(attempts[0].body);
});

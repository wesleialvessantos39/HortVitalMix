import { expect, test, type Page } from "@playwright/test";

const userId = "11111111-1111-4111-8111-111111111111";
const propertyId = "22222222-2222-4222-8222-222222222222";
const session = {
  userId,
  email: "produtor@example.test",
  fullName: "Produtor Local",
  roles: ["producer"],
  activeRole: "producer",
  portalKind: "public",
};
const initialStore = {
  id: "33333333-3333-4333-8333-333333333333",
  producerProfileId: "44444444-4444-4444-8444-444444444444",
  propertyId,
  storeName: "Chácara Boa Colheita",
  storeSlug: "chacara-boa-colheita",
  bio: "Produção local com cuidado, frescor e uma história cultivada em família.",
  minOrderAmountCents: 2000,
  cutoffHour: "14:00",
  status: "draft",
  revision: 2,
  avatarUrl: null,
  bannerUrl: null,
  operatingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isHarvestDay: dayOfWeek > 0,
    isDeliveryDay: dayOfWeek > 1,
    cutoffTime: "14:00",
  })),
};
async function mockStore(
  page: Page,
  options: {
    guest?: boolean;
    forbidden?: boolean;
    conflict?: boolean;
    reauth?: boolean;
    empty?: boolean;
    publicHidden?: boolean;
    active?: boolean;
  } = {},
) {
  let store: typeof initialStore | null = options.empty
    ? null
    : { ...initialStore, status: options.active ? "active" : "draft" };
  let authenticated = !options.reauth;
  const mutations: Array<{
    method: string;
    path: string;
    body: Record<string, any>;
  }> = [];
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (!url.pathname.includes("/v1/")) return route.continue();
    const path = url.pathname.replace(/^\/(?:_hvm_api|api)/, "");
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/v1/config")
      return json({
        platformName: "HortiVitalMix",
        slogan: "Tudo fresco. Tudo da sua região.",
        defaultMunicipality: "Ariquemes",
        defaultState: "RO",
        currency: "BRL",
        timezone: "America/Porto_Velho",
        supportEmail: "hortivitalmix@gmail.com",
        supportPhone: null,
        revision: 1,
      });
    if (path === "/v1/auth/session")
      return options.guest
        ? json({ error: "AUTH_REQUIRED" }, 401)
        : json(session);
    if (path === "/v1/auth/login") {
      authenticated = true;
      return json(session);
    }
    if (path === "/v1/account/addresses") return json({ addresses: [] });
    if (path.startsWith("/v1/localities")) return json({ municipalities: [] });
    if (path === "/v1/products") return json({ products: [] });
    if (path === "/v1/account/profile")
      return json({
        fullName: "Produtor Local",
        cpfMasked: "***.***.123-45",
        phone: "+5569999999999",
        email: session.email,
        revision: 1,
      });
    if (path === "/v1/producer/properties") return json({ properties: [] });
    if (path === "/v1/producer/store" && request.method() === "GET")
      return json({
        store,
        canPublish: Boolean(store && !options.forbidden),
        properties: [
          {
            id: propertyId,
            name: "Chácara Boa Colheita",
            location: "Linha C-65 · Ariquemes/RO",
            approved: !options.forbidden,
          },
        ],
      });
    if (path.startsWith("/v1/producer/store") && request.method() !== "GET") {
      const body = request.postDataJSON();
      mutations.push({ method: request.method(), path, body });
      if (!authenticated && !path.endsWith("/pause"))
        return json({ error: "RECENT_AUTH_REQUIRED" }, 401);
      if (options.conflict)
        return json(
          { error: "STORE_REVISION_CONFLICT", currentRevision: 3 },
          409,
        );
      if (path.endsWith("/publish") && options.forbidden)
        return json({ error: "STORE_PUBLISH_FORBIDDEN" }, 403);
      if (!store)
        store = {
          ...initialStore,
          bio: "",
          propertyId: null as unknown as string,
          revision: 1,
        };
      else if (request.method() === "PATCH")
        store = {
          ...store,
          storeName: body.storeName,
          storeSlug: body.storeSlug,
          bio: body.bio,
          propertyId: body.propertyId,
          minOrderAmountCents: body.minOrderAmountCents,
          cutoffHour: body.cutoffHour,
          operatingHours: body.operatingHours,
          revision: store.revision + 1,
        };
      else
        store = {
          ...store,
          status: path.endsWith("/pause") ? "paused" : "active",
          revision: store.revision + 1,
        };
      return json({ store });
    }
    if (path.startsWith("/v1/stores/"))
      return options.publicHidden
        ? json({ error: "STORE_NOT_FOUND" }, 404)
        : json({
            name: initialStore.storeName,
            slug: initialStore.storeSlug,
            bio: initialStore.bio,
            avatarUrl: null,
            bannerUrl: null,
            location: "Linha C-65 · Ariquemes/RO",
            verification: { isVerified: true, trustLevel: 2 },
            minOrderAmountCents: 2000,
            cutoffHour: "14:00",
            operatingHours: initialStore.operatingHours,
          });
    return json({ error: "NOT_FOUND" }, 404);
  });
  return mutations;
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
for (const width of [320, 390, 768, 1440]) {
  test(`configurações e matriz de sete dias em ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockStore(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/produtor/loja");
    await expect(
      page.getByRole("heading", { name: "Minha loja", exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    await page.getByRole("tab", { name: "Rotina e horários" }).click();
    await expect(
      page.getByRole("checkbox", { name: /Dia de Colheita/ }),
    ).toHaveCount(7);
    await noOverflow(page);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath(`loja-${width}.png`),
      fullPage: true,
    });
  });
  test(`vitrine pública sem login em ${width}px`, async ({ page }) => {
    await mockStore(page, { guest: true });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/produtores/chacara-boa-colheita");
    await expect(
      page.getByRole("heading", { name: "Chácara Boa Colheita", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Produtor Verificado — Nível 2")).toBeVisible();
    await expect(page.getByText("Novas colheitas em breve")).toBeVisible();
    await noOverflow(page);
    await page.getByText("Consultar horários por dia").click();
    await noOverflow(page);
    await page.screenshot({
      path: test.info().outputPath(`vitrine-${width}.png`),
      fullPage: true,
    });
  });
}
test("salva configurações e sete horários em um único comando", async ({
  page,
}) => {
  const mutations = await mockStore(page);
  await page.goto("/produtor/loja");
  await page
    .getByLabel("Nome da loja", { exact: true })
    .fill("Colheita da família");
  await page.getByRole("tab", { name: "Rotina e horários" }).click();
  await page
    .getByLabel("Horário de corte — Domingo", { exact: true })
    .fill("12:30");
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  await expect(
    page.getByText("Configurações e horários salvos."),
  ).toBeVisible();
  const save = mutations.find((mutation) => mutation.method === "PATCH");
  expect(save?.body.storeName).toBe("Colheita da família");
  expect(save?.body.operatingHours).toHaveLength(7);
  expect(save?.body.operatingHours[0].cutoffTime).toBe("12:30");
  expect(save?.body).not.toHaveProperty("producerProfileId");
});
test("403 de homologação orienta o produtor para Meus Imóveis", async ({
  page,
}) => {
  await mockStore(page, { forbidden: true });
  await page.goto("/produtor/loja");
  await page.getByRole("button", { name: "Abrir Loja para Vendas" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "imóvel ainda não foi homologado",
  );
});
test("conflito preserva o texto editado e exige recarga explícita", async ({
  page,
}) => {
  await mockStore(page, { conflict: true });
  await page.goto("/produtor/loja");
  await page
    .getByLabel("Nome da loja", { exact: true })
    .fill("Minha alteração preservada");
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  await expect(page.getByRole("alert")).toContainText("outro dispositivo");
  await expect(page.getByLabel("Nome da loja", { exact: true })).toHaveValue(
    "Minha alteração preservada",
  );
  await expect(
    page.getByRole("button", { name: "Recarregar configurações" }),
  ).toBeVisible();
});
test("senha recente retoma o mesmo comando idempotente de publicação", async ({
  page,
}) => {
  const mutations = await mockStore(page, { reauth: true });
  await page.goto("/produtor/loja");
  await page.getByRole("button", { name: "Abrir Loja para Vendas" }).click();
  await page.getByLabel("Senha atual").fill("senha-local-de-teste");
  await page.getByRole("button", { name: "Confirmar e continuar" }).click();
  await expect(page.getByText("Sua vitrine está aberta!")).toBeVisible();
  expect(
    new Set(mutations.map((mutation) => mutation.body.commandId)).size,
  ).toBe(1);
});
test("pausa de emergência não exige confirmação de senha", async ({ page }) => {
  await mockStore(page, { active: true, reauth: true });
  await page.goto("/produtor/loja");
  await page.getByRole("button", { name: "Pausa de Emergência" }).click();
  await expect(
    page.getByText("Vitrine pausada. Ela não aparece para visitantes."),
  ).toBeVisible();
  await expect(page.getByLabel("Senha atual")).toHaveCount(0);
});
test("a vitrine oculta não expõe cadastro, titular ou status", async ({
  page,
}) => {
  await mockStore(page, { guest: true, publicHidden: true });
  await page.goto("/produtores/chacara-boa-colheita");
  await expect(
    page.getByRole("heading", { name: "Vitrine indisponível" }),
  ).toBeVisible();
  await expect(
    page.getByText("Chácara Boa Colheita", { exact: true }),
  ).toHaveCount(0);
});
test("conta do produtor oferece acesso à Minha loja", async ({ page }) => {
  await mockStore(page);
  await page.goto("/conta");
  await page.getByRole("button", { name: /Minha loja/ }).click();
  await expect(page).toHaveURL(/\/produtor\/loja$/);
  await expect(
    page.getByRole("heading", { name: "Minha loja", exact: true }),
  ).toBeVisible();
});
test("estado vazio cria apenas um rascunho por ação", async ({ page }) => {
  const mutations = await mockStore(page, { empty: true });
  await page.goto("/produtor/loja");
  await page.getByRole("button", { name: "Criar minha vitrine" }).click();
  await expect(
    page.getByText("Rascunho criado. Agora personalize sua loja."),
  ).toBeVisible();
  expect(mutations).toHaveLength(1);
});

import { expect, test, type Page } from "@playwright/test";
const userId = "11111111-1111-4111-8111-111111111111",
  storeId = "22222222-2222-4222-8222-222222222222",
  propertyId = "33333333-3333-4333-8333-333333333333";
const session = {
  userId,
  email: "producer@example.test",
  fullName: "Produtor",
  roles: ["producer"],
  activeRole: "producer",
  portalKind: "public",
};
const initial = {
  store: { id: storeId, name: "Chácara do Vale" },
  origin: {
    propertyId,
    propertyName: "Chácara do Vale",
    centerLatitude: -10.0133,
    centerLongitude: -63.0408,
  },
  serviceArea: null as null | {
    radiusKm: number;
    centerLatitude: number;
    centerLongitude: number;
    isActive: boolean;
  },
  rules: {
    baseFeeCents: 500,
    feePerKmCents: 100,
    minOrderCents: 2000,
    freeDeliveryThresholdCents: null as number | null,
    estimatedPrepHours: 4,
  },
  revision: 0,
  canConfigure: true,
  ariquemesDistanceKm: 11.11949,
};
async function mock(
  page: Page,
  options: {
    guest?: boolean;
    consumer?: boolean;
    reauth?: boolean;
    conflict?: boolean;
    error?: boolean;
    noOrigin?: boolean;
    noStore?: boolean;
    delay?: boolean;
  } = {},
) {
  let value = structuredClone(initial),
    authenticated = !options.reauth,
    recovered = false;
  if (options.noOrigin) {
    value.origin = null as any;
    value.canConfigure = false;
    value.ariquemesDistanceKm = null as any;
  }
  if (options.noStore) {
    value.store = null as any;
    value.origin = null as any;
    value.canConfigure = false;
    value.ariquemesDistanceKm = null as any;
  }
  const requests: any[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const r = route.request(),
      url = new URL(r.url());
    if (!url.pathname.includes("/v1/")) return route.continue();
    const path = url.pathname.replace(/^\/(?:api|_hvm_api)/, ""),
      json = (v: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(v),
        });
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
      return options.guest
        ? json({ error: "AUTH_REQUIRED" }, 401)
        : json(
            options.consumer
              ? { ...session, roles: ["consumer"], activeRole: "consumer" }
              : session,
          );
    if (path === "/v1/auth/login") {
      authenticated = true;
      return json(session);
    }
    if (path === "/v1/categories") return json({ categories: [] });
    if (path === "/v1/localities") return json({ municipalities: [] });
    if (path === "/v1/account/addresses") return json({ addresses: [] });
    if (path === "/v1/producer/store/delivery") {
      if (r.method() === "GET") {
        if (options.error && !recovered) {
          return json({ error: "DEPENDENCY_UNAVAILABLE" }, 503);
        }
        if (options.delay) await new Promise((done) => setTimeout(done, 300));
        return json(value);
      }
      const body = r.postDataJSON();
      requests.push(body);
      if (!authenticated) return json({ error: "RECENT_AUTH_REQUIRED" }, 401);
      if (options.conflict)
        return json({ error: "DELIVERY_REVISION_CONFLICT" }, 409);
      value = {
        ...value,
        serviceArea: {
          radiusKm: body.radiusKm,
          centerLatitude: value.origin.centerLatitude,
          centerLongitude: value.origin.centerLongitude,
          isActive: body.isActive,
        },
        rules: body.rules,
        revision: value.revision + 1,
      };
      return json(value);
    }
    return json({ error: "NOT_FOUND" }, 404);
  });
  return {
    requests,
    errors,
    recover: () => {
      recovered = true;
    },
  };
}
const save = (page: Page) =>
  page.getByRole("button", { name: "Salvar área e tarifas", exact: true });
async function fill(page: Page) {
  await page.getByLabel("Taxa base (R$)", { exact: true }).fill("7,50");
  await page.getByLabel("Valor por km (R$)", { exact: true }).fill("1,37");
  await page
    .getByLabel("Frete grátis a partir de (R$)", { exact: true })
    .fill("100");
}
for (const width of [320, 390, 768, 1440])
  test(`T16 raio, tarifas e acessibilidade ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const state = await mock(page);
    await page.goto("/produtor/loja/entrega");
    await expect(
      page.getByRole("heading", {
        name: "Área de entrega e frete",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("GPS da sede já cadastrado:", { exact: false }),
    ).toBeVisible();
    const slider = page.getByRole("slider", { name: /Raio de entrega/ });
    await slider.focus();
    await slider.press("Home");
    await expect(
      page.getByText("Este endereço está fora da área de entrega desta loja."),
    ).toBeVisible();
    await slider.press("End");
    await expect(
      page.getByText("Dentro da área de entrega", { exact: true }),
    ).toBeVisible();
    await fill(page);
    await save(page).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Área de entrega e tarifas salvas" }),
    ).toBeVisible();
    expect(state.requests[0]).toMatchObject({
      radiusKm: 150,
      rules: {
        baseFeeCents: 750,
        feePerKmCents: 137,
        freeDeliveryThresholdCents: 10000,
      },
    });
    expect(state.requests[0]).not.toHaveProperty("centerLatitude");
    expect(state.requests[0]).not.toHaveProperty("storeId");
    expect(state.errors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
for (const width of [390, 1440])
  test(`T16 reautenticação conserva comando ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const state = await mock(page, { reauth: true });
    await page.goto("/produtor/loja/entrega");
    await fill(page);
    await save(page).click();
    await expect(
      page.getByRole("heading", { name: "Confirme sua senha" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Taxa base (R$)", { exact: true }),
    ).toHaveValue("7,50");
    await page.getByLabel("Senha", { exact: true }).fill("local-password");
    await page.getByRole("button", { name: "Confirmar e salvar" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Área de entrega e tarifas salvas" }),
    ).toBeVisible();
    expect(state.requests).toHaveLength(2);
    expect(state.requests[0].commandId).toBe(state.requests[1].commandId);
    expect(state.errors).toEqual([]);
  });
test("T16 conflito preserva valores e oferece recarga explícita", async ({
  page,
}) => {
  await mock(page, { conflict: true });
  await page.goto("/produtor/loja/entrega");
  await fill(page);
  await save(page).click();
  await expect(page.getByRole("alert")).toContainText("outro dispositivo");
  await expect(page.getByLabel("Taxa base (R$)", { exact: true })).toHaveValue(
    "7,50",
  );
  await expect(save(page)).toBeDisabled();
  await page.getByRole("button", { name: "Recarregar configuração" }).click();
  await expect(save(page)).toBeEnabled();
});
test("T16 indisponibilidade recupera carregamento", async ({ page }) => {
  const state = await mock(page, { error: true, delay: true });
  await page.goto("/produtor/loja/entrega");
  await expect(page.getByRole("alert")).toBeVisible();
  state.recover();
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(save(page)).toBeEnabled();
});
test("T16 ausência de GPS bloqueia gravação com orientação", async ({
  page,
}) => {
  await mock(page, { noOrigin: true });
  await page.goto("/produtor/loja/entrega");
  await expect(
    page.getByText("O imóvel da loja precisa ter o GPS da sede cadastrado."),
  ).toBeVisible();
  await expect(save(page)).toBeDisabled();
});
test("T16 loja ausente direciona configuração existente", async ({ page }) => {
  await mock(page, { noStore: true });
  await page.goto("/produtor/loja/entrega");
  await expect(
    page.getByRole("button", { name: "Configurar minha loja" }),
  ).toBeVisible();
});
test("T16 gratuidade vazia permanece opcional", async ({ page }) => {
  const state = await mock(page);
  await page.goto("/produtor/loja/entrega");
  await save(page).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Área de entrega e tarifas salvas" }),
  ).toBeVisible();
  expect(state.requests[0].rules.freeDeliveryThresholdCents).toBeNull();
});
test("T16 centavos inválidos são rejeitados antes de chamar API", async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto("/produtor/loja/entrega");
  await page.getByLabel("Taxa base (R$)", { exact: true }).fill("1.234");
  await save(page).click();
  await expect(page.getByRole("alert")).toContainText("tarifas válidas");
  expect(state.requests).toHaveLength(0);
});
for (const options of [{ guest: true }, { consumer: true }])
  test(`T16 configuração restrita ${options.guest ? "visitante" : "consumidor"}`, async ({
    page,
  }) => {
    await mock(page, options);
    await page.goto("/produtor/loja/entrega");
    await expect(
      page.getByRole("heading", {
        name: "Área de entrega e frete",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(save(page)).toHaveCount(0);
  });

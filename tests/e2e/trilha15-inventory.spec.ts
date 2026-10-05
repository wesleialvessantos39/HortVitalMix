import { expect, test, type Page } from "@playwright/test";
const id = "22222222-2222-4222-8222-222222222222",
  userId = "11111111-1111-4111-8111-111111111111";
const session = {
  userId,
  email: "producer@example.test",
  fullName: "Produtor",
  roles: ["producer"],
  activeRole: "producer",
  portalKind: "public",
};
const initial = {
  product: { id, title: "Couve picada", unitType: "pote", shelfLifeDays: 5 },
  businessDate: "2026-10-05",
  canRegisterHarvest: true,
  availableQuantity: 0,
  reservedQuantity: 0,
  lots: [] as any[],
  movements: [] as any[],
  pagination: {
    lotsPage: 1,
    lotsTotal: 0,
    movementsPage: 1,
    movementsTotal: 0,
  },
};
async function mock(
  page: Page,
  options: {
    guest?: boolean;
    consumer?: boolean;
    error?: boolean;
    reauth?: boolean;
    conflict?: boolean;
    paused?: boolean;
    populated?: boolean;
    delay?: boolean;
    pages?: boolean;
  } = {},
) {
  let inventory = structuredClone(initial),
    authenticated = !options.reauth,
    recovered = false;
  if (options.paused) inventory.canRegisterHarvest = false;
  if (options.populated) {
    inventory.lots = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        lotCode: "PERTO-01",
        harvestDate: "2026-10-01",
        expirationDate: "2026-10-07",
        initialQuantity: 3,
        currentQuantity: 2,
        reservedQuantity: 1,
        expiresInDays: 2,
        createdAt: "2026-10-05T12:00:00.000Z",
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        lotCode: "VENCIDO-01",
        harvestDate: "2026-10-01",
        expirationDate: "2026-10-04",
        initialQuantity: 2,
        currentQuantity: 2,
        reservedQuantity: 0,
        expiresInDays: -1,
        createdAt: "2026-10-04T12:00:00.000Z",
      },
    ];
    inventory.pagination.lotsTotal = 2;
    inventory.availableQuantity = 2;
    inventory.reservedQuantity = 1;
  }
  if (options.pages) inventory.pagination.lotsTotal = 21;
  const requests: Array<{ body: any; path: string }> = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (!url.pathname.includes("/v1/")) return route.continue();
    const path = url.pathname.replace(/^\/(?:api|_hvm_api)/, "");
    const json = (value: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(value),
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
    if (path === `/v1/producer/products/${id}/lots`) {
      if (request.method() === "GET") {
        if (options.error && !recovered)
          return json({ error: "DEPENDENCY_UNAVAILABLE" }, 503);
        if (options.delay)
          await new Promise((resolve) => setTimeout(resolve, 400));
        inventory.pagination.lotsPage = Number(
          url.searchParams.get("lotsPage") ?? 1,
        );
        return json(inventory);
      }
      const body = request.postDataJSON();
      requests.push({ body, path });
      if (!authenticated) return json({ error: "RECENT_AUTH_REQUIRED" }, 401);
      if (options.conflict)
        return json({ error: "INVENTORY_LOT_CODE_CONFLICT" }, 409);
      inventory.availableQuantity += body.quantity;
      const lotId = crypto.randomUUID();
      inventory.lots.unshift({
        id: lotId,
        lotCode: body.lotCode,
        harvestDate: body.harvestDate,
        expirationDate: body.expirationDate,
        initialQuantity: body.quantity,
        currentQuantity: body.quantity,
        reservedQuantity: 0,
        expiresInDays: 5,
        createdAt: "2026-10-05T12:00:00.000Z",
      });
      inventory.movements.unshift({
        id: crypto.randomUUID(),
        lotId,
        lotCode: body.lotCode,
        movementType: "harvest_entry",
        quantityDelta: body.quantity,
        reasonDescription: "Colheita registrada: " + body.lotCode,
        createdAt: "2026-10-05T12:00:00.000Z",
      });
      inventory.pagination.lotsTotal++;
      inventory.pagination.movementsTotal++;
      return json({ lotId, inventory });
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
async function fill(page: Page) {
  await page.getByLabel("Código do lote").fill("COUVE-01");
  await page.getByLabel("Quantidade", { exact: true }).fill("7");
}
for (const width of [320, 390, 768, 1440])
  test(`T15 colheita e histórico responsivos ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const state = await mock(page);
    await page.goto(`/produtor/produtos/${id}/lotes`);
    await expect(
      page.getByRole("heading", { name: "Lotes e colheitas", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Nenhum lote registrado")).toBeVisible();
    await fill(page);
    await page
      .getByRole("button", { name: "Registrar colheita", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Colheita registrada");
    await expect(
      page.getByRole("heading", { name: "COUVE-01", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Histórico de movimentos" }),
    ).toContainText("Entrada de colheita");
    expect(state.requests[0].body).toMatchObject({
      quantity: 7,
      harvestDate: "2026-10-05",
      expirationDate: "2026-10-10",
    });
    expect(state.requests[0].body).not.toHaveProperty("userId");
    expect(state.errors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
for (const width of [320, 390, 768, 1440])
  test(`T15 reautenticação conserva colheita ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const state = await mock(page, { reauth: true });
    await page.goto(`/produtor/produtos/${id}/lotes`);
    await fill(page);
    await page
      .getByRole("button", { name: "Registrar colheita", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Confirme sua senha" }),
    ).toBeVisible();
    await expect(page.getByLabel("Código do lote")).toHaveValue("COUVE-01");
    await page.getByLabel("Senha atual").fill("local-password");
    await page.getByRole("button", { name: "Confirmar e continuar" }).click();
    await expect(page.getByRole("status")).toContainText("Colheita registrada");
    expect(state.requests).toHaveLength(2);
    expect(state.requests[0].body.commandId).toBe(
      state.requests[1].body.commandId,
    );
    expect(state.errors).toEqual([]);
  });
test("T15 validade próxima/vencida diferencia saldo e disponível", async ({
  page,
}) => {
  await mock(page, { populated: true });
  await page.goto(`/produtor/produtos/${id}/lotes`);
  await expect(
    page.getByText("Validade próxima", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Vencido", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Este lote está fora da disponibilidade para venda."),
  ).toBeVisible();
});
test("T15 conflito conserva formulário e permite corrigir o lote", async ({
  page,
}) => {
  await mock(page, { conflict: true });
  await page.goto(`/produtor/produtos/${id}/lotes`);
  await fill(page);
  await page
    .getByRole("button", { name: "Registrar colheita", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("já foi cadastrado");
  await expect(page.getByLabel("Código do lote")).toHaveValue("COUVE-01");
  await expect(page.getByLabel("Quantidade", { exact: true })).toHaveValue("7");
});
test("T15 indisponibilidade tem recuperação e estado de carregamento", async ({
  page,
}) => {
  const state = await mock(page, { error: true, delay: true });
  await page.goto(`/produtor/produtos/${id}/lotes`);
  await expect(page.getByRole("alert")).toBeVisible();
  state.recover();
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByText("Carregando lotes e movimentos…")).toBeVisible();
  await expect(page.getByText("Nenhum lote registrado")).toBeVisible();
});
test("T15 loja pausada permite histórico e impede colheita", async ({
  page,
}) => {
  await mock(page, { paused: true, populated: true });
  await page.goto(`/produtor/produtos/${id}/lotes`);
  await expect(
    page.getByRole("button", { name: "Registrar colheita", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "PERTO-01", exact: true }),
  ).toBeVisible();
});
test("T15 paginação não descarta histórico", async ({ page }) => {
  await mock(page, { pages: true, populated: true });
  await page.goto(`/produtor/produtos/${id}/lotes`);
  await page.getByRole("button", { name: "lotes: próxima página" }).click();
  await expect(page.getByText("Página 2 de 2")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "lotes: próxima página" }),
  ).toBeDisabled();
});
for (const options of [{ guest: true }, { consumer: true }])
  test(`T15 isolamento de ${options.guest ? "visitante" : "consumidor"}`, async ({
    page,
  }) => {
    const state = await mock(page, options);
    await page.goto(`/produtor/produtos/${id}/lotes`);
    await expect(
      page.getByRole("heading", { name: "Lotes e colheitas", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Registrar colheita", exact: true }),
    ).toHaveCount(0);
    expect(state.requests).toHaveLength(0);
  });

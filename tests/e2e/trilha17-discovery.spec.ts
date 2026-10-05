import { expect, test, type Page } from "@playwright/test";
const nearId = "11111111-1111-4111-8111-111111111111",
  farId = "22222222-2222-4222-8222-222222222222";
const municipalityId = "33333333-3333-4333-8333-333333333333";
const category = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Frutas",
  slug: "frutas",
  description: null,
  parentId: null,
  iconName: "leaf",
  displayOrder: 1,
  isActive: true,
  revision: 1,
  children: [],
};
// Synthetic data is confined to this local browser suite. The real empty DB
// and real HTTP/PostgreSQL flows are covered by discoveryBrowserPostgres.
const stores = [
  {
    id: nearId,
    slug: "produtor-proximo-local",
    name: "Produtor próximo local",
    avatarUrl: null,
    location: "Ariquemes/RO",
    distanceKm: 1.25,
    isVerified: true,
    trustLevel: 3,
  },
  {
    id: farId,
    slug: "produtor-distante-local",
    name: "Produtor distante local",
    avatarUrl: null,
    location: "Ji-Paraná/RO",
    distanceKm: 120.3,
    isVerified: true,
    trustLevel: 2,
  },
];
async function mock(
  page: Page,
  options: {
    guest?: boolean;
    empty?: boolean;
    error?: boolean;
    delay?: boolean;
    favoriteReadError?: boolean;
    lostReply?: boolean;
    expired?: boolean;
    pagination?: boolean;
  } = {},
) {
  let failed = options.error ?? false,
    favoriteReadError = options.favoriteReadError ?? false,
    lostReply = options.lostReply ?? false;
  const favorites = new Set<string>(),
    commands = new Map<string, boolean>(),
    posts: any[] = [],
    searches: URL[] = [],
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
        : json({
            userId: farId,
            email: "consumer@example.test",
            roles: ["consumer"],
            activeRole: "consumer",
            portalKind: "public",
          });
    if (path === "/v1/account/addresses") return json({ addresses: [] });
    if (path === "/v1/categories") return json({ categories: [category] });
    if (path === "/v1/localities")
      return json({
        municipalities: [
          {
            id: municipalityId,
            ibgeCode: "1100023",
            name: "Ariquemes",
            state: "RO",
            isActive: true,
            revision: 1,
          },
        ],
        activeMunicipalityIds: [municipalityId],
      });
    if (path === "/v1/discovery/stores") {
      searches.push(url);
      if (options.delay) await new Promise((done) => setTimeout(done, 250));
      if (failed) return json({ error: "DEPENDENCY_UNAVAILABLE" }, 503);
      const pageNumber = Number(url.searchParams.get("page") ?? 1);
      return json({
        stores: options.empty
          ? []
          : pageNumber === 2
            ? [stores[1]]
            : url.searchParams.has("latitude")
              ? [...stores].reverse()
              : stores,
        page: pageNumber,
        pageSize: 20,
        hasMore: Boolean(options.pagination && pageNumber === 1),
        distanceReference: url.searchParams.has("latitude")
          ? "consumer"
          : "ariquemes",
      });
    }
    if (path === "/v1/favorites") {
      if (favoriteReadError)
        return json({ error: "DEPENDENCY_UNAVAILABLE" }, 503);
      return json({
        favorites: [...favorites].map((targetId) => ({
          targetId,
          targetType: "store",
        })),
        page: 1,
        hasMore: false,
      });
    }
    if (path === "/v1/favorites/toggle") {
      const body = request.postDataJSON();
      posts.push(body);
      if (options.expired) return json({ error: "AUTH_REQUIRED" }, 401);
      const replayed = commands.has(body.commandId);
      const isFavorite = replayed
        ? commands.get(body.commandId)!
        : !favorites.has(body.targetId);
      if (!replayed) {
        commands.set(body.commandId, isFavorite);
        if (isFavorite) favorites.add(body.targetId);
        else favorites.delete(body.targetId);
      }
      if (lostReply) {
        lostReply = false;
        return json({ error: "DEPENDENCY_UNAVAILABLE" }, 503);
      }
      return json({
        targetType: "store",
        targetId: body.targetId,
        isFavorite,
        replayed,
      });
    }
    if (path === "/v1/products") return json({ products: [] });
    if (path.startsWith("/v1/stores/"))
      return json({
        name: stores[0].name,
        slug: stores[0].slug,
        bio: "Vitrine exclusivamente de teste local.",
        bannerUrl: null,
        avatarUrl: null,
        location: "Ariquemes/RO",
        verification: { isVerified: true, trustLevel: 3 },
        minOrderAmountCents: 2000,
        cutoffHour: "14:00",
        operatingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          isHarvestDay: true,
          isDeliveryDay: true,
          cutoffTime: "14:00",
        })),
      });
    return json({ error: "NOT_FOUND" }, 404);
  });
  return {
    posts,
    searches,
    errors,
    recover: () => {
      failed = false;
      favoriteReadError = false;
    },
  };
}
for (const width of [320, 390, 768, 1440]) {
  test(`T17 home vazia e Localização acessível em ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1050 });
    const state = await mock(page, { guest: true, empty: true });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Nenhum produtor encontrado" }),
    ).toBeVisible();
    await expect(page.locator(".hvm-discovery-card")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Selecionar localização", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(state.errors).toEqual([]);
  });
  test(`T17 cards, favorito e link T12 em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1050 });
    const state = await mock(page);
    await page.goto("/produtores");
    await expect(page.locator(".hvm-discovery-card")).toHaveCount(2);
    await expect(page.locator(".hvm-discovery-card h3").first()).toHaveText(
      stores[0].name,
    );
    await expect(page.getByText("1,3 km", { exact: true })).toBeVisible();
    const add = page.getByRole("button", {
      name: "Adicionar Produtor próximo local aos favoritos",
      exact: true,
    });
    await expect(add).toBeEnabled();
    await add.click();
    const remove = page.getByRole("button", {
      name: "Remover Produtor próximo local dos favoritos",
      exact: true,
    });
    await expect(remove).toHaveAttribute("aria-pressed", "true");
    await remove.click();
    await expect(add).toHaveAttribute("aria-pressed", "false");
    expect(state.posts).toHaveLength(2);
    expect(state.posts[0].commandId).not.toBe(state.posts[1].commandId);
    await page.screenshot({
      path: `/workspace/scratch/t17-cards-${width}.png`,
      fullPage: true,
    });
    const link = page
      .getByRole("link", { name: "Ver Produtos", exact: true })
      .first();
    await expect(link).toHaveAttribute("href", "/produtores/" + stores[0].slug);
    await link.click();
    await expect(page).toHaveURL(
      new RegExp("/produtores/" + stores[0].slug + "$"),
    );
    await expect(
      page.getByRole("heading", { name: stores[0].name, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(state.errors).toEqual([]);
  });
}
test("T17 visitante clica no coração e vai ao login de consumidor", async ({
  page,
}) => {
  const state = await mock(page, { guest: true });
  await page.goto("/produtores");
  const add = page.getByRole("button", {
    name: "Adicionar Produtor próximo local aos favoritos",
    exact: true,
  });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page).toHaveURL(/\/entrar\/consumidor$/);
  expect(state.posts).toEqual([]);
});
test("T17 busca, categoria e região enviam filtros reais à API", async ({
  page,
}) => {
  const state = await mock(page, { guest: true });
  await page.goto("/produtores");
  await page
    .getByLabel("Buscar produtores ou alimentos", { exact: true })
    .fill("couve");
  await page
    .getByRole("button", { name: "Buscar produtores", exact: true })
    .click();
  await expect
    .poll(() => state.searches.at(-1)?.searchParams.get("query"))
    .toBe("couve");
  await page
    .getByLabel("Categoria dos produtores", { exact: true })
    .selectOption("frutas");
  await expect
    .poll(() => state.searches.at(-1)?.searchParams.get("categorySlug"))
    .toBe("frutas");
  await page
    .getByRole("button", { name: "Selecionar localização", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ariquemes – RO", exact: true })
    .click();
  await expect
    .poll(() => state.searches.at(-1)?.searchParams.get("municipalityId"))
    .toBe(municipalityId);
  expect(state.errors).toEqual([]);
});
test("T17 geolocalização é opcional e pode voltar à referência de Ariquemes", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: -10, longitude: -63 });
  const state = await mock(page, { guest: true });
  await page.goto("/produtores");
  await page
    .getByRole("button", { name: "Usar minha posição", exact: true })
    .click();
  await expect
    .poll(() => state.searches.at(-1)?.searchParams.get("latitude"))
    .toBe("-10");
  await expect(page.locator(".hvm-discovery-card h3").first()).toHaveText(
    stores[1].name,
  );
  await page
    .getByRole("button", { name: "Usar referência de Ariquemes", exact: true })
    .click();
  await expect
    .poll(() => state.searches.at(-1)?.searchParams.has("latitude"))
    .toBe(false);
  expect(state.errors).toEqual([]);
});
test("T17 erro de busca é explícito e permite recuperar", async ({ page }) => {
  const state = await mock(page, { error: true });
  await page.goto("/produtores");
  await expect(page.getByRole("alert")).toContainText(
    "Não foi possível consultar os produtores agora.",
  );
  await expect(
    page.getByRole("heading", { name: "Nenhum produtor encontrado" }),
  ).toHaveCount(0);
  state.recover();
  await page
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .click();
  await expect(page.locator(".hvm-discovery-card")).toHaveCount(2);
});
test("T17 favoritos indisponíveis não exibem um estado falso e recuperam", async ({
  page,
}) => {
  const state = await mock(page, { favoriteReadError: true });
  await page.goto("/produtores");
  const add = page.getByRole("button", {
    name: "Adicionar Produtor próximo local aos favoritos",
    exact: true,
  });
  await expect(page.getByRole("alert")).toContainText(
    "Não foi possível consultar seus favoritos.",
  );
  await expect(add).toBeDisabled();
  state.recover();
  await page
    .getByRole("button", { name: "Recarregar favoritos", exact: true })
    .click();
  await expect(add).toBeEnabled();
});
test("T17 resposta perdida repete commandId e não desfaz o favorito", async ({
  page,
}) => {
  const state = await mock(page, { lostReply: true });
  await page.goto("/produtores");
  const add = page.getByRole("button", {
    name: "Adicionar Produtor próximo local aos favoritos",
    exact: true,
  });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByRole("alert")).toContainText(
    "Não foi possível atualizar o favorito.",
  );
  await add.click();
  await expect(
    page.getByRole("button", {
      name: "Remover Produtor próximo local dos favoritos",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(state.posts).toHaveLength(2);
  expect(state.posts[0].commandId).toBe(state.posts[1].commandId);
});
test("T17 navega páginas e filtro novo volta à primeira", async ({ page }) => {
  const state = await mock(page, { pagination: true });
  await page.goto("/produtores");
  await page.getByRole("button", { name: "Próxima", exact: true }).click();
  await expect(page.getByText("Página 2", { exact: true })).toBeVisible();
  await page
    .getByLabel("Categoria dos produtores", { exact: true })
    .selectOption("frutas");
  await expect(page.getByText("Página 1", { exact: true })).toBeVisible();
  expect(state.searches.at(-1)?.searchParams.get("page")).toBe("1");
});
test("T17 carregamento não é confundido com catálogo vazio", async ({
  page,
}) => {
  await mock(page, { delay: true, empty: true });
  await page.goto("/produtores");
  await expect(
    page
      .getByRole("status", { name: "" })
      .filter({ hasText: "Buscando produtores…" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Nenhum produtor encontrado" }),
  ).toBeVisible();
});

test("T17 sessão expirada abre login sem redirecionamento pela sessão antiga", async ({
  page,
}) => {
  await mock(page, { expired: true });
  await page.goto("/produtores");
  const add = page.getByRole("button", {
    name: "Adicionar Produtor próximo local aos favoritos",
    exact: true,
  });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page).toHaveURL(/\/entrar\/consumidor$/);
  await expect(
    page.getByRole("heading", { name: "Entrar como Consumidor.", exact: true }),
  ).toBeVisible();
});

test("T17 leitura após resposta perdida resolve comando antes de desfavoritar", async ({
  page,
}) => {
  const state = await mock(page, { lostReply: true });
  await page.goto("/produtores");
  const add = page.getByRole("button", {
    name: "Adicionar Produtor próximo local aos favoritos",
    exact: true,
  });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByRole("alert")).toContainText(
    "Não foi possível atualizar o favorito.",
  );
  await page
    .getByRole("button", { name: "Recarregar favoritos", exact: true })
    .click();
  const remove = page.getByRole("button", {
    name: "Remover Produtor próximo local dos favoritos",
    exact: true,
  });
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(add).toHaveAttribute("aria-pressed", "false");
  expect(state.posts).toHaveLength(2);
  expect(state.posts[0].commandId).not.toBe(state.posts[1].commandId);
});

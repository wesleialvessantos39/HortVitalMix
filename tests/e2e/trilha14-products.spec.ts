import { expect, test, type Page } from "@playwright/test";
import type { Product } from "../../shared/contracts/product";
const userId = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  categoryId = "33333333-3333-4333-8333-333333333333";
const session = {
  userId,
  email: "produtor@example.test",
  fullName: "Produtor local",
  roles: ["producer"],
  activeRole: "producer",
  portalKind: "public",
};
const initial: Product = {
  id,
  storeId: "44444444-4444-4444-8444-444444444444",
  categoryId,
  categoryName: "Hortaliças folhosas",
  title: "Couve picada",
  description: "Couve fresca picada e higienizada.",
  packagingType: "pote_higienizado",
  netWeightGrams: 250,
  unitType: "pote",
  shelfLifeDays: 5,
  conservationNotes: "Manter refrigerado entre 2°C e 6°C",
  isPublished: false,
  revision: 1,
  currentPrice: {
    id: "55555555-5555-4555-8555-555555555555",
    priceCents: 1290,
    validFrom: "2026-10-04T00:00:00.000Z",
  },
  media: [],
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6LRsAAAAASUVORK5CYII=",
  "base64",
);
async function mock(
  page: Page,
  options: {
    guest?: boolean;
    empty?: boolean;
    forbidden?: boolean;
    conflict?: boolean;
    reauth?: boolean;
    error?: boolean;
    published?: boolean;
    delay?: boolean;
    hold?: Promise<void>;
  } = {},
) {
  let product = structuredClone(initial),
    authenticated = !options.reauth,
    created = !options.empty,
    failed = options.error ?? false;
  let recovery = false;
  if (options.published) {
    product.isPublished = true;
    product.media = [
      {
        id: "66666666-6666-4666-8666-666666666666",
        url: "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/product-media/local.png?token=local",
        isPrimary: true,
        displayOrder: 0,
      },
    ];
  }
  const requests: Array<{
      path: string;
      body: Record<string, any>;
      method: string;
    }> = [],
    errors: string[] = [],
    filters: Record<string, string>[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.hostname === "xipbsazvymkqqfmfegwu.supabase.co")
      return route.fulfill({ contentType: "image/png", body: png });
    if (!url.pathname.includes("/v1/")) return route.continue();
    const path = url.pathname.replace(/^\/(?:api|_hvm_api)/, "");
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
        supportEmail: "support@example.test",
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
    if (path === "/v1/localities") return json({ municipalities: [] });
    if (path === "/v1/producer/properties") return json({ properties: [] });
    if (path === "/v1/categories")
      return json({
        categories: [
          {
            id: categoryId,
            parentId: null,
            slug: "hortalicas-folhosas",
            name: "Hortaliças folhosas",
            description: "Folhas frescas",
            iconName: "leaf",
            displayOrder: 1,
            isActive: true,
            revision: 1,
            children: [],
          },
        ],
      });
    if (path === "/v1/products") {
      filters.push(Object.fromEntries(url.searchParams));
      const {
        storeId: _s,
        isPublished: _p,
        revision: _r,
        ...publicProduct
      } = product;
      return json({
        products: product.isPublished
          ? [
              {
                ...publicProduct,
                storeSlug: "chacara-local",
                storeName: "Chácara local",
              },
            ]
          : [],
      });
    }
    if (path === "/v1/producer/products" && request.method() === "GET") {
      if (failed && !recovery) {
        return json({ error: "DEPENDENCY_UNAVAILABLE" }, 503);
      }
      if (options.delay)
        await new Promise((resolve) => setTimeout(resolve, 500));
      if (options.hold) await options.hold;
      return json({
        products: created ? [product] : [],
        store: {
          id: initial.storeId,
          name: "Chácara local",
          slug: "chacara-local",
          status: options.forbidden ? "paused" : "active",
        },
        canCreate: !options.forbidden,
      });
    }
    if (path === `/v1/producer/products/${id}` && request.method() === "GET")
      return json({ product });
    if (
      path.startsWith("/v1/producer/products") &&
      request.method() !== "GET"
    ) {
      const body = path.endsWith("/media/upload")
        ? Object.fromEntries(url.searchParams)
        : request.postDataJSON();
      requests.push({ path, body, method: request.method() });
      if (!authenticated) return json({ error: "RECENT_AUTH_REQUIRED" }, 401);
      if (options.conflict)
        return json(
          { error: "PRODUCT_REVISION_CONFLICT", currentRevision: 3 },
          409,
        );
      if (options.forbidden)
        return json(
          { error: "PRODUCT_CREATE_FORBIDDEN_UNVERIFIED_STORE" },
          403,
        );
      if (
        path.endsWith("/publish") &&
        body.isPublished &&
        !product.media.some((m) => m.isPrimary)
      )
        return json({ error: "PRODUCT_PRIMARY_MEDIA_REQUIRED" }, 422);
      if (path.endsWith("/media/upload"))
        product.media.push({
          id: "66666666-6666-4666-8666-666666666666",
          url: "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/product-media/local.png?token=local",
          displayOrder: 0,
          isPrimary: true,
        });
      else if (path.endsWith("/publish"))
        product.isPublished = body.isPublished;
      else if (path.endsWith("/price"))
        product.currentPrice = {
          id: "77777777-7777-4777-8777-777777777777",
          priceCents: body.newPriceCents,
          validFrom: new Date().toISOString(),
        };
      else if (request.method() === "PATCH")
        product = {
          ...product,
          ...Object.fromEntries(
            Object.entries(body).filter(
              ([k]) => !["expectedRevision", "commandId"].includes(k),
            ),
          ),
        };
      else {
        const { priceCents, commandId: _c, ...fields } = body;
        product = {
          ...product,
          ...fields,
          currentPrice: { ...product.currentPrice, priceCents },
        };
        created = true;
      }
      product.revision++;
      return json({ product });
    }
    return json({});
  });
  return {
    requests,
    errors,
    filters,
    recover: () => {
      recovery = true;
    },
  };
}
async function fill(page: Page) {
  await page
    .getByLabel("Nome do produto", { exact: true })
    .fill("Salada higienizada");
  await page
    .getByRole("combobox", { name: "Categoria", exact: true })
    .selectOption(categoryId);
  await page
    .getByLabel("Descrição", { exact: true })
    .fill("Folhas frescas higienizadas e embaladas com cuidado.");
  await page.getByLabel("Peso líquido (g)").fill("300");
  await page.getByLabel("Preço inicial (R$)").fill("12,99");
}
for (const width of [320, 390, 768, 1440]) {
  test(`catálogo e criação responsivos em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await mock(page, { empty: true });
    await page.goto("/produtor/produtos");
    await expect(
      page.getByRole("heading", { name: "Meus produtos", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Seu catálogo começa aqui" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Novo produto", exact: true })
      .click();
    await fill(page);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      )
      .toBe(true);
    await page.getByRole("button", { name: "Criar rascunho" }).click();
    await expect(
      page.getByRole("heading", { name: "Editar produto", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Rascunho criado. Adicione uma foto principal para publicar.",
      ),
    ).toBeVisible();
    const request = state.requests.find(
      (r) => r.path === "/v1/producer/products",
    );
    expect(request?.body.priceCents).toBe(1299);
    expect(request?.body.netWeightGrams).toBe(300);
    expect(request?.body).not.toHaveProperty("storeId");
    expect(state.errors).toEqual([]);
  });
  test(`editor, preço, upload e publicação em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await mock(page);
    await page.goto(`/produtor/produtos/${id}/editar`);
    await page.getByLabel("Novo preço (R$)").fill("15,90");
    await page.getByRole("button", { name: "Salvar novo preço" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Novo preço salvo" }),
    ).toBeVisible();
    await page
      .getByLabel("Adicionar foto")
      .setInputFiles({ name: "couve.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "Enviar foto" }).click();
    await expect(
      page.getByText("Foto principal", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Publicar produto", exact: true })
      .click();
    await expect(
      page.getByText("Produto publicado na sua vitrine.", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      )
      .toBe(true);
    expect(
      state.requests.find((r) => r.path.endsWith("/price"))?.body.newPriceCents,
    ).toBe(1590);
    expect(state.errors).toEqual([]);
    await page
      .getByRole("button", { name: "Meus produtos", exact: true })
      .click();
    await expect(page.getByText("Publicado", { exact: true })).toBeVisible();
  });
}
test("409 preserva informação e preço e exige recarregamento explícito", async ({
  page,
}) => {
  await mock(page, { conflict: true });
  await page.goto(`/produtor/produtos/${id}/editar`);
  await page
    .getByLabel("Nome do produto", { exact: true })
    .fill("Título preservado");
  await page.getByLabel("Novo preço (R$)").fill("18,80");
  await page.getByRole("button", { name: "Salvar novo preço" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Sua edição foi preservada",
  );
  await expect(page.getByLabel("Nome do produto", { exact: true })).toHaveValue(
    "Título preservado",
  );
  await expect(page.getByLabel("Novo preço (R$)")).toHaveValue("18,80");
  await page.getByRole("button", { name: "Recarregar versão atual" }).click();
  await expect(page.getByLabel("Novo preço (R$)")).toHaveValue("12,90");
});
test("sessão antiga retoma preço com mesmo comando sem descartar edição", async ({
  page,
}) => {
  const state = await mock(page, { reauth: true });
  await page.goto(`/produtor/produtos/${id}/editar`);
  await page
    .getByLabel("Nome do produto", { exact: true })
    .fill("Edição preservada");
  await page.getByLabel("Novo preço (R$)").fill("16,90");
  await page.getByRole("button", { name: "Salvar novo preço" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirme sua senha" }),
  ).toBeVisible();
  await page.getByLabel("Senha atual").fill("senha-local");
  await page.getByRole("button", { name: "Confirmar e continuar" }).click();
  await expect(
    page.getByText(
      "Novo preço salvo. As versões anteriores foram preservadas.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Nome do produto", { exact: true })).toHaveValue(
    "Edição preservada",
  );
  const requests = state.requests.filter((r) => r.path.endsWith("/price"));
  expect(new Set(requests.map((r) => r.body.commandId)).size).toBe(1);
});
test("publicação sem foto mostra erro e mantém rascunho", async ({ page }) => {
  await mock(page);
  await page.goto(`/produtor/produtos/${id}/editar`);
  await page
    .getByRole("button", { name: "Publicar produto", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Adicione uma foto principal",
  );
  await expect(
    page.getByRole("button", { name: "Publicar produto", exact: true }),
  ).toBeEnabled();
});
test("loja não habilitada informa próximo passo e impede criação", async ({
  page,
}) => {
  await mock(page, { forbidden: true });
  await page.goto("/produtor/produtos");
  await expect(
    page.getByRole("button", { name: "Novo produto", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Minha loja", exact: true }),
  ).toBeVisible();
});
test("catálogo recupera falha de leitura", async ({ page }) => {
  const state = await mock(page, { error: true });
  await page.goto("/produtor/produtos");
  await expect(page.getByRole("alert")).toBeVisible();
  state.recover();
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    page.getByRole("heading", { name: "Couve picada", exact: true }),
  ).toBeVisible();
});
test("estado de carregamento é anunciado", async ({ page }) => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mock(page, { hold });
  await page.goto("/produtor/produtos");
  try {
    await expect(
      page.getByRole("status").filter({ hasText: "Carregando seus produtos" }),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(
    page.getByRole("status").filter({ hasText: "Carregando seus produtos" }),
  ).toHaveCount(0);
});
test("consulta pública seleciona categoria e mostra embalagem, peso e preço", async ({
  page,
}) => {
  const state = await mock(page, { guest: true, published: true });
  await page.goto("/produtos");
  await expect(
    page.getByRole("heading", { name: "Couve picada", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Hortaliças folhosas", exact: true })
    .click();
  await expect
    .poll(() => state.filters.some((q) => q.categoryId === categoryId))
    .toBe(true);
  await expect(page.getByText("Pote higienizado · 250 g")).toBeVisible();
  await page.getByText("Preparo e conservação", { exact: true }).click();
  await expect(
    page.getByText("Validade: 5 dias.", { exact: true }),
  ).toBeVisible();
  expect(state.errors).toEqual([]);
});
test("visitante não acessa editor do produtor", async ({ page }) => {
  await mock(page, { guest: true });
  await page.goto(`/produtor/produtos/${id}/editar`);
  await expect(
    page.getByRole("heading", { name: "Editar produto", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Nome do produto", { exact: true })).toHaveCount(
    0,
  );
});

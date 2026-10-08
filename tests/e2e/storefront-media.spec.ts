import { expect, test, type Page } from "@playwright/test";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://xipbsazvymkqqfmfegwu.supabase.co";
const photo = (n: number, bucket = "product-media") =>
  `${origin}/storage/v1/object/sign/${bucket}/photo-${n}.png?token=local`;
const privatePhoto = (n: number, bucket = "product-media") =>
  `${origin}/storage/v1/object/sign/${bucket}/${id(n)}/${id(n)}-${"a".repeat(64)}.png?token=local`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6LRsAAAAASUVORK5CYII=",
  "base64",
);
const regions = ["Ariquemes", "Cujubim", "Machadinho"].map((name, i) => ({
  id: id(i + 1),
  name,
  state: "RO",
  ibgeCode: String(1100000 + i),
  isActive: true,
  revision: 1,
}));
const category = {
  id: id(10),
  name: "Hortaliças",
  slug: "hortalicas",
  description: null,
  parentId: null,
  iconName: "leaf",
  displayOrder: 1,
  isActive: true,
  revision: 1,
  children: [],
};
const publicProducts = regions.map((r, i) => ({
  id: id(20 + i),
  categoryId: category.id,
  categoryName: category.name,
  title: ["Couve fresca", "Alface da horta", "Cheiro-verde"][i],
  description: "Alimento fresco da produção familiar.",
  packagingType: "pote_higienizado",
  netWeightGrams: 250,
  unitType: "pote",
  shelfLifeDays: 5,
  conservationNotes: "Conservar refrigerado",
  currentPrice: {
    id: id(40 + i),
    priceCents: 1290 + i * 100,
    validFrom: "2026-10-05T00:00:00Z",
  },
  media: [
    { id: id(50 + i * 2), url: photo(i * 2), displayOrder: 0, isPrimary: true },
    {
      id: id(51 + i * 2),
      url: photo(i * 2 + 1),
      displayOrder: 1,
      isPrimary: false,
    },
  ],
  storeSlug: `loja-${i}`,
  storeName: `Loja da região ${i}`,
  inStock: true,
}));
const session = {
  userId: id(90),
  email: "producer@example.test",
  roles: ["producer"],
  activeRole: "producer",
  portalKind: "public",
  fullName: "Produtor local",
};
async function mock(
  page: Page,
  {
    producer = false,
    reauth = false,
    pagination = false,
    empty = false,
    privatePhotos = false,
  } = {},
) {
  let recent = !reauth;
  const requests: URL[] = [],
    uploads: any[] = [],
    commands: string[] = [];
  let store: any = {
    id: id(100),
    producerProfileId: id(101),
    propertyId: id(102),
    storeName: publicProducts[0].storeName,
    storeSlug: publicProducts[0].storeSlug,
    bio: "Uma história cultivada em família.",
    minOrderAmountCents: 1000,
    cutoffHour: "14:00",
    status: "active",
    revision: 1,
    avatarUrl: photo(100, "store-media"),
    bannerUrl: null,
    coverMode: "mixed",
    publicProducerName: "Maria da horta",
    coverImages: [
      { id: id(110), url: photo(110, "store-media"), displayOrder: 0 },
      { id: id(111), url: photo(111, "store-media"), displayOrder: 1 },
    ],
    operatingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      isHarvestDay: true,
      isDeliveryDay: true,
      cutoffTime: "14:00",
    })),
  };
  const errors: string[] = [];
  if (privatePhotos) {
    store.avatarUrl = privatePhoto(100, "store-media");
    store.coverImages = store.coverImages.map(
      (image: { id: string }, index: number) => ({
        ...image,
        url: privatePhoto(110 + index, "store-media"),
      }),
    );
  }
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.hostname === "xipbsazvymkqqfmfegwu.supabase.co")
      return route.fulfill({ contentType: "image/png", body: png });
    if (!url.pathname.includes("/v1/")) return route.continue();
    const path = url.pathname.replace(/^\/(?:api|_hvm_api)/, "");
    const json = (v: unknown, status = 200) =>
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
      return producer ? json(session) : json({ error: "AUTH_REQUIRED" }, 401);
    if (path === "/v1/auth/login") {
      recent = true;
      return json(session);
    }
    if (path === "/v1/account/addresses") return json({ addresses: [] });
    if (path === "/v1/localities")
      return json({
        municipalities: regions,
        activeMunicipalityIds: regions.map((r) => r.id),
      });
    if (path === "/v1/categories") return json({ categories: [category] });
    if (path === "/v1/discovery/stores")
      return json({
        stores: regions.map((r, i) => ({
          id: id(130 + i),
          slug: publicProducts[i].storeSlug,
          name: publicProducts[i].storeName,
          avatarUrl: photo(100 + i, "store-media"),
          location: r.name + "/RO",
          distanceKm: i * 10,
          isVerified: true,
          trustLevel: 2,
        })),
        page: 1,
        pageSize: 20,
        hasMore: false,
        distanceReference: "ariquemes",
      });
    if (path === "/v1/discovery/highlights") {
      requests.push(url);
      const filtered = empty
        ? []
        : publicProducts.filter(
            (_, i) =>
              !url.searchParams.has("municipalityId") ||
              regions[i].id === url.searchParams.get("municipalityId"),
          );
      const pageNumber = Number(url.searchParams.get("page") ?? 1);
      return json({
        products: (pagination
          ? filtered.slice(pageNumber === 1 ? 0 : 2, pageNumber === 1 ? 2 : 3)
          : filtered
        ).map((p) => {
          const i = publicProducts.indexOf(p);
          return {
            ...p,
            producerName: `Produtor ${i}`,
            producerAvatarUrl: photo(100 + i, "store-media"),
            municipalityId: regions[i].id,
            municipality: regions[i].name,
          };
        }),
        page: pageNumber,
        hasMore: pagination && pageNumber === 1,
      });
    }
    if (path === "/v1/products")
      return json({
        products: url.searchParams.has("storeSlug")
          ? publicProducts.filter(
              (p) => p.storeSlug === url.searchParams.get("storeSlug"),
            )
          : publicProducts,
      });
    if (path === "/v1/producer/products")
      return json({
        store: {
          id: store.id,
          name: store.storeName,
          slug: store.storeSlug,
          status: "active",
        },
        canCreate: true,
        products: publicProducts
          .slice(0, 1)
          .map(
            ({
              storeName: _name,
              storeSlug: _slug,
              inStock: _stock,
              ...p
            }) => ({
              ...p,
              media: privatePhotos
                ? p.media.map((media, index) => ({
                    ...media,
                    url: privatePhoto(index),
                  }))
                : p.media,
              storeId: store.id,
              isPublished: !privatePhotos,
              revision: 1,
            }),
          ),
      });
    if (path === "/v1/producer/store" && req.method() === "GET")
      return json({
        store,
        canPublish: true,
        properties: [
          {
            id: store.propertyId,
            name: "Imóvel local",
            location: "Ariquemes/RO",
            approved: true,
          },
        ],
      });
    if (path.startsWith("/v1/producer/store/") && req.method() !== "GET") {
      if (path.endsWith("/media/upload")) {
        commands.push(url.searchParams.get("commandId")!);
        if (!recent) return json({ error: "RECENT_AUTH_REQUIRED" }, 401);
        uploads.push({
          purpose: url.searchParams.get("purpose"),
          type: req.headers()["content-type"],
          body: req.postDataBuffer(),
        });
        if (url.searchParams.get("purpose") === "avatar")
          store = {
            ...store,
            avatarUrl: photo(200, "store-media"),
            revision: store.revision + 1,
          };
        else
          store = {
            ...store,
            coverImages: [
              ...store.coverImages,
              { id: id(112), url: photo(112, "store-media"), displayOrder: 2 },
            ],
            revision: store.revision + 1,
          };
        return json({ store });
      }
      const body = req.postDataJSON();
      if (path.endsWith("/cover"))
        store = {
          ...store,
          coverMode: body.coverMode,
          publicProducerName: body.publicProducerName,
          revision: store.revision + 1,
        };
      if (path.endsWith("/media/remove"))
        store = {
          ...store,
          coverImages: store.coverImages.filter(
            (i: any) => i.id !== body.mediaId,
          ),
          revision: store.revision + 1,
        };
      return json({ store });
    }
    if (path.startsWith("/v1/stores/"))
      return json({
        name: store.storeName,
        slug: store.storeSlug,
        bio: store.bio,
        avatarUrl: store.avatarUrl,
        bannerUrl: store.bannerUrl,
        coverMode: store.coverMode,
        coverImages: store.coverImages,
        publicProducerName: store.publicProducerName,
        location: "Ariquemes/RO",
        verification: { isVerified: true, trustLevel: 2 },
        minOrderAmountCents: 1000,
        cutoffHour: "14:00",
        operatingHours: store.operatingHours,
      });
    return json({ error: "NOT_FOUND" }, 404);
  });
  return { requests, uploads, commands, errors, store: () => store };
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
test("destaque aparece enquanto retrato lento carrega em paralelo", async ({
  page,
}) => {
  await mock(page);
  let release!: () => void;
  const portrait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Set<string>();
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.add(path);
    if (path.includes("store-media")) await portrait;
    await route.fulfill({ contentType: "image/png", body: png });
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect
      .poll(() => [...requested].some((p) => p.includes("product-media")))
      .toBe(true);
    await expect
      .poll(() => [...requested].some((p) => p.includes("store-media")))
      .toBe(true);
    const carousel = page.getByRole("region", {
      name: "Produtos da região",
      exact: true,
    });
    await expect(carousel).toBeVisible();
    release();
    await expect(carousel).toBeVisible();
    await expect
      .poll(() =>
        carousel
          .locator(".hvm-carousel-surface img")
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
  } finally {
    release();
  }
});

test("vitrine aparece sem esperar fotos lentas dos produtos", async ({
  page,
}) => {
  await mock(page);
  let release!: () => void;
  const product = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Set<string>();
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.add(path);
    if (path.includes("product-media")) await product;
    await route.fulfill({ contentType: "image/png", body: png });
  });
  try {
    await page.goto("/produtores/loja-0", { waitUntil: "domcontentloaded" });
    await expect
      .poll(() => [...requested].some((p) => p.includes("product-media")))
      .toBe(true);
    await expect
      .poll(() => [...requested].some((p) => p.includes("store-media")))
      .toBe(true);
    await expect(page.locator(".hvm-store-public")).toBeVisible();
    release();
    await expect(page.locator(".hvm-store-public")).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(
            ".hvm-store-public .hvm-carousel-surface>img, .hvm-store-avatar img",
          )
          .evaluateAll(
            (images) =>
              images.length >= 3 &&
              images.every(
                (image) =>
                  (image as HTMLImageElement).complete &&
                  (image as HTMLImageElement).naturalWidth > 0,
              ),
          ),
      )
      .toBe(true);
    await noOverflow(page);
  } finally {
    release();
  }
});

test("imagem inválida libera a vitrine e mantém indicação honesta da falha", async ({
  page,
}) => {
  await mock(page);
  await page.route(
    `${origin}/storage/v1/object/sign/product-media/**`,
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: '{"error":"not-an-image"}',
      }),
  );
  await page.goto("/produtores/loja-0");
  await expect(page.locator(".hvm-store-public")).toBeVisible();
  const product = page.getByRole("region", {
    name: "Fotos de Couve fresca",
    exact: true,
  });
  await expect(product.getByText("Foto indisponível")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".hvm-store-avatar img")
        .evaluate((image) => (image as HTMLImageElement).naturalWidth > 0),
    )
    .toBe(true);
  await noOverflow(page);
});

test("foto sem resposta não deixa a vitrine esperando indefinidamente", async ({
  page,
}) => {
  await mock(page);
  await page.clock.install();
  let release!: () => void;
  const stalled = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(
    `${origin}/storage/v1/object/sign/product-media/**`,
    async (route) => {
      requested = true;
      await stalled;
      await route.fulfill({ contentType: "image/png", body: png });
    },
  );
  try {
    await page.goto("/produtores/loja-0", { waitUntil: "domcontentloaded" });
    await expect.poll(() => requested).toBe(true);
    await expect(page.locator(".hvm-store-public")).toBeVisible();
    await page.clock.runFor(50);
    await expect(page.locator(".hvm-store-public")).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Fotos de Couve fresca", exact: true })
        .getByRole("status"),
    ).toHaveText("Carregando foto…");
    release();
    await expect
      .poll(() =>
        page
          .getByRole("region", { name: "Fotos de Couve fresca", exact: true })
          .locator(".hvm-carousel-surface>img")
          .evaluate((image) => (image as HTMLImageElement).naturalWidth > 0),
      )
      .toBe(true);
  } finally {
    release();
  }
});

test("assinatura renovada mantém foto carregada sem indicador permanente nem novo download", async ({
  page,
}) => {
  await mock(page);
  let version = 0;
  let reads = 0;
  const downloads: string[] = [];
  const signed = (value: string) =>
    value.replace(
      "token=local",
      "token=header." +
        Buffer.from(
          JSON.stringify({ exp: Date.now() / 1000 + 900, version }),
        ).toString("base64url") +
        ".signature",
    );
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "xipbsazvymkqqfmfegwu.supabase.co") {
      downloads.push(url.pathname);
      return route.fulfill({ contentType: "image/png", body: png });
    }
    if (!url.pathname.endsWith("/v1/discovery/highlights"))
      return route.fallback();
    reads++;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        page: 1,
        hasMore: false,
        products: [
          {
            ...publicProducts[0],
            media: publicProducts[0].media.map((media) => ({
              ...media,
              url: signed(media.url),
            })),
            producerName: "Produtor 0",
            producerAvatarUrl: signed(photo(100, "store-media")),
            municipalityId: regions[0].id,
            municipality: regions[0].name,
          },
        ],
      }),
    });
  });
  // Install before mounting so the existing refresh interval is controlled.
  await page.clock.install();
  await page.goto("/");
  const carousel = page.getByRole("region", {
    name: "Produtos da região",
    exact: true,
  });
  const image = carousel.locator(".hvm-carousel-surface>img");
  await expect
    .poll(() =>
      image.evaluate(
        (element) => (element as HTMLImageElement).naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect(carousel.getByRole("status")).toHaveCount(0);
  const original = await image.getAttribute("src");
  const count = downloads.length;
  version++;
  await page.clock.fastForward(31000);
  await expect.poll(() => reads).toBeGreaterThan(1);
  await expect(image).toHaveAttribute("src", original!);
  await expect(carousel.getByRole("status")).toHaveCount(0);
  expect(downloads).toHaveLength(count);
});

test("fotos privadas do produtor carregam sem tentar endpoint público", async ({
  page,
}) => {
  await mock(page, { producer: true, privatePhotos: true });
  const previews: string[] = [];
  await page.route("**/v1/public-media/**", async (route) => {
    previews.push(route.request().url());
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: '{"error":"MEDIA_NOT_FOUND"}',
    });
  });
  await page.goto("/produtor/produtos");
  const product = page.locator(".hvm-product-photo img").first();
  await expect(product).toHaveAttribute("src", privatePhoto(0));
  await expect
    .poll(() =>
      product.evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.goto("/produtor/loja");
  await page.getByRole("tab", { name: "Fotos e capa" }).click();
  const cover = page
    .getByRole("region", { name: "Prévia da capa da loja" })
    .locator(".hvm-carousel-surface > img");
  await expect(cover).toHaveAttribute("src", privatePhoto(110, "store-media"));
  await expect
    .poll(() => cover.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.locator(".hvm-store-media-avatar img")).toHaveAttribute(
    "fetchpriority",
    "auto",
  );
  expect(previews).toEqual([]);
});

test("próximas capas aguardam a foto exibida antes de ocupar a conexão", async ({
  page,
}) => {
  await mock(page);
  await page.clock.install();
  let release!: () => void;
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Set<string>();
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.add(path);
    if (path === new URL(photo(110, "store-media")).pathname) await first;
    await route.fulfill({ contentType: "image/png", body: png });
  });
  try {
    await page.goto("/produtores/loja-0", { waitUntil: "domcontentloaded" });
    await expect
      .poll(() => requested.has(new URL(photo(110, "store-media")).pathname))
      .toBe(true);
    await expect(page.locator(".hvm-store-public")).toBeVisible();
    await page.clock.runFor(100);
    expect(requested.has(new URL(photo(111, "store-media")).pathname)).toBe(
      false,
    );
    release();
    await expect
      .poll(() => requested.has(new URL(photo(111, "store-media")).pathname))
      .toBe(true);
  } finally {
    release();
  }
});

test("carrossel antecipa duas próximas fotos sem abrir os slides", async ({
  page,
}) => {
  await mock(page);
  const requested = new Set<string>();
  await page.route(`${origin}/**`, async (route) => {
    requested.add(new URL(route.request().url()).pathname);
    await route.fulfill({ contentType: "image/png", body: png });
  });
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Produtos da região", exact: true }),
  ).toBeVisible();
  await expect.poll(() => requested.has(new URL(photo(4)).pathname)).toBe(true);
});

for (const width of [320, 390, 768, 1440]) {
  test(`destaques e busca única adaptados a ${width}px`, async ({ page }) => {
    const m = await mock(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const carousel = page.getByRole("region", {
      name: "Produtos da região",
      exact: true,
    });
    await expect(carousel).toBeVisible();
    await expect(
      carousel.getByText("Couve fresca", { exact: true }),
    ).toBeVisible();
    await expect(
      carousel.getByText("Produtor 0", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(1);
    await expect(page.locator(".hero input, .mobile-header input")).toHaveCount(
      0,
    );
    await noOverflow(page);
    await carousel.getByRole("button", { name: "Próxima foto" }).click();
    await expect(
      carousel.getByText("Alface da horta", { exact: true }),
    ).toBeVisible();
    await expect(carousel.getByText("Cujubim", { exact: true })).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`destaques-${width}.png`),
      fullPage: true,
    });
    expect(m.errors).toEqual([]);
  });
  test(`produtos e capa da loja com fotos em ${width}px`, async ({ page }) => {
    const m = await mock(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/produtores/loja-0");
    const cover = page.getByRole("region", {
      name: "Capa da loja",
      exact: true,
    });
    await expect(cover).toBeVisible();
    await cover.getByRole("button", { name: "Próxima foto" }).click();
    await expect(
      cover.getByText("Couve fresca", { exact: true }),
    ).toBeVisible();
    await expect(cover.getByText("R$ 12,90", { exact: false })).toBeVisible();
    const product = page.getByRole("region", {
      name: "Fotos de Couve fresca",
      exact: true,
    });
    const before = await product
      .locator(".hvm-carousel-surface>img")
      .getAttribute("src");
    await product.getByRole("button", { name: "Próxima foto" }).click();
    expect(
      await product.locator(".hvm-carousel-surface>img").getAttribute("src"),
    ).not.toBe(before);
    await noOverflow(page);
    await page.screenshot({
      path: test.info().outputPath(`capa-${width}.png`),
      fullPage: true,
    });
    expect(m.errors).toEqual([]);
  });
  test(`escolha dos três modos de capa em ${width}px`, async ({ page }) => {
    const m = await mock(page, { producer: true });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/produtor/loja");
    await page.getByRole("tab", { name: "Fotos e capa" }).click();
    const preview = page.getByRole("region", {
      name: "Prévia da capa da loja",
      exact: true,
    });
    await expect(preview).toBeVisible();
    await page.getByRole("radio", { name: /Produtos da loja/ }).check();
    await expect(
      preview.getByText("Couve fresca", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Salvar capa e identidade" })
      .click();
    await expect(page.getByText("Nome público e capa salvos.")).toBeVisible();
    expect(m.store().coverMode).toBe("products");
    await page.getByRole("radio", { name: /Fotos enviadas/ }).check();
    await expect(preview.locator(".hvm-carousel-surface>img")).toHaveAttribute(
      "src",
      photo(110, "store-media"),
    );
    await page.getByRole("radio", { name: /Fotos e produtos/ }).check();
    await preview.getByRole("button", { name: "Próxima foto" }).click();
    await expect(
      preview.getByText("Couve fresca", { exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: test.info().outputPath(`fotos-config-${width}.png`),
      fullPage: true,
    });
    expect(m.errors).toEqual([]);
  });
}
test("mudar região filtra os slides e clicar abre a loja correta", async ({
  page,
}) => {
  const m = await mock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Selecionar localização" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Cujubim/ })
    .click();
  const carousel = page.getByRole("region", {
    name: "Produtos da região",
    exact: true,
  });
  await expect(
    carousel.getByText("Alface da horta", { exact: true }),
  ).toBeVisible();
  expect(m.requests.at(-1)?.searchParams.get("municipalityId")).toBe(
    regions[1].id,
  );
  await carousel.getByRole("link").click();
  await expect(page).toHaveURL(/\/produtores\/loja-1$/);
});
test("páginas de produtos avançam e retornam ao início", async ({ page }) => {
  const m = await mock(page, { pagination: true });
  await page.goto("/");
  const carousel = page.getByRole("region", {
    name: "Produtos da região",
    exact: true,
  });
  await expect(carousel).toBeVisible();
  await carousel.getByRole("button", { name: "Próxima foto" }).click();
  await carousel.getByRole("button", { name: "Próxima foto" }).click();
  await expect(
    carousel.getByText("Cheiro-verde", { exact: true }),
  ).toBeVisible();
  await carousel.getByRole("button", { name: "Próxima foto" }).click();
  await expect(
    carousel.getByText("Couve fresca", { exact: true }),
  ).toBeVisible();
  expect(m.requests.map((r) => r.searchParams.get("page")).slice(-2)).toEqual([
    "2",
    "1",
  ]);
});
test("autoplay respeita pausa, foco e preferência de movimento reduzido", async ({
  page,
}) => {
  await mock(page);
  await page.clock.install();
  await page.goto("/");
  const carousel = page.getByRole("region", {
    name: "Produtos da região",
    exact: true,
  });
  await expect(carousel).toBeVisible();
  await page.mouse.move(0, 0);
  await page.clock.runFor(6500);
  await expect(
    carousel.getByText("Alface da horta", { exact: true }),
  ).toBeVisible();
  await carousel.getByRole("button", { name: "Pausar slides" }).click();
  await page.clock.runFor(18000);
  await expect(
    carousel.getByText("Alface da horta", { exact: true }),
  ).toBeVisible();
  await carousel.getByRole("button", { name: "Iniciar slides" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("h1").click();
  await page.mouse.move(0, 0);
  await page.clock.runFor(18000);
  await expect(
    carousel.getByText("Alface da horta", { exact: true }),
  ).toBeVisible();
  await carousel
    .getByRole("button", { name: "Próxima foto" })
    .press("ArrowRight");
  await expect(
    carousel.getByText("Cheiro-verde", { exact: true }),
  ).toBeVisible();
});
test("salvar identidade preserva apresentação ainda não salva e recarga mantém capa", async ({
  page,
}) => {
  const m = await mock(page, { producer: true });
  await page.goto("/produtor/loja");
  await page
    .getByLabel("Nome da loja", { exact: true })
    .fill("Alteração de apresentação pendente");
  await page.getByRole("tab", { name: "Fotos e capa" }).click();
  await page.getByLabel("Nome público do produtor").fill("Joana da produção");
  await page.getByRole("radio", { name: /Fotos enviadas/ }).check();
  await page.getByRole("button", { name: "Salvar capa e identidade" }).click();
  await expect(page.getByText("Nome público e capa salvos.")).toBeVisible();
  await page.getByRole("tab", { name: "Apresentação" }).click();
  await expect(page.getByLabel("Nome da loja", { exact: true })).toHaveValue(
    "Alteração de apresentação pendente",
  );
  await page.reload();
  await page.getByRole("tab", { name: "Fotos e capa" }).click();
  await expect(page.getByLabel("Nome público do produtor")).toHaveValue(
    "Joana da produção",
  );
  expect(m.store().coverMode).toBe("images");
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Excluir foto de capa 1" }).click();
  await expect(page.getByText("Foto removida da capa.")).toBeVisible();
  expect(m.store().coverImages).toHaveLength(1);
});
test("foto grande é otimizada e retry após senha usa o mesmo comando", async ({
  page,
}) => {
  const m = await mock(page, { producer: true, reauth: true });
  await page.goto("/produtor/loja");
  await page.getByRole("tab", { name: "Fotos e capa" }).click();
  const bytes = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 2400;
    c.height = 1800;
    c.getContext("2d")!.fillRect(0, 0, 2400, 1800);
    const b = await new Promise<Blob>((r) =>
      c.toBlob((v) => r(v!), "image/png"),
    );
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  await page
    .getByLabel("Adicionar foto de capa", { exact: true })
    .setInputFiles({
      name: "paisagem.png",
      mimeType: "image/png",
      buffer: Buffer.from(bytes),
    });
  await page.getByLabel("Senha atual").fill("senha-local");
  await page.getByRole("button", { name: "Confirmar e continuar" }).click();
  await expect(page.getByText("Foto adicionada à capa.")).toBeVisible();
  expect(new Set(m.commands).size).toBe(1);
  expect(m.uploads).toHaveLength(1);
  expect(m.uploads[0].type).toBe("image/webp");
  expect(m.uploads[0].body.length).toBeLessThan(2 * 1024 * 1024);
});
test("estado vazio regional é honesto e não inventa fotos, produtos ou preços", async ({
  page,
}) => {
  const m = await mock(page, { empty: true });
  await page.goto("/");
  await expect(page.getByText("O próximo frescor vem do campo")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Produtos da região", exact: true }),
  ).toHaveCount(0);
  expect(m.errors).toEqual([]);
});

import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
const pa = "11111111-1111-4111-8111-111111111111",
  pb = "22222222-2222-4222-8222-222222222222",
  sa = "33333333-3333-4333-8333-333333333333",
  sb = "44444444-4444-4444-8444-444444444444",
  cat = "55555555-5555-4555-8555-555555555555",
  municipality = "66666666-6666-4666-8666-666666666666";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6LRsAAAAASUVORK5CYII=",
  "base64",
);
function image(nonce: string) {
  return (
    "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/product-media/photo.png?token=header." +
    Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900, nonce }),
    ).toString("base64url") +
    ".signature"
  );
}
const products = [
  {
    id: pa,
    title: "Cenoura em porções",
    storeName: "Chácara Sol",
    storeSlug: "chacara-sol",
    price: 700,
    weight: 300,
  },
  {
    id: pb,
    title: "Couve em porções",
    storeName: "Sítio Verde",
    storeSlug: "sitio-verde",
    price: 900,
    weight: 200,
  },
];
async function mock(
  page: Page,
  options: { lostReply?: boolean; error?: boolean; slowImages?: boolean } = {},
) {
  let records: any[] = [],
    failed = !!options.error,
    lost = !!options.lostReply,
    revision = 0;
  const commands = new Set<string>(),
    posts: any[] = [],
    errors: string[] = [],
    images: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const cart = () => {
    const stores = [
      {
        storeId: sa,
        storeName: "Chácara Sol",
        storeSlug: "chacara-sol",
        minOrderCents: 2500,
      },
      {
        storeId: sb,
        storeName: "Sítio Verde",
        storeSlug: "sitio-verde",
        minOrderCents: 800,
      },
    ]
      .map((store) => {
        const items = records
          .filter((i) => i.storeId === store.storeId)
          .map(({ storeId: _store, ...item }) => item);
        const subtotalCents = items.reduce(
          (sum, i) => sum + i.unitPriceCents * i.quantity,
          0,
        );
        return {
          ...store,
          items,
          subtotalCents,
          meetsMinOrder: subtotalCents >= store.minOrderCents,
        };
      })
      .filter((s) => s.items.length);
    return {
      stores,
      itemCount: records.length,
      subtotalCents: stores.reduce((n, s) => n + s.subtotalCents, 0),
    };
  };
  function add(input: any) {
    const product = products.find((p) => p.id === input.productId)!;
    const existing = records.find(
      (i) =>
        i.productId === product.id && i.cutType === (input.cutType ?? null),
    );
    if (existing)
      existing.quantity = Math.min(99, existing.quantity + input.quantity);
    else
      records.push({
        id: randomUUID(),
        productId: product.id,
        title: product.title,
        storeId: product.id === pa ? sa : sb,
        quantity: input.quantity,
        cutType: input.cutType ?? null,
        unitPriceCents: product.price,
        unitType: "un",
        netWeightGrams: product.weight,
        imageUrl: image(String(revision)),
        available: true,
      });
  }
  await page.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.hostname === "xipbsazvymkqqfmfegwu.supabase.co") {
      images.push(url.href);
      if (options.slowImages)
        await new Promise((done) => setTimeout(done, 300));
      return route.fulfill({ contentType: "image/png", body: png });
    }
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
      return json({ error: "AUTH_REQUIRED" }, 401);
    if (path === "/v1/localities")
      return json({
        municipalities: [
          {
            id: municipality,
            ibgeCode: "1100023",
            name: "Ariquemes",
            state: "RO",
            isActive: true,
            revision: 1,
          },
        ],
        activeMunicipalityIds: [municipality],
      });
    if (path === "/v1/categories") return json({ categories: [] });
    if (path === "/v1/products") {
      revision++;
      return json({
        products: products.map((p) => ({
          id: p.id,
          title: p.title,
          storeName: p.storeName,
          storeSlug: p.storeSlug,
          categoryId: cat,
          categoryName: "Hortaliças",
          description: "Porções frescas e higienizadas.",
          packagingType: "porcao_embalada",
          netWeightGrams: p.weight,
          unitType: "un",
          shelfLifeDays: 5,
          conservationNotes: "Refrigerar",
          inStock: true,
          currentPrice: {
            id: randomUUID(),
            priceCents: p.price,
            validFrom: "2026-10-05T00:00:00Z",
          },
          media: [
            {
              id: p.id,
              url: image(String(revision)),
              displayOrder: 0,
              isPrimary: true,
            },
          ],
        })),
      });
    }
    if (path === "/v1/cart" && req.method() === "GET") {
      if (failed) return json({ error: "DEPENDENCY_UNAVAILABLE" }, 503);
      return json(cart());
    }
    if (path.startsWith("/v1/cart/")) {
      const body = req.postDataJSON();
      posts.push({ path, body });
      if (!commands.has(body.commandId)) {
        if (path === "/v1/cart/items") add(body);
        else if (path === "/v1/cart/mix") body.items.forEach(add);
        else if (path.endsWith("/remove"))
          records = records.filter((i) => i.id !== path.split("/")[4]);
        else {
          const item = records.find((i) => i.id === path.split("/")[4]);
          if (item) item.quantity = body.quantity;
        }
        commands.add(body.commandId);
      }
      if (lost) {
        lost = false;
        return json({ error: "DEPENDENCY_UNAVAILABLE" }, 503);
      }
      return json(cart());
    }
    return json({ error: "NOT_FOUND" }, 404);
  });
  return {
    posts,
    images,
    errors,
    recover: () => {
      failed = false;
    },
    cart,
  };
}
const noOverflow = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
for (const width of [320, 390, 768, 1440]) {
  test(`T18 cesta multilojas, mínimos, quantidades, persistência e remoção ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    const state = await mock(page);
    await page.goto("/produtos");
    await page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: products[0].title }) })
      .getByRole("button", { name: "Adicionar à cesta" })
      .click();
    await page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: products[1].title }) })
      .getByRole("button", { name: "Adicionar à cesta" })
      .click();
    await page
      .getByRole("button", { name: "Carrinho", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Minha cesta" }),
    ).toBeVisible();
    await expect(
      page.getByText("Faltam R$ 18,00 para o pedido mínimo desta loja."),
    ).toBeVisible();
    await expect(page.getByText("Pedido mínimo atingido")).toBeVisible();
    await noOverflow(page);
    await page
      .getByRole("button", { name: "Aumentar Cenoura em porções" })
      .click();
    await expect(
      page.getByText("Faltam R$ 11,00 para o pedido mínimo desta loja."),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("Faltam R$ 11,00 para o pedido mínimo desta loja."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Remover Couve em porções", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Sítio Verde" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Remover Cenoura em porções", exact: true })
      .click();
    await expect(
      page.getByText("Sua cesta está esperando o frescor"),
    ).toBeVisible();
    await noOverflow(page);
    expect(state.errors).toEqual([]);
  });
  test(`T18 Monte seu HortiMix com duas lojas e cortes separados ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    const state = await mock(page);
    await page.goto("/produtos");
    await page.getByText("Monte seu HortiMix", { exact: true }).click();
    await page.getByLabel("Alimento", { exact: true }).selectOption(pa);
    await page.getByLabel("Corte", { exact: true }).selectOption("rodelas");
    await page.getByRole("button", { name: "Incluir no mix" }).click();
    await page.getByLabel("Corte", { exact: true }).selectOption("cubos");
    await page.getByRole("button", { name: "Incluir no mix" }).click();
    await page.getByLabel("Alimento", { exact: true }).selectOption(pb);
    await page.getByLabel("Corte", { exact: true }).selectOption("picado_fino");
    await page.getByRole("button", { name: "Incluir no mix" }).click();
    await page
      .getByRole("button", { name: "Adicionar HortiMix à cesta" })
      .click();
    await expect(
      page.getByText("Seu HortiMix foi adicionado à cesta."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ver minha cesta" }).click();
    await expect(
      page.getByRole("heading", { name: "Minha cesta" }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(3);
    expect(state.posts.filter((p) => p.path === "/v1/cart/mix")).toHaveLength(
      1,
    );
    expect(state.cart().stores).toHaveLength(2);
    await noOverflow(page);
    expect(state.errors).toEqual([]);
    if (width === 390)
      await page.screenshot({
        path: "/workspace/scratch/t18-cart-mobile.png",
        fullPage: true,
      });
    if (width === 1440)
      await page.screenshot({
        path: "/workspace/scratch/t18-cart-desktop.png",
        fullPage: true,
      });
  });
}
test("T18 resposta perdida mantém commandId e recupera sem duplicar", async ({
  page,
}) => {
  const state = await mock(page, { lostReply: true });
  await page.goto("/produtos");
  const card = page.locator("article").first();
  await card.getByRole("button", { name: "Adicionar à cesta" }).click();
  await expect(
    card.getByRole("button", { name: "Confirmar alteração" }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Adicionar à cesta" }),
  ).toBeDisabled();
  await card.getByRole("button", { name: "Confirmar alteração" }).click();
  expect(state.posts).toHaveLength(2);
  expect(state.posts[0].body.commandId).toBe(state.posts[1].body.commandId);
  expect(state.cart().itemCount).toBe(1);
});
test("T18 erro de leitura não é cesta vazia e pode recuperar", async ({
  page,
}) => {
  const state = await mock(page, { error: true });
  await page.goto("/carrinho");
  await expect(page.getByRole("alert")).toBeVisible();
  expect(
    await page.getByText("Sua cesta está esperando o frescor").count(),
  ).toBe(0);
  state.recover();
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    page.getByText("Sua cesta está esperando o frescor"),
  ).toBeVisible();
});
test("Fotos: visíveis são prioritárias, texto não espera download e assinatura renovada não baixa outra vez", async ({
  page,
}) => {
  const state = await mock(page, { slowImages: true });
  await page.goto("/produtos");
  await expect(
    page.getByRole("heading", { name: products[0].title }),
  ).toBeVisible();
  const photo = page.getByAltText(products[0].title, { exact: true });
  await expect(photo).toHaveAttribute("loading", "eager");
  await expect(photo).toHaveAttribute("fetchpriority", "high");
  await expect
    .poll(() =>
      photo.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0),
    )
    .toBe(true);
  const first = await photo.getAttribute("src"),
    downloads = state.images.length;
  await page.clock.install();
  await page.clock.fastForward(31000);
  await expect(photo).toHaveAttribute("src", first!);
  expect(state.images.length).toBe(downloads);
  expect(state.errors).toEqual([]);
});

test("Fotos novas: imagem grande é otimizada uma vez e chega ao upload com dimensões e peso limitados", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/produtos");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/optimizeImage.ts";
    const { optimizeImage } = await import(modulePath);
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1800;
    const ctx = canvas.getContext("2d")!,
      pixels = ctx.createImageData(canvas.width, canvas.height);
    let seed = 42;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      pixels.data[i] = seed & 255;
      pixels.data[i + 1] = (seed >>> 8) & 255;
      pixels.data[i + 2] = (seed >>> 16) & 255;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob>((done) =>
      canvas.toBlob((b) => done(b!), "image/jpeg", 0.96),
    );
    const input = new File([blob], "foto-grande.jpg", { type: "image/jpeg" });
    const [a, b] = await Promise.all([
      optimizeImage(input),
      optimizeImage(input),
    ]);
    const bitmap = await createImageBitmap(a);
    const result = {
      before: input.size,
      after: a.size,
      width: bitmap.width,
      height: bitmap.height,
      type: a.type,
      reused: a === b,
    };
    bitmap.close();
    return result;
  });
  expect(result.before).toBeGreaterThan(2 * 1024 * 1024);
  expect(result.after).toBeLessThanOrEqual(240 * 1024);
  expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1280);
  expect(result.type).toBe("image/webp");
  expect(result.reused).toBe(true);
});

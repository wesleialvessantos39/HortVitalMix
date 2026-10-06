import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const userId = randomUUID(),
  cartId = randomUUID(),
  addressId = randomUUID();
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6LRsAAAAASUVORK5CYII=",
  "base64",
);
const address = {
  id: addressId,
  label: "Casa",
  cep: "76870000",
  street: "Rua das Hortas",
  number: "10",
  complement: null,
  neighborhood: "Centro",
  city: "Ariquemes",
  state: "RO",
  latitude: -9.911,
  longitude: -63.041,
  deliveryNotes: null,
  revision: 1,
};
const stores = ["Chácara Sol", "Sítio Verde"].map((storeName, i) => {
  const productId = randomUUID(),
    id = randomUUID();
  return {
    storeId: randomUUID(),
    storeName,
    storeSlug: "produtor-" + i,
    minOrderCents: 1000,
    subtotalCents: i ? 1800 : 1400,
    meetsMinOrder: true,
    items: [
      {
        id,
        productId,
        title: i ? "Couve em porções" : "Cenoura em porções",
        quantity: 2,
        cutType: i ? "rodelas" : null,
        unitPriceCents: i ? 900 : 700,
        unitType: "un",
        netWeightGrams: 300,
        available: true,
        imageUrl:
          "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/product-media/local.png?token=local",
      },
    ],
  };
});
type Options = {
  guest?: boolean;
  empty?: boolean;
  noAddress?: boolean;
  noGps?: boolean;
  belowMin?: boolean;
  lost?: boolean;
  invalidReply?: boolean;
  conflict?: 409 | 410;
  error?: boolean;
  expire?: boolean;
  omitContextReceipt?: boolean;
  failReceiptRead?: boolean;
};
async function mock(page: Page, options: Options = {}) {
  const posts: { commandId: string; body: any }[] = [],
    quotes: any[] = [],
    errors: string[] = [];
  let receipt: any = null,
    first = true,
    conflict = options.conflict,
    failRead = !!options.failReceiptRead;
  page.on("pageerror", (e) => errors.push(e.message));
  const cart = {
    stores: options.empty
      ? []
      : stores.map((s) => ({ ...s, meetsMinOrder: !options.belowMin })),
    itemCount: options.empty ? 0 : 4,
    subtotalCents: options.empty ? 0 : 3200,
  };
  await page.route("**/*", async (route) => {
    const r = route.request(),
      u = new URL(r.url());
    if (u.hostname === "xipbsazvymkqqfmfegwu.supabase.co")
      return route.fulfill({ contentType: "image/png", body: png });
    if (!u.pathname.includes("/v1/")) return route.continue();
    const path = u.pathname.replace(/^\/(?:api|_hvm_api)/, ""),
      json = (body: unknown, status = 200) =>
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
        : json({
            userId,
            email: "buyer@example.test",
            fullName: "Consumidor",
            roles: ["consumer"],
            activeRole: "consumer",
            portalKind: "public",
          });
    if (path === "/v1/localities") return json({ municipalities: [] });
    if (path === "/v1/categories") return json({ categories: [] });
    if (path === "/v1/cart") return json(cart);
    if (path === "/v1/account/addresses")
      return json({
        addresses: options.noAddress
          ? []
          : [
              {
                ...address,
                latitude: options.noGps ? null : address.latitude,
                longitude: options.noGps ? null : address.longitude,
                isActive: true,
                isDefault: true,
                geocodingAccuracy: "manual",
                lastUsedAt: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
      });
    if (path === "/v1/checkout/context")
      return options.error
        ? json({ error: "DEPENDENCY_UNAVAILABLE" }, 503)
        : json({
            cartId,
            serverTime: new Date().toISOString(),
            pendingConfirmation: options.omitContextReceipt ? null : receipt,
          });
    if (path === "/v1/checkout/quotes" && r.method() === "POST") {
      const now = Date.now(),
        q = {
          id: randomUUID(),
          cartId,
          deliveryAddressId: addressId,
          addressSnapshot: address,
          stores: stores.map((s) => ({
            storeId: s.storeId,
            storeName: s.storeName,
            storeSlug: s.storeSlug,
            minOrderCents: 1000,
            subtotalCents: s.subtotalCents,
            deliveryQuoteId: randomUUID(),
            deliveryFeeCents: 600,
            distanceKm: 1,
            items: s.items.map(({ id, available: _available, ...i }) => ({
              ...i,
              cartItemId: id,
              totalPriceCents: i.unitPriceCents * i.quantity,
              priceVersionId: randomUUID(),
            })),
          })),
          subtotalCents: 3200,
          deliveryFeeCents: 1200,
          discountCents: 0,
          totalCents: 4400,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(
            now + (options.expire && !quotes.length ? 1200 : 900000),
          ).toISOString(),
          serverTime: new Date(now).toISOString(),
          isConsumed: false,
        };
      quotes.push(q);
      return json(q, 201);
    }
    if (path.startsWith("/v1/checkout/quotes/")) {
      const q = quotes.find((q) => q.id === path.split("/").at(-1));
      return q
        ? json({ ...q, serverTime: new Date().toISOString() })
        : json({ error: "CHECKOUT_QUOTE_NOT_FOUND" }, 404);
    }
    if (path.startsWith("/v1/checkout/confirmations/"))
      return failRead
        ? json({ error: "DEPENDENCY_UNAVAILABLE" }, 503)
        : receipt
          ? json(receipt)
          : json({ error: "CHECKOUT_CONFIRMATION_NOT_FOUND" }, 404);
    if (path === "/v1/checkout/confirm") {
      const commandId = r.headers()["x-command-id"],
        body = r.postDataJSON();
      posts.push({ commandId, body });
      if (conflict) {
        const status = conflict;
        conflict = undefined;
        return json(
          {
            error:
              status === 410
                ? "CHECKOUT_QUOTE_EXPIRED"
                : "CHECKOUT_VALUES_CHANGED",
          },
          status,
        );
      }
      receipt ??= {
        commandId,
        quoteId: body.quoteId,
        paymentIntentId: randomUUID(),
        status: "pending_payment",
        paymentStatus: "pending",
        paymentMethod: body.paymentMethod,
        totalCents: 4400,
        confirmedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 900000).toISOString(),
        reservations: [
          {
            id: randomUUID(),
            productId: stores[0].items[0].productId,
            lotId: randomUUID(),
            quantity: 2,
            expiresAt: new Date(Date.now() + 900000).toISOString(),
          },
        ],
      };
      quotes.find((q) => q.id === body.quoteId).isConsumed = true;
      if (first && options.lost) {
        first = false;
        return route.abort("failed");
      }
      if (first && options.invalidReply) {
        first = false;
        return route.fulfill({
          status: 201,
          contentType: "text/html",
          body: "temporary gateway reply",
        });
      }
      return json(receipt, 201);
    }
    return json({ error: "NOT_FOUND" }, 404);
  });
  return {
    posts,
    quotes,
    errors,
    recoverRead: () => {
      failRead = false;
    },
  };
}
async function calculate(page: Page) {
  await page.goto("/checkout");
  await page
    .getByRole("button", { name: "Calcular frete e revisar", exact: true })
    .click();
  await expect(
    page.getByText("Cotação congelada", { exact: true }),
  ).toBeVisible();
}
for (const width of [320, 390, 768, 1440])
  test(`T19 revisão multilojas e confirmação acessível ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    const s = await mock(page);
    await calculate(page);
    await expect(
      page.getByRole("heading", { name: "Chácara Sol", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sítio Verde", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("timer")).toContainText(
      /Válida por 14:|Válida por 15:/,
    );
    await expect(page.getByText("R$ 44,00", { exact: true })).toBeVisible();
    await page
      .getByRole("radio", { name: "Cartão de crédito", exact: true })
      .check();
    await page
      .getByRole("button", { name: "Confirmar Pedido", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Checkout confirmado", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Pagamento pendente", { exact: true }),
    ).toBeVisible();
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0].body.paymentMethod).toBe("credit_card");
    expect(s.posts[0].commandId).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(s.errors).toEqual([]);
  });
test("T19 autenticação e cesta vazia", async ({ page }) => {
  await mock(page, { guest: true });
  await page.goto("/checkout");
  await expect(
    page.getByRole("heading", { name: "Entre para revisar sua seleção" }),
  ).toBeVisible();
  await page.unrouteAll();
  await mock(page, { empty: true });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sua cesta está vazia" }),
  ).toBeVisible();
});
for (const option of ["noAddress", "noGps", "belowMin"] as const)
  test(`T19 bloqueia cálculo sem pré-requisito ${option}`, async ({ page }) => {
    await mock(page, { [option]: true });
    await page.goto("/checkout");
    await expect(
      page.getByRole("button", {
        name: "Calcular frete e revisar",
        exact: true,
      }),
    ).toBeDisabled();
  });
for (const conflict of [409, 410] as const)
  test(`T19 conflito ${conflict} exige revisão e novo comando`, async ({
    page,
  }) => {
    const s = await mock(page, { conflict });
    await calculate(page);
    await page
      .getByRole("button", { name: "Confirmar Pedido", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Os valores do seu pedido mudaram, revise antes de confirmar",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confirmar Pedido", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Recalcular cotação", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Confirmar Pedido", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Checkout confirmado", exact: true }),
    ).toBeVisible();
    expect(s.posts).toHaveLength(2);
    expect(s.posts[0].commandId).not.toBe(s.posts[1].commandId);
    expect(s.posts[0].body.quoteId).not.toBe(s.posts[1].body.quoteId);
  });
test("T19 prazo usa relógio do servidor e expiração permite recálculo", async ({
  page,
}) => {
  await mock(page, { expire: true });
  await calculate(page);
  await expect(
    page.getByRole("heading", {
      name: "Os valores do seu pedido mudaram, revise antes de confirmar",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirmar Pedido", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Recalcular cotação", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Confirmar Pedido", exact: true }),
  ).toBeEnabled();
});
for (const invalidReply of [false, true])
  test(`T19 resposta perdida ${invalidReply ? "HTML201" : "rede"} conserva chave no reload`, async ({
    page,
  }) => {
    const s = await mock(page, {
      lost: !invalidReply,
      invalidReply,
      omitContextReceipt: true,
      failReceiptRead: true,
    });
    await calculate(page);
    await page
      .getByRole("button", { name: "Confirmar Pedido", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Vamos recuperar sua confirmação" }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "Cartão de crédito", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Vamos recuperar sua confirmação" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Recuperar confirmação", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Checkout confirmado", exact: true }),
    ).toBeVisible();
    expect(s.posts).toHaveLength(2);
    expect(s.posts[0]).toEqual(s.posts[1]);
    expect(s.errors).toEqual([]);
  });
test("T19 reload recupera recibo sem confirmar de novo", async ({ page }) => {
  const s = await mock(page);
  await calculate(page);
  await page
    .getByRole("button", { name: "Confirmar Pedido", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Checkout confirmado", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Checkout confirmado", exact: true }),
  ).toBeVisible();
  expect(s.posts).toHaveLength(1);
});
test("T19 duplo clique bloqueado em trânsito e preserva um comando", async ({
  page,
}) => {
  const s = await mock(page);
  await calculate(page);
  await page
    .getByRole("button", { name: "Confirmar Pedido", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(
    page.getByRole("heading", { name: "Checkout confirmado", exact: true }),
  ).toBeVisible();
  expect(s.posts).toHaveLength(1);
});
test("T19 indisponibilidade inicial oferece recuperação", async ({ page }) => {
  await mock(page, { error: true });
  await page.goto("/checkout");
  await expect(
    page.getByRole("button", { name: "Tentar novamente", exact: true }),
  ).toBeVisible();
});

import { expect, test, type Page } from "@playwright/test";
import {
  ORDER_TRANSITIONS,
  type OrderStatus,
} from "../../shared/contracts/order";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stages: OrderStatus[] = [
  "confirmed",
  "in_preparation",
  "ready_for_dispatch",
  "out_for_delivery",
  "delivered",
];
const created = new Date().toISOString();
function detail(status: OrderStatus = "confirmed", revision = 1) {
  const summary = {
    id: id(5),
    orderNumber: "#HVM-2026-00001",
    storeName: "Chácara Boa Colheita",
    status,
    revision,
    commercialStatus: "confirmed",
    subtotalCents: 1400,
    deliveryFeeCents: 500,
    totalCents: 1900,
    itemCount: 2,
    cancellationReason:
      status === "cancelled"
        ? "A colheita não atingiu a qualidade esperada."
        : null,
    receivedAt: null,
    createdAt: created,
    updatedAt: created,
    allowedTransitions: [...ORDER_TRANSITIONS[status]],
  };
  return {
    ...summary,
    refundState: status === "cancelled" ? "disputed" : "held",
    address: {
      id: id(9),
      label: "Casa",
      cep: "76870000",
      street: "Rua da Colheita",
      number: "21",
      complement: null,
      neighborhood: "Centro",
      city: "Ariquemes",
      state: "RO",
      latitude: -9.911,
      longitude: -63.041,
      deliveryNotes: "Chamar ao chegar.",
      revision: 1,
    },
    items: [
      {
        id: id(6),
        productId: id(7),
        title: "Cenoura fresca da horta",
        packaging: "porcao_embalada",
        netWeightGrams: 300,
        unitType: "un",
        cutType: "rodelas",
        quantity: 2,
        unitPriceCents: 700,
        totalPriceCents: 1400,
      },
    ],
    events: (status === "cancelled"
      ? ["confirmed", "cancelled"]
      : stages.slice(0, stages.indexOf(status) + 1)
    ).map((toStatus, index) => ({
      id: id(20 + index),
      fromStatus: index ? stages[index - 1] : null,
      toStatus,
      actorRole: index ? "producer" : "payment_gateway",
      notes: toStatus === "cancelled" ? summary.cancellationReason : null,
      revision: index + 1,
      occurredAt: created,
    })),
  };
}
function summary(order: ReturnType<typeof detail>, producer: boolean) {
  const {
    address: _a,
    items: _i,
    events: _e,
    refundState: _r,
    ...value
  } = order;
  return {
    ...value,
    allowedTransitions: producer ? value.allowedTransitions : [],
  };
}
async function mock(
  page: Page,
  role = "producer",
  loggedIn = true,
  initial: OrderStatus = "confirmed",
) {
  let current = detail(
      initial,
      initial === "cancelled" ? 2 : stages.indexOf(initial) + 1,
    ),
    failOnce = false,
    syncPaused = false,
    conflictOnce = false,
    inaccessible = false,
    reads = 0;
  const errors: string[] = [],
    posts: Array<{ body: any; command: string | undefined }> = [],
    receipts = new Map<string, ReturnType<typeof detail>>(),
    synchronized: any[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
    if (path === "/v1/auth/session")
      return loggedIn
        ? json({
            userId: id(1),
            email: "local@example.test",
            fullName: "Pessoa de teste",
            roles: [role],
            activeRole: role,
            portalKind: "public",
          })
        : json({ error: "AUTH_REQUIRED" }, 401);
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
    if (path === "/v1/cart")
      return json({
        id: id(40),
        stores: [],
        itemCount: 0,
        subtotalCents: 0,
        totalCents: 0,
      });
    if (path === "/v1/localities") return json({ municipalities: [] });
    if (path === "/v1/categories") return json({ categories: [] });
    if (path === "/v1/producer/sync") {
      if (syncPaused) return json({ error: "DEPENDENCY_UNAVAILABLE" }, 503);
      const batch = request.postDataJSON();
      synchronized.push(batch);
      return json({ results: batch.commands.map((command: any) => {
        const receipt = receipts.get(command.commandId);
        if (!receipt) throw Error("Existing online receipt required");
        return {
          commandId: command.commandId, status: "confirmed", code: "CONFIRMED",
          entityId: receipt.id, revision: receipt.revision, conflictDetails: null,
        };
      }) });
    }
    if (path === "/v1/orders" || path === "/v1/producer/orders") {
      const counts = {
        confirmed: 0,
        in_preparation: 0,
        ready_for_dispatch: 0,
        out_for_delivery: 0,
        delivered: 0,
        cancelled: 0,
      };
      counts[current.status] = 1;
      const filter = url.searchParams.get("status") ?? "all",
        orders =
          filter === "all" || filter === current.status
            ? [summary(current, role === "producer")]
            : [];
      return json({ orders, page: 1, pages: 1, total: orders.length, counts });
    }
    if (path === "/v1/orders/" + id(5)) {
      reads++;
      return inaccessible
        ? json({ error: "ORDER_NOT_FOUND" }, 404)
        : json({
            ...current,
            allowedTransitions:
              role === "producer" ? current.allowedTransitions : [],
          });
    }
    if (path.endsWith("/transitions")) {
      const body = request.postDataJSON(),
        command = request.headers()["x-command-id"]!;
      posts.push({ body, command });
      if (receipts.has(command)) return json(receipts.get(command));
      if (conflictOnce) {
        conflictOnce = false;
        current = detail("in_preparation", 2);
        return json({ error: "REVISION_CONFLICT" }, 409);
      }
      if (body.expectedRevision !== current.revision)
        return json({ error: "REVISION_CONFLICT" }, 409);
      current = detail(body.toStatus, current.revision + 1);
      if (body.notes) current.cancellationReason = body.notes;
      receipts.set(command, current);
      if (failOnce) {
        failOnce = false;
        return route.abort("failed");
      }
      return json(current);
    }
    return json({ error: "NOT_FOUND" }, 404);
  });
  return {
    errors,
    posts,
    synchronized,
    get revision() { return current.revision; },
    get reads() {
      return reads;
    },
    dropNext: () => {
      failOnce = true;
      syncPaused = true;
    },
    reconnect: () => { syncPaused = false; },
    conflictNext: () => {
      conflictOnce = true;
    },
    deny: () => {
      inaccessible = true;
    },
    change: (status: OrderStatus) => {
      current = detail(status, stages.indexOf(status) + 1);
    },
  };
}
async function layout(page: Page, errors: string[]) {
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
for (const width of [320, 390, 768, 1440]) {
  test(`produtor avança somente a próxima etapa em ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await mock(page);
    await page.goto("/produtor/pedidos");
    await expect(
      page.getByRole("heading", { name: "Pedidos da minha loja" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Iniciar preparo", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confirmar entrega", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Iniciar preparo", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Marcar como pronto", exact: true }),
    ).toBeVisible();
    expect(state.posts[0].body).toEqual({
      toStatus: "in_preparation",
      expectedRevision: 1,
    });
    expect(state.posts[0].command).toMatch(/^[a-f0-9-]{36}$/);
    await layout(page, state.errors);
  });
  test(`cancelamento justificado e dialog acessível em ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await mock(page);
    await page.goto("/produtor/pedidos");
    await page
      .getByRole("button", { name: "Cancelar pedido", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confirmar cancelamento", exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel("Motivo do cancelamento")
      .fill("A colheita não atingiu a qualidade esperada.");
    await page
      .getByRole("button", { name: "Confirmar cancelamento", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(
      page.locator(".order-card .order-status-cancelled"),
    ).toHaveText("Cancelado");
    expect(state.posts[0].body.notes).toContain("qualidade");
    await expect(
      page.getByRole("button", { name: "Iniciar preparo", exact: true }),
    ).toHaveCount(0);
    await layout(page, state.errors);
  });
  test(`comprador vê timeline e valores congelados em ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await mock(page, "consumer", true, "in_preparation");
    await page.goto("/pedidos/" + id(5));
    await expect(
      page.getByRole("heading", { name: "#HVM-2026-00001", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('.order-timeline [aria-current="step"]'),
    ).toContainText("Em preparo");
    await expect(
      page.getByRole("heading", { name: "Produtos do seu pedido" }),
    ).toBeVisible();
    await expect(
      page.getByText("Cenoura fresca da horta", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".order-final-amount")).toContainText("19,00");
    await expect(
      page.getByRole("button", { name: "Iniciar preparo", exact: true }),
    ).toHaveCount(0);
    await layout(page, state.errors);
  });
  test(`lista do comprador abre o pedido em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await mock(page, "consumer");
    await page.goto("/pedidos");
    await page
      .getByRole("button", { name: "Acompanhar pedido", exact: true })
      .click();
    await expect(page.locator(".order-timeline")).toBeVisible();
    await layout(page, state.errors);
  });
}
test("resposta perdida conserva commandId após reload e recupera o resultado", async ({
  page,
}) => {
  const state = await mock(page);
  state.dropNext();
  await page.goto("/produtor/pedidos");
  await page
    .getByRole("button", { name: "Iniciar preparo", exact: true })
    .click();
  await expect(page.getByText(/Ações aguardando confirmação — 1 ação pendente/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Ações aguardando confirmação — 1 ação pendente/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sincronizar", exact: true })).toBeEnabled();
  state.reconnect();
  await page.getByRole("button", { name: "Sincronizar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Marcar como pronto", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("complementary",{name:"Conexão e ações do produtor"})).toHaveCount(0);
  await expect(page.getByText("Conectado",{exact:true})).toHaveCount(0);
  expect(state.posts).toHaveLength(1);
  expect(state.synchronized).toHaveLength(1);
  expect(state.synchronized[0].commands).toEqual([{
    commandId: state.posts[0].command,
    commandType: "order.transition",
    baseRevision: state.posts[0].body.expectedRevision,
    payload: { orderId: id(5), transition: state.posts[0].body },
  }]);
  expect(state.revision).toBe(2);
  await layout(page, state.errors);
});
test("HTTP 409 atualiza o painel sem avançar uma segunda etapa", async ({
  page,
}) => {
  const state = await mock(page);
  state.conflictNext();
  await page.goto("/produtor/pedidos");
  await page
    .getByRole("button", { name: "Iniciar preparo", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("outra sessão");
  await expect(
    page.getByRole("button", { name: "Marcar como pronto", exact: true }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(1);
});
test("rastreamento busca automaticamente a etapa nova e pausa quando oculto", async ({
  page,
}) => {
  const state = await mock(page, "consumer");
  await page.clock.install();
  await page.goto("/pedidos/" + id(5));
  await expect(
    page.locator('.order-timeline [aria-current="step"]'),
  ).toContainText("Pagamento confirmado");
  state.change("in_preparation");
  await page.clock.runFor(15001);
  await expect(
    page.locator('.order-timeline [aria-current="step"]'),
  ).toContainText("Em preparo");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = state.reads;
  state.change("out_for_delivery");
  await page.clock.runFor(30000);
  expect(state.reads).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.locator('.order-timeline [aria-current="step"]'),
  ).toContainText("Saiu para entrega");
  await layout(page, state.errors);
});
test("pedido de terceiro não exibe timeline ou endereço", async ({ page }) => {
  const state = await mock(page, "consumer");
  state.deny();
  await page.goto("/pedidos/" + id(5));
  await expect(page.getByRole("alert")).toContainText("não está disponível");
  await expect(page.locator(".order-timeline")).toHaveCount(0);
  await expect(page.getByText("Rua da Colheita")).toHaveCount(0);
});
test("visitante tem entrada segura e pagamento legado permanece com rota própria", async ({
  page,
}) => {
  const state = await mock(page, "consumer", false);
  for (const path of ["/pedidos", "/pedidos/" + id(5), "/produtor/pedidos"]) {
    await page.goto(path);
    await expect(
      page.getByRole("button", { name: /^Entrar/ }).last(),
    ).toBeVisible();
  }
  expect(state.posts).toHaveLength(0);
  await layout(page, state.errors);
});

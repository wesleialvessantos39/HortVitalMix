import { expect, test, type Page } from "@playwright/test";
import type { AdminSectorCode } from "../../shared/contracts/adminGovernance";

const at = "2026-10-09T02:00:00Z";
const id = (n: number) =>
  "11111111-1111-4111-8111-" + String(n).padStart(12, "0");
const cfg = {
  platformName: "HortiVitalMix",
  slogan: "Tudo fresco. Tudo da sua região.",
  defaultMunicipality: "Ariquemes",
  defaultState: "RO",
  currency: "BRL",
  timezone: "America/Porto_Velho",
  supportEmail: "suporte@example.test",
  supportPhone: null,
  revision: 7,
};
function finance(params: URLSearchParams, amount = 15000) {
  const view = params.get("view") ?? "payments",
    page = Number(params.get("page") ?? 1);
  return {
    generatedAt: at,
    view,
    period: {
      from: params.get("from") ?? "2026-09-09",
      to: params.get("to") ?? "2026-10-08",
    },
    pagination: { page, pageSize: 20, total: 21 },
    metrics: {
      approvedPayments: 8,
      approvedAmountCents: amount,
      heldAmountCents: 4000,
      releasedAmountCents: 7000,
    },
    payments:
      view === "payments"
        ? [
            {
              id: id(page),
              method: "pix",
              status: "approved",
              source: "online",
              amountCents: 5000,
              createdAt: at,
              expiresAt: "2026-10-09T02:15:00Z",
              orderCount: 1,
            },
          ]
        : [],
    orders:
      view === "orders"
        ? [
            {
              id: id(30 + page),
              orderNumber: "1501",
              storeName:
                "Loja de produção regional com nome completo para testar adaptação da tela",
              status: "confirmed",
              totalCents: 5000,
              holdState: "partially_refunded",
              retainedCents: 4000,
              refundedCents: 1000,
              createdAt: at,
              releaseAfter: "2026-10-16T02:00:00Z",
            },
          ]
        : [],
  };
}
function catalog(params: URLSearchParams) {
  const view = params.get("view") ?? "products",
    page = Number(params.get("page") ?? 1);
  return {
    generatedAt: at,
    view,
    pagination: {
      page,
      pageSize: 20,
      total: params.get("search") === "não existe" ? 0 : 21,
    },
    metrics: {
      publishedProducts: 12,
      draftProducts: 3,
      visibleProducts: 10,
      activeStores: 4,
      activeCategories: 6,
    },
    products:
      view === "products" && params.get("search") !== "não existe"
        ? [
            {
              id: id(page),
              title:
                "Hortaliças frescas da produção regional com nome completo e apresentação longa",
              storeName: "Loja regional da família produtora",
              categoryName: "Hortaliças folhosas",
              isPublished: true,
              isVisible: true,
              storeStatus: "active",
              categoryActive: true,
              priceCents: 1250,
              updatedAt: at,
            },
          ]
        : [],
    stores:
      view === "stores"
        ? [
            {
              id: id(40),
              name: "Loja regional da família produtora",
              slug: "loja-regional-da-familia-produtora",
              status: "active",
              isVisible: true,
              productCount: 12,
              publishedProductCount: 10,
              updatedAt: at,
            },
          ]
        : [],
    categories:
      view === "categories"
        ? [
            {
              id: id(50),
              name: "Hortaliças folhosas e produtos da agricultura regional",
              isActive: true,
              productCount: 15,
              publishedProductCount: 12,
            },
          ]
        : [],
  };
}
async function mock(
  page: Page,
  options: {
    role?: "platform_admin" | "platform_super_admin";
    sectors?: AdminSectorCode[];
    denied?: AdminSectorCode[];
    financeStatus?: () => number;
    financeAmount?: () => number;
    pending?: () => Promise<void> | undefined;
    requests?: string[];
  } = {},
) {
  const role = options.role ?? "platform_admin",
    sectors = options.sectors ?? ["finance_ops", "catalog_moderation"];
  await page.addInitScript(() =>
    localStorage.setItem(
      "hvm.admin.session",
      JSON.stringify({
        accessToken: "synthetic-operations",
        refreshToken: "synthetic-operations-refresh",
        expiresAt: Date.now() + 3600000,
        identityVersion: "synthetic-operations-identity",
      }),
    ),
  );
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace(/^\/(api|_hvm_api)/, "");
    if (!path.startsWith("/v1/")) return route.continue();
    if (path === "/v1/config") return route.fulfill({ json: cfg });
    if (path === "/v1/auth/session")
      return route.fulfill({
        json: {
          userId: id(99),
          fullName: "Pessoa Operações",
          email: "operations@example.test",
          activeRole: role,
          roles: [role],
          portalKind: "administrative",
        },
      });
    if (path === "/v1/admin/auth/verify-session")
      return route.fulfill({
        json: {
          authorized: true,
          role,
          sectors,
          deniedSectors: options.denied ?? [],
          requiresReauth: false,
        },
      });
    if (path === "/v1/admin/finance/overview") {
      options.requests?.push(path + url.search);
      await options.pending?.();
      const status = options.financeStatus?.() ?? 200;
      return route.fulfill({
        status,
        json:
          status === 200
            ? finance(url.searchParams, options.financeAmount?.())
            : {
                error: status === 403 ? "FORBIDDEN" : "DEPARTMENT_UNAVAILABLE",
              },
      });
    }
    if (path === "/v1/admin/catalog/overview") {
      options.requests?.push(path + url.search);
      return route.fulfill({ json: catalog(url.searchParams) });
    }
    if (path.includes("notifications"))
      return route.fulfill({
        json: {
          notifications: [],
          unreadCount: 0,
          total: 0,
          page: 1,
          pageSize: 20,
          asOf: at,
          hasMore: false,
        },
      });
    return route.fulfill({ json: {} });
  });
}

for (const width of [320, 390, 768, 1280, 1440])
  test(`financeiro e catálogo organizados sem transbordamento em ${width}px`, async ({
    page,
  }, info) => {
    await mock(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/admin/financeiro");
    await expect(
      page.getByRole("heading", { name: "Financeiro", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Pagamentos", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".admin-ops-metrics")).toContainText("R$ 150,00");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .locator(".admin-ops-tabs")
      .getByRole("button", { name: "Pedidos e retenções" })
      .click();
    await expect(
      page.getByRole("table", { name: "Pedidos e retenções", exact: true }),
    ).toBeVisible();
    expect(
      await page
        .locator(".admin-ops-table-wrap")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`financeiro-${width}.png`),
      fullPage: true,
    });
    await page.goto("/admin/catalogo");
    await expect(
      page.getByRole("heading", { name: "Catálogo", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Produtos do catálogo" }),
    ).toBeVisible();
    for (const [button, table] of [
      ["Lojas", "Lojas do catálogo"],
      ["Categorias", "Categorias do catálogo"],
      ["Produtos", "Produtos do catálogo"],
    ]) {
      await page
        .locator(".admin-ops-tabs")
        .getByRole("button", { name: button, exact: true })
        .click();
      await expect(page.getByRole("table", { name: table })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .locator(".admin-ops-table-wrap")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
    await expect(
      page.getByRole("button", { name: "Organizar categorias" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`catalogo-${width}.png`),
      fullPage: true,
    });
  });

test("catálogo aplica pesquisa/filtros e pagina mantendo a consulta", async ({
  page,
}) => {
  const requests: string[] = [];
  await mock(page, { requests });
  await page.goto("/admin/catalogo");
  await expect(
    page.getByRole("table", { name: "Produtos do catálogo" }),
  ).toBeVisible();
  await page.getByLabel("Buscar no catálogo").fill("hortaliças");
  await page
    .getByRole("combobox", { name: "Publicação", exact: true })
    .selectOption("published");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(
    page.getByRole("table", { name: "Produtos do catálogo" }),
  ).toBeVisible();
  await page.getByLabel("Próxima página").click();
  await expect(
    page.getByRole("navigation", { name: "Paginação do departamento" }),
  ).toContainText("Página 2 de 2");
  expect(requests.at(-1)).toContain("page=2");
  expect(requests.at(-1)).toContain("publication=published");
  expect(decodeURIComponent(requests.at(-1)!)).toContain("search=hortaliças");
  await page.getByLabel("Buscar no catálogo").fill("não existe");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(
    page.getByText(
      "Nenhum registro corresponde a esta busca e aos filtros selecionados.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Próxima página")).toBeDisabled();
  await expect(page.getByLabel("Página anterior")).toBeDisabled();
});

test("financeiro mantém filtros editados e dados durante atualização, sem inventar zeros em falha", async ({
  page,
}) => {
  let amount = 15000,
    status = 200;
  await mock(page, {
    financeAmount: () => amount,
    financeStatus: () => status,
  });
  await page.goto("/admin/financeiro");
  await expect(page.locator(".admin-ops-metrics")).toContainText("R$ 150,00");
  await page.getByLabel("Data inicial").fill("2026-10-01");
  amount = 23000;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("hvm:departments-changed")),
  );
  await expect(page.locator(".admin-ops-metrics")).toContainText("R$ 230,00");
  await expect(page.getByLabel("Data inicial")).toHaveValue("2026-10-01");
  status = 503;
  await page.getByLabel("Atualizar financeiro").click();
  await expect(page.getByRole("alert")).toContainText(
    "Exibindo a última consulta recebida",
  );
  await expect(page.locator(".admin-ops-metrics")).toContainText("R$ 230,00");
});

test("financeiro descarta dados quando o servidor retira o poder no meio da sessão", async ({
  page,
}) => {
  let status = 200;
  await mock(page, { financeStatus: () => status });
  await page.goto("/admin/financeiro");
  await expect(
    page.getByRole("table", { name: "Pagamentos", exact: true }),
  ).toBeVisible();
  status = 403;
  await page.getByLabel("Atualizar financeiro").click();
  await expect(page.getByRole("alert")).toContainText("Seu acesso mudou");
  await expect(page.locator(".admin-ops-metrics")).toHaveCount(0);
  await expect(
    page.getByRole("table", { name: "Pagamentos", exact: true }),
  ).toHaveCount(0);
});

test("consultas atualizam a cada 30 segundos enquanto a tela está aberta", async ({
  page,
}) => {
  let amount = 15000;
  await page.clock.install();
  await mock(page, { financeAmount: () => amount });
  await page.goto("/admin/financeiro");
  await expect(page.locator(".admin-ops-metrics")).toContainText("R$ 150,00");
  amount = 27000;
  await page.clock.fastForward(30_001);
  await expect(page.locator(".admin-ops-metrics")).toContainText("R$ 270,00");
});

test("estado inicial usa carregamento padrão e não oculta campos da consulta", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mock(page, { pending: () => pending });
  await page.goto("/admin/financeiro");
  await expect(page.getByLabel("Carregando financeiro")).toBeVisible();
  await expect(page.getByLabel("Data inicial")).toBeVisible();
  release();
  await expect(
    page.getByRole("table", { name: "Pagamentos", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Carregando financeiro")).toHaveCount(0);
});

test("poderes negados de Super não produzem chamadas de dados nem atalhos para departamento", async ({
  page,
}) => {
  const requests: string[] = [];
  await mock(page, {
    role: "platform_super_admin",
    denied: ["finance_ops", "catalog_moderation"],
    requests,
  });
  await page.goto("/admin/financeiro");
  await expect(page.getByText("Seu perfil não tem permissão para acessar esta área.")).toBeVisible();
  await expect(page.locator(".admin-ops-metrics")).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.goto("/admin/catalogo");
  await expect(page.getByText("Seu perfil não tem permissão para acessar esta área.")).toBeVisible();
  await expect(page.locator(".admin-ops-metrics")).toHaveCount(0);
  expect(requests).toEqual([]);
  await expect(
    page
      .locator(".admin-sidebar")
      .getByRole("button", { name: "Financeiro", exact: true }),
  ).toHaveCount(0);
});

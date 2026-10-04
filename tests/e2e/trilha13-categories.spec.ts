import { expect, test, type Page } from "@playwright/test";
import type { Category } from "../../shared/contracts/category";
const seed: Category[] = [
  ["hortalicas-folhosas", "Hortaliças folhosas", "leaf"],
  ["legumes-picados", "Legumes picados", "knife"],
  ["mix-prontos", "Mix prontos", "bowl"],
  ["temperos-e-ervas", "Temperos e ervas", "sparkles"],
  ["frutas", "Frutas", "sun"],
].map(([slug, name, icon], index) => ({
  id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
  parentId: null,
  slug,
  name,
  description: "Categoria da produção regional.",
  iconName: icon as Category["iconName"],
  displayOrder: index + 1,
  isActive: true,
  revision: 1,
}));
type Options = {
  admin?: boolean;
  role?: string;
  empty?: boolean;
  unavailable?: boolean;
  wait?: Promise<void>;
  conflict?: boolean;
  cycle?: boolean;
  reauth?: boolean;
  products?: number;
  children?: number;
  impactChanges?: boolean;
};
async function mock(page: Page, options: Options = {}) {
  let rows = options.empty ? [] : structuredClone(seed);
  let fail = Boolean(options.unavailable),
    conflict = Boolean(options.conflict),
    products = options.products ?? 0;
  const commands: Array<{
    path: string;
    method: string;
    body: Record<string, any>;
  }> = [];
  await page.route("**/*", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace(/^\/(?:api|_hvm_api)/, "");
    if (!path.startsWith("/v1/")) return route.continue();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body });
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
      return options.admin
        ? json({
            userId: seed[0].id,
            email: "admin@example.test",
            fullName: "Administrador Local",
            roles: [options.role ?? "platform_super_admin"],
            activeRole: options.role ?? "platform_super_admin",
            portalKind: "administrative",
          })
        : json({ error: "AUTH_REQUIRED" }, 401);
    if (path === "/v1/admin/auth/verify-session")
      return json({
        authorized: true,
        role: options.role ?? "platform_super_admin",
        sectors: ["document_verification"],
        requiresReauth: false,
      });
    if (path.startsWith("/v1/localities"))
      return json({ municipalities: [], activeMunicipalityIds: [] });
    if (path === "/v1/categories") {
      if (options.wait) await options.wait;
      if (fail) return json({ error: "DEPENDENCY_UNAVAILABLE" }, 503);
      return json({
        categories: rows
          .filter((category) => category.isActive)
          .map((category) => ({ ...category, children: [] })),
      });
    }
    if (path === "/v1/admin/categories" && request.method() === "GET")
      return fail
        ? json({ error: "DEPENDENCY_UNAVAILABLE" }, 503)
        : json({ categories: rows });
    if (path.endsWith("/impact")) {
      const id = path.split("/")[4],
        row = rows.find((category) => category.id === id)!;
      return json({
        categoryId: id,
        revision: row.revision,
        activeProducts: products,
        activeChildren: options.children ?? 0,
        requiresConfirmation: products > 0 || Boolean(options.children),
      });
    }
    if (path.startsWith("/v1/admin/categories") && request.method() !== "GET") {
      const body = request.postDataJSON();
      commands.push({ path, method: request.method(), body });
      if (options.reauth)
        return json({ error: "ADMIN_REAUTHENTICATION_REQUIRED" }, 401);
      if (options.cycle)
        return json({ error: "CATEGORY_CYCLE_FORBIDDEN" }, 422);
      if (conflict) {
        conflict = false;
        return json(
          { error: "CATEGORY_REVISION_CONFLICT", currentRevision: 2 },
          409,
        );
      }
      if (
        options.impactChanges &&
        path.endsWith("/deactivate") &&
        !body.confirmImpact
      ) {
        products = 2;
        return json({ error: "CATEGORY_IMPACT_CONFIRMATION_REQUIRED" }, 409);
      }
      if (path === "/v1/admin/categories") {
        const { commandId: _commandId, ...fields } = body;
        const category: Category = {
          ...fields,
          id: "22222222-2222-4222-8222-222222222222",
          isActive: true,
          revision: 1,
        };
        rows.push(category);
        return json({ category });
      }
      const id = path.split("/")[4],
        index = rows.findIndex((category) => category.id === id);
      const {
        commandId: _commandId,
        expectedRevision: _expectedRevision,
        confirmImpact: _confirmImpact,
        ...fields
      } = body;
      rows[index] = {
        ...rows[index],
        ...fields,
        revision: rows[index].revision + 1,
        ...(path.endsWith("/deactivate")
          ? { isActive: false }
          : path.endsWith("/reactivate")
            ? { isActive: true }
            : {}),
      };
      return json({ category: rows[index] });
    }
    return json({ producers: [], addresses: [] });
  });
  return {
    commands,
    recover: () => {
      fail = false;
    },
    deactivate: (id: string) => {
      rows = rows.map((row) =>
        row.id === id ? { ...row, isActive: false } : row,
      );
    },
  };
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

for (const width of [320, 390, 768, 1440]) {
  test(`T13 navegação pública responsiva em ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mock(page);
    await page.goto("/");
    const nav = page.getByRole("navigation", {
      name: "Categorias de produtos",
    });
    await expect(nav.getByRole("button")).toHaveCount(6);
    expect(await nav.getByRole("button").allTextContents()).toEqual([
      "Todos os produtos",
      ...seed.map((row) => row.name),
    ]);
    await expect(nav.locator("button svg")).toHaveCount(12);
    expect(
      await nav.evaluate((element) => getComputedStyle(element).display),
    ).toBe(width < 768 ? "flex" : "grid");
    if (width < 768) {
      await nav.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      expect(
        await nav.evaluate((element) => element.scrollLeft),
      ).toBeGreaterThan(0);
    }
    await nav.getByRole("button", { name: "Frutas", exact: true }).click();
    await expect(page).toHaveURL(/\/produtos$/);
    await expect(
      page.getByRole("heading", { name: "Frutas", exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`public-${width}.png`),
      fullPage: true,
    });
  });
  test(`T13 gestão e impacto responsivos em ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await mock(page, { admin: true });
    await page.goto("/admin/categorias");
    await expect(
      page.getByRole("heading", { name: "Categorias", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".hvm-category-list li")).toHaveCount(5);
    await noOverflow(page);
    await page
      .getByRole("button", { name: "Desativar Frutas", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Produtos ativos vinculados")).toBeVisible();
    await expect(dialog.locator("dd").first()).toHaveText("0");
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath(`admin-impact-${width}.png`),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });
}
test("T13 skeleton de carregamento sem categorias fictícias", async ({
  page,
}) => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mock(page, { wait });
  await page.goto("/");
  await expect(page.getByText("Carregando categorias…")).toBeVisible();
  await expect(page.locator(".hvm-category-skeleton")).toHaveCount(5);
  await expect(
    page.getByRole("button", { name: "Frutas", exact: true }),
  ).toHaveCount(0);
  release();
  await expect(
    page.getByRole("button", { name: "Frutas", exact: true }),
  ).toBeVisible();
});
test("T13 estado vazio e erro com nova tentativa", async ({ page }) => {
  const mockApi = await mock(page, { empty: true, unavailable: true });
  await page.goto("/");
  await expect(
    page.getByText(/Não foi possível atualizar as categorias/),
  ).toBeVisible();
  mockApi.recover();
  await page
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .click();
  await expect(
    page.getByText("Nenhuma categoria disponível no momento."),
  ).toBeVisible();
});
test("T13 primeira carga acontece mesmo em aba inicialmente oculta", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(document, "hidden", {
      get: () => true,
      configurable: true,
    }),
  );
  await mock(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Frutas", exact: true }),
  ).toBeVisible();
});
test("T13 categoria desativada some e seleção retorna a todos os produtos", async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Frutas", exact: true }).click();
  state.deactivate(seed[4].id);
  await page.evaluate(() => dispatchEvent(new Event("hvm:categories-changed")));
  await expect(
    page.getByRole("button", { name: "Frutas", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Todos os produtos", exact: true }),
  ).toBeVisible();
});
test("T13 Super Admin cria categoria com hierarquia, descrição e ícone", async ({
  page,
}) => {
  const state = await mock(page, { admin: true });
  await page.goto("/admin/categorias");
  await page.getByLabel("Nome", { exact: true }).fill("Raízes da estação");
  await expect(page.getByLabel("Slug", { exact: false })).toHaveValue(
    "raizes-da-estacao",
  );
  await page.getByLabel("Categoria superior").selectOption(seed[0].id);
  await page.getByLabel("Ícone").selectOption("carrot");
  await page
    .getByLabel("Descrição", { exact: false })
    .fill("Produção regional colhida fresca.");
  await page.getByLabel("Ordem de exibição").fill("6");
  await page
    .getByRole("button", { name: "Criar categoria", exact: true })
    .click();
  await expect(page.getByText(/Categoria salva/)).toBeVisible();
  expect(state.commands[0].body).toMatchObject({
    slug: "raizes-da-estacao",
    parentId: seed[0].id,
    iconName: "carrot",
    displayOrder: 6,
  });
  expect(state.commands[0].body.commandId).toMatch(/^[0-9a-f-]{36}$/);
});
test("T13 edição de slug autorizada e revisão enviada", async ({ page }) => {
  const state = await mock(page, { admin: true });
  await page.goto("/admin/categorias");
  await page
    .getByRole("button", { name: "Editar Frutas", exact: true })
    .click();
  await page.getByLabel("Slug", { exact: false }).fill("frutas-do-campo");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText(/Categoria salva/)).toBeVisible();
  expect(state.commands[0]).toMatchObject({
    method: "PATCH",
    body: { slug: "frutas-do-campo", expectedRevision: 1 },
  });
});
test("T13 conflito preserva formulário até recarregamento explícito", async ({
  page,
}) => {
  await mock(page, { admin: true, conflict: true });
  await page.goto("/admin/categorias");
  await page
    .getByRole("button", { name: "Editar Frutas", exact: true })
    .click();
  await page.getByLabel("Slug", { exact: false }).fill("frutas-em-edicao");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Sua edição foi preservada",
  );
  await expect(page.getByLabel("Slug", { exact: false })).toHaveValue(
    "frutas-em-edicao",
  );
  await page.getByRole("button", { name: "Recarregar categoria" }).click();
  await expect(page.getByLabel("Slug", { exact: false })).toHaveValue("frutas");
});
test("T13 ciclo é informado sem perder campos", async ({ page }) => {
  await mock(page, { admin: true, cycle: true });
  await page.goto("/admin/categorias");
  await page.getByLabel("Nome", { exact: true }).fill("Categoria com ciclo");
  await page.getByRole("button", { name: "Criar categoria" }).click();
  await expect(page.getByRole("alert")).toContainText("criaria um ciclo");
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue(
    "Categoria com ciclo",
  );
});
test("T13 desativação com impacto exige confirmação e permite reativação", async ({
  page,
}) => {
  const state = await mock(page, { admin: true, products: 3, children: 2 });
  await page.goto("/admin/categorias");
  await page
    .getByRole("button", { name: "Desativar Frutas", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Confirmar desativação" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Conferi o impacto e confirmo a desativação.")
    .check();
  await dialog.getByRole("button", { name: "Confirmar desativação" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reativar Frutas", exact: true }),
  ).toBeVisible();
  expect(state.commands[0].body.confirmImpact).toBe(true);
  await page
    .getByRole("button", { name: "Reativar Frutas", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Desativar Frutas", exact: true }),
  ).toBeVisible();
  expect(state.commands[1].body.expectedRevision).toBe(2);
});
test("T13 impacto alterado no envio requer nova confirmação", async ({
  page,
}) => {
  const state = await mock(page, { admin: true, impactChanges: true });
  await page.goto("/admin/categorias");
  await page
    .getByRole("button", { name: "Desativar Frutas", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Confirmar desativação" }).click();
  await expect(dialog.locator("dd").first()).toHaveText("2");
  await expect(
    dialog.getByRole("button", { name: "Confirmar desativação" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Conferi o impacto e confirmo a desativação.")
    .check();
  await dialog.getByRole("button", { name: "Confirmar desativação" }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.commands).toHaveLength(2);
});
test("T13 Administrador setorial não vê o atalho nem acessa a gestão", async ({
  page,
}) => {
  const state = await mock(page, { admin: true, role: "platform_admin" });
  await page.goto("/admin/painel");
  await expect(
    page.getByRole("button", { name: "Categorias", exact: true }),
  ).toHaveCount(0);
  await page.goto("/admin/categorias");
  await expect(
    page.getByText("Seu perfil não tem permissão para acessar esta área."),
  ).toBeVisible();
  expect(state.commands).toHaveLength(0);
});
test("T13 guia para reautenticação preserva a edição", async ({ page }) => {
  await mock(page, { admin: true, reauth: true });
  await page.goto("/admin/categorias");
  await page.getByLabel("Nome", { exact: true }).fill("Nova categoria");
  await page.getByRole("button", { name: "Criar categoria" }).click();
  await expect(
    page.getByRole("button", { name: "Confirmar sessão administrativa" }),
  ).toBeVisible();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue(
    "Nova categoria",
  );
});

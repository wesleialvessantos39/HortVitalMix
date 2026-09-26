import { expect, test } from "@playwright/test";

const session = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "consumidor@example.com",
  roles: ["consumer"],
  activeRole: "consumer",
  portalKind: "public",
};

function address(
  id: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `22222222-2222-4222-8222-${String(id).padStart(12, "0")}`,
    label: id === 1 ? "Casa" : "Trabalho",
    cep: String(76870000 + id).padStart(8, "0"),
    street: "Rua " + id,
    number: String(id),
    complement: null,
    neighborhood: id === 1 ? "Centro" : "Jardim",
    city: "Ariquemes",
    state: "RO",
    latitude: null,
    longitude: null,
    geocodingAccuracy: "none",
    deliveryNotes: null,
    isDefault: id === 1,
    isActive: true,
    lastUsedAt: null,
    revision: 1,
    createdAt: `2026-09-25T00:00:${String(id).padStart(2, "0")}.000Z`,
    updatedAt: `2026-09-25T00:00:${String(id).padStart(2, "0")}.000Z`,
    ...overrides,
  };
}

async function mockT07(
  page: import("@playwright/test").Page,
  initial = [address(1), address(2)],
  role = "consumer",
  requireReauth = false,
) {
  const addresses = [...initial] as ReturnType<typeof address>[];
  const mutations: unknown[] = [];
  let reauthenticated = !requireReauth;
  const loginPaths: string[] = [];

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.hostname === "tile.openstreetmap.org") {
      return route.fulfill({
        status: 204,
        contentType: "image/png",
        body: "",
      });
    }

    if (url.hostname === "viacep.com.br") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          cep: "76870-000",
          logradouro: "Rua das Hortas",
          bairro: "Centro",
          localidade: "Ariquemes",
          uf: "RO",
        }),
      });
    }

    if (!url.pathname.includes("/v1/")) {
      await route.continue();
      return;
    }

    const path = url.pathname.replace(/^\/(?:_hvm_api|api)/, "");
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (path === "/v1/auth/session") return json({ ...session, fullName: "Pessoa Cadastrada", roles: [role], activeRole: role });
    if (path === "/v1/admin/auth/verify-session") return json({ authorized: true, role, sectors: ["support"], requiresReauth: false });
    if (path === "/v1/admin/auth/login") {
      loginPaths.push(path);
      if (request.postDataJSON().portalRole !== role) return json({ error: "INVALID_CREDENTIALS" }, 401);
      reauthenticated = true;
      return json({ status: "session_created", role, sectors: [] });
    }
    if (path === "/v1/account/profile") {
      if (url.searchParams.get("export") === "1" && !reauthenticated) return json({ error: "RECENT_AUTH_REQUIRED" }, 401);
      return json({ fullName: "Pessoa Cadastrada", cpfMasked: "***.***.123-45", phone: "+5569999999999", email: session.email, revision: 1 });
    }
    if (path === "/v1/account/preferences") return json({ preferences: { marketingConsent: false, orderUpdatesChannel: "email", quietHoursEnabled: false, quietHoursStart: null, quietHoursEnd: null, revision: 1 }, consents: [] });
    if (path === "/v1/config")
      return json({
        platformName: "HortiVitalMix",
        slogan: "Tudo fresco. Tudo da sua região.",
        defaultMunicipality: "Ariquemes",
        defaultState: "RO",
        currency: "BRL",
        timezone: "America/Porto_Velho",
        supportEmail: "hortivitalmix@gmail.com",
        supportPhone: null,
        revision: 1,
      });

    if (path === "/v1/account/addresses" && method === "GET")
      return json({ addresses: addresses.filter((item) => item.isActive) });

    if (path === "/v1/account/addresses" && method === "POST") {
      const body = request.postDataJSON() as Record<string, any>;
      mutations.push(body);
      const next = address(addresses.length + 1, {
        ...body,
        id: `33333333-3333-4333-8333-${String(addresses.length + 1).padStart(12, "0")}`,
        cep: String(body.cep).replace(/\D/g, ""),
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        geocodingAccuracy:
          body.latitude !== undefined && body.longitude !== undefined
            ? "manual"
            : "none",
        deliveryNotes: body.deliveryNotes ?? null,
        isDefault: Boolean(body.isDefault) || addresses.length === 0,
        revision: 1,
      });
      if (next.isDefault) {
        for (const item of addresses) item.isDefault = false;
      }
      addresses.push(next);
      return json({ address: next }, 201);
    }

    const defaultMatch = path.match(
      /^\/v1\/account\/addresses\/([^/]+)\/default$/,
    );
    if (defaultMatch && method === "PATCH") {
      const target = addresses.find((item) => item.id === defaultMatch[1]);
      if (!target) return json({ error: "ADDRESS_NOT_FOUND" }, 404);
      for (const item of addresses) item.isDefault = false;
      target.isDefault = true;
      target.revision += 1;
      return json({ status: "updated", address: target });
    }

    const itemMatch = path.match(/^\/v1\/account\/addresses\/([^/]+)$/);
    if (itemMatch && method === "PATCH") {
      const target = addresses.find((item) => item.id === itemMatch[1]);
      if (!target) return json({ error: "ADDRESS_NOT_FOUND" }, 404);
      const body = request.postDataJSON() as Record<string, any>;
      mutations.push(body);
      Object.assign(target, {
        ...body,
        cep: body.cep
          ? String(body.cep).replace(/\D/g, "")
          : target.cep,
        deliveryNotes:
          body.deliveryNotes === undefined
            ? target.deliveryNotes
            : body.deliveryNotes,
        latitude:
          body.latitude === undefined ? target.latitude : body.latitude,
        longitude:
          body.longitude === undefined ? target.longitude : body.longitude,
        geocodingAccuracy:
          body.latitude !== undefined && body.longitude !== undefined
            ? "manual"
            : target.geocodingAccuracy,
        revision: target.revision + 1,
      });
      return json({ status: "updated", address: target });
    }

    if (itemMatch && method === "DELETE") {
      const index = addresses.findIndex((item) => item.id === itemMatch[1]);
      if (index < 0) return json({ error: "ADDRESS_NOT_FOUND" }, 404);
      const [removed] = addresses.splice(index, 1);
      if (removed.isDefault && addresses[0]) addresses[0].isDefault = true;
      return json({
        status: "deleted",
        mode: "hard",
        wasDefault: removed.isDefault,
        replacementDefaultId: addresses.find((item) => item.isDefault)?.id ?? null,
      });
    }

    return json({});
  });

  return { addresses, mutations, loginPaths };
}

test("conta e endereço vazio usam identidade pronta e uma única ação em mobile", async ({ page }) => {
  await mockT07(page, []);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/conta");
  await expect(page.getByRole("heading", { name: /Pessoa Cadastrada/ })).toBeVisible();
  await expect(page.getByText("Consumidor · consumidor@example.com")).toBeVisible();
  await expect(page.getByRole("button", { name: "Gerenciar meus endereços" })).toHaveCount(0);
  await expect(page.locator(".account-delivery-card")).toHaveCount(0);
  await page.goto("/conta/enderecos");
  await expect(page.getByRole("button", { name: "Adicionar um endereço" })).toHaveCount(1);
  await expect(page.locator(".address-state-empty button")).toHaveCount(0);
});

for (const role of ["platform_admin", "platform_super_admin"]) {
  test(`exportação confirma senha no portal correto: ${role}`, async ({ page }) => {
    const mocked = await mockT07(page, [], role, true);
    await page.goto("/admin/conta/privacidade");
    await page.getByRole("button", { name: "Exportar meus dados (JSON)" }).click();
    await page.getByLabel("Senha atual").fill("SenhaTeste#2026");
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Confirmar e exportar" }).click();
    expect((await downloaded).suggestedFilename()).toBe("hortivitalmix-meus-dados.json");
    expect(mocked.loginPaths).toEqual(["/v1/admin/auth/login"]);
    await expect(page).toHaveURL(/\/admin\/conta\/privacidade$/);
  });
  for (const width of [360, 1440]) {
    test(`conta administrativa permanece no portal: ${role} ${width}px`, async ({ page }) => {
      await mockT07(page, [], role);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/admin/painel");
      const shortcut = page.locator(".admin-action-grid").getByRole("button", { name: /Minha conta e privacidade/ });
      await expect(shortcut).toBeVisible();
      await shortcut.click();
      await expect(page).toHaveURL(/\/admin\/conta$/);
      await expect(page.locator(".admin-shell .account-hub")).toBeVisible();
      await page.screenshot({ path: `test-results/admin-account-${role}-${width}.png`, fullPage: true });
      await page.locator(".account-hub-grid").getByRole("button", { name: /^Perfil/ }).click();
      await expect(page).toHaveURL(/\/admin\/conta\/perfil$/);
      await expect(page.getByLabel("Nome completo")).toHaveValue("Pessoa Cadastrada");
      await page.getByRole("navigation", { name: "Seções da conta" }).getByRole("button", { name: "Preferências" }).click();
      await expect(page).toHaveURL(/\/admin\/conta\/preferencias$/);
      await expect(page.getByText("Avisos sobre seus pedidos")).toHaveCount(0);
      await page.getByRole("navigation", { name: "Seções da conta" }).getByRole("button", { name: "Privacidade" }).click();
      await expect(page.getByRole("button", { name: "Exportar meus dados (JSON)" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

test("produtor vê endereço pessoal sem convite de entrega ao consumidor", async ({ page }) => {
  await mockT07(page, [address(1)], "producer");
  await page.goto("/conta");
  await expect(page.getByText("Produtor · consumidor@example.com")).toBeVisible();
  await expect(page.getByText("Entrega para")).toHaveCount(0);
  await page.goto("/conta/enderecos");
  await expect(page.getByRole("heading", { name: "Endereços pessoais" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Adicionar novo endereço" })).toHaveCount(1);
});

test("rótulos rápidos e instruções de entrega são persistidos", async ({
  page,
}) => {
  const mocked = await mockT07(page);
  await page.goto("/conta/enderecos");
  await page.getByRole("button", { name: "Adicionar novo endereço" }).click();

  await page.getByRole("button", { name: "Trabalho", exact: true }).click();
  await page.getByLabel("CEP").fill("76870010");
  await page.getByLabel("Rua").fill("Rua Nova");
  await page.getByLabel("Número").fill("20");
  await page.getByLabel("Bairro").fill("Jardim");
  await page.getByLabel("Cidade").fill("Ariquemes");
  await page.getByLabel("UF").fill("RO");
  await page
    .getByLabel("Instruções para entrega")
    .fill("Portão branco, chamar no interfone");
  await page.getByRole("button", { name: "Salvar endereço" }).click();

  await expect(page.getByText("Portão branco, chamar no interfone")).toBeVisible();
  const body = mocked.mutations.at(-1) as Record<string, unknown>;
  expect(body.label).toBe("Trabalho");
  expect(body.deliveryNotes).toBe("Portão branco, chamar no interfone");
});

test("geolocalização do aparelho envia latitude e longitude como pin manual", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"], {
    origin: "http://127.0.0.1:3000",
  });
  await context.setGeolocation({ latitude: -9.9132, longitude: -63.0408 });
  const mocked = await mockT07(page);

  await page.goto("/conta/enderecos");
  await page.getByRole("button", { name: "Adicionar novo endereço" }).click();
  await page.getByLabel("CEP").fill("76870020");
  await page.getByLabel("Rua").fill("Rua Mapa");
  await page.getByLabel("Número").fill("30");
  await page.getByLabel("Bairro").fill("Setor 1");
  await page.getByLabel("Cidade").fill("Ariquemes");
  await page.getByLabel("UF").fill("RO");

  await page
    .getByRole("button", { name: "Usar minha localização atual" })
    .click();
  await expect(page.getByText(/Localização recebida/)).toBeVisible();
  await page.getByRole("button", { name: "Salvar endereço" }).click();

  const body = mocked.mutations.at(-1) as Record<string, number>;
  expect(body.latitude).toBeCloseTo(-9.9132, 4);
  expect(body.longitude).toBeCloseTo(-63.0408, 4);
});

test("troca de padrão sincroniza o cabeçalho de entrega", async ({ page }) => {
  await mockT07(page);
  await page.goto("/conta/enderecos");

  await page
    .locator(".address-card")
    .filter({ hasText: "Trabalho" })
    .getByRole("button", { name: "Tornar padrão" })
    .click();

  await expect(
    page.locator(".location-pill").getByText(
      "Entrega para: Jardim · Ariquemes/RO",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page
      .locator(".address-card")
      .filter({ hasText: "Trabalho" })
      .getByText("Padrão", { exact: true }),
  ).toBeVisible();
});

test("limite de dez endereços bloqueia novo cadastro com mensagem amigável", async ({
  page,
}) => {
  await mockT07(
    page,
    Array.from({ length: 10 }, (_, index) => address(index + 1)),
  );
  await page.goto("/conta/enderecos");

  await expect(
    page.getByText("Limite de 10 endereços atingido. Remova um.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Adicionar novo endereço" }),
  ).toBeDisabled();
});

test("endereços permanecem sem overflow nos cinco breakpoints oficiais", async ({
  page,
}) => {
  await mockT07(page);
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 360, height: 800 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/conta/enderecos");
    await expect(
      page.getByRole("heading", { name: "Seus locais de entrega", level: 2 }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, "overflow em " + viewport.width + "px").toBe(false);
  }
});

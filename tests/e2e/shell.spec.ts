import { test, expect } from "@playwright/test";

for (const width of [320, 360, 430, 768, 1024, 1440]) {
  test(`shell e cadastro em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });

    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Conectamos produtores",
    );

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);

    await expect(page.locator(".vite-error-overlay")).toHaveCount(0);

    const desktop = page.locator(".desktop-header");
    const mobile = page.locator(".mobile-header");
    const bottomNav = page.locator(".bottom-nav");

    if (width < 768) {
      await expect(mobile).toBeVisible();
      await expect(desktop).toBeHidden();
      await expect(bottomNav).toBeVisible();

      if (width === 360) {
        const paddingBottom = await bottomNav.evaluate(
          (element) => getComputedStyle(element).paddingBottom,
        );
        expect(Number.parseFloat(paddingBottom)).toBeGreaterThanOrEqual(7);
      }
    } else {
      await expect(desktop).toBeVisible();
      await expect(mobile).toBeHidden();
      await expect(bottomNav).toBeHidden();
    }

    if (width === 1024) {
      await expect(page.locator("aside")).toBeVisible();
      await expect(page.locator(".main-content")).toBeVisible();
    }

    if (width === 1440) {
      const layoutWidth = await page.locator(".layout").evaluate(
        (element) => element.getBoundingClientRect().width,
      );
      expect(layoutWidth).toBeLessThanOrEqual(1440);
    }

    await page.screenshot({
      path: `test-results/home-${width}.png`,
      fullPage: true,
    });

    await page.goto("/cadastro/produtor");

    await expect(
      page.getByRole("heading", { name: "Cadastro de produtor" }),
    ).toBeVisible();
    await expect(page.getByLabel("Nome de seu imóvel")).toBeVisible();

    const cpf = page.getByLabel("CPF");
    await cpf.fill("52998224725");
    await expect(cpf).toHaveValue("529.982.247-25");

    const phone = page.getByLabel("Celular com DDD");
    await expect(phone).toHaveAttribute("placeholder", "(00) 00000-0000");
    await phone.fill("69993810921");
    await expect(phone).toHaveValue("(69) 99381-0921");

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);

    expect(errors).toEqual([]);
  });
}

test("navegação, diálogo e indisponibilidade honesta", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page
    .getByRole("button", { name: "Selecionar localização", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.getByRole("button", { name: "Entendi" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();

  await page
    .getByRole("link", { name: "Produtos", exact: true })
    .first()
    .click();

  await expect(page).toHaveURL(/produtos/);
  await expect(
    page.getByText("O catálogo ainda não está disponível"),
  ).toBeVisible();
});

test("falha de config é não bloqueante e mantém navegação", async ({ page }) => {
  await page.route("**/api/v1/config", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "DB_UNAVAILABLE" }),
    });
  });

  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");

  await expect(page.getByText("Tudo fresco. Tudo da sua região.").first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page
    .getByRole("link", { name: "Produtos", exact: true })
    .first()
    .click();

  await expect(page).toHaveURL(/produtos/);
  await expect(
    page.getByText("O catálogo ainda não está disponível"),
  ).toBeVisible();
});

test("config pública válida atualiza slogan da shell", async ({ page }) => {
  await page.route("**/api/v1/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        platformName: "HortiVitalMix",
        slogan: "Slogan canônico de validação",
        defaultMunicipality: "Ariquemes",
        defaultState: "RO",
        currency: "BRL",
        timezone: "America/Porto_Velho",
        supportEmail: "hortivitalmix@gmail.com",
        supportPhone: null,
        revision: 1,
      }),
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByText("Slogan canônico de validação").first()).toBeVisible();
});


test("fluxos públicos de segurança estão acessíveis e responsivos", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/entrar");

  await page.getByRole("button", { name: "Esqueci minha senha" }).click();
  await expect(
    page.getByRole("heading", { name: "Recupere sua senha" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Voltar para entrar" }).click();
  await page.getByRole("button", { name: "Reenviar confirmação" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirme seu cadastro" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Voltar para entrar" }).click();
  await page.getByRole("button", { name: "Entrar com link ou código" }).click();
  await expect(
    page.getByRole("heading", { name: "Acesso por link ou código" }),
  ).toBeVisible();

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});

test("rotas diretas de recuperação preservam estado correto", async ({ page }) => {
  await page.goto("/recuperar-senha");
  await expect(
    page.getByRole("heading", { name: "Recupere sua senha" }),
  ).toBeVisible();

  await page.goto("/redefinir-senha");
  await expect(
    page.getByRole("heading", { name: "Defina sua nova senha" }),
  ).toBeVisible();

  await page.goto("/confirmar-contato");
  await expect(
    page.getByRole("heading", { name: "Confirme seu cadastro" }),
  ).toBeVisible();
});


test("login e cadastros usam telas separadas", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/entrar");
  await expect(page.getByRole("heading", { name: "Entrar no HortiVitalMix" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cadastro de consumidor/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cadastro de produtor/ })).toBeVisible();

  await page.goto("/cadastro/consumidor");
  await expect(
    page.getByRole("heading", { name: "Cadastro de consumidor" }),
  ).toBeVisible();
  await expect(page.getByLabel("Nome de seu imóvel")).toHaveCount(0);

  await page.goto("/cadastro/produtor");
  await expect(
    page.getByRole("heading", { name: "Cadastro de produtor" }),
  ).toBeVisible();
  await expect(page.getByLabel("Nome de seu imóvel")).toBeVisible();

  await page.goto("/acesso/administracao");
  await expect(page.getByRole("heading", { name: "Login administrativo" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Acesso administrativo — disponível futuramente" }),
  ).toBeDisabled();

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});

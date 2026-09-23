import { expect, test } from "@playwright/test";

const widths = [320, 390, 768, 1024, 1440] as const;

for (const width of widths) {
  test(`Trilha 03 — cadastro público separado e responsivo em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });

    await page.goto("/cadastro");

    await expect(
      page.getByRole("heading", { name: "Como você quer participar?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Cadastrar como Consumidor/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Cadastrar como Produtor/ }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: /Administrador/ }),
    ).toHaveCount(0);

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);

    await page.getByRole("button", { name: /Cadastrar como Consumidor/ }).click();
    await expect(page).toHaveURL(/\/cadastro\/consumidor$/);
    await expect(
      page.getByRole("heading", { name: "Cadastro de consumidor" }),
    ).toBeVisible();

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
  });
}

test("Trilha 03 — portal administrativo usa ponto de entrada independente", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/entrar");

  await expect(
    page.getByRole("heading", { name: "Gestão segura da plataforma." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Entrar na administração" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Entrar como Consumidor" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Entrar como Produtor" }),
  ).toHaveCount(0);

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});

test("Trilha 03 — seleção pública nunca oferece papel administrativo", async ({ page }) => {
  await page.goto("/cadastro");
  const text = await page.locator("main").innerText();

  expect(text).toContain("Cadastrar como Consumidor");
  expect(text).toContain("Cadastrar como Produtor");
  expect(text).not.toContain("Super administrador");
  expect(text).not.toContain("Entrar como Administrador");
});


test("Trilha 03 — home expõe cadastro e admin/entrar mostra somente Administração", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Conheça as opções de cadastro/ }).click();
  await expect(page).toHaveURL(/\/cadastro$/);
  await expect(page.getByRole("heading", { name: "Como você quer participar?" })).toBeVisible();

  await page.goto("/admin/entrar");
  await expect(
    page.getByRole("heading", { name: "Gestão segura da plataforma." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar como Consumidor" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Entrar como Produtor" })).toHaveCount(0);
});

import { test, expect } from "@playwright/test";
for (const width of [320, 360, 430, 768, 1024, 1440])
  test(`shell e cadastro em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
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
    await expect(
      page.locator(width < 768 ? ".mobile-header" : ".desktop-header"),
    ).toBeVisible();
    await page.screenshot({path: `test-results/home-${width}.png`,fullPage:true});
    await page.goto("/conta");
    await page.getByRole("button", { name: "Produtor", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Cadastro do produtor" }),
    ).toBeVisible();
    await expect(page.getByLabel("Nome da sua produção")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
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

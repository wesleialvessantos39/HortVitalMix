import { expect, test } from "@playwright/test";

for (const width of [320, 390, 430, 768, 1024, 1440]) {
  test(`Trilha 05 — login administrativo responsivo em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin/entrar");
    await expect(
      page.getByRole("heading", { name: "Gestão segura da plataforma." }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Entrar na administração" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
  });
}

test("Trilha 05 — bootstrap usa página dedicada", async ({ page }) => {
  await page.goto("/admin/bootstrap");
  await expect(
    page.getByRole("heading", { name: "Primeiro acesso administrativo" }),
  ).toBeVisible();
});

test("Trilha 05 — convite inválido não exibe ativação", async ({ page }) => {
  await page.goto("/admin/aceitar-convite");
  await expect(
    page.getByRole("heading", { name: "Este convite não está disponível" }),
  ).toBeVisible();
});


test("Trilha 05 — ajuda de governança abre, fecha por backdrop e Escape", async ({ page }) => {
  await page.goto("/admin/entrar");
  await page.getByRole("button", { name: "Saiba mais" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Saiba mais" }).click();
  await page.locator(".admin-help-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

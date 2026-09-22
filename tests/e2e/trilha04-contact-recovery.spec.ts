import { expect, test } from "@playwright/test";

for (const width of [320, 430, 768, 1024, 1440]) {
  test(`Trilha 04 — camada visual responsiva em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/recuperar-senha");
    await expect(page.getByRole("heading", { name: "Recuperar senha" })).toBeVisible();
    await expect(page.getByText("Volte para sua conta com segurança.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Consumidor/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("Trilha 04 — confirmação usa página própria e Supabase-only", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/confirmar-contato");
  await expect(page.getByRole("heading", { name: "Confirme seu e-mail" })).toBeVisible();
  await expect(page.getByText("Seu acesso protegido, sem complicação.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Consumidor/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Trilha 04 — redefinição inválida permanece em página visual própria", async ({ page }) => {
  await page.goto("/redefinir-senha");
  await expect(page.getByRole("heading", { name: "Definir nova senha" })).toBeVisible();
  await expect(page.getByText("Link inválido ou expirado")).toBeVisible();
  await expect(page.getByRole("button", { name: "Solicitar novo link" })).toBeVisible();
});

test("Trilha 04 — aliases mantêm as camadas visuais próprias", async ({ page }) => {
  await page.goto("/confirmarcontato");
  await expect(page.getByRole("heading", { name: "Confirme seu e-mail" })).toBeVisible();
  await page.goto("/redefinirsenha");
  await expect(page.getByRole("heading", { name: "Definir nova senha" })).toBeVisible();
});

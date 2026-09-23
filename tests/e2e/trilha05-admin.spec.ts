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


test("Trilha 05 — endpoint administrativo legado não cria sessão", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/admin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nao-existe@example.com",
        password: "SenhaInvalida#2026",
        portalRole: "platform_super_admin",
      }),
    });
    return {
      status: response.status,
      body: await response.json(),
      setCookieVisible: response.headers.has("set-cookie"),
    };
  });

  expect(result.status).toBe(409);
  expect(result.body).toEqual({
    error: "ADMIN_GOVERNANCE_LOGIN_REQUIRED",
    redirectTo: "/admin/entrar",
  });
  expect(result.setCookieVisible).toBe(false);
});


test("Trilha 05 — seletor administrativo conduz a telas de entrada distintas", async ({ page }) => {
  await page.goto("/administracao");

  await expect(
    page.getByRole("button", { name: "Entrar como Administrador" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Entrar como Super administrador" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Entrar como Administrador" }).click();
  await expect(page).toHaveURL(/\/entrar\/administrador$/);
  await expect(
    page.getByRole("heading", { name: "Entrar como Administrador." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Entrar como Administrador", exact: true }),
  ).toBeVisible();

  await page.goto("/administracao");
  await page.getByRole("button", { name: "Entrar como Super administrador" }).click();
  await expect(page).toHaveURL(/\/entrar\/super-administrador$/);
  await expect(
    page.getByRole("heading", { name: "Entrar como Super administrador." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Primeiro acesso do Super administrador" }),
  ).toBeVisible();
});

test("Trilha 05 — seletor administrativo expõe o estado protegido do bootstrap", async ({ page }) => {
  await page.goto("/administracao");
  await expect(page.locator(".admin-bootstrap-discovery")).toBeVisible();
  await expect(
    page.getByText(/configuração administrativa|Super administrador|Configuração inicial/i).first(),
  ).toBeVisible();
});

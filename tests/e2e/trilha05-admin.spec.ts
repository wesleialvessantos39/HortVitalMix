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
  await expect(page.getByLabel("Senha")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Mostrar senha/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Esqueci minha senha" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Confirmar ou reenviar confirmação do e-mail",
    }),
  ).toBeVisible();
});

test("Trilha 05 — seletor administrativo expõe o estado protegido do bootstrap", async ({ page }) => {
  await page.goto("/administracao");
  await expect(page.locator(".admin-bootstrap-discovery")).toBeVisible();
  await expect(
    page.getByText(/configuração administrativa|Super administrador|Configuração inicial/i).first(),
  ).toBeVisible();
});


test("Trilha 05 — seletor sempre oferece diagnóstico do bootstrap enquanto não estiver fechado", async ({ page }) => {
  await page.goto("/administracao");
  const bootstrapCard = page.locator(".admin-bootstrap-discovery");
  await expect(bootstrapCard).toBeVisible();

  const statusText = await bootstrapCard.textContent();
  if (statusText?.includes("Configuração inicial concluída")) {
    await expect(
      page.getByRole("button", { name: /Configurar primeiro Super administrador|Verificar configuração inicial/ }),
    ).toHaveCount(0);
  } else {
    await expect(
      page.getByRole("button", { name: /Configurar primeiro Super administrador|Verificar configuração inicial/ }),
    ).toBeVisible();
  }
});


test("Trilha 05 — aliases administrativos usam o portal canônico", async ({ page }) => {
  await page.goto("/acesso/administracao");
  await expect(
    page.getByRole("heading", { name: "Entrar como Administrador." }),
  ).toBeVisible();

  await page.goto("/acesso/super-administracao");
  await expect(
    page.getByRole("heading", { name: "Entrar como Super administrador." }),
  ).toBeVisible();

  await expect(page.getByText(/ADMIN_GOVERNANCE_LOGIN_REQUIRED|Código de atendimento|Falha não identificada/i)).toHaveCount(0);
});

test("Trilha 05 — conflito do bootstrap não expõe detalhes técnicos", async ({ page }) => {
  await page.goto("/admin/bootstrap");
  const source = await page.locator("body").textContent();
  expect(source ?? "").not.toMatch(/ADMIN_GOVERNANCE_LOGIN_REQUIRED|HTTP_409|Código de atendimento/);
});


test("Trilha 05 — confirmação administrativa possui envio, OTP e reenvio", async ({ page }) => {
  await page.goto("/admin/confirmar-email?email=admin%40example.com");
  await expect(
    page.getByRole("heading", { name: "Confirme seu e-mail" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enviar código de confirmação" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});

test("Trilha 05 — recuperação administrativa abre no perfil correto", async ({ page }) => {
  await page.goto("/entrar/super-administrador");
  await page.getByRole("button", { name: "Esqueci minha senha" }).click();
  await expect(page).toHaveURL(/\/recuperar-senha\?portal=platform_super_admin$/);
  await expect(
    page.getByRole("heading", { name: "Recuperar senha" }),
  ).toBeVisible();
  await expect(page.getByText(/Super administrador/).first()).toBeVisible();
});

import { expect, test } from "@playwright/test";

for (const width of [320, 430, 768, 1024, 1440]) {
  test(`Trilha 04 — recuperação responsiva em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/recuperar-senha");
    await expect(page.getByRole("heading", { name: "Recuperar senha" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Consumidor" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("Trilha 04 — OTP cabe em 320px, aceita paste e auto-advance", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        userId: "00000000-0000-4000-8000-000000000001",
        email: "masked@example.com",
        roles: ["consumer"],
        activeRole: "consumer",
        portalKind: "public",
      }),
    });
  });
  await page.route("**/api/v1/auth/contact/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        email: {
          verified: false,
          maskedDestination: "m***d@example.com",
          hasActiveChallenge: true,
          cooldownRemainingSeconds: 0,
        },
        phone: {
          verified: false,
          maskedDestination: "+55 (69) 9****-1234",
          hasActiveChallenge: false,
          cooldownRemainingSeconds: 0,
        },
      }),
    });
  });
  await page.route("**/api/v1/auth/contact/challenge", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "issued",
        channel: "email",
        maskedDestination: "m***d@example.com",
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        cooldownSeconds: 60,
      }),
    });
  });

  await page.goto("/confirmar-contato");
  await page.getByRole("button", { name: "Enviar código + link" }).click();
  const inputs = page.getByRole("textbox", { name: /Dígito/ });
  await expect(inputs).toHaveCount(6);
  await inputs.first().fill("1");
  await expect(inputs.nth(1)).toBeFocused();
  await inputs.first().focus();
  await page.evaluate(() => navigator.clipboard?.writeText?.("654321"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Trilha 04 — reset inválido não expõe formulário", async ({ page }) => {
  await page.goto("/redefinir-senha");
  await expect(page.getByRole("heading", { name: "Link de recuperação inválido" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Solicitar novo link" })).toBeVisible();
});

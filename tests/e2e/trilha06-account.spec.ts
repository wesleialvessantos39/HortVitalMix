import { expect, test } from "@playwright/test";

const session = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "consumidor@example.com",
  roles: ["consumer"],
  activeRole: "consumer",
  portalKind: "public",
};
const profile = {
  fullName: "Pessoa Consumidora",
  cpfMasked: "***.***.123-45",
  email: "consumidor@example.com",
  phone: "+5569999999999",
  revision: 1,
};
const address = {
  id: "22222222-2222-4222-8222-222222222222",
  label: "Casa",
  cep: "76870000",
  street: "Rua das Hortas",
  number: "10",
  complement: null,
  neighborhood: "Centro",
  city: "Ariquemes",
  state: "RO",
  isDefault: true,
  revision: 1,
  createdAt: "2026-09-24T20:00:00.000Z",
  updatedAt: "2026-09-24T20:00:00.000Z",
};

async function mockAccount(page: import("@playwright/test").Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("/v1/")) {
      await route.continue();
      return;
    }
    const path = url.pathname.replace(/^\/(?:_hvm_api|api)/, "");
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/v1/auth/session") return json(session);
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
    if (path === "/v1/account/profile") return json(profile);
    if (path === "/v1/account/addresses")
      return json({ addresses: [address] });
    if (path === "/v1/account/preferences")
      return json({
        preferences: {
          marketingConsent: false,
          orderUpdatesChannel: "both",
          quietHoursEnabled: false,
          quietHoursStart: null,
          quietHoursEnd: null,
          revision: 1,
        },
        consents: [],
      });
    return json({});
  });
}

for (const viewport of [
  { width: 320, height: 720 },
  { width: 360, height: 800 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 },
]) {
  test("T06 sem overflow em " + viewport.width + "px", async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockAccount(page);
    await page.goto("/conta");
    await expect(page.getByText("Minha conta").first()).toBeVisible();
    await expect(page.getByText("Centro · Ariquemes/RO").first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
}

test("T06 expõe as quatro áreas da conta", async ({ page }) => {
  await mockAccount(page);
  for (const [route, heading] of [
    ["/conta/perfil", "Perfil"],
    ["/conta/enderecos", "Endereços"],
    ["/conta/preferencias", "Preferências"],
    ["/conta/privacidade", "Privacidade"],
  ]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("T06 abre cadastro de endereço como bottom sheet no mobile", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockAccount(page);
  await page.goto("/conta/enderecos");
  await page.getByRole("button", { name: "Novo endereço" }).click();
  await expect(page.getByRole("heading", { name: "Novo endereço" })).toBeVisible();
  const position = await page.locator(".account-sheet-backdrop").evaluate(
    (element) => getComputedStyle(element).placeItems,
  );
  expect(position).toContain("end");
});

import { test, expect } from "@playwright/test";
async function base(page: import("@playwright/test").Page) {
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path.endsWith("/v1/auth/session"))
      return json({ error: "SESSION_REQUIRED" }, 401);
    if (path.endsWith("/v1/config"))
      return json({
        platformName: "HortiVitalMix",
        slogan: "Tudo fresco. Tudo da sua região.",
        defaultMunicipality: "Ariquemes",
        defaultState: "RO",
        currency: "BRL",
        timezone: "America/Porto_Velho",
        supportEmail: "support@example.com",
        supportPhone: null,
        revision: 1,
      });
    return route.continue();
  });
}
test("confirmation recognizes identity once and opens the correct password login", async ({
  page,
}) => {
  await base(page);
  let calls = 0;
  await page.route("**/v1/auth/confirmation", (route) => {
    calls++;
    return route.fulfill({
      json: {
        status: "confirmed",
        fullName: "Pessoa Cadastrada",
        email: "person@example.com",
        role: "producer",
      },
    });
  });
  await page.goto(
    "/confirmar-contato?portal=producer&context=signed-proof#error_code=otp_expired",
  );
  await expect(
    page.getByRole("heading", { name: "Boas-vindas, Pessoa Cadastrada!" }),
  ).toBeVisible();
  expect(calls).toBe(1);
  await expect(
    page.getByRole("button", { name: "Reenviar confirmação" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page).toHaveURL(/entrar\/produtor/);
  await expect(page.getByLabel("E-mail", { exact: true })).toHaveValue(
    "person@example.com",
  );
  await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
});
test("pending signed link resends in place without asking email again", async ({
  page,
}) => {
  await base(page);
  let resent = false;
  await page.route("**/v1/auth/confirmation", (route) => {
    const body = route.request().postDataJSON();
    resent = resent || body.resend === true;
    return route.fulfill({
      json: { status: body.resend ? "sent" : "pending", role: "consumer" },
    });
  });
  await page.goto("/confirmar-contato?portal=consumer&context=signed-proof");
  await page.getByRole("button", { name: "Reenviar confirmação" }).click();
  expect(resent).toBe(true);
  await expect(page.getByLabel("E-mail do cadastro")).toHaveCount(0);
  await expect(page.getByText(/Solicitação recebida/)).toBeVisible();
});
test("temporary failure is recoverable and does not claim expiration", async ({
  page,
}) => {
  await base(page);
  await page.route("**/v1/auth/confirmation", (route) =>
    route.fulfill({ status: 503, json: { error: "DEPENDENCY_UNAVAILABLE" } }),
  );
  await page.goto("/confirmar-contato?portal=producer&context=signed-proof");
  await expect(
    page.getByText(/isso não significa que o link expirou/),
  ).toBeVisible();
});
test("super admin can block public identities", async ({
  page,
}) => {
  await base(page);
  await page.route("**/v1/admin/auth/verify-session", (r) =>
    r.fulfill({
      json: {
        authorized: true,
        role: "platform_super_admin",
        sectors: [],
        requiresReauth: false,
      },
    }),
  );
  await page.route("**/v1/admin/users", (r) =>
    r.fulfill({
      json: {
        users: [
          {
            id: "public-1",
            status: "active",
            full_name: "Produtor Cadastrado",
            email_normalized: "prod@example.com",
            role_code: null,
            account_kind: "public",
            email_confirmed: true,
            sectors: [],
            public_roles: ["producer"],
          },
        ],
      },
    }),
  );
  await page.goto("/admin/usuarios");
  await expect(page.getByText("Produtor Cadastrado")).toBeVisible();
  await expect(page.getByRole("button", { name: "Bloquear" })).toHaveCount(1);
  await page.getByRole("button",{name:"Bloquear",exact:true}).click();
  await page.getByLabel("Tipo de bloqueio").selectOption("custom");
  await expect(page.getByLabel("Início",{exact:true})).toBeVisible();
  await expect(page.getByLabel("Término",{exact:true})).toBeVisible();
  await page.screenshot({path:"/tmp/hvm-account-block-form.png",fullPage:true});
});
test("submitted properties are visible and review uses revision and command id", async ({
  page,
}) => {
  await base(page);
  await page.route("**/v1/admin/auth/verify-session", (r) =>
    r.fulfill({
      json: {
        authorized: true,
        role: "platform_super_admin",
        sectors: [],
        requiresReauth: false,
      },
    }),
  );
  let verified = false;
  await page.route("**/v1/admin/rural-properties", (r) =>
    r.fulfill({
      json: {
        properties: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            revision: 3,
            status: verified ? "verified" : "submitted",
            property_name: "Imóvel enviado",
            producer_name: "Produtor",
            municipality: "Ariquemes",
            line_vicinal: "Linha 1",
            total_area_hectares: "10",
            cultivated_area_hectares: "4",
            water_source: "poco_artesiano",
            irrigation_system: "gotejamento",
            activity: null,
          },
        ],
      },
    }),
  );
  await page.route("**/rural-properties/*/review", (r) => {
    expect(r.request().postDataJSON()).toMatchObject({
      decision: "verified",
      expectedRevision: 3,
      commandId: expect.any(String),
    });
    verified = true;
    return r.fulfill({ json: { status: "verified" } });
  });
  await page.goto("/admin/imoveis");
  await expect(page.getByText("Imóvel enviado")).toBeVisible();
  await page.getByRole("button", { name: "Validar imóvel" }).click();
  await expect(
    page.getByText("Imóvel validado.", { exact: true }),
  ).toBeVisible();
});

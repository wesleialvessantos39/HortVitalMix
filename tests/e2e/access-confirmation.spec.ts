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
test("property alias uses the canonical queue and archives approvals as read only", async ({
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
  const id = "22222222-2222-4222-8222-222222222222";
  const opinion = "Documentos e checklists conferidos nesta análise.";
  const commandIds: string[] = [];
  const visitedTabs: string[] = [];
  let status = "pending";
  await page.route("**/v1/admin/verification-queue**", (r) => {
    const url = new URL(r.request().url());
    if (r.request().method() === "GET") {
      const tab = url.searchParams.get("tab")!;
      visitedTabs.push(tab);
      expect(tab).toBe(
        status === "approved" ? "archived" : status === "pending" ? "pending" : "in_review",
      );
      return r.fulfill({ json: { requests: [{
        id, status, property_name: "Imóvel enviado", producer_name: "Produtor",
        municipality: "Ariquemes", line_vicinal: "Linha 1",
        total_area_hectares: "10", cultivated_area_hectares: "4",
        latitude_sede: null, longitude_sede: null, draft_data: null,
        perimeter: null, documents: [], extraction: null,
        last_decision: status === "approved" ? {
          decision: "approved", technical_opinion: opinion,
          decided_at: "2026-10-06T10:00:00Z", checklist_environmental_ok: true,
          checklist_land_tenure_ok: true, checklist_water_quality_ok: true,
        } : null,
      }] } });
    }
    expect(r.request().method()).toBe("POST");
    const body = r.request().postDataJSON();
    expect(body.commandId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    commandIds.push(body.commandId);
    if (url.pathname.endsWith(`/${id}/claim`)) {
      expect(status).toBe("pending");
      expect(Object.keys(body)).toEqual(["commandId"]);
      status = "in_review";
    } else {
      expect(url.pathname.replace(/^\/(?:api|_hvm_api)/, "")).toBe(`/v1/admin/verification-queue/${id}/decide`);
      expect(status).toBe("in_review");
      expect(body).toEqual({
        commandId: expect.any(String), decision: "approved", technicalOpinion: opinion,
        assignedTrustLevel: 3, checklistEnvironmentalOk: true,
        checklistLandTenureOk: true, checklistWaterQualityOk: true,
      });
      status = "approved";
    }
    return r.fulfill({ json: { status } });
  });
  await page.goto("/admin/imoveis");
  await page.getByRole("button", { name: /Imóvel enviado/ }).click();
  await page.getByRole("button", { name: "Colocar em análise", exact: true }).click();
  const approve = page.getByRole("button", { name: "Aprovar imóvel", exact: true });
  await expect(approve).toBeDisabled();
  await page.getByLabel("CAR regular sem sobreposições").check();
  await page.getByLabel("Posse ou CCIR regular").check();
  await page.getByLabel("Laudo de água potável / irrigação").check();
  await expect(approve).toBeDisabled();
  await page.getByLabel("Parecer técnico para o produtor").fill(opinion);
  await approve.click();
  await expect(page.getByText(/Imóvel aprovado e arquivado em modo somente leitura/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Arquivados" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: /Imóvel enviado/ }).click();
  await expect(page.getByText("Aprovado · somente leitura", { exact: true })).toBeVisible();
  await expect(page.getByText(opinion, { exact: true })).toBeVisible();
  await expect(approve).toHaveCount(0);
  expect(commandIds).toHaveLength(2);
  expect(new Set(commandIds).size).toBe(2);
  expect(visitedTabs).toEqual(expect.arrayContaining(["pending", "in_review", "archived"]));
});

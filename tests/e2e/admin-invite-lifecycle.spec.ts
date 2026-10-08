import { expect, test, type Page } from "@playwright/test";
import type { InviteResponse } from "../../shared/contracts/adminGovernance";
const actorId = "11111111-1111-4111-8111-111111111111";
const pendingId = "22222222-2222-4222-8222-222222222222";
const acceptedId = "33333333-3333-4333-8333-333333333333";
const email = "administrador.com.endereco.extenso@example.invalid";
const sector = {
  code: "catalog_moderation",
  name: "Moderação do catálogo",
  description: "Revisão do catálogo e produtos",
};
const makeInvite = (id: string, isAccepted = false): InviteResponse => ({
  id,
  email,
  isAccepted,
  invitedBy: actorId,
  targetRole: "platform_admin",
  identityMode: "new",
  sectors: [sector.code as "catalog_moderation"],
  revision: 1,
  createdAt: "2026-10-08T00:00:00.000Z",
  expiresAt: "2099-10-09T00:00:00.000Z",
  invalidatedAt: null,
});
async function mock(
  page: Page,
  inviteRole = "platform_admin",
  acceptance = false,
) {
  let invites = [makeInvite(pendingId), makeInvite(acceptedId, true)];
  const commands: Array<{ method: string; path: string; body: any }> = [];
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      /^\/(api|_hvm_api)/,
      "",
    );
    if (!path.startsWith("/v1/")) return route.continue();
    const method = route.request().method();
    const body = method === "GET" ? null : route.request().postDataJSON();
    const json = (value: unknown, status = 200) =>
      route.fulfill({ json: value, status });
    if (method !== "GET") commands.push({ method, path, body });
    if (path === "/v1/auth/session")
      return acceptance
        ? json({ error: "UNAUTHORIZED" }, 401)
        : json({
            userId: actorId,
            email: "gestor@example.invalid",
            fullName: "Gestor Teste",
            roles: ["platform_super_admin"],
            activeRole: "platform_super_admin",
            portalKind: "administrative",
          });
    if (path === "/v1/admin/auth/verify-session")
      return json({
        authorized: true,
        role: "platform_super_admin",
        sectors: [sector.code],
        deniedSectors: [],
        requiresReauth: false,
      });
    if (path === "/v1/config")
      return json({
        platformName: "HortiVitalMix",
        slogan: "Alimentos frescos perto de você.",
        defaultMunicipality: "Ariquemes",
        defaultState: "RO",
        currency: "BRL",
        timezone: "America/Porto_Velho",
        supportEmail: "support@example.invalid",
        supportPhone: null,
        revision: 1,
      });
    if (path === "/v1/admin/sectors") return json({ sectors: [sector] });
    if (path === "/v1/admin/invites/validate")
      return json({
        status: "valid",
        email,
        targetRole: inviteRole,
        identityMode: "new",
        existingRoles: [],
        sectors: inviteRole === "platform_admin" ? [sector.code] : [],
        expiresAt: "2099-10-09T00:00:00.000Z",
      });
    if (path === "/v1/admin/invites/clear-history") {
      const count = invites.filter((i) => i.isAccepted).length;
      invites = invites.filter((i) => !i.isAccepted);
      return json({ status: "cleared", count });
    }
    if (path === "/v1/admin/invites" && method === "POST") {
      const invite = {
        ...makeInvite("44444444-4444-4444-8444-444444444444"),
        email: body.email,
      };
      invites.unshift(invite);
      return json({ status: "created", invite }, 201);
    }
    if (path.startsWith("/v1/admin/invites/") && method === "DELETE") {
      invites = invites.filter((i) => i.id !== path.split("/").at(-1));
      return json({ status: "deleted" });
    }
    if (path === "/v1/admin/invites") return json({ invites });
    return json({});
  });
  return commands;
}
for (const width of [320, 390, 1440]) {
  test(`convites: excluir, reenviar e limpar histórico em ${width}px`, async ({
    page,
  }) => {
    const commands = await mock(page);
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/admin/governanca");
    await expect(
      page.getByRole("heading", { name: "Convites administrativos" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Excluir convite para ${email}` }),
    ).toHaveCount(2);
    await page
      .getByRole("button", { name: `Excluir convite para ${email}` })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Excluir convite", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Você já pode enviar" }),
    ).toBeVisible();
    expect(commands[0]).toMatchObject({
      method: "DELETE",
      path: `/v1/admin/invites/${pendingId}`,
      body: { expectedRevision: 1 },
    });
    await page.getByLabel("E-mail administrativo").fill(email);
    await page.getByRole("checkbox", { name: /Moderação do catálogo/ }).check();
    await page
      .getByRole("button", { name: "Enviar convite", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Convite enviado" }),
    ).toBeVisible();
    expect(
      commands.find(
        (i) => i.method === "POST" && i.path === "/v1/admin/invites",
      )?.body.email,
    ).toBe(email);
    await page
      .getByRole("button", { name: "Limpar histórico", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Limpar histórico", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "1 convite(s)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Excluir convite para ${email}` }),
    ).toHaveCount(1);
    await expect(page.getByText("Pendente", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/auditoria/convites-${width}.png`,
      fullPage: true,
    });
  });
}
test("resposta antiga da atualização não restaura convite excluído", async ({ page }) => {
  await mock(page);
  await page.goto("/admin/governanca");
  await expect(page.getByRole("button", { name: `Excluir convite para ${email}` })).toHaveCount(2);
  let resume!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  const requested = new Promise<void>((resolve) => { started = resolve; });
  let delayed = false;
  await page.route("**/v1/admin/invites", async (route) => {
    if (route.request().method() !== "GET" || delayed) return route.fallback();
    delayed = true;
    started();
    await gate;
    return route.fulfill({ json: { invites: [makeInvite(pendingId), makeInvite(acceptedId, true)] } });
  });
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await requested;
  await page.getByRole("button", { name: `Excluir convite para ${email}` }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Excluir convite", exact: true }).click();
  await expect(page.getByRole("button", { name: `Excluir convite para ${email}` })).toHaveCount(1);
  resume();
  await expect(page.getByRole("button", { name: "Atualizar", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: `Excluir convite para ${email}` })).toHaveCount(1);
});

for (const role of ["platform_admin", "platform_super_admin"]) {
  for (const width of [320, 390, 1440]) {
    test(`aceite distingue ${role} em ${width}px`, async ({ page }) => {
      await mock(page, role, true);
      await page.setViewportSize({ width, height: 850 });
      await page.goto("/admin/aceitar-convite?token=" + "a".repeat(64));
      await expect(
        page.getByRole("heading", { name: "Conclua seu cadastro" }),
      ).toBeVisible();
      await expect(
        page.getByText(
          role === "platform_super_admin"
            ? "Gestão da plataforma"
            : "Administração por setores",
          { exact: true },
        ),
      ).toBeVisible();
      expect(
        await page
          .locator(".admin-invite-accept")
          .evaluate((node) => node.classList.contains("is-super")),
      ).toBe(role === "platform_super_admin");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width === 390)
        await page.screenshot({
          path: `artifacts/auditoria/aceite-${role}-390.png`,
          fullPage: true,
        });
    });
  }
}

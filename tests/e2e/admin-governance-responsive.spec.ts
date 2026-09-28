import { test, expect, type Page } from "@playwright/test";
const id = "22222222-2222-4222-8222-222222222222";
const fullName =
  "Pessoa com nome extenso para validar a apresentação administrativa";
const config = {
  platformName: "HortiVitalMix",
  slogan: "Alimentos frescos perto de você.",
  defaultMunicipality: "Ariquemes",
  defaultState: "RO",
  currency: "BRL",
  timezone: "America/Porto_Velho",
  supportEmail: "support@example.invalid",
  supportPhone: null,
  revision: 1,
};
async function mock(page: Page, role: string) {
  const commands: Array<{ path: string; body: any }> = [];
  let status = "active";
  let reviews = true;
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      /^\/(api|_hvm_api)/,
      "",
    );
    if (!path.startsWith("/v1/")) return route.continue();
    const json = (body: unknown, code = 200) =>
      route.fulfill({ status: code, json: body });
    if (route.request().method() !== "GET") {
      const body = route.request().postDataJSON();
      commands.push({ path, body });
      if (path.endsWith("/status")) status = body.status;
      if (path.endsWith("/delete")) status = "deleted";
      if (path.endsWith("/decision")) reviews = false;
      return json({ status: "updated" });
    }
    if (path === "/v1/auth/session")
      return json({
        userId: id,
        email: "test@example.invalid",
        fullName,
        roles: [role],
        activeRole: role,
        portalKind: "administrative",
      });
    if (path === "/v1/admin/auth/verify-session")
      return json({
        authorized: true,
        role,
        sectors: ["document_verification"],
        requiresReauth: false,
      });
    if (path === "/v1/config") return json(config);
    if (path === "/v1/admin/configuration")
      return json({
        ...config,
        updatedAt: "2026-09-27T00:00:00Z",
        updatedBy: null,
      });
    if (path === "/v1/admin/users")
      return json({
        users: [
          {
            id,
            status,
            stored_status: status,
            full_name: fullName,
            email_normalized:
              "emailmuitolongo.paraverificarquebradelinha@example.invalid",
            role_code: null,
            account_kind: "public",
            email_confirmed: true,
            sectors: [],
            public_roles: ["consumer", "producer"],
          },
        ],
      });
    if (path === "/v1/admin/registration-reviews")
      return json({
        reviews: reviews
          ? [
              {
                id,
                user_id: id,
                full_name: fullName,
                email_normalized: "novo@example.invalid",
                reasons: ["name"],
                created_at: "2026-09-27T00:00:00Z",
              },
            ]
          : [],
      });
    if (path === "/v1/admin/sectors")
      return json({
        sectors: [
          {
            code: "document_verification",
            name: "Verificação documental",
            description: "Análise de documentos",
          },
        ],
      });
    if (path === "/v1/admin/invites")
      return json({
        invites: [
          {
            id,
            email: "administrador@example.invalid",
            targetRole: "platform_admin",
            identityMode: "existing",
            sectors: ["document_verification"],
            isAccepted: true,
            expiresAt: "2026-09-27T00:00:00Z",
          },
        ],
      });
    if (path === "/v1/admin/rural-properties")
      return json({
        properties: [
          {
            id,
            revision: 1,
            status: "submitted",
            property_name: "Propriedade rural com nome extenso",
            producer_name: fullName,
            municipality: "Ariquemes",
            line_vicinal: "Linha C-65",
            total_area_hectares: "12",
            cultivated_area_hectares: "5",
            water_source: "poco_artesiano",
            irrigation_system: "gotejamento",
            access_directions: "Terceira porteira à direita",
            activity: null,
          },
        ],
      });
    if (path === "/v1/account/profile")
      return json({
        fullName,
        email: "test@example.invalid",
        phone: "+5500000000000",
        revision: 1,
      });
    if (path === "/v1/account/addresses") return json({ addresses: [] });
    if (path === "/v1/account/preferences")
      return json({
        preferences: {
          revision: 1,
          locale: "pt-BR",
          timezone: "America/Porto_Velho",
        },
        consents: [],
      });
    return json({});
  });
  return commands;
}
for (const role of ["platform_admin", "platform_super_admin"])
  for (const width of [320, 390, 768, 1024, 1440])
    test(`${role}: populated administrative screens at ${width}px`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await mock(page, role);
      await page.setViewportSize({ width, height: 900 });
      const paths = [
        "painel",
        "governanca",
        "usuarios",
        "imoveis",
        "conta",
        "conta/perfil",
        "conta/enderecos",
        "conta/preferencias",
        "conta/privacidade",
        ...(role === "platform_super_admin" ? ["configuracao"] : []),
      ];
      for (const path of paths) {
        await page.goto("/admin/" + path);
        await expect(page.locator("h1").first()).toBeVisible();
        await expect
          .poll(
            () =>
              page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            { message: path + " must fit viewport" },
          )
          .toBe(true);
        if (path === "usuarios") {
          await expect(page.getByText(fullName).first()).toBeVisible();
          if (role === "platform_super_admin") {
            await page
              .getByRole("button", { name: "Bloquear", exact: true })
              .click();
            await page.getByLabel("Tipo de bloqueio").selectOption("custom");
            await expect(page.getByLabel("Término")).toBeVisible();
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            ).toBe(true);
          }
          if (role === "platform_super_admin" && [390, 1440].includes(width)) {
            await page.evaluate(() =>
              window.scrollTo({ top: 0, behavior: "instant" }),
            );
            await page.screenshot({
              path: `/workspace/scratch/55678aa2ddfb/admin-users-${width}.png`,
              fullPage: true,
            });
          }
        }
      }
      expect(errors).toEqual([]);
    });
test("super administrator confirms block, deletion and registration review", async ({
  page,
}) => {
  const commands = await mock(page, "platform_super_admin");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/usuarios");
  await page.getByRole("button", { name: "Bloquear", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirmar bloqueio", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Desbloquear", exact: true }),
  ).toBeVisible();
  expect(commands[0].body.mode).toBe("indefinite");
  await page.getByRole("button", { name: "Desbloquear", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Bloquear", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Analisar cadastro" }).click();
  await page
    .getByLabel("Justificativa da análise")
    .fill("Identidade e documentos conferidos");
  await page.getByRole("button", { name: "Confirmar decisão" }).click();
  await expect(page.getByText("Nenhuma solicitação pendente.")).toBeVisible();
  await page
    .getByRole("button", { name: "Excluir conta", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirmar exclusão" }),
  ).toBeDisabled();
  await page.getByLabel("Confirmo a exclusão desta conta.").check();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(page.getByText("Excluída", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bloquear", exact: true }),
  ).toHaveCount(0);
  expect(commands.map((c) => c.path.split("/").at(-1))).toEqual([
    "status",
    "status",
    "decision",
    "delete",
  ]);
});

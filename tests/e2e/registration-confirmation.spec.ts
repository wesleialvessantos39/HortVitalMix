import { test, expect } from "@playwright/test";
for (const role of ["consumer", "producer"] as const)
  for (const width of [390, 1440]) {
    test(`cadastro ${role} confirma perfil automaticamente em ${width}px sem aguardar e-mail`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      let accepted = 0;
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", async (route) => {
        const req = route.request(),
          url = new URL(req.url()),
          path = url.pathname.replace(/^\/(?:api|_hvm_api)/, "");
        const json = (body: unknown, status = 200) =>
          route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(body),
          });
        if (url.pathname === "/functions/v1/public-registration") {
          const body = req.postDataJSON();
          expect(body.role).toBe(role);
          expect(body.consent.policyVersion).toBe("lgpd-cadastro-2026-10-02");
          accepted++;
          return json(
            {
              userId: "11111111-1111-4111-8111-111111111111",
              role,
              confirmationRequired: true,
              confirmationContext: "local-proof",
              lgpdRecorded: true,
              confirmationDispatchAccepted: false,
              confirmationDispatchScheduled: true,
              confirmationDispatchDeferred: true,
            },
            201,
          );
        }
        if (path === "/v1/auth/confirmation")
          return json({ status: "pending", role });
        if (path === "/v1/auth/lgpd-acceptance")
          throw Error("SECOND_CONSENT_REQUEST_NOT_EXPECTED");
        if (path === "/v1/auth/session")
          return json({ error: "AUTH_REQUIRED" }, 401);
        if (path === "/v1/localities")
          return json({
            municipalities: [
              {
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                ibgeCode: "1100023",
                name: "Ariquemes",
                state: "RO",
                isActive: true,
                revision: 1,
              },
            ],
            activeMunicipalityIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
          });
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
        if (path.startsWith("/v1/")) return json({ addresses: [] });
        return route.continue();
      });
      await page.goto(
        `/cadastro/${role === "producer" ? "produtor" : "consumidor"}`,
      );
      await page.locator('[name="fullName"]').fill("Maria Aparecida Silva");
      await page.locator('[name="cpf"]').fill("52998224725");
      await page.locator('[name="phone"]').fill("69999999999");
      await page
        .locator('[name="municipality"]')
        .selectOption({ label: "Ariquemes – RO" });
      await page.locator('[name="email"]').fill("local@example.test");
      await page.locator('[name="password"]').fill("Local-only123!");
      await page.locator('[name="confirmPassword"]').fill("Local-only123!");
      await page.locator('[name="lgpdAccepted"]').check();
      const before = Date.now();
      await page
        .getByRole("button", { name: "Criar cadastro", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: `Cadastro de ${role === "producer" ? "produtor" : "consumidor"} criado`,
        }),
      ).toBeVisible();
      expect(Date.now() - before).toBeLessThan(10000);
      expect(accepted).toBe(1);
      await expect(page.getByRole("combobox")).toHaveCount(0);
      await expect(
        page.getByText(role === "producer" ? "Produtor" : "Consumidor", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Reenviar confirmação" }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("heading", {
          name: `Cadastro de ${role === "producer" ? "produtor" : "consumidor"} criado`,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: `/workspace/scratch/fix-confirmation-${role}-${width}.png`,
        fullPage: true,
      });
    });
  }

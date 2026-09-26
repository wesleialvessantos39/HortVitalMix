import { expect, test } from "@playwright/test";

const propertyId = "22222222-2222-4222-8222-222222222222";

function fullProperty(overrides: Record<string, any> = {}) {
  return {
    id: propertyId,
    propertyName: "Chácara Boa Colheita",
    registrationNumber: null,
    totalAreaHectares: 10,
    cultivatedAreaHectares: 4,
    ruralZoneSector: "Gleba Jamari",
    lineVicinal: "Linha C-65",
    municipality: "Ariquemes",
    state: "RO",
    latitudeSede: -9.9132,
    longitudeSede: -63.0408,
    accessDirections: "Terceira porteira à direita",
    waterSource: "poco_artesiano",
    irrigationSystem: "gotejamento",
    status: "draft",
    wizardCurrentStep: 1,
    revision: 1,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    boundaries: [],
    activity: null,
    ...overrides,
  };
}

function summary(property: ReturnType<typeof fullProperty>) {
  return {
    id: property.id,
    propertyName: property.propertyName,
    lineVicinal: property.lineVicinal,
    municipality: property.municipality,
    state: property.state,
    status: property.status,
    wizardCurrentStep: property.wizardCurrentStep,
    revision: property.revision,
    updatedAt: property.updatedAt,
  };
}

async function mockT08(
  page: import("@playwright/test").Page,
  initial: ReturnType<typeof fullProperty> | null = null,
) {
  let current = initial ? structuredClone(initial) : null;

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.hostname === "tile.openstreetmap.org") {
      await route.fulfill({
        status: 204,
        contentType: "image/png",
        body: "",
      });
      return;
    }

    if (!url.pathname.includes("/v1/")) {
      await route.continue();
      return;
    }

    const path = url.pathname.replace(/^\/(?:_hvm_api|api)/, "");
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (path === "/v1/auth/session")
      return json({
        userId: "11111111-1111-4111-8111-111111111111",
        email: "produtor@example.com",
        fullName: "Produtor Rural",
        roles: ["producer"],
        activeRole: "producer",
        portalKind: "public",
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

    if (path === "/v1/account/addresses" && method === "GET")
      return json({ addresses: [] });

    if (path === "/v1/producer/properties" && method === "GET")
      return json({ properties: current ? [summary(current)] : [] });

    if (
      path === "/v1/producer/properties/" + propertyId &&
      method === "GET"
    )
      return current
        ? json({ property: current })
        : json({ error: "PROPERTY_NOT_FOUND" }, 404);

    if (
      path === "/v1/producer/properties/wizard/save-step" &&
      method === "POST"
    ) {
      const body = request.postDataJSON() as any;
      const stepData = body.stepData;

      if (!current) {
        current = fullProperty({
          propertyName: stepData.propertyName,
          registrationNumber: stepData.registrationNumber ?? null,
          ruralZoneSector: stepData.ruralZoneSector,
          lineVicinal: stepData.lineVicinal,
          municipality: stepData.municipality,
          state: "RO",
          latitudeSede: stepData.latitudeSede,
          longitudeSede: stepData.longitudeSede,
          accessDirections: stepData.accessDirections ?? null,
          totalAreaHectares: null,
          cultivatedAreaHectares: null,
          waterSource: null,
          irrigationSystem: null,
          wizardCurrentStep: 1,
          revision: 1,
        });
      } else {
        current.revision += 1;
      }

      current.wizardCurrentStep = Math.max(
        current.wizardCurrentStep,
        body.step,
      );

      if (body.step === 1) {
        Object.assign(current, {
          propertyName: stepData.propertyName,
          registrationNumber: stepData.registrationNumber ?? null,
          ruralZoneSector: stepData.ruralZoneSector,
          lineVicinal: stepData.lineVicinal,
          municipality: stepData.municipality,
          latitudeSede: stepData.latitudeSede,
          longitudeSede: stepData.longitudeSede,
          accessDirections: stepData.accessDirections ?? null,
        });
      } else if (body.step === 2) {
        current.totalAreaHectares = stepData.totalAreaHectares;
        current.cultivatedAreaHectares = stepData.cultivatedAreaHectares;
        current.boundaries = (stepData.boundaries ?? []).map(
          (item: any, index: number) => ({
            id: "33333333-3333-4333-8333-" + String(index + 1).padStart(12, "0"),
            boundaryType: item.boundaryType,
            polygonGeojson: item.polygonGeojson,
            calculatedAreaHa: item.calculatedAreaHa ?? null,
            createdAt: "2026-09-26T00:00:00.000Z",
          }),
        );
      } else if (body.step === 3) {
        current.waterSource = stepData.waterSource;
        current.irrigationSystem = stepData.irrigationSystem;
      } else if (body.step === 4) {
        current.activity = {
          id: "44444444-4444-4444-8444-444444444444",
          activityCategory: stepData.activityCategory,
          productionSystem: stepData.productionSystem,
          hasWashingFacility: stepData.hasWashingFacility,
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:00:00.000Z",
        };
      } else if (body.step === 5) {
        current.status = "submitted";
      }

      return json({
        status: body.step === 5 ? "submitted" : "step_saved",
        property: current,
        nextStep: Math.min(5, body.step + 1),
      }, body.step === 1 && !body.propertyId ? 201 : 200);
    }

    if (
      path === "/v1/producer/properties/" + propertyId + "/submit" &&
      method === "POST"
    ) {
      if (current) current.status = "submitted";
      return json({ status: "submitted", property: current });
    }

    return json({});
  });

  return {
    get property() {
      return current;
    },
  };
}

test("01 lista vazia diferencia imóvel rural de endereço pessoal", async ({ page }) => {
  await mockT08(page);
  await page.goto("/produtor/propriedades");
  await expect(page.getByRole("heading", { name: "Meus imóveis rurais" })).toBeVisible();
  await expect(page.getByText(/endereços pessoais continuam em Minha conta/i)).toBeVisible();
  await expect(page.getByText("Nenhum imóvel rural cadastrado")).toBeVisible();
});

test("02 lista rascunho com estado e progresso", async ({ page }) => {
  await mockT08(page, fullProperty({ wizardCurrentStep: 3 }));
  await page.goto("/produtor/propriedades");
  await expect(page.getByText("Chácara Boa Colheita")).toBeVisible();
  await expect(page.getByText("Rascunho")).toBeVisible();
  await expect(page.getByText("Etapa 3 de 5")).toBeVisible();
});

test("03 novo imóvel abre wizard de cinco etapas e mapa em Ariquemes", async ({ page }) => {
  await mockT08(page);
  await page.goto("/produtor/propriedades");
  await page.getByRole("button", { name: /Novo imóvel rural/ }).click();
  await expect(page).toHaveURL(/\/produtor\/propriedades\/novo$/);
  await expect(page.getByText("Etapa 1 de 5")).toBeVisible();
  await expect(page.getByLabel("Mapa para marcar a sede do imóvel rural")).toBeVisible();
  await expect(page.locator(".rural-step-dot")).toHaveCount(5);
});

test("04 passo 1 salva e avança sem valor fictício de área", async ({ page }) => {
  const mocked = await mockT08(page);
  await page.goto("/produtor/propriedades/novo");
  await page.getByLabel("Nome da propriedade ou chácara").fill("Sítio Esperança");
  await page.getByLabel("Linha vicinal / travessão").fill("Linha C-70");
  await page.getByLabel("Setor rural / gleba").fill("Gleba 2");
  const map = page.getByLabel("Mapa para marcar a sede do imóvel rural");
  await map.click({ position: { x: 160, y: 120 } });
  await page.getByRole("button", { name: /Salvar e continuar/ }).click();
  await expect(page.getByRole("heading", { name: "Dimensões" })).toBeVisible();
  expect(mocked.property?.totalAreaHectares).toBeNull();
  expect(mocked.property?.cultivatedAreaHectares).toBeNull();
});

test("05 área cultivada maior que total não avança", async ({ page }) => {
  await mockT08(
    page,
    fullProperty({
      wizardCurrentStep: 2,
      totalAreaHectares: null,
      cultivatedAreaHectares: null,
      waterSource: null,
      irrigationSystem: null,
    }),
  );
  await page.goto("/produtor/propriedades/novo?id=" + propertyId);
  await page.getByLabel("Área total (ha)").fill("5");
  await page.getByLabel("Área cultivada ativa (ha)").fill("6");
  await page.getByRole("button", { name: /Salvar e continuar/ }).click();
  await expect(page.getByText(/Preencha os campos obrigatórios desta etapa/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dimensões" })).toBeVisible();
});

test("06 legumes picados exigem instalação de lavagem", async ({ page }) => {
  await mockT08(
    page,
    fullProperty({
      wizardCurrentStep: 4,
      activity: {
        id: "44444444-4444-4444-8444-444444444444",
        activityCategory: "legumes_picados",
        productionSystem: "agroecologico_declarado",
        hasWashingFacility: true,
        createdAt: "2026-09-26T00:00:00.000Z",
        updatedAt: "2026-09-26T00:00:00.000Z",
      },
    }),
  );
  await page.goto("/produtor/propriedades/novo?id=" + propertyId);
  await page.getByLabel(/instalação adequada para lavagem/).uncheck();
  await expect(page.getByText(/Para legumes picados, essa estrutura é obrigatória/)).toBeVisible();
  await page.getByRole("button", { name: /Salvar e continuar/ }).click();
  await expect(page.getByRole("heading", { name: "Culturas e processamento" })).toBeVisible();
});

test("07 queda de conexão mantém rascunho local e informa o produtor", async ({ page }) => {
  await mockT08(page);
  await page.goto("/produtor/propriedades/novo");
  await expect(page.getByLabel("Nome da propriedade ou chácara")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText(/Sem conexão. Alterações ficam salvas localmente/)).toBeVisible();
  await page.getByLabel("Nome da propriedade ou chácara").fill("Rascunho offline");
  await expect.poll(async () =>
    page.evaluate(() =>
      Object.keys(localStorage).some((key) =>
        key.startsWith("hvm:rural-property-draft:"),
      ),
    ),
  ).toBe(true);
});

test("08 layout não cria overflow nos cinco breakpoints oficiais", async ({ page }) => {
  await mockT08(page, fullProperty({ wizardCurrentStep: 2 }));
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 360, height: 800 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/produtor/propriedades/novo?id=" + propertyId);
    await expect(page.getByRole("heading", { name: "Dimensões" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "overflow em " + viewport.width + "px",
    ).toBe(true);
    await page.screenshot({ path: `/tmp/t08-layout-${viewport.width}.png`, fullPage: true });
  }
});

test("09 recarregar preserva imóvel e alterações locais ainda não sincronizadas", async ({ page }) => {
  const mocked = await mockT08(page);
  await page.goto("/produtor/propriedades/novo");
  await page.getByLabel("Nome da propriedade ou chácara").fill("Sítio Persistente");
  await page.getByLabel("Linha vicinal / travessão").fill("Linha C-70");
  await page.getByLabel("Setor rural / gleba").fill("Gleba 2");
  await page.getByLabel("Mapa para marcar a sede do imóvel rural").click({ position: { x: 160, y: 120 } });
  await page.getByRole("button", { name: /Salvar e continuar/ }).click();
  await expect(page).toHaveURL(new RegExp("id=" + propertyId));
  await page.getByLabel("Área total (ha)").fill("8");
  await page.reload();
  await expect(page.getByLabel("Área total (ha)")).toHaveValue("8");
  await page.getByLabel("Área cultivada ativa (ha)").fill("3");
  await page.getByRole("button", { name: /Salvar e continuar/ }).click();
  await expect(page.getByRole("heading", { name: "Segurança hídrica" })).toBeVisible();
  expect(mocked.property?.totalAreaHectares).toBe(8);
});

test("10 autosave salva também a edição feita enquanto a resposta estava pendente", async ({ page }) => {
  const mocked = await mockT08(page, fullProperty());
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  await page.route("**/producer/properties/wizard/save-step", async (route) => {
    if (first) { first = false; await pending; }
    await route.fallback();
  });
  await page.goto("/produtor/propriedades/novo?id=" + propertyId);
  await page.getByLabel("Nome da propriedade ou chácara").fill("Primeira edição");
  await page.waitForRequest((req) => req.url().includes("wizard/save-step"));
  await page.getByLabel("Nome da propriedade ou chácara").fill("Última edição");
  release();
  await expect.poll(() => mocked.property?.propertyName, { timeout: 10000 }).toBe("Última edição");
});

test("11 completa as cinco etapas e submete o imóvel", async ({ page }) => {
  const mocked = await mockT08(page, fullProperty({ wizardCurrentStep: 2 }));
  await page.goto("/produtor/propriedades/novo?id=" + propertyId);
  await page.getByRole("button", { name: /Salvar e continuar/ }).click();
  await page.getByRole("button", { name: /Salvar e continuar/ }).click();
  await page.getByLabel("Atividade principal").selectOption("hortalicas_folhosas");
  await page.getByLabel("Sistema de produção").selectOption("agroecologico_declarado");
  await page.getByRole("button", { name: /Salvar e continuar/ }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Revisar e enviar/ }).click();
  await expect(page.getByText("Enviado para análise")).toBeVisible();
  expect(mocked.property?.status).toBe("submitted");
});

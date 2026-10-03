import type { RuralPropertyView } from "../../shared/contracts/ruralProperty";
import { expect, test } from "@playwright/test";

const propertyId = "22222222-2222-4222-8222-222222222222";

function fullProperty(overrides: Partial<RuralPropertyView> = {}): RuralPropertyView {
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
    completedAt:property.completedAt,
    wizardCurrentStep: property.wizardCurrentStep,
    revision: property.revision,
    updatedAt: property.updatedAt,
    queueStatus: property.queueStatus ?? null,
    reviewDecision: property.reviewDecision ?? null,
  };
}

async function mockT08(
  page: import("@playwright/test").Page,
  initial: ReturnType<typeof fullProperty> | null = null,
  withDocument = false,
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

    if (path === "/v1/localities" && method === "GET")
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
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            ibgeCode: "1100122",
            name: "Ji-Paraná",
            state: "RO",
            isActive: true,
            revision: 1,
          },
        ],
        activeMunicipalityIds: [
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ],
      });

    if (path === "/v1/account/addresses" && method === "GET")
      return json({ addresses: [] });

    if (path === "/v1/account/profile" && method === "GET")
      return json({ fullName: "Produtor Rural", cpfMasked: "***.***.***-**" });

    if (path === "/v1/producer/properties/activity-default" && method === "GET")
      return json({ activityCategory: "hortalicas_folhosas" });

    if (path === "/v1/producer/properties" && method === "GET")
      return json({ properties: current ? [summary(current)] : [] });

    if (path === "/v1/producer/documents" && method === "GET")
      return json({
        documents: withDocument
          ? [{
              id: "55555555-5555-4555-8555-555555555555",
              property_id: propertyId,
              document_type: "car_sicar",
              file_name: "CAR-Sitio-Esperanca.pdf",
              file_size_bytes: 1200,
              mime_type: "application/pdf",
              status: "clean",
              created_at: "2026-09-26T00:00:00.000Z",
            }]
          : [],
      });

    if (
      path ===
        "/v1/producer/documents/55555555-5555-4555-8555-555555555555/extraction" &&
      method === "GET"
    )
      return json({
        extraction: withDocument
          ? {
              status: "completed",
              payload_jsonb: {
                propertyRegisteredName: "Sítio Esperança",
                municipality: "Ariquemes",
                totalAreaHectares: "10",
                carNumber: "RO-1100023-TESTE",
              },
              review: null,
            }
          : null,
        ai: { enabled: false },
        job: null,
      });

    if (
      path === "/v1/producer/properties/" + propertyId &&
      method === "GET"
    )
      return current
        ? json({ property: current })
        : json({ error: "PROPERTY_NOT_FOUND" }, 404);

    if(path==="/v1/producer/properties/wizard/draft" && method==="POST"){
      const body=request.postDataJSON();
      current=current ?? fullProperty({
        propertyName: body.draft.propertyName,
        registrationNumber: body.draft.registrationNumber || null,
        ruralZoneSector: body.draft.ruralZoneSector,
        lineVicinal: body.draft.lineVicinal,
        municipality: body.draft.municipality,
        latitudeSede: body.draft.latitudeSede,
        longitudeSede: body.draft.longitudeSede,
        totalAreaHectares:null,
        cultivatedAreaHectares:null,
        waterSource:null,
        irrigationSystem:null,
      });
      current.draftData=body.draft;current.propertyName=body.draft.propertyName || current.propertyName;current.wizardCurrentStep=body.draft.step;current.revision++;
      return json({property:current});
    }
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

      if (body.step === 2) {
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
      } else if (body.step === 3) {
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
      } else if (body.step === 4) {
        current.waterSource = stepData.waterSource;
        current.irrigationSystem = stepData.irrigationSystem;
      } else if (body.step === 5) {
        current.activity = {
          id: "44444444-4444-4444-8444-444444444444",
          activityCategory: stepData.activityCategory,
          productionSystem: stepData.productionSystem,
          hasWashingFacility: stepData.hasWashingFacility,
          createdAt: "2026-09-26T00:00:00.000Z",
          updatedAt: "2026-09-26T00:00:00.000Z",
        };
      } else if (body.step === 6) {
        current.status = body.completeOnly ? "completed" : "submitted";current.completedAt=new Date().toISOString();current.draftData=null;
      }

      return json({
        status: body.step === 6 ? "submitted" : "step_saved",
        property: current,
        nextStep: Math.min(6, body.step + 1),
      }, body.step === 2 && !body.propertyId ? 201 : 200);
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
  await expect(page.getByRole("heading", { name: "Seu perfil ainda não está aprovado" })).toBeVisible();
  await expect(page.getByText(/Novo imóvel rural/).first()).toBeVisible();
});

test("01b produtor sem aprovação recebe guia até iniciar novo imóvel", async ({ page }) => {
  await mockT08(page);
  await page.goto("/conta");
  await expect(page.getByText("Seu perfil de produtor ainda não está aprovado.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Escopo de entrega" })).toHaveCount(0);
  await page.getByRole("button", { name: "Ver guia passo a passo" }).click();
  await expect(page.getByText(/Abra Imóveis rurais/)).toBeVisible();
  await page.getByRole("button", { name: "Ir para Imóveis rurais" }).click();
  await expect(page).toHaveURL(/\/produtor\/propriedades$/);
  await expect(page.getByRole("heading", { name: "Seu perfil ainda não está aprovado" })).toBeVisible();
  await page.getByRole("button", { name: "Novo imóvel rural" }).click();
  await expect(page.getByRole("heading", { name: "Documentos do imóvel" }).first()).toBeVisible();
});

test("02 lista rascunho com estado e progresso", async ({ page }) => {
  await mockT08(page, fullProperty({ wizardCurrentStep: 3 }));
  await page.goto("/produtor/propriedades");
  await expect(page.getByText("Chácara Boa Colheita")).toBeVisible();
  await expect(page.getByText("Rascunho", {exact:true})).toBeVisible();
  await expect(page.getByText("Etapa 3 de 6")).toBeVisible();
});

test("02b imóvel verificado nunca aparece como devolvido por decisão antiga", async ({ page }) => {
  await mockT08(
    page,
    fullProperty({
      status: "verified",
      queueStatus: "approved",
      reviewDecision: "adjustments_required",
      wizardCurrentStep: 5,
    }),
  );
  await page.goto("/produtor/propriedades");
  await expect(page.getByText("Aprovado", { exact: true })).toBeVisible();
  await expect(page.getByText("Devolvido para correção", { exact: true })).toHaveCount(0);
});

test("03 novo imóvel abre wizard de seis etapas com documentos primeiro", async ({ page }) => {
  await mockT08(page);
  await page.goto("/produtor/propriedades");
  await page.getByRole("button", { name: /Novo imóvel rural/ }).click();
  await expect(page).toHaveURL(/\/produtor\/propriedades\/novo$/);
  await expect(page.getByText("Etapa 1 de 6")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Documentos do imóvel" })).toBeVisible();
  await expect(page.getByLabel("Mapa para marcar a sede do imóvel rural")).toHaveCount(0);
  await expect(page.locator(".rural-step-dot")).toHaveCount(6);
});

test("03b cria rascunho sem inventar dados antes do upload documental", async ({ page }) => {
  const mocked = await mockT08(page);
  await page.goto("/produtor/propriedades/novo");
  await page.getByRole("button", { name: "Iniciar etapa de documentos" }).click();
  await expect(page).toHaveURL(new RegExp("id=" + propertyId));
  await expect(page.getByLabel("Selecionar PDF ou imagem")).toBeVisible();
  await page.getByRole("button", { name: /Etapa 2: Identificação e acesso/ }).click();
  await expect(page.getByLabel("Nome da propriedade ou chácara")).toHaveValue("");
  await expect(page.getByLabel("Município")).toHaveValue("");
  await expect(page.getByLabel("Município").locator("option")).toHaveText([
    "Escolha o município",
    "Ariquemes",
    "Ji-Paraná",
  ]);
  expect(mocked.property?.latitudeSede).toBeNull();
  expect(mocked.property?.longitudeSede).toBeNull();
});

test("04 bloqueia avanço e submissão se não houver documento processado", async ({ page }) => {
  await mockT08(page);
  await page.goto("/produtor/propriedades/novo");
  await page.getByRole("button", { name: /Salvar e continuar/ }).click();
  await expect(page.getByText(/Anexe e processe um CAR ou CCIR/)).toBeVisible();
  await expect(page.getByText("Etapa 1 de 6")).toBeVisible();
  await page.getByRole("button", { name: "Etapa 6: Revisão e submissão, pendente" }).click();
  await page.getByRole("button", { name: "Enviar para análise" }).click();
  await expect(page.getByText(/Complete as etapas pendentes: 1/)).toBeVisible();
});

test("04b extrai os dados documentais para as etapas seguintes e permite revisá-los", async ({ page }) => {
  await mockT08(
    page,
    fullProperty({
      wizardCurrentStep: 1,
      propertyName: "",
      registrationNumber: null,
      municipality: "",
      totalAreaHectares: null,
      cultivatedAreaHectares: null,
    }),
    true,
  );
  await page.goto("/produtor/propriedades/novo?id=" + propertyId);
  await expect(page.getByText(/Documento CAR\/CCIR processado e dados documentais salvos/)).toBeVisible();
  await page.getByRole("button", { name: /Salvar e continuar/ }).click();
  await expect(page.getByLabel("Nome da propriedade ou chácara")).toHaveValue("Sítio Esperança");
  await expect(page.getByLabel("Município")).toHaveValue("Ariquemes");
  await page.getByLabel("Nome da propriedade ou chácara").fill("Sítio editado");
  await page.getByRole("button", { name: "Etapa 3: Dimensões, pendente" }).click();
  await expect(page.getByLabel("Área total (ha)")).toHaveValue("10");
  await page.getByLabel("Área total (ha)").fill("9");
  await expect(page.getByLabel("Área total (ha)")).toHaveValue("9");
});

test("05 área inválida permite avançar com pendência e bloqueia submissão", async ({ page }) => {
  await mockT08(
    page,
    fullProperty({
      wizardCurrentStep: 3,
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
  await expect(page.getByText(/Etapa com pendências/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Segurança hídrica" })).toBeVisible();
});

test("06 legumes picados exigem instalação de lavagem", async ({ page }) => {
  await mockT08(
    page,
    fullProperty({
      wizardCurrentStep: 5,
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
  await expect(page.getByRole("heading", { name: "Revisão e submissão" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Etapa 5:.*pendente/ })).toBeVisible();
});

test("07 queda de conexão mantém rascunho local e informa o produtor", async ({ page }) => {
  await mockT08(page, fullProperty({ wizardCurrentStep: 2 }));
  await page.goto("/produtor/propriedades/novo?id=" + propertyId);
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
  await mockT08(page, fullProperty({ wizardCurrentStep: 3 }));
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

test("08b etapa de documentos não cria overflow em mobile e desktop", async ({ page }) => {
  await mockT08(page, fullProperty({ wizardCurrentStep: 1 }), true);
  for (const width of [320, 360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/produtor/propriedades/novo?id=" + propertyId);
    await expect(
      page.getByRole("heading", { name: "Documentos do imóvel" }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `overflow em ${width}px na etapa de documentos`,
    ).toBe(true);
  }
});

test("09 recarregar preserva imóvel e alterações locais ainda não sincronizadas", async ({ page }) => {
  const mocked = await mockT08(page, fullProperty({ wizardCurrentStep: 3 }));
  await page.goto("/produtor/propriedades/novo?id=" + propertyId);
  await page.getByLabel("Área total (ha)").fill("8");
  await page.reload();
  await expect(page.getByLabel("Área total (ha)")).toHaveValue("8");
  await page.getByLabel("Área cultivada ativa (ha)").fill("3");
  await page.getByRole("button", { name: /Salvar e continuar/ }).click();
  await expect(page.getByRole("heading", { name: "Segurança hídrica" })).toBeVisible();
  expect(mocked.property?.draftData?.totalAreaHectares).toBe("8");
});

test("10 autosave salva também a edição feita enquanto a resposta estava pendente", async ({ page }) => {
  const mocked = await mockT08(page, fullProperty({ wizardCurrentStep: 2 }));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  await page.route("**/producer/properties/wizard/draft", async (route) => {
    if (first) { first = false; await pending; }
    await route.fallback();
  });
  await page.goto("/produtor/propriedades/novo?id=" + propertyId);
  await page.getByLabel("Nome da propriedade ou chácara").fill("Primeira edição");
  await page.waitForRequest((req) => req.url().includes("wizard/draft"));
  await page.getByLabel("Nome da propriedade ou chácara").fill("Última edição");
  release();
  await expect.poll(() => mocked.property?.propertyName, { timeout: 10000 }).toBe("Última edição");
});

test("11 completa as seis etapas e submete o imóvel", async ({ page }) => {
  const mocked = await mockT08(page, fullProperty({ wizardCurrentStep: 2 }), true);
  await page.goto("/produtor/propriedades/novo?id=" + propertyId);
  await page.getByRole("button", { name: /Salvar e continuar/ }).click();
  await page.getByRole("button", { name: /Salvar e continuar/ }).click();
  await page.getByRole("button", { name: /Salvar e continuar/ }).click();
  await page.getByLabel("Atividade principal").selectOption("hortalicas_folhosas");
  await page.getByLabel("Sistema de produção").selectOption("agroecologico_declarado");
  await page.getByRole("button", { name: /Salvar e continuar/ }).click();
  await page.getByLabel(/Confirmo que revisei os dados/).check();
  await expect(page.getByLabel(/Confirmo que revisei os dados/)).toBeChecked();
  await expect(page.getByText("Documento exigido processado; dados documentais salvos.")).toBeVisible();
  await expect(page.getByText(/Dados extraídos: Sítio Esperança/)).toBeVisible();
  await page.getByRole("button", { name: /Enviar para análise/ }).click();
  await expect(page.getByText("Enviado para análise")).toBeVisible();
  expect(mocked.property?.status).toBe("submitted");
});

test("12 revisão final não oferece caminho paralelo que contorne a submissão",async({page})=>{
 const mocked=await mockT08(page,fullProperty({wizardCurrentStep:5}),true);
 await page.goto("/produtor/propriedades/novo?id="+propertyId);
 await page.getByLabel("Atividade principal").selectOption("hortalicas_folhosas");
 await page.getByLabel("Sistema de produção").selectOption("agroecologico_declarado");
 await page.getByRole("button",{name:/Salvar e continuar/}).click();
 await page.getByLabel(/Confirmo que revisei os dados/).check();
 await expect(page.getByLabel(/Confirmo que revisei os dados/)).toBeChecked();
 await expect(page.getByRole("button",{name:"Concluir e salvar"})).toHaveCount(0);
 await page.getByRole("button",{name:"Enviar para análise"}).click();
 await expect(page.getByText("Enviado para análise")).toBeVisible();
 expect(mocked.property?.status).toBe("submitted");
});

const viewports = [
  [320, 568], [360, 800], [390, 844], [412, 915],
  [768, 1024], [1024, 768], [1280, 720], [1440, 900],
] as const;

for (const [width, height] of viewports) {
  test(`13 sem overflow horizontal em ${width}x${height} (lista e etapas 1-6)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await mockT08(page, fullProperty({ wizardCurrentStep: 3 }));
    const noOverflow = async () =>
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto("/produtor/propriedades");
    await expect(page.getByText("Chácara Boa Colheita")).toBeVisible();
    await noOverflow();
    for (let step = 1; step <= 6; step++) {
      await page.goto(`/produtor/propriedades/novo?id=${propertyId}&step=${step}`);
      await expect(page.getByText(`Etapa ${step} de 6`)).toBeVisible();
      await noOverflow();
    }
  });
}

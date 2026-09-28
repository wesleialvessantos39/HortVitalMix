import { test, expect } from "@playwright/test";
const propertyId = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333";
const doc = {
  id,
  property_id: propertyId,
  document_type: "car_sicar",
  file_name: "CAR do imóvel rural.pdf",
  file_size_bytes: 2048,
  mime_type: "application/pdf",
  status: "clean",
  created_at: "2026-09-28T00:00:00Z",
};
async function mock(page: import("@playwright/test").Page, enabled = true) {
  let documents: any[] = [doc],
    extraction: any = null,
    review: any = null;
  await page.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.replace(/^\/(?:api|_hvm_api)/, "");
    const json = (x: any) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(x),
      });
    if (path === "/v1/auth/session")
      return json({
        userId: "11111111-1111-4111-8111-111111111111",
        email: "test@example.invalid",
        fullName: "Produtor",
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
    if (path === "/v1/account/addresses") return json({ addresses: [] });
    if (path === "/v1/producer/documents") return json({ documents });
    if (path.endsWith("/download"))
      return json({ signedUrl: "http://127.0.0.1:3000/test-document.pdf" });
    if (path === "/test-document.pdf")
      return route.fulfill({
        contentType: "application/pdf",
        body: "%PDF-1.7\n%%EOF",
      });
    if (path.endsWith("/upload-url"))
      return json({
        documentId: id,
        signedUrl: "http://127.0.0.1:3000/test-upload",
        status: "quarantine",
      });
    if (path === "/test-upload") return json({ Key: "test" });
    if (path.endsWith("/confirm")) {
      documents = [doc];
      return json({ status: "clean" });
    }
    if (path.endsWith("/archive")) {
      documents = [{ ...doc, status: "archived" }];
      return json({ status: "archived" });
    }
    if (path.endsWith("/review")) {
      review = req.postDataJSON();
      return json({ status: "saved" });
    }
    if (path.endsWith("/extraction")) {
      if (req.method() === "POST")
        extraction = {
          id: "extraction",
          status: "flagged_discrepancy",
          payload_jsonb: {
            carNumber: "RO-1100023-" + "A".repeat(32),
            ccirNumber: null,
            propertyRegisteredName: "Imóvel de teste",
            holderName: "Titular",
            holderCpfNormalized: "12345678901",
            municipality: "Ariquemes",
            totalAreaHectares: 12,
            legalReserveHectares: 3,
            appHectares: 1,
            consolidatedRuralAreaHectares: 8,
            fiscalModules: null,
            confidenceScore: 0.95,
            fieldConfidence: { totalAreaHectares: 0.95 },
            rawText: "Texto de teste",
          },
          discrepancies: ["Área total difere mais de 5% da declaração"],
          area_difference_percent: 20,
        };
      return json({
        extraction: extraction ? { ...extraction, review } : null,
        ai: { enabled },
        job: null,
      });
    }
    if (path.startsWith("/v1/")) return json({});
    return route.continue();
  });
}
for (const width of [320, 390, 768, 1440])
  test(`conferência responsiva ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mock(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/produtor/documentos?propertyId=" + propertyId);
    await page.getByRole("button", { name: "Visualizar e conferir" }).click();
    await page
      .getByRole("button", { name: "Extrair dados do documento" })
      .click();
    await expect(
      page.getByText("Área total difere mais de 5% da declaração"),
    ).toBeVisible();
    await page
      .getByLabel("Observação para conferência")
      .fill("Área informada diverge do meu documento.");
    await page
      .getByRole("button", { name: "Há divergência nos números" })
      .click();
    await expect(
      page.getByText("Divergência registrada para análise administrativa."),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: `/tmp/documents-${width}.png`,
      fullPage: true,
    });
  });
test("envio direto, hash e confirmação", async ({ page }) => {
  await mock(page);
  await page.goto("/produtor/documentos?propertyId=" + propertyId);
  const bytes = Buffer.from("%PDF-1.7\n" + "x".repeat(2048) + "\n%%EOF");
  await page
    .getByLabel("Selecionar PDF ou imagem", { exact: true })
    .setInputFiles({
      name: "car.pdf",
      mimeType: "application/pdf",
      buffer: bytes,
    });
  await expect(
    page.getByText("Documento recebido e integridade conferida."),
  ).toBeVisible();
});
test("IA não configurada mantém documento visualizável", async ({ page }) => {
  await mock(page, false);
  await page.goto("/produtor/documentos?propertyId=" + propertyId);
  await page.getByRole("button", { name: "Visualizar e conferir" }).click();
  await expect(
    page.getByRole("button", { name: "Extrair dados do documento" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Abrir documento em outra aba" }),
  ).toBeVisible();
});
test("arquivamento confirmado remove visualização ativa", async ({ page }) => {
  await mock(page);
  await page.goto("/produtor/documentos?propertyId=" + propertyId);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Arquivar", exact: true }).click();
  await expect(page.getByText("Arquivado", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Visualizar e conferir" }),
  ).toHaveCount(0);
});

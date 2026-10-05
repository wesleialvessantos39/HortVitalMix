import { test, expect } from "@playwright/test";
const propertyId = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333";
const readablePdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 188>>stream
BT /F1 12 Tf 20 120 Td (Nome do imovel: Sitio Boa Vista) Tj ET
BT /F1 12 Tf 20 90 Td (Municipio: Ariquemes) Tj ET
BT /F1 12 Tf 20 60 Td (Area total do imovel: 12,50 ha) Tj ET
BT /F1 12 Tf 20 30 Td (RO-1100262-E37BCF0AB8FA4AC3B96572A57914FB03) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Size 6/Root 1 0 R>>
%%EOF`;
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
async function mock(page: import("@playwright/test").Page) {
  let documents: any[] = [doc];
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
      documents = [];
      return json({ status: "archived" });
    }
    if (path.endsWith("/declare") && req.method() === "POST")
      return json({
        propertyUpdated: true,
        areaApplied: true,
        propertyStatus: "completed",
        discrepancies: [],
      });
    if (path.endsWith("/file"))
      return route.fulfill({
        contentType: "application/pdf",
        body: readablePdf,
      });
    if (path.endsWith("/extraction"))
      return json({
        extraction: null,
        ai: { enabled: false },
        job: null,
      });
    if (path.startsWith("/v1/")) return json({});
    return route.continue();
  });
}
for (const width of [320, 390, 768, 1440])
  test(`conferência responsiva ${width}`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    await mock(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/produtor/documentos?propertyId=" + propertyId);
    await page.getByRole("button", { name: "Ver documento" }).click();
    await expect(page.getByRole("heading", { name: "Dados lidos" })).toBeVisible();
    await expect(page.getByText("Sitio Boa Vista")).toBeVisible();
    await expect(
      page.getByText("O PDF foi lido e o cadastro do imóvel foi preenchido."),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Abrir em tela cheia" }),
    ).toBeVisible();
    const canvas = page.locator("canvas.document-page");
    await expect(canvas).toBeVisible();
    const painted = await canvas.evaluate((node) => {
      const c = node as HTMLCanvasElement;
      const ctx = c.getContext("2d");
      if (!ctx || c.width < 20 || c.height < 20) return false;
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i + 3] > 16 && (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240))
          return true;
      }
      return false;
    });
    expect(painted).toBe(true);
    const viewer = await page.locator(".document-viewer").boundingBox();
    expect(viewer?.height ?? 999).toBeLessThanOrEqual(width <= 900 ? 330 : 590);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: `/tmp/documents-${width}.png`,
      fullPage: true,
    });
  });
test("envio direto lê o PDF e preenche o cadastro", async ({ page }) => {
  test.setTimeout(60000);
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
    page.getByText("O PDF foi lido e o cadastro do imóvel foi preenchido."),
  ).toBeVisible();
});
test("leitura do PDF não depende de IA", async ({ page }) => {
  test.setTimeout(60000);
  await mock(page);
  await page.goto("/produtor/documentos?propertyId=" + propertyId);
  await page.getByRole("button", { name: "Ver documento" }).click();
  await expect(page.getByText("Sitio Boa Vista")).toBeVisible();
  await expect(page.getByText("IA", { exact: true })).toHaveCount(0);
});
test("exclusão confirma e remove da lista ativa", async ({ page }) => {
  await mock(page);
  await page.goto("/produtor/documentos?propertyId=" + propertyId);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(
    page.getByText("Documento excluído da conferência.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(doc.file_name)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Ver documento" }),
  ).toHaveCount(0);
});

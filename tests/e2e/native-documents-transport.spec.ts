import { expect, test } from "@playwright/test";
import { emulateCapacitorBridge } from "./helpers/capacitorBridge";

const propertyId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";
const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 62>>stream
BT /F1 14 Tf 20 100 Td (Documento conferido no aplicativo) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Size 6/Root 1 0 R>>
%%EOF`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1cAAAAASUVORK5CYII=", "base64");

for (const platform of ["android", "ios"] as const)
  for (const width of [390, 1440])
    for (const mime of ["application/pdf", "image/png"])
      test(`emulated ${platform} protected ${mime} at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await emulateCapacitorBridge(page, platform);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
          const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
          const json = (data: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
          if (path === "/v1/auth/session") return json({
            userId: "11111111-1111-4111-8111-111111111111", email: "native-test@example.invalid",
            fullName: "Produtor", roles: ["producer"], activeRole: "producer", portalKind: "public",
          });
          if (path === "/v1/config") return json({
            platformName: "HortiVitalMix", slogan: "Tudo fresco. Tudo da sua região.", defaultMunicipality: "Ariquemes", defaultState: "RO", currency: "BRL",
            timezone: "America/Porto_Velho", supportEmail: "native-test@example.invalid", supportPhone: null, revision: 1,
          });
          if (path === "/v1/account/addresses") return json({ addresses: [] });
          if (path === "/v1/producer/documents") return json({ documents: [{
            id: documentId, property_id: propertyId, document_type: "water_analysis", file_name: "Documento nativo", file_size_bytes: 500,
            mime_type: mime, status: "clean", created_at: "2026-10-09T00:00:00Z",
          }] });
          if (path.endsWith("/extraction")) return json({ extraction: null, ai: { enabled: false }, job: null });
          if (path.endsWith("/file")) return route.fulfill({ contentType: mime, body: mime === "application/pdf" ? pdf : png });
          if (path.startsWith("/v1/")) return json({});
          return route.continue();
        });
        await page.goto("/produtor/documentos?propertyId=" + propertyId);
        await page.getByRole("button", { name: "Ver documento" }).click();
        const open = page.getByRole("link", { name: "Abrir em tela cheia" });
        await expect(open).toHaveAttribute("href", /^blob:/);
        if (mime === "application/pdf") {
          await expect(page.locator("canvas.document-page")).toBeVisible();
          await expect.poll(() => page.locator("canvas.document-page").evaluate((node) => (node as HTMLCanvasElement).width)).toBeGreaterThan(20);
        } else {
          const image = page.getByRole("img", { name: "Documento enviado" });
          await expect(image).toHaveAttribute("src", /^blob:/);
          await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const requests = await page.evaluate(() => (globalThis as unknown as {
          __HVM_TEST_NATIVE_CALLS: Array<{ plugin: string; options: { url?: string; headers?: Record<string, string>; responseType?: string } }>;
        }).__HVM_TEST_NATIVE_CALLS.filter((call) => call.plugin === "CapacitorHttp"));
        const file = requests.find((request) => request.options.url?.endsWith("/" + documentId + "/file"));
        expect(file?.options.url).toBe("https://hortvitalmix.vercel.app/api/v1/producer/documents/" + documentId + "/file");
        expect(file?.options.headers?.origin).toBe("https://hortvitalmix.vercel.app");
        expect(file?.options.responseType).toBe("arraybuffer");
        expect(file?.options.headers?.authorization).toBeUndefined();
        expect(errors).toEqual([]);
      });

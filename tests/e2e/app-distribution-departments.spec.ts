// Installation, responsive departments, guards and real Service Worker
// transitions now run against compiled builds in tests/pwa. Native availability
// and private APIs remain covered by the existing unit/integration suites.
import { expect, test } from "@playwright/test";

test("public application department prioritizes the same PWA for both platforms", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ status: 401, json: { error: "AUTH_REQUIRED" } }));
  await page.goto("/aplicativos");
  await expect(page.getByRole("button", { name: "Instalar para Android", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Instalar para iPhone e iPad", exact: true })).toBeEnabled();
  await expect(page.locator(".hvm-pwa-cards")).not.toContainText("Em breve");
  await expect(page.locator(".hvm-pwa-cards a[href^='/downloads']")).toHaveCount(0);
});

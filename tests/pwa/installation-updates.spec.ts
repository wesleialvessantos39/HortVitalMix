import { expect, test, type Page } from "@playwright/test";
const actor = "11111111-1111-4111-8111-111111111111";
const androidUA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36";
async function fixture(page: Page, role: string | null = null, allowed = true) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (data: unknown, status = 200) =>
      route.fulfill({ json: data, status });
    if (path.endsWith("/v1/config"))
      return json({
        platformName: "HortiVitalMix",
        slogan: "Tudo fresco.",
        defaultMunicipality: "Ariquemes",
        defaultState: "RO",
        currency: "BRL",
        timezone: "America/Porto_Velho",
        supportEmail: "synthetic@example.invalid",
        supportPhone: null,
        revision: 1,
      });
    if (path.endsWith("/auth/session"))
      return role
        ? json({
            userId: actor,
            email: "synthetic@example.invalid",
            roles: [role],
            activeRole: role,
            portalKind: role.startsWith("platform_")
              ? "administrative"
              : "public",
          })
        : json({ error: "AUTH_REQUIRED" }, 401);
    if (path.endsWith("/admin/auth/verify-session"))
      return json({
        authorized: true,
        role: role ?? "platform_admin",
        sectors: allowed ? ["platform_configuration"] : [],
        deniedSectors: allowed ? [] : ["platform_configuration"],
        requiresReauth: false,
      });
    if (path.includes("notifications"))
      return json({
        notifications: [],
        unreadCount: 0,
        total: 0,
        page: 1,
        pageSize: 20,
        asOf: "2026-10-10T00:00:00Z",
        hasMore: false,
      });
    if (path.endsWith("/account/addresses")) return json({ addresses: [] });
    return json({});
  });
}
const loadedBuild = (page: Page) =>
  page.locator('meta[name="hvm-pwa-build"]').getAttribute("content");
async function ready(page: Page) {
  await expect(
    page.getByText("Aplicativo atualizado", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    navigator.serviceWorker.ready.then(() => undefined),
  );
}
async function controlled(page: Page) {
  await page.goto("/aplicativos");
  await ready(page);
  await page.reload();
  await ready(page);
  expect(
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  ).toBe(true);
}
async function check(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("hvm:pwa-check")));
}
async function prompt(page: Page, outcome: "accepted" | "dismissed") {
  await page.evaluate((outcome) => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        (window as any).__syntheticPromptCalls =
          ((window as any).__syntheticPromptCalls ?? 0) + 1;
      },
      userChoice: Promise.resolve({ outcome, platform: "web" }),
    });
    window.dispatchEvent(event);
  }, outcome);
}
test.beforeEach(async ({ request }) => {
  await request.post("/__pwa_test__/switch", { data: { build: "a" } });
});

for (const width of [320, 360, 390, 430, 768, 1024, 1440])
  test(`home installation cards fit ${width}px`, async ({ page }) => {
    await fixture(page);
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(
      page
        .locator(".hvm-app-download")
        .getByRole("button", { name: "Instalar para Android", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator(".hvm-app-download")
        .getByRole("button", {
          name: "Instalar para iPhone e iPad",
          exact: true,
        }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

for (const [width, height] of [
  [320, 700],
  [360, 780],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1024, 768],
  [1440, 900],
  [844, 390],
]) {
  test(`public cards and installation guides fit ${width}×${height}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await fixture(page);
    await page.setViewportSize({ width, height });
    await page.goto("/aplicativos");
    await ready(page);
    await expect(
      page.getByRole("button", { name: "Instalar para Android", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", {
        name: "Instalar para iPhone e iPad",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(page.locator(".hvm-pwa-cards")).not.toContainText("Em breve");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`public-${width}-${height}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Instalar para iPhone e iPad", exact: true })
      .click();
    const guide = page.getByRole("dialog");
    await expect(guide).toBeVisible();
    await expect(guide).toContainText("Abrir como App da Web");
    expect(
      await guide.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`ios-guide-${width}-${height}.png`),
    });
    await guide.getByRole("button", { name: "Entendi", exact: true }).click();
    expect(errors).toEqual([]);
  });
}
for (const role of ["platform_admin", "platform_super_admin"])
  for (const width of [320, 390, 768, 1440])
    test(`${role} with configuration power: PWA central fits ${width}px`, async ({
      page,
    }, info) => {
      await fixture(page, role);
      await page.setViewportSize({ width, height: 850 });
      await page.goto("/admin/aplicativos");
      await expect(
        page.getByRole("heading", {
          name: "Aplicativos e atualizações",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Estado da instalação PWA" }),
      ).toBeVisible();
      await expect(
        page.locator(".admin-mobile-release-center, input[type='url']"),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`admin-${role}-${width}.png`),
        fullPage: true,
      });
    });
for (const role of ["platform_admin", "platform_super_admin"])
  test(`${role}: explicit power denial protects the department`, async ({
    page,
  }) => {
    await fixture(page, role, false);
    await page.goto("/admin/aplicativos");
    await expect(page.locator(".admin-pwa-page")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Instalar para Android", exact: true }),
    ).toHaveCount(0);
  });
for (const role of ["consumer", "producer"])
  test(`${role}: shared registration works without opening a producer screen`, async ({
    page,
  }) => {
    await fixture(page, role);
    await page.goto("/aplicativos");
    await ready(page);
    const registrations = await page.evaluate(async () =>
      (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope),
    );
    expect(registrations).toHaveLength(1);
  });

test("Android button uses a real event contract and treats simulated accept, cancel and browser confirmation separately", async ({
  browser,
}) => {
  const context = await browser.newContext({ userAgent: androidUA });
  const page = await context.newPage();
  await fixture(page);
  await page.goto("/aplicativos");
  await ready(page);
  await expect(page.locator(".hvm-pwa-card.is-recommended")).toContainText(
    "Android",
  );
  await prompt(page, "dismissed");
  await page
    .getByRole("button", { name: "Instalar para Android", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Instalação cancelada" }),
  ).toBeVisible();
  await prompt(page, "accepted");
  await page
    .getByRole("button", { name: "Instalar para Android", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Solicitação aceita" }),
  ).toBeVisible();
  await expect(
    page.getByText("Instalado neste dispositivo", { exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(
    page.getByText("Instalação confirmada pelo navegador.", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).__syntheticPromptCalls),
  ).toBe(2);
  await page.reload();
  await ready(page);
  await expect(
    page.getByText("Instalado neste dispositivo", { exact: true }),
  ).toHaveCount(0);
  await context.close();
});

for (const device of ["iphone", "ipad", "internal"])
  test(`${device}: Safari assistant and device signals`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent:
        device === "ipad"
          ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17 Safari/605.1.15"
          : "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18 Mobile Safari/605.1.15" +
            (device === "internal" ? " Instagram" : ""),
    });
    await context.addInitScript((ipad) => {
      Object.defineProperty(navigator, "platform", {
        value: ipad ? "MacIntel" : "iPhone",
      });
      Object.defineProperty(navigator, "maxTouchPoints", { value: 5 });
    }, device === "ipad");
    const page = await context.newPage();
    await fixture(page);
    await page.goto("/instalar/ios");
    await expect(page.locator(".hvm-pwa-card.is-recommended")).toContainText(
      "iPhone e iPad",
    );
    await expect(page.getByRole("dialog")).toContainText(
      "Adicionar à Tela de Início",
    );
    if (device === "internal")
      await expect(page.getByRole("dialog")).toContainText("navegador interno");
    await context.close();
  });

test("standalone suppresses repeated installation without trusting saved preferences", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true });
  });
  await fixture(page);
  await page.goto("/aplicativos");
  await expect(
    page.getByText("Instalado neste dispositivo", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Instalar para Android", exact: true }),
  ).toHaveCount(0);
});

test("a new complete build applies automatically and preserves IndexedDB", async ({
  page,
  request,
}) => {
  await fixture(page);
  await controlled(page);
  const original = await loadedBuild(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const open = indexedDB.open("pwa-preservation-fixture", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("data");
        open.onsuccess = () => {
          const tx = open.result.transaction("data", "readwrite");
          tx.objectStore("data").put("preserved", "marker");
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
  );
  await request.post("/__pwa_test__/switch", { data: { build: "b" } });
  await check(page);
  await expect.poll(() => loadedBuild(page)).not.toBe(original);
  const preserved = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("pwa-preservation-fixture");
        open.onsuccess = () => {
          const r = open.result
            .transaction("data")
            .objectStore("data")
            .get("marker");
          r.onsuccess = () => {
            open.result.close();
            resolve(r.result);
          };
        };
      }),
  );
  expect(preserved).toBe("preserved");
  await expect(
    page.getByText("Aplicativo atualizado", { exact: true }),
  ).toBeVisible();
});

for (const blocker of ["form", "upload", "confirmation", "offline-queue"])
  test(`update waits for ${blocker} and resumes automatically`, async ({
    page,
    request,
  }) => {
    await fixture(page);
    await controlled(page);
    const original = await loadedBuild(page);
    if (blocker === "offline-queue")
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            const open = indexedDB.open("hvm-rural-v1", 1);
            open.onsuccess = () => {
              const tx = open.result.transaction(
                "pending_commands",
                "readwrite",
              );
              tx.objectStore("pending_commands").put({
                commandId: "synthetic",
                userId: "another-local-account",
                sequence: 1,
              });
              tx.oncomplete = () => {
                open.result.close();
                resolve();
              };
            };
          }),
      );
    else
      await page.evaluate((blocker) => {
        const form = document.createElement("form");
        form.id = "synthetic-work";
        if (blocker === "confirmation") {
          form.setAttribute("aria-modal", "true");
          form.textContent = "Synthetic administrative confirmation";
        } else {
          const input = document.createElement("input");
          input.id = "synthetic-input";
          input.type = blocker === "upload" ? "file" : "text";
          form.append(input);
        }
        document.body.append(form);
      }, blocker);
    if (blocker === "form")
      await page.locator("#synthetic-input").fill("unsaved value");
    if (blocker === "upload")
      await page
        .locator("#synthetic-input")
        .setInputFiles({
          name: "synthetic.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("synthetic upload"),
        });
    await request.post("/__pwa_test__/switch", { data: { build: "b" } });
    await check(page);
    await expect(
      page.getByRole("complementary", { name: "Atualização da plataforma" }),
    ).toContainText("Atualização aguardando operação");
    expect(await loadedBuild(page)).toBe(original);
    if (blocker === "form")
      await expect(page.locator("#synthetic-input")).toHaveValue(
        "unsaved value",
      );
    if (blocker === "offline-queue") {
      expect(
        await page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const open = indexedDB.open("hvm-rural-v1");
              open.onsuccess = () => {
                const r = open.result
                  .transaction("pending_commands")
                  .objectStore("pending_commands")
                  .count();
                r.onsuccess = () => {
                  open.result.close();
                  resolve(r.result);
                };
              };
            }),
        ),
      ).toBe(1);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            const open = indexedDB.open("hvm-rural-v1");
            open.onsuccess = () => {
              const tx = open.result.transaction(
                "pending_commands",
                "readwrite",
              );
              tx.objectStore("pending_commands").delete("synthetic");
              tx.oncomplete = () => {
                open.result.close();
                window.dispatchEvent(new Event("hvm:offline-changed"));
                resolve();
              };
            };
          }),
      );
    } else
      await page.evaluate(() => {
        const form = document.getElementById(
          "synthetic-work",
        ) as HTMLFormElement;
        form.reset();
        form.remove();
        (document.activeElement as HTMLElement)?.blur();
      });
    await expect
      .poll(() => loadedBuild(page), { timeout: 30000 })
      .not.toBe(original);
  });

test("two tabs wait for the dirty tab before activating either shell", async ({
  context,
  page,
  request,
}) => {
  await fixture(page);
  await controlled(page);
  const original = await loadedBuild(page);
  const other = await context.newPage();
  await fixture(other);
  await other.goto("/aplicativos");
  await ready(other);
  await other.evaluate(() => {
    const form = document.createElement("form");
    form.id = "other-work";
    form.innerHTML = '<input id="other-edit" aria-label="Synthetic edit" />';
    document.body.append(form);
  });
  await other.locator("#other-edit").fill("protected in another tab");
  await request.post("/__pwa_test__/switch", { data: { build: "b" } });
  await check(page);
  await expect(
    page.getByRole("complementary", { name: "Atualização da plataforma" }),
  ).toContainText("Atualização aguardando operação");
  expect(await loadedBuild(page)).toBe(original);
  expect(await loadedBuild(other)).toBe(original);
  await expect(other.locator("#other-edit")).toHaveValue(
    "protected in another tab",
  );
  await other.evaluate(() => {
    (document.getElementById("other-work") as HTMLFormElement).reset();
    document.getElementById("other-work")!.remove();
    (document.activeElement as HTMLElement)?.blur();
  });
  await page.bringToFront();
  await check(page);
  await expect
    .poll(() => loadedBuild(page), { timeout: 30000 })
    .not.toBe(original);
  await expect
    .poll(() => loadedBuild(other), { timeout: 30000 })
    .not.toBe(original);
});

test("failed downloads preserve the old cache and recover after a later verification", async ({
  page,
  request,
}) => {
  await fixture(page);
  await controlled(page);
  const original = await loadedBuild(page);
  await request.post("/__pwa_test__/switch", {
    data: { build: "b", corrupt: true },
  });
  await check(page);
  await expect(page.locator(".hvm-pwa-version")).toContainText(
    "Não foi possível verificar agora",
  );
  expect(await loadedBuild(page)).toBe(original);
  expect(
    await page.evaluate(async () =>
      (await caches.keys()).some((name) =>
        name.startsWith("hvm-rural-assets-"),
      ),
    ),
  ).toBe(true);
  await request.post("/__pwa_test__/switch", { data: { build: "b" } });
  await check(page);
  await expect
    .poll(() => loadedBuild(page), { timeout: 30000 })
    .not.toBe(original);
});

test("offline preserves the shell; reconnection checks the new build without reinstalling", async ({
  context,
  page,
  request,
}) => {
  await fixture(page);
  await controlled(page);
  const original = await loadedBuild(page);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Aplicativos e atualizações",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".hvm-pwa-version")).toContainText("Sem conexão");
  expect(await loadedBuild(page)).toBe(original);
  await request.post("/__pwa_test__/switch", { data: { build: "b" } });
  await context.setOffline(false);
  await expect
    .poll(() => loadedBuild(page), { timeout: 30000 })
    .not.toBe(original);
});

test("private/API responses and authorization are absent from static caches", async ({
  page,
}) => {
  await fixture(page);
  await controlled(page);
  await page.evaluate(() =>
    fetch("/api/v1/admin/private", {
      headers: { Authorization: "Bearer synthetic" },
    }).then(() => undefined),
  );
  const keys = await page.evaluate(async () => {
    const values: string[] = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys())
        values.push(new URL(request.url).pathname);
    return values;
  });
  expect(keys.length).toBeGreaterThan(5);
  expect(
    keys.some((path) =>
      /^\/(api|_hvm_api|downloads|documents|storage)/.test(path),
    ),
  ).toBe(false);
});

test("checkout remains on the old version until its activity is concluded", async ({
  page,
  request,
}) => {
  await fixture(page, "consumer");
  await controlled(page);
  const original = await loadedBuild(page);
  await page.evaluate(() => {
    history.pushState({}, "", "/checkout");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/checkout$/);
  await request.post("/__pwa_test__/switch", { data: { build: "b" } });
  await check(page);
  await expect(
    page.getByRole("complementary", { name: "Atualização da plataforma" }),
  ).toContainText("Atualização aguardando operação");
  expect(await loadedBuild(page)).toBe(original);
  await page.evaluate(() => {
    history.pushState({}, "", "/aplicativos");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect
    .poll(() => loadedBuild(page), { timeout: 30000 })
    .not.toBe(original);
});

test("first registration controls the identical shell for offline use without reloading work", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/aplicativos");
  const original = await loadedBuild(page);
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  expect(await loadedBuild(page)).toBe(original);
});

test("two already open documents with different build identities transition coherently", async ({
  context,
  page,
  request,
}) => {
  await fixture(page);
  await controlled(page);
  const original = await loadedBuild(page);
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.id = "old-build-work";
    form.innerHTML = '<input id="old-build-edit" />';
    document.body.append(form);
  });
  await page.locator("#old-build-edit").fill("protected old build");
  await request.post("/__pwa_test__/switch", { data: { build: "b" } });
  const other = await context.newPage();
  await fixture(other);
  // This LOCAL fixture path bypasses navigation interception to serve build B,
  // while both documents share the real same-origin worker registration.
  await other.goto("/downloads/pwa-test-shell");
  await other.evaluate(() => {
    history.replaceState({}, "", "/aplicativos");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  const newer = await loadedBuild(other);
  expect(newer).not.toBe(original);
  await check(other);
  await expect(
    other.getByRole("complementary", { name: "Atualização da plataforma" }),
  ).toContainText("Atualização aguardando operação");
  await expect(page.locator("#old-build-edit")).toHaveValue(
    "protected old build",
  );
  await page.evaluate(() => {
    (document.getElementById("old-build-work") as HTMLFormElement).reset();
    document.getElementById("old-build-work")!.remove();
    (document.activeElement as HTMLElement)?.blur();
  });
  await page.bringToFront();
  await check(page);
  await expect.poll(() => loadedBuild(page), { timeout: 30000 }).toBe(newer);
  await other.bringToFront();
  await expect(other.locator(".hvm-pwa-version")).toContainText(
    "Aplicativo atualizado",
  );
  expect(await loadedBuild(other)).toBe(newer);
});

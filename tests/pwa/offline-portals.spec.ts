import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const actor = "11111111-1111-4111-8111-111111111111";
const roles = [
  "consumer",
  "producer",
  "platform_admin",
  "platform_super_admin",
] as const;
type Role = (typeof roles)[number];
type Fixture = {
  role: Role;
  profiles: Map<Role, { fullName: string; revision: number }>;
  receipts: Map<string, unknown>;
  writes: number;
  loseResponse: boolean;
  reject: number;
};
async function fixture(context: BrowserContext, role: Role): Promise<Fixture> {
  const state: Fixture = {
    role,
    profiles: new Map(
      roles.map((r) => [r, { fullName: `${r} conectado`, revision: 1 }]),
    ),
    receipts: new Map(),
    writes: 0,
    loseResponse: false,
    reject: 0,
  };
  await context.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.replace(/^\/api/, ""),
      data = req.postDataJSON();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        json: body,
        status,
        headers: {
          "Cache-Control": "private, no-store",
          ...(req.headers()["x-hvm-offline-id"]
            ? { "X-HVM-Offline-Receipt": req.headers()["x-hvm-offline-id"] }
            : {}),
        },
      });
    if (path === "/v1/auth/session")
      return json({
        userId: actor,
        email: "offline@example.invalid",
        fullName: state.profiles.get(state.role)!.fullName,
        roles: [state.role],
        activeRole: state.role,
        portalKind: state.role.startsWith("platform_")
          ? "administrative"
          : "public",
      });
    if (path === "/v1/admin/auth/verify-session")
      return json({
        authorized: true,
        role: state.role,
        sectors: [
          "account_governance",
          "platform_configuration",
          "catalog_moderation",
        ],
        requiresReauth: false,
      });
    if (path === "/v1/config")
      return json({
        platformName: "HortiVitalMix",
        slogan: "Produtos frescos.",
        defaultMunicipality: "Ariquemes",
        defaultState: "RO",
        currency: "BRL",
        timezone: "America/Porto_Velho",
        supportEmail: "offline@example.invalid",
        supportPhone: null,
        revision: 1,
      });
    if (path === "/v1/account/profile") {
      const profile = state.profiles.get(state.role)!;
      if (req.method() === "GET")
        return json({
          ...profile,
          cpfMasked: "***.***.789-09",
          email: "offline@example.invalid",
          phone: "+5569988888888",
          profileRole: state.role,
        });
      if (state.reject)
        return json(
          {
            error: state.reject === 409 ? "REVISION_CONFLICT" : "FORBIDDEN",
            currentRevision: profile.revision,
          },
          state.reject,
        );
      if (req.headers()["x-hvm-offline-scope"] !== `${actor}:${state.role}`)
        return json({ error: "OFFLINE_SCOPE_CHANGED" }, 409);
      const key = req.headers()["x-hvm-offline-id"];
      if (state.receipts.has(key)) return json(state.receipts.get(key));
      if (data.expectedRevision !== profile.revision)
        return json(
          { error: "REVISION_CONFLICT", currentRevision: profile.revision },
          409,
        );
      profile.fullName = data.fullName;
      profile.revision++;
      state.writes++;
      const result = { status: "updated", revision: profile.revision };
      state.receipts.set(key, result);
      if (state.loseResponse) {
        state.loseResponse = false;
        return route.abort("failed");
      }
      return json(result);
    }
    if (path === "/v1/account/preferences")
      return json({
        preferences: {
          marketingConsent: false,
          orderUpdatesChannel: "email",
          quietHoursEnabled: false,
          quietHoursStart: null,
          quietHoursEnd: null,
          revision: 1,
        },
        consents: [],
      });
    if (path.includes("notifications"))
      return json({
        notifications: [],
        unreadCount: 0,
        total: 0,
        page: 1,
        pages: 1,
        asOf: new Date().toISOString(),
      });
    if (path === "/v1/producer/trial") return json({ trial: null });
    if (path === "/v1/producer/sync") return json({ results: [] });
    if (path === "/v1/localities") return json({ municipalities: [] });
    if (path === "/v1/categories") return json({ categories: [] });
    if (path === "/v1/account/addresses") return json({ addresses: [] });
    return json({ error: "FIXTURE_NOT_AVAILABLE" }, 404);
  });
  return state;
}
async function rows(page: Page, store: string) {
  return page.evaluate(
    (name) =>
      new Promise<any[]>((resolve, reject) => {
        const open = indexedDB.open("hvm-rural-v1");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction(name),
            r = tx.objectStore(name).getAll();
          r.onsuccess = () => resolve(r.result);
          tx.oncomplete = () => db.close();
        };
      }),
    store,
  );
}
async function openProfile(page: Page, role: Role) {
  await page.goto(
    role.startsWith("platform_") ? "/admin/conta/perfil" : "/conta/perfil",
  );
  await expect(page.getByLabel("Nome completo", { exact: true })).toHaveValue(
    `${role} conectado`,
  );
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect
    .poll(async () =>
      (await rows(page, "portal_cache")).some(
        (r) => r.path === "/v1/account/profile",
      ),
    )
    .toBe(true);
}
test.beforeEach(async ({ request }) => {
  await request.post("/__pwa_test__/switch", { data: { build: "a" } });
});
for (const role of roles)
  test(`${role}: offline reload, durable edits and automatic reconciliation`, async ({
    page,
    context,
  }) => {
    const state = await fixture(context, role);
    await page.setViewportSize({ width: 390, height: 844 });
    await openProfile(page, role);
    await context.setOffline(true);
    await page
      .getByLabel("Nome completo", { exact: true })
      .fill(`${role} salvo offline`);
    await expect
      .poll(async () => (await rows(page, "portal_drafts")).length)
      .toBeGreaterThan(0);
    await page
      .getByRole("button", { name: "Salvar alterações", exact: true })
      .click();
    await expect(
      page.getByText(
        "Ação salva neste aparelho. Será enviada automaticamente quando a conexão voltar.",
        { exact: true },
      ),
    ).toBeVisible();
    const pending = await rows(page, "portal_requests");
    expect(pending).toHaveLength(1);
    expect(pending[0].scope).toBe(`${actor}:${role}`);
    expect(state.writes).toBe(0);
    await page.reload();
    await expect(page.getByLabel("Nome completo", { exact: true })).toHaveValue(
      `${role} salvo offline`,
    );
    await expect(page.getByText(/Modo offline/)).toBeVisible();
    await context.setOffline(false);
    await expect
      .poll(() => state.profiles.get(role)!.fullName)
      .toBe(`${role} salvo offline`);
    await expect
      .poll(async () => (await rows(page, "portal_requests")).length)
      .toBe(0);
    await expect
      .poll(async () => (await rows(page, "portal_drafts")).length)
      .toBe(0);
    expect(state.writes).toBe(1);
    await expect
      .poll(
        async () =>
          (await rows(page, "portal_cache")).find(
            (r) => r.path === "/v1/account/profile",
          )?.value.revision,
      )
      .toBe(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
test("a lost response recovers the same action without duplicate server writes", async ({
  page,
  context,
}) => {
  const state = await fixture(context, "consumer");
  await openProfile(page, "consumer");
  state.loseResponse = true;
  await page
    .getByLabel("Nome completo", { exact: true })
    .fill("Resposta recuperada");
  await page
    .getByRole("button", { name: "Salvar alterações", exact: true })
    .click();
  await expect.poll(() => state.writes).toBe(1);
  await expect
    .poll(async () => (await rows(page, "portal_requests")).length)
    .toBe(0);
  expect(state.writes).toBe(1);
});
test("offline conflict preserves the local action and the newer server value", async ({
  page,
  context,
}) => {
  const state = await fixture(context, "consumer");
  await openProfile(page, "consumer");
  await context.setOffline(true);
  await page
    .getByLabel("Nome completo", { exact: true })
    .fill("Alteracao local em conflito");
  await page
    .getByRole("button", { name: "Salvar alterações", exact: true })
    .click();
  state.profiles.set("consumer", {
    fullName: "Servidor mais recente",
    revision: 2,
  });
  await context.setOffline(false);
  await expect
    .poll(async () => (await rows(page, "portal_requests"))[0]?.state)
    .toBe("conflict");
  expect(state.profiles.get("consumer")!.fullName).toBe(
    "Servidor mais recente",
  );
  expect(state.writes).toBe(0);
  expect((await rows(page, "portal_requests"))[0].body).toContain(
    "Alteracao local em conflito",
  );
  await page.getByRole("button", { name: "Ver ações salvas" }).click();
  await expect(page.getByText(/O registro mudou no servidor/)).toBeVisible();
});
test("consumer and producer caches and queues remain separate for the same email and user", async ({
  page,
  context,
}) => {
  const state = await fixture(context, "consumer");
  await openProfile(page, "consumer");
  await context.setOffline(true);
  await page
    .getByLabel("Nome completo", { exact: true })
    .fill("Somente consumidor");
  await page
    .getByRole("button", { name: "Salvar alterações", exact: true })
    .click();
  state.role = "producer";
  await context.setOffline(false);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("hvm:session-changed")),
  );
  await expect(page.getByLabel("Nome completo", { exact: true })).toHaveValue(
    "producer conectado",
  );
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel("Nome completo", { exact: true })).toHaveValue(
    "producer conectado",
  );
  const queue = await rows(page, "portal_requests");
  expect(queue).toHaveLength(1);
  expect(queue[0].scope).toBe(`${actor}:consumer`);
  expect(state.writes).toBe(0);
  await expect(
    page.getByRole("button", { name: "Ver ações salvas" }),
  ).toHaveCount(0);
});
test("permission loss rejects the admin action and preserves it locally", async ({
  page,
  context,
}) => {
  const state = await fixture(context, "platform_admin");
  await openProfile(page, "platform_admin");
  await context.setOffline(true);
  await page
    .getByLabel("Nome completo", { exact: true })
    .fill("Acesso retirado");
  await page
    .getByRole("button", { name: "Salvar alterações", exact: true })
    .click();
  state.reject = 403;
  await context.setOffline(false);
  await expect
    .poll(async () => (await rows(page, "portal_requests"))[0]?.state)
    .toBe("rejected");
  expect(state.writes).toBe(0);
  expect((await rows(page, "portal_requests"))[0].body).toContain(
    "Acesso retirado",
  );
});
test("connected changes are pulled automatically and refresh the current screen", async ({
  page,
  context,
}) => {
  const state = await fixture(context, "consumer");
  await openProfile(page, "consumer");
  state.profiles.set("consumer", {
    fullName: "Atualizado em outro aparelho",
    revision: 2,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("Nome completo", { exact: true })).toHaveValue(
    "Atualizado em outro aparelho",
  );
  expect(state.writes).toBe(0);
});
test("a connected refresh never overwrites a form being edited", async ({
  page,
  context,
}) => {
  const state = await fixture(context, "consumer");
  await openProfile(page, "consumer");
  await page
    .getByLabel("Nome completo", { exact: true })
    .fill("Rascunho que deve continuar");
  state.profiles.set("consumer", {
    fullName: "Mudou no servidor",
    revision: 2,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(
      async () =>
        (await rows(page, "portal_cache")).find(
          (r) => r.path === "/v1/account/profile",
        )?.value.fullName,
    )
    .toBe("Mudou no servidor");
  await expect(page.getByLabel("Nome completo", { exact: true })).toHaveValue(
    "Rascunho que deve continuar",
  );
});
test("offline reload restores older drafts, distinct radio choices and checkboxes", async ({
  page,
  context,
}) => {
  await fixture(context, "consumer");
  await page.goto("/conta/preferencias");
  const sms = page.getByRole("radio", { name: "SMS", exact: true }),
    quiet = page.getByRole("checkbox", { name: "Ativar horário de silêncio" });
  await expect(sms).toBeVisible();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await sms.check();
  await quiet.check();
  await expect
    .poll(async () => (await rows(page, "portal_drafts")).length)
    .toBeGreaterThan(0);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("hvm-rural-v1");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction("portal_drafts", "readwrite"),
            store = tx.objectStore("portal_drafts"),
            r = store.getAll();
          r.onsuccess = () =>
            r.result.forEach((row) =>
              store.put({ ...row, savedAt: Date.now() - 30 * 86400000 }),
            );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await expect(sms).toBeChecked();
  await expect(quiet).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "E-mail", exact: true }),
  ).not.toBeChecked();
});

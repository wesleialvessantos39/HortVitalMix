import { expect, test, type Page } from "@playwright/test";

type Role = "platform_admin" | "platform_super_admin" | "consumer" | "producer";
const token = "a".repeat(64);
const actorId = "11111111-1111-4111-8111-111111111111";

async function expectGuestHome(page: Page) {
  await expect(
    page
      .locator('.account-status-icon[data-session-role="guest"]:visible')
      .first(),
  ).toBeVisible();
  await expect(page.locator(".account-status-icon.is-connected")).toHaveCount(
    0,
  );
}

async function expectAdministrativeLogin(
  page: Page,
  role: "platform_admin" | "platform_super_admin",
) {
  const choose = page.getByRole("button", {
    name:
      role === "platform_super_admin"
        ? "Entrar como Super administrador"
        : "Entrar como Administrador",
    exact: true,
  });
  if (new URL(page.url()).pathname === "/admin/entrar") {
    await expect(choose).toBeVisible();
    await choose.click();
  }
  await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
  await expect(page.locator(".admin-sidebar")).toHaveCount(0);
}

async function privateSnapshot(page: Page) {
  return page.evaluate(
    (userId) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("hvm-rural-v1", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("snapshots", "readonly");
          const request = tx
            .objectStore("snapshots")
            .get(userId + ":/v1/producer/products");
          request.onsuccess = () => resolve(request.result?.value ?? null);
          request.onerror = () => reject(request.error);
          tx.oncomplete = () => db.close();
        };
      }),
    actorId,
  );
}

async function fixture(
  page: Page,
  role: Role,
  status: string,
  failOnce = false,
  shared?: { logged: boolean },
) {
  const identity = shared ?? { logged: true };
  let unavailable = failOnce;
  const commands: Array<{
    path: string;
    authorization?: string;
    body: unknown;
  }> = [];
  await page.addInitScript(() => {
    if (sessionStorage.getItem("invite-exit-seeded")) return;
    sessionStorage.setItem("invite-exit-seeded", "1");
    localStorage.setItem(
      "hvm.admin.session",
      JSON.stringify({
        accessToken: "synthetic-admin-bearer",
        refreshToken: "synthetic-admin-refresh",
        expiresAt: Date.now() + 3_600_000,
      }),
    );
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(
      /^\/(?:api|_hvm_api)/,
      "",
    );
    if (!path.startsWith("/v1/")) return route.continue();
    const json = (data: unknown, code = 200) =>
      route.fulfill({ json: data, status: code });
    if (request.method() !== "GET")
      commands.push({
        path,
        authorization: request.headers().authorization,
        body: request.postDataJSON(),
      });
    if (path === "/v1/auth/session")
      return identity.logged
        ? json({
            userId: actorId,
            email: "synthetic@example.invalid",
            fullName: "Pessoa Sintética",
            roles: [role],
            activeRole: role,
            portalKind: role.startsWith("platform_")
              ? "administrative"
              : "public",
          })
        : json({ error: "SESSION_REQUIRED" }, 401);
    if (path === "/v1/admin/invites/validate")
      return json(
        status === "valid"
          ? {
              status,
              targetRole: role,
              email: "invited@example.invalid",
              identityMode: "new",
              sectors: [],
            }
          : { status },
      );
    if (path === "/v1/admin/invites/accept")
      return json({ status: "accepted" });
    if (path === "/v1/auth/logout") {
      if (unavailable) {
        unavailable = false;
        return json({ error: "DEPENDENCY_UNAVAILABLE" }, 503);
      }
      identity.logged = false;
      return route.fulfill({ status: 204, body: "" });
    }
    if (path === "/v1/admin/auth/verify-session")
      return identity.logged
        ? json({
            authorized: true,
            role,
            sectors: [],
            deniedSectors: [],
            requiresReauth: false,
          })
        : json({ error: "UNAUTHORIZED" }, 401);
    if (path === "/v1/admin/bootstrap/status")
      return json({ status: "closed" });
    if (path === "/v1/config")
      return json({
        platformName: "HortiVitalMix",
        slogan: "Tudo fresco.",
        defaultMunicipality: "Ariquemes",
        defaultState: "RO",
        currency: "BRL",
        timezone: "America/Porto_Velho",
        supportEmail: "suporte@example.invalid",
        supportPhone: null,
        revision: 1,
      });
    if (path === "/v1/notifications")
      return json({ notifications: [], unreadCount: 0 });
    return json({});
  });
  return {
    commands,
    logoutCalls: () =>
      commands.filter((value) => value.path === "/v1/auth/logout"),
  };
}

for (const role of [
  "platform_admin",
  "platform_super_admin",
  "consumer",
  "producer",
] as const) {
  for (const status of [
    "invalid",
    "expired",
    "invalidated",
    "already_accepted",
  ]) {
    test(`${role}: ${status} invite offers only safe site exit`, async ({
      page,
    }) => {
      const mocked = await fixture(page, role, status);
      await page.setViewportSize({
        width:
          role === "platform_super_admin" || role === "producer" ? 1440 : 360,
        height: 844,
      });
      await page.goto(
        `/admin/aceitar-convite?token=${token}#access_token=synthetic-never-imported`,
      );
      await expect(
        page.getByRole("heading", { name: "Este convite não está disponível" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Ir para o acesso administrativo" }),
      ).toHaveCount(0);
      expect(mocked.commands).toHaveLength(0);
      await page
        .getByRole("button", { name: "← Voltar ao site", exact: true })
        .click();
      await expect(page).toHaveURL(/\/$/);
      await expectGuestHome(page);
      expect(mocked.logoutCalls()).toEqual([
        {
          path: "/v1/auth/logout",
          authorization: "Bearer synthetic-admin-bearer",
          body: { refreshToken: "synthetic-admin-refresh" },
        },
      ]);
      expect(
        await page.evaluate(() => localStorage.getItem("hvm.admin.session")),
      ).toBeNull();
      expect(
        mocked.commands.some((value) =>
          /login|import-session|refresh|invites\/accept/.test(value.path),
        ),
      ).toBe(false);
      await page.goto("/entrar/super-administrador");
      await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
      await expect(page.locator(".admin-sidebar")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
  test(`${role}: failed revocation keeps the invitation open until a successful retry`, async ({
    page,
  }) => {
    const mocked = await fixture(page, role, "expired", true);
    await page.goto(`/admin/aceitar-convite?token=${token}`);
    await expect(
      page.getByRole("heading", { name: "Este convite não está disponível" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "← Voltar ao site", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Não foi possível encerrar as sessões com segurança",
    );
    await expect(page).toHaveURL(
      new RegExp(`/admin/aceitar-convite\\?token=${token}$`),
    );
    expect(
      await page.evaluate(() => localStorage.getItem("hvm.admin.session")),
    ).not.toBeNull();
    await page
      .getByRole("button", { name: "← Voltar ao site", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expectGuestHome(page);
    expect(mocked.logoutCalls()).toHaveLength(2);
  });
}

test("back navigation and refresh cannot reactivate a session after invitation exit", async ({
  page,
}) => {
  const mocked = await fixture(
    page,
    "platform_super_admin",
    "already_accepted",
  );
  await page.goto(`/admin/aceitar-convite?token=${token}`);
  await expect(
    page.getByRole("heading", { name: "Este convite não está disponível" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "← Voltar ao site", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.reload();
  await expectGuestHome(page);
  await page.goto("/admin/painel");
  await expect(page).toHaveURL(/\/admin\/entrar$/);
  await expectAdministrativeLogin(page, "platform_super_admin");
  expect(mocked.logoutCalls()).toHaveLength(1);
});

for (const role of ["platform_admin", "platform_super_admin"] as const) {
  test(`${role}: accepting a valid invitation opens a password login after closing the previous account`, async ({
    page,
  }) => {
    const mocked = await fixture(page, role, "valid");
    await page.goto(`/admin/aceitar-convite?token=${token}`);
    await page
      .getByLabel("Nome completo", { exact: true })
      .fill("Pessoa Convidada Sintética");
    await page.getByLabel("CPF", { exact: true }).fill("52998224725");
    await page
      .getByLabel("Celular com DDD", { exact: true })
      .fill("69999999999");
    await page.locator('input[name="password"]').fill("Synthetic!Password2026");
    await page
      .getByRole("button", {
        name: "Aceitar convite e ativar acesso",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(
      role === "platform_super_admin"
        ? /\/entrar\/super-administrador$/
        : /\/admin\/entrar$/,
    );
    await expectAdministrativeLogin(page, role);
    await expect(page.locator(".admin-sidebar")).toHaveCount(0);
    expect(mocked.commands.map((value) => value.path)).toEqual([
      "/v1/admin/invites/accept",
      "/v1/auth/logout",
    ]);
    expect(
      await page.evaluate(() => localStorage.getItem("hvm.admin.session")),
    ).toBeNull();
  });

  test(`${role}: accepted invitation cannot navigate to a stale account when logout fails`, async ({
    page,
  }) => {
    const mocked = await fixture(page, role, "valid", true);
    await page.goto(`/admin/aceitar-convite?token=${token}`);
    await page
      .getByLabel("Nome completo", { exact: true })
      .fill("Pessoa Convidada Sintética");
    await page.getByLabel("CPF", { exact: true }).fill("52998224725");
    await page
      .getByLabel("Celular com DDD", { exact: true })
      .fill("69999999999");
    await page.locator('input[name="password"]').fill("Synthetic!Password2026");
    await page
      .getByRole("button", {
        name: "Aceitar convite e ativar acesso",
        exact: true,
      })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Seu convite foi aceito",
    );
    await expect(page).toHaveURL(
      new RegExp(`/admin/aceitar-convite\\?token=${token}$`),
    );
    await expect(
      page.getByRole("button", {
        name: "Aceitar convite e ativar acesso",
        exact: true,
      }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "← Voltar ao site", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expectGuestHome(page);
    expect(
      mocked.commands.filter(
        (value) => value.path === "/v1/admin/invites/accept",
      ),
    ).toHaveLength(1);
    expect(mocked.logoutCalls()).toHaveLength(2);
  });
}

test("exit clears offline producer authentication and cached private data", async ({
  page,
  context,
}) => {
  await fixture(page, "producer", "expired");
  await page.goto(`/admin/aceitar-convite?token=${token}`);
  await expect(
    page.getByRole("heading", { name: "Este convite não está disponível" }),
  ).toBeVisible();
  await page.evaluate(async (userId) => {
    const modulePath = "/src/lib/offlineDb.ts";
    const offline = await import(modulePath);
    await offline.saveProducerSession({
      userId,
      email: "synthetic@example.invalid",
      roles: ["producer"],
      activeRole: "producer",
      portalKind: "public",
    });
    await offline.cacheSnapshot(userId, "/v1/producer/products", {
      products: [{ id: "private-synthetic-product" }],
    });
  }, actorId);
  await page
    .getByRole("button", { name: "← Voltar ao site", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  const session = await page.evaluate(async () => {
    const modulePath = "/src/lib/offlineDb.ts";
    const offline = await import(modulePath);
    return offline.readProducerSession();
  });
  expect(session).toBeNull();
  expect(await privateSnapshot(page)).toBeNull();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expectGuestHome(page);
});

test("late producer responses cannot recreate private snapshots after exit", async ({
  page,
}) => {
  await fixture(page, "producer", "expired");
  let respond!: () => Promise<void>;
  let started = false;
  await page.route("**/v1/producer/products", async (route) => {
    started = true;
    await new Promise<void>((resolve) => {
      respond = async () => {
        await route.fulfill({
          json: { products: [{ id: "late-private-product" }] },
        });
        resolve();
      };
    });
  });
  await page.goto(`/admin/aceitar-convite?token=${token}`);
  await expect(
    page.getByRole("heading", { name: "Este convite não está disponível" }),
  ).toBeVisible();
  await page.evaluate(async (userId) => {
    const modulePath = "/src/lib/offlineDb.ts";
    const offline = await import(modulePath);
    (window as unknown as { lateRead: Promise<unknown> }).lateRead = offline
      .producerRead(userId, "/v1/producer/products", {
        parse: (value: unknown) => value,
      })
      .catch((error: Error) => error.message);
  }, actorId);
  await expect.poll(() => started).toBe(true);
  await page
    .getByRole("button", { name: "← Voltar ao site", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await respond();
  expect(
    await page.evaluate(
      () => (window as unknown as { lateRead: Promise<unknown> }).lateRead,
    ),
  ).toBe("SESSION_CHANGED");
  expect(await privateSnapshot(page)).toBeNull();
});

test("exit waits for an in-flight refresh and revokes the refreshed administrative credentials", async ({
  page,
}) => {
  const mocked = await fixture(page, "platform_super_admin", "expired");
  let refreshStarted = false;
  let release!: () => Promise<void>;
  await page.route("**/v1/admin/invites/validate?*", (route) => {
    if (refreshStarted) return route.fulfill({ json: { status: "expired" } });
    return route.fulfill({ status: 401, json: { error: "UNAUTHORIZED" } });
  });
  await page.route("**/v1/auth/refresh", async (route) => {
    refreshStarted = true;
    await new Promise<void>((resolve) => {
      release = async () => {
        await route.fulfill({
          json: {
            accessToken: "refreshed-before-exit",
            refreshToken: "refreshed-before-exit-refresh",
            expiresIn: 3600,
          },
        });
        resolve();
      };
    });
  });
  await page.goto(`/admin/aceitar-convite?token=${token}`);
  await expect.poll(() => refreshStarted).toBe(true);
  await page
    .getByRole("button", { name: "← Voltar ao site", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Encerrando sessões…", exact: true }),
  ).toBeDisabled();
  expect(mocked.logoutCalls()).toHaveLength(0);
  await release();
  await expect(page).toHaveURL(/\/$/);
  await expectGuestHome(page);
  expect(mocked.logoutCalls()).toEqual([
    {
      path: "/v1/auth/logout",
      authorization: "Bearer refreshed-before-exit",
      body: { refreshToken: "refreshed-before-exit-refresh" },
    },
  ]);
  expect(
    await page.evaluate(() => localStorage.getItem("hvm.admin.session")),
  ).toBeNull();
});

for (const role of [
  "platform_admin",
  "platform_super_admin",
  "consumer",
  "producer",
] as const) {
  test(`${role}: safe invitation exit also removes authenticated UI in another tab`, async ({
    page,
    context,
  }) => {
    const identity = { logged: true };
    const other = await context.newPage();
    await fixture(page, role, "expired", false, identity);
    await fixture(other, role, "expired", false, identity);
    await page.goto(`/admin/aceitar-convite?token=${token}`);
    await expect(
      page.getByRole("heading", { name: "Este convite não está disponível" }),
    ).toBeVisible();
    await other.goto(role.startsWith("platform_") ? "/admin/painel" : "/");
    if (role.startsWith("platform_"))
      await expect(other.locator(".admin-sidebar")).toBeVisible();
    else
      await expect(
        other.getByRole("button", { name: "Faça parte", exact: true }),
      ).toHaveCount(0);
    await page
      .getByRole("button", { name: "← Voltar ao site", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
    if (role.startsWith("platform_")) {
      await expect(other).toHaveURL(/\/admin\/entrar$/);
      await expectAdministrativeLogin(
        other,
        role as "platform_admin" | "platform_super_admin",
      );
      await expect(other.locator(".admin-sidebar")).toHaveCount(0);
    } else {
      await expectGuestHome(other);
    }
    expect(
      await other.evaluate(() => localStorage.getItem("hvm.admin.session")),
    ).toBeNull();
  });
}

test("late administrative validation in another tab cannot restore its portal after exit", async ({
  page,
  context,
}) => {
  const identity = { logged: true };
  const other = await context.newPage();
  await fixture(page, "platform_super_admin", "expired", false, identity);
  await fixture(other, "platform_super_admin", "expired", false, identity);
  await page.goto(`/admin/aceitar-convite?token=${token}`);
  await expect(
    page.getByRole("heading", { name: "Este convite não está disponível" }),
  ).toBeVisible();
  await other.goto("/admin/painel");
  await expect(other.locator(".admin-sidebar")).toBeVisible();
  let started = false;
  let respond!: () => Promise<void>;
  await other.route("**/v1/admin/auth/verify-session", async (route) => {
    started = true;
    await new Promise<void>((resolve) => {
      respond = async () => {
        await route
          .fulfill({
            json: {
              authorized: true,
              role: "platform_super_admin",
              sectors: [],
              deniedSectors: [],
              requiresReauth: false,
            },
          })
          .catch(() => {});
        resolve();
      };
    });
  });
  await other.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => started).toBe(true);
  await page
    .getByRole("button", { name: "← Voltar ao site", exact: true })
    .click();
  await expect(other).toHaveURL(/\/admin\/entrar$/);
  await respond();
  await expectAdministrativeLogin(other, "platform_super_admin");
  await expect(other.locator(".admin-sidebar")).toHaveCount(0);
});

test("navigating back during activation cannot redirect or log out the next screen", async ({
  page,
}) => {
  const mocked = await fixture(page, "platform_super_admin", "valid");
  let started = false;
  let respond!: () => Promise<void>;
  await page.route("**/v1/admin/invites/accept", async (route) => {
    started = true;
    await new Promise<void>((resolve) => {
      respond = async () => {
        await route.fulfill({ json: { status: "accepted" } }).catch(() => {});
        resolve();
      };
    });
  });
  await page.goto("/");
  await page.evaluate((inviteToken) => {
    history.pushState({}, "", "/admin/aceitar-convite?token=" + inviteToken);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, token);
  await page
    .getByLabel("Nome completo", { exact: true })
    .fill("Pessoa Convidada Sintética");
  await page.getByLabel("CPF", { exact: true }).fill("52998224725");
  await page.getByLabel("Celular com DDD", { exact: true }).fill("69999999999");
  await page.locator('input[name="password"]').fill("Synthetic!Password2026");
  await page
    .getByRole("button", {
      name: "Aceitar convite e ativar acesso",
      exact: true,
    })
    .click();
  await expect.poll(() => started).toBe(true);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await respond();
  await expect(
    page
      .locator(
        '.account-status-icon[data-session-role="platform_super_admin"]:visible',
      )
      .first(),
  ).toBeVisible();
  expect(mocked.logoutCalls()).toHaveLength(0);
  expect(
    await page.evaluate(() => localStorage.getItem("hvm.admin.session")),
  ).not.toBeNull();
  await expect(page).toHaveURL(/\/$/);
});

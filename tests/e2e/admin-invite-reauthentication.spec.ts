import { expect, test, type Page } from "@playwright/test";
import type {
  AdminRole,
  InviteResponse,
} from "../../shared/contracts/adminGovernance";

const actorId = "22222222-2222-4222-8222-222222222222";
const differentActorId = "99999999-9999-4999-8999-999999999999";
const inviteId = "33333333-3333-4333-8333-333333333333";
const acceptedInviteId = "44444444-4444-4444-8444-444444444444";
const email = "convidado@example.invalid";
const password = "synthetic-confirmation-password";
const sector = {
  code: "catalog_moderation" as const,
  name: "Moderação do catálogo",
  description: "Revisão do catálogo e produtos",
};
type Command = {
  method: string;
  path: string;
  body: Record<string, unknown>;
  authorization: string | undefined;
};
type FixtureOptions = {
  role?: AdminRole;
  reauthenticatedActorId?: string;
  stillRequiresReauth?: boolean;
  unauthorized?: boolean;
  seedHistory?: boolean;
  confirmationGate?: Promise<void>;
  confirmationUnavailableOnce?: boolean;
};

function invite(id = inviteId, isAccepted = false): InviteResponse {
  return {
    id,
    email,
    isAccepted,
    invitedBy: actorId,
    targetRole: "platform_admin",
    identityMode: "new",
    sectors: [sector.code],
    revision: 1,
    createdAt: "2026-10-08T00:00:00.000Z",
    expiresAt: "2099-10-09T00:00:00.000Z",
    invalidatedAt: null,
  };
}

async function mockGovernance(page: Page, options: FixtureOptions = {}) {
  const role = options.role ?? "platform_super_admin";
  const commands: Command[] = [];
  let confirmed = false;
  let confirmationUnavailable = Boolean(options.confirmationUnavailableOnce);
  let history = options.seedHistory
    ? [invite(), invite(acceptedInviteId, true)]
    : [];
  await page.addInitScript(() => {
    localStorage.setItem(
      "hvm.admin.session",
      JSON.stringify({
        accessToken: "synthetic-old-access-token",
        refreshToken: "synthetic-old-refresh-token",
        expiresAt: Date.now() + 3_600_000,
      }),
    );
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(
      /^\/(api|_hvm_api)/,
      "",
    );
    if (!path.startsWith("/v1/")) return route.continue();
    const method = request.method();
    const body = method === "GET" ? {} : (request.postDataJSON() ?? {});
    const json = (value: unknown, status = 200) =>
      route.fulfill({ json: value, status });
    if (method !== "GET") {
      commands.push({
        method,
        path,
        body,
        authorization: request.headers().authorization,
      });
    }
    if (path === "/v1/auth/session") {
      return json({
        userId: actorId,
        email: "gestor@example.invalid",
        fullName: "Gestor Teste",
        roles: [role],
        activeRole: role,
        portalKind: "administrative",
      });
    }
    if (path === "/v1/admin/auth/verify-session") {
      return json({
        authorized: true,
        role,
        sectors: [sector.code],
        deniedSectors: [],
        requiresReauth: true,
      });
    }
    if (path === "/v1/config") {
      return json({
        platformName: "HortiVitalMix",
        slogan: "Alimentos frescos perto de você.",
        defaultMunicipality: "Ariquemes",
        defaultState: "RO",
        currency: "BRL",
        timezone: "America/Porto_Velho",
        supportEmail: "support@example.invalid",
        supportPhone: null,
        revision: 1,
      });
    }
    if (path === "/v1/admin/sectors") return json({ sectors: [sector] });
    if (path === "/v1/admin/identities/lookup") return json({ found: false });
    if (path === "/v1/auth/refresh")
      return json({ error: "UNAUTHORIZED" }, 401);
    if (path === "/v1/admin/auth/reauthenticate") {
      if (options.confirmationGate) await options.confirmationGate;
      if (confirmationUnavailable) {
        confirmationUnavailable = false;
        return json({ error: "unavailable" }, 503);
      }
      if (body.password !== password)
        return json({ status: "invalid_credentials" }, 401);
      confirmed = true;
      return json({
        status: "session_created",
        userId: options.reauthenticatedActorId ?? actorId,
        role,
        accessToken: "synthetic-confirmed-access-token",
        refreshToken: "synthetic-confirmed-refresh-token",
        expiresIn: 3600,
        sectors: [sector.code],
        deniedSectors: [],
      });
    }
    const isInviteMutation =
      path.startsWith("/v1/admin/invites") && method !== "GET";
    if (isInviteMutation && options.unauthorized)
      return json({ error: "UNAUTHORIZED" }, 401);
    if (isInviteMutation && (!confirmed || options.stillRequiresReauth)) {
      return json({ error: "ADMIN_REAUTHENTICATION_REQUIRED", actorId }, 401);
    }
    if (path === "/v1/admin/invites/clear-history") {
      const count = history.filter((item) => item.isAccepted).length;
      history = history.filter((item) => !item.isAccepted);
      return json({ status: "cleared", count });
    }
    if (path.startsWith("/v1/admin/invites/") && method === "DELETE") {
      history = history.filter((item) => item.id !== path.split("/").at(-1));
      return json({ status: "deleted" });
    }
    if (path === "/v1/admin/invites" && method === "POST") {
      const created: InviteResponse = {
        ...invite(),
        email: String(body.email),
        targetRole: body.targetRole as AdminRole,
        sectors: body.sectors as InviteResponse["sectors"],
      };
      history = [created, ...history];
      return json({ status: "created", invite: created }, 201);
    }
    if (path === "/v1/admin/invites") return json({ invites: history });
    return json({});
  });
  return {
    commands,
    inviteCommands: () =>
      commands.filter((item) => item.path.startsWith("/v1/admin/invites")),
    confirmationCommands: () =>
      commands.filter((item) => item.path === "/v1/admin/auth/reauthenticate"),
  };
}

async function fillDraft(page: Page, targetRole: AdminRole = "platform_admin") {
  await expect(
    page.getByRole("heading", { name: "Convites administrativos" }),
  ).toBeVisible();
  await page.getByLabel("CPF já cadastrado (opcional)").fill("52998224725");
  await page.getByLabel("E-mail administrativo", { exact: true }).fill(email);
  await page
    .getByRole("combobox", { name: "Papel", exact: true })
    .selectOption(targetRole);
  if (targetRole === "platform_admin") {
    await page.getByRole("checkbox", { name: /Moderação do catálogo/ }).check();
  }
}

function confirmationDialog(page: Page) {
  return page.getByRole("dialog", {
    name: "Confirmar operação administrativa",
    exact: true,
  });
}

async function submitDraft(page: Page) {
  await page
    .getByRole("button", { name: "Enviar convite", exact: true })
    .click();
  await expect(confirmationDialog(page)).toBeVisible();
}

async function confirmPassword(page: Page, value = password) {
  const dialog = confirmationDialog(page);
  await dialog.getByLabel("Senha administrativa", { exact: true }).fill(value);
  await dialog
    .getByRole("button", { name: "Confirmar identidade", exact: true })
    .click();
}

async function expectDraftPreserved(
  page: Page,
  targetRole: AdminRole = "platform_admin",
) {
  await expect(page.getByLabel("CPF já cadastrado (opcional)")).toHaveValue(
    "529.982.247-25",
  );
  await expect(
    page.getByLabel("E-mail administrativo", { exact: true }),
  ).toHaveValue(email);
  await expect(
    page.getByRole("combobox", { name: "Papel", exact: true }),
  ).toHaveValue(targetRole);
  if (targetRole === "platform_admin") {
    await expect(
      page.getByRole("checkbox", { name: /Moderação do catálogo/ }),
    ).toBeChecked();
  }
}

for (const [actorRole, targetRole] of [
  ["platform_admin", "platform_admin"],
  ["platform_super_admin", "platform_admin"],
  ["platform_super_admin", "platform_super_admin"],
] as const) {
  for (const width of [320, 1440]) {
    test(`${actorRole} confirma convite ${targetRole} sem perder dados em ${width}px`, async ({
      page,
    }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const fixture = await mockGovernance(page, { role: actorRole });
      await page.setViewportSize({ width, height: 850 });
      await page.goto("/admin/governanca");
      await fillDraft(page, targetRole);
      if (actorRole === "platform_admin") {
        await expect(
          page
            .getByRole("combobox", { name: "Papel", exact: true })
            .locator("option"),
        ).toHaveCount(1);
      }
      await submitDraft(page);
      expect(fixture.inviteCommands()).toHaveLength(1);
      expect(
        fixture.commands.some((item) => item.path === "/v1/auth/refresh"),
      ).toBe(false);
      expect(
        await confirmationDialog(page).evaluate((dialog) => {
          const rect = dialog.getBoundingClientRect();
          return (
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight
          );
        }),
      ).toBe(true);
      await expect(
        confirmationDialog(page).getByLabel("Senha administrativa", {
          exact: true,
        }),
      ).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (
        actorRole === "platform_admin" ||
        (actorRole === "platform_super_admin" &&
          targetRole === "platform_super_admin")
      ) {
        await page.screenshot({
          path: `artifacts/auditoria/convite-confirmacao-${actorRole}-${width}.png`,
          fullPage: false,
        });
      }
      await confirmPassword(page);
      await expect(
        page.getByRole("status").filter({ hasText: "Convite enviado" }),
      ).toBeVisible();
      await expect(confirmationDialog(page)).not.toBeVisible();
      const attempts = fixture.inviteCommands();
      expect(attempts).toHaveLength(2);
      expect(attempts[1].body).toEqual(attempts[0].body);
      expect(attempts[0].body).toMatchObject({
        email,
        targetCpf: "52998224725",
        targetRole,
        sectors: targetRole === "platform_admin" ? [sector.code] : [],
      });
      expect(attempts[0].body.commandId).toMatch(/^[\da-f-]{36}$/i);
      expect(attempts[1].authorization).toBe(
        "Bearer synthetic-confirmed-access-token",
      );
      expect(fixture.confirmationCommands()).toHaveLength(1);
      expect(fixture.confirmationCommands()[0].body).toEqual({ password });
      await expect(page.getByLabel("CPF já cadastrado (opcional)")).toHaveValue(
        "",
      );
      await expect(
        page.getByLabel("E-mail administrativo", { exact: true }),
      ).toHaveValue("");
      if (
        actorRole === "platform_super_admin" &&
        targetRole === "platform_super_admin" &&
        width === 1440
      ) {
        await page.screenshot({
          path: "artifacts/auditoria/convite-enviado-apos-confirmacao-1440.png",
          fullPage: false,
        });
      }
      expect(pageErrors).toEqual([]);
    });
  }
}

test("cancelar a confirmação preserva o rascunho para uma nova tentativa", async ({
  page,
}) => {
  const fixture = await mockGovernance(page);
  await page.goto("/admin/governanca");
  await fillDraft(page);
  await submitDraft(page);
  await confirmationDialog(page)
    .getByRole("button", { name: "Voltar sem confirmar", exact: true })
    .click();
  await expect(confirmationDialog(page)).not.toBeVisible();
  await expectDraftPreserved(page);
  expect(fixture.inviteCommands()).toHaveLength(1);
  expect(fixture.confirmationCommands()).toHaveLength(0);
  await submitDraft(page);
  await confirmPassword(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Convite enviado" }),
  ).toBeVisible();
  expect(fixture.inviteCommands()).toHaveLength(3);
  const attempts = fixture.inviteCommands();
  expect(attempts[2].body).toEqual(attempts[1].body);
});

test("senha incorreta não envia outro convite e permite corrigir a confirmação", async ({
  page,
}) => {
  const fixture = await mockGovernance(page);
  await page.goto("/admin/governanca");
  await fillDraft(page);
  await submitDraft(page);
  await confirmPassword(page, "synthetic-wrong-password");
  await expect(confirmationDialog(page).getByRole("alert")).toBeVisible();
  expect(fixture.inviteCommands()).toHaveLength(1);
  expect(fixture.confirmationCommands()).toHaveLength(1);
  await expectDraftPreserved(page);
  await confirmPassword(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Convite enviado" }),
  ).toBeVisible();
  expect(fixture.inviteCommands()).toHaveLength(2);
  expect(fixture.confirmationCommands()).toHaveLength(2);
});

test("nova exigência após a confirmação não inicia ciclo de tentativas automáticas", async ({
  page,
}) => {
  const fixture = await mockGovernance(page, { stillRequiresReauth: true });
  await page.goto("/admin/governanca");
  await fillDraft(page);
  await submitDraft(page);
  await confirmPassword(page);
  await expect(page.getByRole("alert")).toBeVisible();
  await expectDraftPreserved(page);
  await expect(
    page.getByRole("button", { name: "Enviar convite", exact: true }),
  ).toBeEnabled();
  expect(fixture.inviteCommands()).toHaveLength(2);
  expect(fixture.confirmationCommands()).toHaveLength(1);
});

test("indisponibilidade da confirmação preserva o rascunho e permite repetir somente a senha", async ({
  page,
}) => {
  const fixture = await mockGovernance(page, {
    confirmationUnavailableOnce: true,
  });
  await page.goto("/admin/governanca");
  await fillDraft(page);
  await submitDraft(page);
  await confirmPassword(page);
  await expect(confirmationDialog(page).getByRole("alert")).toContainText(
    "indisponível",
  );
  await expectDraftPreserved(page);
  expect(fixture.inviteCommands()).toHaveLength(1);
  await confirmPassword(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Convite enviado" }),
  ).toBeVisible();
  expect(fixture.confirmationCommands()).toHaveLength(2);
  expect(fixture.inviteCommands()).toHaveLength(2);
});

test("confirmação de outro usuário não reaplica a operação do ator original", async ({
  page,
}) => {
  const fixture = await mockGovernance(page, {
    reauthenticatedActorId: differentActorId,
  });
  await page.goto("/admin/governanca");
  await fillDraft(page);
  await submitDraft(page);
  await confirmPassword(page);
  await expect
    .poll(
      () =>
        fixture.commands.filter((item) => item.path === "/v1/auth/logout")
          .length,
    )
    .toBe(1);
  expect(fixture.inviteCommands()).toHaveLength(1);
  expect(fixture.confirmationCommands()).toHaveLength(1);
  expect(
    await page.evaluate(() => localStorage.getItem("hvm.admin.session")),
  ).toBeNull();
});

test("trocar de conta durante a confirmação descarta a resposta anterior", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = await mockGovernance(page, { confirmationGate: gate });
  await page.goto("/admin/governanca");
  await fillDraft(page);
  await submitDraft(page);
  await confirmPassword(page);
  await expect.poll(() => fixture.confirmationCommands().length).toBe(1);
  await page.evaluate(() => {
    localStorage.setItem(
      "hvm.admin.session",
      JSON.stringify({
        accessToken: "synthetic-different-account-access-token",
        refreshToken: "synthetic-different-account-refresh-token",
        identityVersion: "synthetic-different-account-identity",
        expiresAt: Date.now() + 3_600_000,
      }),
    );
  });
  release();
  await expect(confirmationDialog(page).getByRole("alert")).toContainText(
    "A conta administrativa mudou",
  );
  expect(fixture.inviteCommands()).toHaveLength(1);
  expect(fixture.commands.some((item) => item.path === "/v1/auth/logout")).toBe(
    false,
  );
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("hvm.admin.session") || "null")
          ?.accessToken,
    ),
  ).toBe("synthetic-different-account-access-token");
});

test("cliques repetidos confirmam uma vez e não duplicam o envio", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = await mockGovernance(page, { confirmationGate: gate });
  await page.goto("/admin/governanca");
  await fillDraft(page);
  await submitDraft(page);
  const dialog = confirmationDialog(page);
  await dialog
    .getByLabel("Senha administrativa", { exact: true })
    .fill(password);
  await dialog
    .getByRole("button", { name: "Confirmar identidade", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect.poll(() => fixture.confirmationCommands().length).toBe(1);
  expect(fixture.inviteCommands()).toHaveLength(1);
  release();
  await expect(
    page.getByRole("status").filter({ hasText: "Convite enviado" }),
  ).toBeVisible();
  expect(fixture.confirmationCommands()).toHaveLength(1);
  expect(fixture.inviteCommands()).toHaveLength(2);
});

test("sessão inválida mostra uma ação para entrar novamente", async ({
  page,
}) => {
  await mockGovernance(page, { unauthorized: true });
  await page.goto("/admin/governanca");
  await fillDraft(page);
  await page
    .getByRole("button", { name: "Enviar convite", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Entrar novamente", exact: true }),
  ).toBeVisible();
  await expect(confirmationDialog(page)).not.toBeVisible();
  await expectDraftPreserved(page);
});

for (const operation of ["delete", "clear-history"] as const) {
  test(`${operation} retoma a operação original após confirmar identidade`, async ({
    page,
  }) => {
    const fixture = await mockGovernance(page, { seedHistory: true });
    await page.goto("/admin/governanca");
    await expect(
      page.getByRole("button", { name: `Excluir convite para ${email}` }),
    ).toHaveCount(2);
    if (operation === "delete") {
      await page
        .getByRole("button", { name: `Excluir convite para ${email}` })
        .first()
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Excluir convite", exact: true })
        .click();
    } else {
      await page
        .getByRole("button", { name: "Limpar histórico", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Limpar histórico", exact: true })
        .click();
    }
    await expect(confirmationDialog(page)).toBeVisible();
    expect(fixture.inviteCommands()).toHaveLength(1);
    await confirmPassword(page);
    await expect(
      page.getByRole("status").filter({
        hasText: operation === "delete" ? "Convite excluído" : "1 convite(s)",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Excluir convite para ${email}` }),
    ).toHaveCount(1);
    const attempts = fixture.inviteCommands();
    expect(attempts).toHaveLength(2);
    expect(attempts[1].method).toBe(operation === "delete" ? "DELETE" : "POST");
    expect(attempts[1].path).toBe(
      operation === "delete"
        ? `/v1/admin/invites/${inviteId}`
        : "/v1/admin/invites/clear-history",
    );
    expect(attempts[1].body).toEqual(attempts[0].body);
    expect(fixture.confirmationCommands()[0].body).toEqual({ password });
  });
}

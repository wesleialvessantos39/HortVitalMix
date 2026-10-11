import { expect, test, type Page } from "@playwright/test";
const actor = "11111111-1111-4111-8111-111111111111",
  entity = "22222222-2222-4222-8222-222222222222";
type Fixture = {
  offline: boolean;
  fail: number;
  omitReceipt: boolean;
  calls: {
    path: string;
    headers: Record<string, string>;
    bytes: number[];
    body: any;
  }[];
  signed: number;
  uploads: number;
};
async function init(page: Page, role = "consumer") {
  const state: Fixture = {
    offline: false,
    fail: 0,
    omitReceipt: false,
    calls: [],
    signed: 0,
    uploads: 0,
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.replace(/^\/api/, "");
    if (path === "/v1/auth/session")
      return route.fulfill({ status: 401, json: { error: "AUTH_REQUIRED" } });
    if (path === "/v1/config")
      return route.fulfill({
        json: {
          platformName: "HortiVitalMix",
          slogan: "Frescos",
          defaultMunicipality: "Ariquemes",
          defaultState: "RO",
          currency: "BRL",
          timezone: "America/Porto_Velho",
          supportEmail: "fixture@example.invalid",
          supportPhone: null,
          revision: 1,
        },
      });
    if (state.offline) return route.abort("failed");
    const bytes = [...(req.postDataBuffer() ?? [])];
    if (req.method() !== "GET")
      state.calls.push({
        path,
        headers: req.headers(),
        bytes,
        body: req.headers()["content-type"]?.includes("application/json")
          ? req.postDataJSON()
          : null,
      });
    if (state.fail) {
      const status = state.fail;
      state.fail = 0;
      return route.fulfill({
        status,
        json: {
          error:
            status === 401
              ? "RECENT_AUTH_REQUIRED"
              : status === 403
                ? "FORBIDDEN"
                : "DEPENDENCY_UNAVAILABLE",
        },
      });
    }
    if (path.endsWith("/upload-url")) {
      state.signed++;
      return route.fulfill({
        json: {
          documentId: entity,
          signedUrl: `http://127.0.0.1:3000/__offline_file_fixture/${state.signed}`,
          status: "prepared",
        },
      });
    }
    if (path.endsWith("/confirm"))
      return route.fulfill({ json: { status: "clean" } });
    return route.fulfill({
      json: {
        status: "updated",
        revision: 2,
        fullName: "Servidor",
        profileRole: role,
      },
      headers:
        !state.omitReceipt && req.headers()["x-hvm-offline-id"]
          ? { "X-HVM-Offline-Receipt": req.headers()["x-hvm-offline-id"] }
          : {},
    });
  });
  await page.route("**/__offline_file_fixture/**", async (route) => {
    state.uploads++;
    return route.fulfill({ json: { status: "ok" } });
  });
  await page.goto("/sobre");
  await expect(page.locator("#root")).not.toBeEmpty();
  await page.evaluate(
    async ({ actor, role }) => {
      const source = "/src/lib/portalOffline.ts",
        m = await import(source);
      m.setOfflineIdentity({
        userId: actor,
        email: "fixture@example.invalid",
        roles: [role],
        activeRole: role,
      });
    },
    { actor, role },
  );
  return state;
}
async function network(page: Page, state: Fixture, online: boolean) {
  state.offline = !online;
  await page.evaluate(
    (value) =>
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => value,
      }),
    online,
  );
}
async function requests(page: Page) {
  return page.evaluate(async () => {
    const source = "/src/lib/portalOffline.ts",
      m = await import(source);
    return m.portalRequests(m.currentOfflineIdentity().scope);
  });
}
async function synchronize(page: Page) {
  return page.evaluate(async () => {
    const source = "/src/lib/portalOffline.ts",
      m = await import(source);
    try {
      await m.synchronizePortalRequests(m.currentOfflineIdentity());
      return "ok";
    } catch (error) {
      return (error as Error).message;
    }
  });
}
async function profile(page: Page, name = "Salvo localmente") {
  return page.evaluate(async (fullName) => {
    const source = "/src/lib/api.ts",
      m = await import(source);
    try {
      await m.api("/v1/account/profile", {
        method: "PATCH",
        body: JSON.stringify({
          fullName,
          expectedRevision: 1,
          commandId: crypto.randomUUID(),
        }),
      });
      return "ok";
    } catch (error) {
      return (error as Error).message;
    }
  }, name);
}

test("raw image bytes persist and are sent unchanged after reconnect", async ({
  page,
}) => {
  const state = await init(page, "producer");
  await network(page, state, false);
  expect(
    await page.evaluate(async (id) => {
      const source = "/src/lib/api.ts",
        m = await import(source);
      try {
        await m.api(
          `/v1/producer/products/${id}/media/upload?commandId=${crypto.randomUUID()}&expectedRevision=1`,
          {
            method: "POST",
            headers: { "Content-Type": "image/jpeg" },
            body: new Blob([new Uint8Array([255, 216, 17, 31, 217, 255])], {
              type: "image/jpeg",
            }),
          },
        );
        return "ok";
      } catch (e) {
        return (e as Error).message;
      }
    }, entity),
  ).toBe("OFFLINE_ACTION_SAVED");
  const bytes = await page.evaluate(async () => {
    const source = "/src/lib/portalOffline.ts",
      m = await import(source),
      row = (await m.portalRequests(m.currentOfflineIdentity().scope))[0];
    return [...new Uint8Array(await row.body.arrayBuffer())];
  });
  expect(bytes).toEqual([255, 216, 17, 31, 217, 255]);
  await network(page, state, true);
  expect(await synchronize(page)).toBe("ok");
  expect(await requests(page)).toHaveLength(0);
  const sent = state.calls.find((r) => r.path.endsWith("/media/upload"))!;
  expect(sent.bytes).toEqual(bytes);
  expect(sent.headers["content-type"]).toBe("image/jpeg");
  expect(sent.headers["x-hvm-offline-scope"]).toBe(`${actor}:producer`);
});
test("documents retain the file, obtain a fresh signed URL and confirm automatically", async ({
  page,
}) => {
  const state = await init(page, "producer");
  await network(page, state, false);
  expect(
    await page.evaluate(async (id) => {
      const source = "/src/lib/offlineDocuments.ts",
        m = await import(source);
      const file = new File([new Uint8Array(2048).fill(65)], "offline.pdf", {
        type: "application/pdf",
      });
      try {
        await m.uploadDocumentDurably(
          "/v1/producer/documents",
          {
            propertyId: id,
            documentType: "car_sicar",
            fileName: file.name,
            fileSizeBytes: file.size,
            fileHashSha256: "a".repeat(64),
            mimeType: file.type,
            commandId: crypto.randomUUID(),
          },
          file,
        );
        return "ok";
      } catch (e) {
        return (e as Error).message;
      }
    }, entity),
  ).toBe("OFFLINE_ACTION_SAVED");
  const saved = await page.evaluate(async () => {
    const source = "/src/lib/offlineDocuments.ts",
      m = await import(source);
    const rows = await m.documentUploads(
      "11111111-1111-4111-8111-111111111111:producer",
    );
    return {
      count: rows.length,
      size: rows[0].file.size,
      hasSignedUrl: JSON.stringify(rows).includes("signedUrl"),
    };
  });
  expect(saved).toEqual({ count: 1, size: 2048, hasSignedUrl: false });
  await network(page, state, true);
  await page.evaluate(async () => {
    const docs = "/src/lib/offlineDocuments.ts",
      portal = "/src/lib/portalOffline.ts",
      [m, p] = await Promise.all([import(docs), import(portal)]);
    await m.synchronizeDocumentUploads(p.currentOfflineIdentity());
  });
  expect(state.signed).toBe(1);
  expect(state.uploads).toBe(1);
  expect(state.calls.some((r) => r.path.endsWith("/confirm"))).toBe(true);
});
test("passwords, tokens and login never enter the durable queue", async ({
  page,
}) => {
  const state = await init(page);
  await network(page, state, false);
  await page.evaluate(async () => {
    const source = "/src/lib/api.ts",
      m = await import(source);
    for (const [path, body] of [
      [
        "/v1/auth/login",
        { email: "fixture@example.invalid", password: "FixturePassword!2026" },
      ],
      ["/v1/account/profile", { payload: { token: "one-use-fixture" } }],
    ]) {
      await m
        .api(path, { method: "POST", body: JSON.stringify(body) })
        .catch(() => {});
    }
  });
  expect(await requests(page)).toHaveLength(0);
  const drafts = await page.evaluate(async () => {
    const source = "/src/lib/offlineDrafts.ts",
      database = "/src/lib/offlineDb.ts";
    const [draft, db] = await Promise.all([import(source), import(database)]);
    const form = document.createElement("form");
    for (const [name, type, value, autocomplete] of [
      ["note", "text", "Rascunho permitido", ""],
      ["password", "password", "NeverPersist!2026", ""],
      ["code", "text", "123456", "one-time-code"],
      ["token", "hidden", "NeverPersistToken", ""],
    ]) {
      const input = document.createElement("input");
      input.name = name;
      input.type = type;
      input.value = value;
      input.setAttribute("autocomplete", autocomplete);
      form.append(input);
    }
    document.body.append(form);
    const dispose = draft.mountOfflineDrafts(location.pathname);
    form
      .querySelector<HTMLInputElement>("input[name=note]")!
      .dispatchEvent(new Event("input", { bubbles: true }));
    const rows = await db.offlineTransaction(
      ["portal_drafts"],
      "readonly",
      (tx: IDBTransaction, finish: (rows: any[]) => void) => {
        const r = tx.objectStore("portal_drafts").getAll();
        r.onsuccess = () => finish(r.result);
      },
    );
    dispose();
    form.remove();
    return rows;
  });
  expect(JSON.stringify(drafts)).toContain("Rascunho permitido");
  expect(JSON.stringify(drafts)).not.toMatch(/NeverPersist|123456/);
});
test("charging stays as a saved review until an explicit connected action", async ({
  page,
}) => {
  const state = await init(page);
  await network(page, state, false);
  const send = () =>
    page.evaluate(async (id) => {
      const source = "/src/lib/api.ts",
        m = await import(source);
      try {
        await m.api(`/v1/payments/${id}/start`, { method: "POST", body: "{}" });
        return "ok";
      } catch (e) {
        return (e as Error).message;
      }
    }, entity);
  expect(await send()).toBe("OFFLINE_REVIEW_SAVED");
  await network(page, state, true);
  await synchronize(page);
  expect(state.calls).toHaveLength(0);
  expect((await requests(page))[0].state).toBe("review");
  expect(await send()).toBe("ok");
  expect(await requests(page)).toHaveLength(0);
  expect(state.calls).toHaveLength(1);
});
test("a transient server failure retries with the same persisted ID", async ({
  page,
}) => {
  const state = await init(page);
  await network(page, state, false);
  await profile(page);
  const id = (await requests(page))[0].key;
  await network(page, state, true);
  state.fail = 503;
  expect(await synchronize(page)).toBe("NETWORK_UNAVAILABLE");
  expect((await requests(page))[0].key).toBe(id);
  await page.evaluate(async () => {
    const source = "/src/lib/portalOffline.ts",
      m = await import(source);
    await m.resetPortalBackoff(m.currentOfflineIdentity().scope);
  });
  await synchronize(page);
  expect(await requests(page)).toHaveLength(0);
  expect(state.calls.map((r) => r.headers["x-hvm-offline-id"])).toEqual([
    id,
    id,
  ]);
});
test("authentication failure keeps the original action for confirmation", async ({
  page,
}) => {
  const state = await init(page);
  await network(page, state, false);
  await profile(page);
  const id = (await requests(page))[0].key;
  await network(page, state, true);
  state.fail = 401;
  await synchronize(page);
  expect((await requests(page))[0].state).toBe("authentication");
  expect((await requests(page))[0].key).toBe(id);
  await synchronize(page);
  expect(await requests(page)).toHaveLength(0);
});
test("pending actions keep their order", async ({ page }) => {
  const state = await init(page);
  await network(page, state, false);
  await profile(page, "Primeira");
  await profile(page, "Segunda");
  await network(page, state, true);
  await synchronize(page);
  expect(state.calls.map((r) => r.body.fullName)).toEqual([
    "Primeira",
    "Segunda",
  ]);
});
test("a retry delay also preserves order for later queued actions", async ({
  page,
}) => {
  const state = await init(page);
  await network(page, state, false);
  await profile(page, "Primeira");
  await profile(page, "Segunda");
  await network(page, state, true);
  state.fail = 503;
  await synchronize(page);
  await synchronize(page);
  expect(state.calls.map((r) => r.body.fullName)).toEqual(["Primeira"]);
  expect(await requests(page)).toHaveLength(2);
  await page.evaluate(async () => {
    const source = "/src/lib/portalOffline.ts",
      m = await import(source);
    await m.resetPortalBackoff(m.currentOfflineIdentity().scope);
  });
  await synchronize(page);
  expect(state.calls.map((r) => r.body.fullName)).toEqual([
    "Primeira",
    "Primeira",
    "Segunda",
  ]);
  expect(await requests(page)).toHaveLength(0);
});
test("an unconfirmed success response never removes a persisted action", async ({
  page,
}) => {
  const state = await init(page);
  state.omitReceipt = true;
  expect(await profile(page)).toBe("OFFLINE_ACTION_SAVED");
  const id = (await requests(page))[0].key;
  state.omitReceipt = false;
  await synchronize(page);
  expect(await requests(page)).toHaveLength(0);
  expect(state.calls.map((r) => r.headers["x-hvm-offline-id"])).toEqual([
    id,
    id,
  ]);
});
test("an observed permission denial invalidates the private cached read", async ({
  page,
}) => {
  const state = await init(page);
  await page.evaluate(async () => {
    const source = "/src/lib/api.ts",
      m = await import(source);
    await m.api("/v1/account/profile");
  });
  state.fail = 403;
  expect(
    await page.evaluate(async () => {
      const source = "/src/lib/api.ts",
        m = await import(source);
      try {
        await m.api("/v1/account/profile");
        return "ok";
      } catch (e) {
        return (e as Error).message;
      }
    }),
  ).toBe("FORBIDDEN");
  await network(page, state, false);
  expect(
    await page.evaluate(async () => {
      const source = "/src/lib/api.ts",
        m = await import(source);
      try {
        await m.api("/v1/account/profile");
        return "ok";
      } catch (e) {
        return (e as Error).message;
      }
    }),
  ).toBe("OFFLINE_SNAPSHOT_MISSING");
});
test("unavailable device storage never reports a saved action", async ({
  page,
}) => {
  const state = await init(page);
  await network(page, state, false);
  await page.evaluate(() =>
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    }),
  );
  expect(await profile(page)).toBe("OFFLINE_STORAGE_UNAVAILABLE");
  expect(state.calls).toHaveLength(0);
});
test("erasing consumer local data preserves the producer pending work", async ({
  page,
}) => {
  const state = await init(page);
  await network(page, state, false);
  await profile(page, "Consumidor");
  await page.evaluate(async (actor) => {
    const source = "/src/lib/portalOffline.ts",
      m = await import(source);
    m.setOfflineIdentity({
      userId: actor,
      email: "fixture@example.invalid",
      roles: ["producer"],
      activeRole: "producer",
    });
  }, actor);
  await profile(page, "Produtor");
  const result = await page.evaluate(async (actor) => {
    const db = "/src/lib/offlineDb.ts",
      portal = "/src/lib/portalOffline.ts",
      [d, p] = await Promise.all([import(db), import(portal)]);
    await d.eraseOwnOfflineData(actor, "consumer");
    return {
      consumer: await p.portalRequests(actor + ":consumer"),
      producer: await p.portalRequests(actor + ":producer"),
    };
  }, actor);
  expect(result.consumer).toHaveLength(0);
  expect(result.producer).toHaveLength(1);
  expect(result.producer[0].body).toContain("Produtor");
});

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { AppearanceSync } from "../src/lib/appearanceSync.ts";
import {
  APPEARANCE_STORAGE_KEY, readAppearancePreference,
  saveAppearancePreference, isColorTheme,
} from "../src/lib/appearance.ts";

let stored, cookies, root, bar;
beforeEach(() => {
  stored = new Map(); cookies = new Map(); root = { dataset: {}, style: {} };
  bar = { setAttribute(name, value) { this[name] = value; } };
  const document = {
    documentElement: root,
    querySelector() { return bar; },
    get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join("; "); },
    set cookie(value) { const [pair] = value.split(";"); const [key, item] = pair.split("="); cookies.set(key, item); },
  };
  const localStorage = {
    getItem(key) { return stored.get(key) ?? null; },
    setItem(key, value) { stored.set(key, value); },
  };
  globalThis.document = document;
  globalThis.window = { localStorage };
  globalThis.location = { protocol: "https:" };
});

const bootstrap = readFileSync(new URL("../public/theme-init.js", import.meta.url), "utf8");
function newDocumentPaint() {
  root.dataset = {}; root.style = {};
  vm.runInNewContext(bootstrap, { document, localStorage: window.localStorage });
}

test("guest dark choice survives a fresh document and is applied before application render", () => {
  saveAppearancePreference("dark");
  newDocumentPaint();
  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.style.colorScheme, "dark");
  assert.equal(bar.content, "#11241a");
  assert.equal(readAppearancePreference()?.theme, "dark");
});
test("manual light choice replaces dark and survives closing and reopening", () => {
  saveAppearancePreference("dark");
  saveAppearancePreference("light");
  newDocumentPaint();
  assert.equal(root.dataset.theme, "light");
  assert.equal(bar.content, "#1B4D2E");
  assert.equal(readAppearancePreference()?.source, "manual");
});
test("cookie fallback preserves the mode when browser local storage is unavailable", () => {
  window.localStorage = { getItem() { throw Error("unavailable"); }, setItem() { throw Error("unavailable"); } };
  saveAppearancePreference("dark");
  newDocumentPaint();
  assert.equal(root.dataset.theme, "dark");
  assert.equal(readAppearancePreference()?.theme, "dark");
});
test("corrupted local storage recovers from cookie without crashing startup", () => {
  saveAppearancePreference("dark");
  stored.set(APPEARANCE_STORAGE_KEY, "broken-json");
  newDocumentPaint();
  assert.equal(root.dataset.theme, "dark");
  assert.equal(readAppearancePreference()?.theme, "dark");
});
test("only supported theme values are accepted and a new guest retains the original light design", () => {
  assert.equal(isColorTheme("system"), false);
  stored.set(APPEARANCE_STORAGE_KEY, JSON.stringify({ theme: "invalid" }));
  newDocumentPaint();
  assert.equal(root.dataset.theme, "light");
  assert.equal(readAppearancePreference(), null);
});
test("saved appearance contains no account or session identifiers", () => {
  saveAppearancePreference("dark");
  assert.deepEqual(Object.keys(JSON.parse(stored.get(APPEARANCE_STORAGE_KEY))).sort(), ["source", "theme", "updatedAt"]);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function syncHarness({ local = null, load, save, online = () => true } = {}) {
  const writes = [], applied = [];
  const sync = new AppearanceSync({
    userId: "account-a", readLocal: () => local, online,
    applyAccount: (theme) => applied.push(theme),
    load: load ?? (async () => ({ userId: "account-a", theme: "dark" })),
    save: save ?? (async (theme) => { writes.push(theme); return { userId: "account-a", theme }; }),
  });
  return { sync, writes, applied };
}
test("a new device restores an account choice; an existing device choice wins over the account", async () => {
  const fresh = syncHarness(); await fresh.sync.restore();
  assert.deepEqual(fresh.applied, ["dark"]);
  const existing = syncHarness({ local: { theme: "light", source: "manual", updatedAt: 1 } });
  await existing.sync.restore(); await tick();
  assert.deepEqual(existing.applied, []);
  assert.deepEqual(existing.writes, ["light"]);
});
test("a late account read never overwrites a theme selected while it was loading", async () => {
  const read = deferred();
  const { sync, applied } = syncHarness({ load: () => read.promise });
  const restore = sync.restore(); sync.changed("light");
  read.resolve({ userId: "account-a", theme: "dark" }); await restore;
  assert.deepEqual(applied, []);
});
test("rapid toggles are saved in order so the final database choice matches the last click", async () => {
  const first = deferred(), writes = [];
  const { sync } = syncHarness({ save: async (theme) => {
    writes.push(theme);
    if (writes.length === 1) await first.promise;
    return { userId: "account-a", theme };
  } });
  sync.changed("dark"); sync.changed("light");
  assert.deepEqual(writes, ["dark"]);
  first.resolve(); await tick();
  assert.deepEqual(writes, ["dark", "light"]);
});
test("offline changes are retained and saved after reconnecting", async () => {
  let connected = false;
  const { sync, writes } = syncHarness({ online: () => connected });
  sync.changed("dark"); assert.deepEqual(writes, []);
  connected = true; await sync.flush(); assert.deepEqual(writes, ["dark"]);
});
test("failed account storage leaves appearance untouched and the newest choice can be retried", async () => {
  let failing = true;
  const writes = [];
  const { sync, applied } = syncHarness({ save: async (theme) => {
    if (failing) throw Error("offline");
    writes.push(theme); return { userId: "account-a", theme };
  } });
  sync.changed("dark"); await tick();
  sync.changed("light"); await tick();
  failing = false; await sync.flush();
  assert.deepEqual(writes, ["light"]); assert.deepEqual(applied, []);
});
test("logging out during a request prevents any returned account theme from being applied", async () => {
  const read = deferred();
  const { sync, applied } = syncHarness({ load: () => read.promise });
  const restore = sync.restore(); sync.dispose();
  read.resolve({ userId: "account-a", theme: "dark" }); await restore;
  assert.deepEqual(applied, []);
});
test("a response from a different account is rejected", async () => {
  const { sync, applied } = syncHarness({ load: async () => ({ userId: "account-b", theme: "dark" }) });
  await sync.restore(); assert.deepEqual(applied, []);
});

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import manifest from "../../supabase/manifest.json" with { type: "json" };
import { FOUNDATION_SCHEMA_VERSION } from "../../shared/contracts/foundation.ts";
import {
  APP_BINARY_STORAGE_ORIGIN,
  APP_WEB_ORIGIN,
  classifyAppDownloadUrl,
  UpdateAppDistributionRequestSchema,
} from "../../shared/contracts/appDistribution.ts";

vi.mock("../../server/config/runtime.ts", () => ({
  runtime: {
    appEnv: "production",
    commitSha: "a".repeat(40),
  },
}));
vi.mock("../../server/db/pool.ts", () => ({ dbPool: null }));
import { presentAppDistribution } from "../../server/services/AppDistributionService.ts";

const apk =
  APP_BINARY_STORAGE_ORIGIN +
  "/storage/v1/object/public/app-downloads/android/1.0.0/hortivitalmix.apk";
const play =
  "https://play.google.com/store/apps/details?id=br.com.hortivitalmix.app";
const apple = "https://apps.apple.com/br/app/hortivitalmix/id123456789";
const flight = "https://testflight.apple.com/join/AbC123";

describe("Distribuição: destinos confiáveis e compatibilidade da versão web", () => {
  it.each([
    ["android", apk, "apk"],
    [
      "android",
      APP_WEB_ORIGIN + "/native-downloads/android/hvm-1.0.0.apk",
      "apk",
    ],
    ["android", play, "play_store"],
    ["ios", apple, "app_store"],
    ["ios", flight, "testflight"],
  ] as const)("aceita %s em %s", (platform, url, channel) => {
    expect(classifyAppDownloadUrl(platform, url)).toBe(channel);
  });

  it.each([
    "http://play.google.com/store/apps/details?id=br.com.hortivitalmix.app",
    "https://play.google.com.attacker.invalid/store/apps/details?id=br.com.hortivitalmix.app",
    "https://play.google.com@attacker.invalid/store/apps/details?id=br.com.hortivitalmix.app",
    "https://user:password@play.google.com/store/apps/details?id=br.com.hortivitalmix.app",
    play + "&id=br.com.outro.app",
    play + "&redirect=https://attacker.invalid",
    play + "#untrusted",
    "https://play.google.com:8443/store/apps/details?id=br.com.hortivitalmix.app",
    "https://play.google.com/store/apps/details?id=invalid-package",
    "https://attacker.invalid/hortivitalmix.apk",
    APP_BINARY_STORAGE_ORIGIN +
      "/storage/v1/object/public/product-media/hortivitalmix.apk",
    APP_BINARY_STORAGE_ORIGIN +
      "/storage/v1/object/public/app-downloads/../../malicious.apk",
    APP_BINARY_STORAGE_ORIGIN +
      "/storage/v1/object/public/app-downloads/%2fmalicious.apk",
    apk + "?redirect=https://attacker.invalid",
    apk.replace(".apk", ".html"),
    "javascript:alert(1)",
    "file:///app.apk",
    apple,
  ])("Android rejeita destino forjado %s", (url) => {
    expect(classifyAppDownloadUrl("android", url)).toBeNull();
  });

  it.each([
    apk,
    APP_WEB_ORIGIN + "/native-downloads/ios/hvm.ipa",
    "https://apps.apple.com.attacker.invalid/br/app/hvm/id123456789",
    apple + "?redirect=https://attacker.invalid",
    flight + "?redirect=https://attacker.invalid",
    "https://testflight.apple.com/join/../malicious",
    "itms-services://?action=download-manifest&url=https://attacker.invalid/app.plist",
    "https://attacker.invalid/app.ipa",
  ])("iOS rejeita IPA direto ou destino forjado %s", (url) => {
    expect(classifyAppDownloadUrl("ios", url)).toBeNull();
  });

  it("rejeita poderes, operador e chaves adicionais enviados no payload", () => {
    const base = {
      commandId: randomUUID(),
      expectedRevision: 1,
      payload: {
        android: { version: "1.0.0", url: apk },
        ios: null,
        releaseNotes: "Versão disponível.",
      },
    };
    expect(UpdateAppDistributionRequestSchema.safeParse(base).success).toBe(
      true,
    );
    for (const forged of [
      { ...base, actorId: randomUUID() },
      { ...base, payload: { ...base.payload, updatedBy: randomUUID() } },
      {
        ...base,
        payload: {
          ...base.payload,
          android: { ...base.payload.android, available: true },
        },
      },
      {
        ...base,
        payload: { ...base.payload, ios: { version: "1.0.0", url: apk } },
      },
      { ...base, expectedRevision: 0 },
    ])
      expect(UpdateAppDistributionRequestSchema.safeParse(forged).success).toBe(
        false,
      );
  });

  function row() {
    return {
      id: randomUUID(),
      android: null,
      ios: null,
      release_notes: "",
      revision: 1,
      updated_at: new Date(),
      updated_by: randomUUID(),
      release: {
        release_tag: "release-confirmada",
        commit_sha: "a".repeat(40),
        schema_version: FOUNDATION_SCHEMA_VERSION,
        migration_history_hash: manifest.migrationHistoryHash,
        deployed_at: new Date().toISOString(),
      },
    };
  }
  it("somente uma release compatível com SHA, schema e histórico fica disponível", () => {
    const valid = row();
    expect(presentAppDistribution(valid).web.available).toBe(true);
    expect(
      presentAppDistribution({
        ...valid,
        release: { ...valid.release, commit_sha: "b".repeat(40) },
      }).web.available,
    ).toBe(false);
    expect(
      presentAppDistribution({
        ...valid,
        release: {
          ...valid.release,
          schema_version: FOUNDATION_SCHEMA_VERSION - 1,
        },
      }).web.available,
    ).toBe(false);
    expect(
      presentAppDistribution({
        ...valid,
        release: { ...valid.release, migration_history_hash: "c".repeat(64) },
      }).web.available,
    ).toBe(false);
    expect(
      presentAppDistribution({ ...valid, release: null }).web.available,
    ).toBe(false);
  });
  it("não inventa binários e bloqueia URL corrompida já armazenada", () => {
    const base = row();
    expect(presentAppDistribution(base).android).toMatchObject({
      available: false,
      version: null,
      url: null,
      downloadUrl: null,
    });
    expect(presentAppDistribution(base).ios).toMatchObject({
      available: false,
      version: null,
      url: null,
    });
    expect(
      presentAppDistribution({
        ...base,
        android: { version: "1.0.0", url: "https://attacker.invalid/app.apk" },
      }).android.available,
    ).toBe(false);
  });
  it("um APK sem registro verificado não ganha um link público", () => {
    expect(presentAppDistribution({ ...row(), android: { version: "1.0.0", url: apk } }).android.available).toBe(false);
  });
  it("a publicação do pipeline prevalece e a retirada não recupera um link antigo", () => {
    const version = { version: "2.0.0", url: apk };
    const managed = { ...row(), android: { version: "1.0.0", url: play }, android_managed: true };
    expect(presentAppDistribution({ ...managed, android_release: version }).android).toMatchObject({ available: true, version: "2.0.0", channel: "apk", managedBy: "pipeline" });
    expect(presentAppDistribution({ ...managed, android_release: null }).android).toMatchObject({ available: false, url: null, managedBy: "pipeline" });
  });
});

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  assessMobileUpdate,
  MOBILE_CI_AUDIENCE,
  MobileReleaseCommandSchema,
  PrepareMobileUploadRequestSchema,
  PublishMobileCiRequestSchema,
  type PublicMobileReleases,
} from "../../shared/contracts/mobileReleases.ts";
vi.mock("../../server/db/pool.ts", () => ({ dbPool: null }));
vi.mock("../../server/supabase/client.ts", () => ({ supabaseAdmin: null }));
import {
  mobilePackageStoragePath,
  verifyMobileArtifact,
} from "../../server/services/MobileReleaseService.ts";
const bytes = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(200, 7),
]);
const sha = createHash("sha256").update(bytes).digest("hex");
const android = {
  platform: "android",
  version: "1.0.10",
  buildNumber: 10,
  minSupportedBuild: 1,
  runtimeFingerprint: "a".repeat(64),
  sourceCommit: "b".repeat(40),
  schemaVersion: 67,
  sha256: sha,
  sizeBytes: bytes.length,
  channel: "apk",
  url: `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/public/app-downloads/android/10/${sha}.apk`,
  releaseNotes: "Correções da versão",
  signingIdentity: "c".repeat(64),
};
describe("Política e pacote mobile", () => {
  it("usa caminho imutável por build e SHA; audience é estável em domínio próprio", () => {
    expect(
      mobilePackageStoragePath(
        PrepareMobileUploadRequestSchema.parse({
          platform: "android",
          buildNumber: android.buildNumber,
          sha256: sha,
          sizeBytes: android.sizeBytes,
        }),
      ),
    ).toBe(`android/10/${sha}.apk`);
    expect(MOBILE_CI_AUDIENCE).toBe(
      "https://hortvitalmix.vercel.app/mobile-ci",
    );
  });
  it("não aceita mínimo acima da própria versão nem canais/tokens arbitrários", () => {
    expect(PublishMobileCiRequestSchema.safeParse(android).success).toBe(true);
    for (const changes of [
      { minSupportedBuild: 11 },
      { url: "https://attacker.invalid/app.apk" },
      { channel: "testflight" },
      { signingIdentity: "unsigned" },
      { extra: "secret" },
    ])
      expect(
        PublishMobileCiRequestSchema.safeParse({ ...android, ...changes })
          .success,
      ).toBe(false);
  });
  it("separa configuração de sincronização de comando sobre versão", () => {
    const base = {
      commandId: "12345678-1234-4234-8234-123456789abc",
      expectedRevision: 1,
    };
    expect(
      MobileReleaseCommandSchema.safeParse({
        ...base,
        action: "configure",
        autoPublish: { android: true, ios: false },
      }).success,
    ).toBe(true);
    expect(
      MobileReleaseCommandSchema.safeParse({ ...base, action: "publish" })
        .success,
    ).toBe(false);
    expect(
      MobileReleaseCommandSchema.safeParse({
        ...base,
        action: "withdraw",
        releaseId: base.commandId,
        autoPublish: { android: true, ios: false },
      }).success,
    ).toBe(false);
  });
  it("mantém atualização obrigatória mesmo se o pacote foi retirado", () => {
    const policy: PublicMobileReleases = {
      revision: 1,
      updatedAt: new Date().toISOString(),
      minimumSupportedBuild: { android: 10, ios: 0 },
      android: null,
      ios: null,
    };
    expect(
      assessMobileUpdate(
        {
          platform: "android",
          buildNumber: 5,
          runtimeFingerprint: "a".repeat(64),
        },
        policy,
      ),
    ).toEqual({ required: true, available: false, runtimeCompatible: false });
  });
  it("confere bytes reais, checksum e origem fixa do APK", async () => {
    const request = vi.fn(
      async () =>
        new Response(bytes, {
          headers: { "Content-Length": String(bytes.length) },
        }),
    ) as unknown as typeof fetch;
    await verifyMobileArtifact(android.url, sha, bytes.length, request);
    expect(request).toHaveBeenCalledWith(
      android.url,
      expect.objectContaining({ redirect: "error" }),
    );
    await expect(
      verifyMobileArtifact(
        "https://attacker.invalid/app.apk",
        sha,
        bytes.length,
        request,
      ),
    ).rejects.toMatchObject({ code: "MOBILE_ARTIFACT_INVALID" });
    await expect(
      verifyMobileArtifact(android.url, "a".repeat(64), bytes.length, request),
    ).rejects.toMatchObject({ code: "MOBILE_ARTIFACT_CHECKSUM_MISMATCH" });
    await expect(
      verifyMobileArtifact(android.url, sha, bytes.length - 1, request),
    ).rejects.toMatchObject({ code: "MOBILE_ARTIFACT_SIZE_MISMATCH" });
  });
  it("interrompe streaming acima do limite e não aceita HTML no lugar de APK", async () => {
    const request = vi.fn(
      async () => new Response(bytes),
    ) as unknown as typeof fetch;
    await expect(
      verifyMobileArtifact(android.url, sha, 100, request),
    ).rejects.toMatchObject({ code: "MOBILE_ARTIFACT_SIZE_MISMATCH" });
    const html = vi.fn(
      async () => new Response(Buffer.alloc(200, 60)),
    ) as unknown as typeof fetch;
    await expect(
      verifyMobileArtifact(android.url, sha, 200, html),
    ).rejects.toMatchObject({ code: "MOBILE_ARTIFACT_INVALID" });
  });
});

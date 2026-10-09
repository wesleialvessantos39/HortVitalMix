import { z } from "zod";
import {
  APP_BINARY_STORAGE_ORIGIN,
  AppNativeVersionSchema,
  AppPlatformSchema,
  classifyAppDownloadUrl,
} from "./appDistribution.ts";

export const MOBILE_CI_AUDIENCE = "https://hortvitalmix.vercel.app/mobile-ci";
export const MOBILE_CI_REPOSITORY = "wesleialvessantos39/HortVitalMix";
export const MOBILE_CI_WORKFLOW = ".github/workflows/hvm-mobile-build.yml";
export const MobileBuildSchema = z.number().int().min(1).max(2147483647);
export const MobileSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const FingerprintSchema = MobileSha256Schema;
export const PrepareMobileUploadRequestSchema = z
  .object({
    platform: z.literal("android"),
    buildNumber: MobileBuildSchema,
    sha256: MobileSha256Schema,
    sizeBytes: z
      .number()
      .int()
      .min(100)
      .max(150 * 1024 * 1024),
  })
  .strict();
export type PrepareMobileUploadRequest = z.infer<
  typeof PrepareMobileUploadRequestSchema
>;

export const PublishMobileCiRequestSchema = z
  .object({
    platform: AppPlatformSchema,
    version: AppNativeVersionSchema,
    buildNumber: MobileBuildSchema,
    minSupportedBuild: MobileBuildSchema,
    runtimeFingerprint: FingerprintSchema,
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
    schemaVersion: z.number().int().positive(),
    sha256: MobileSha256Schema,
    sizeBytes: z
      .number()
      .int()
      .min(100)
      .max(150 * 1024 * 1024),
    channel: z.enum(["apk", "app_store", "testflight"]),
    url: z.string().max(2048),
    releaseNotes: z.string().trim().max(1600),
    signingIdentity: z.string().regex(/^[a-zA-Z0-9:_-]{10,160}$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.minSupportedBuild > value.buildNumber)
      ctx.addIssue({
        code: "custom",
        path: ["minSupportedBuild"],
        message: "A versão mínima não pode superar a versão publicada.",
      });
    if (classifyAppDownloadUrl(value.platform, value.url) !== value.channel)
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message:
          "O canal e o endereço oficial precisam corresponder à plataforma.",
      });
    if (
      value.platform === "android" &&
      (value.channel !== "apk" || !/^[a-f0-9]{64}$/.test(value.signingIdentity))
    )
      ctx.addIssue({
        code: "custom",
        path: ["signingIdentity"],
        message:
          "Informe a impressão SHA-256 do certificado que assinou o APK.",
      });
  });
export type PublishMobileCiRequest = z.infer<
  typeof PublishMobileCiRequestSchema
>;

export const PublicMobileReleaseSchema = z
  .object({
    id: z.string().uuid(),
    platform: AppPlatformSchema,
    version: AppNativeVersionSchema,
    buildNumber: MobileBuildSchema,
    minSupportedBuild: MobileBuildSchema,
    runtimeFingerprint: FingerprintSchema,
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
    schemaVersion: z.number().int().positive(),
    sha256: MobileSha256Schema,
    sizeBytes: z.number().int().positive(),
    channel: z.enum(["apk", "app_store", "testflight"]),
    url: z.string().max(2048),
    downloadUrl: z.string(),
    publishedAt: z.string().datetime().nullable(),
    releaseNotes: z.string(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      classifyAppDownloadUrl(value.platform, value.url) !== value.channel ||
      value.downloadUrl !== "/downloads/" + value.platform ||
      (value.platform === "android" &&
        value.url !==
          `${APP_BINARY_STORAGE_ORIGIN}/storage/v1/object/public/app-downloads/android/${value.buildNumber}/${value.sha256}.apk`) ||
      value.minSupportedBuild > value.buildNumber
    )
      ctx.addIssue({
        code: "custom",
        message:
          "A versão possui endereço, canal ou compatibilidade inválidos.",
      });
  });
export type PublicMobileRelease = z.infer<typeof PublicMobileReleaseSchema>;
export const PublicMobileReleasesSchema = z
  .object({
    revision: z.number().int().positive(),
    updatedAt: z.string().datetime(),
    minimumSupportedBuild: z
      .object({
        android: z.number().int().nonnegative(),
        ios: z.number().int().nonnegative(),
      })
      .strict(),
    android: PublicMobileReleaseSchema.nullable(),
    ios: PublicMobileReleaseSchema.nullable(),
  })
  .strict();
export type PublicMobileReleases = z.infer<typeof PublicMobileReleasesSchema>;
export const AdminMobileReleaseSchema = PublicMobileReleaseSchema.safeExtend({
  status: z.enum(["verified", "published", "withdrawn"]),
  verifiedAt: z.string().datetime(),
  signingIdentity: z.string(),
  ciRunId: z.string(),
  ciRunAttempt: z.number().int().positive(),
}).strict();
export type AdminMobileRelease = z.infer<typeof AdminMobileReleaseSchema>;
const AutomationSchema = z
  .object({ android: z.boolean(), ios: z.boolean() })
  .strict();
export const AdminMobileReleasesSchema = z
  .object({
    revision: z.number().int().positive(),
    updatedAt: z.string().datetime(),
    minimumSupportedBuild: z
      .object({
        android: z.number().int().nonnegative(),
        ios: z.number().int().nonnegative(),
      })
      .strict(),
    autoPublish: AutomationSchema,
    releases: z.array(AdminMobileReleaseSchema),
    sync: z
      .object({
        state: z.enum(["ready", "awaiting_first_release", "unavailable"]),
        lastVerifiedAt: z.string().datetime().nullable(),
        pendingUploads: z.number().int().nonnegative(),
        webCommit: z.string(),
        webSchema: z.number().int().positive(),
        storageConfigured: z.boolean(),
        oidcAudience: z.literal(MOBILE_CI_AUDIENCE),
      })
      .strict(),
  })
  .strict();
export type AdminMobileReleases = z.infer<typeof AdminMobileReleasesSchema>;
export const MobileReleaseCommandSchema = z
  .object({
    commandId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    action: z.enum(["publish", "withdraw", "restore", "configure"]),
    releaseId: z.string().uuid().optional(),
    autoPublish: AutomationSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.action === "configure"
        ? !value.autoPublish || value.releaseId
        : !value.releaseId || value.autoPublish
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Informe a versão para a operação ou a configuração de sincronização.",
      });
  });
export type MobileReleaseCommand = z.infer<typeof MobileReleaseCommandSchema>;
export const MobileReleaseCommandResultSchema = z
  .object({
    status: z.enum(["success", "no_change", "idempotent_replay"]),
    revision: z.number().int().positive(),
  })
  .strict();
export type MobileReleaseCommandResult = z.infer<
  typeof MobileReleaseCommandResultSchema
>;

/** Native identity is obtained from the signed installed package, not the user agent. */
export function assessMobileUpdate(
  current: {
    platform: "android" | "ios";
    buildNumber: number;
    runtimeFingerprint: string;
  },
  policy: PublicMobileReleases,
) {
  const latest = policy[current.platform];
  return {
    required:
      current.buildNumber < policy.minimumSupportedBuild[current.platform],
    available: Boolean(latest && latest.buildNumber > current.buildNumber),
    runtimeCompatible: Boolean(
      latest && latest.runtimeFingerprint === current.runtimeFingerprint,
    ),
  };
}

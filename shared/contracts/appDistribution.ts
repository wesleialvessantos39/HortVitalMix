import { z } from "zod";

export const APP_WEB_ORIGIN = "https://hortvitalmix.vercel.app";
export const APP_BINARY_STORAGE_ORIGIN =
  "https://xipbsazvymkqqfmfegwu.supabase.co";
export const AppPlatformSchema = z.enum(["android", "ios"]);
export type AppPlatform = z.infer<typeof AppPlatformSchema>;
export type AppDistributionChannel =
  "apk" | "play_store" | "app_store" | "testflight";

/** No client-supplied redirect: these are the only distribution destinations. */
export function classifyAppDownloadUrl(
  platform: AppPlatform,
  value: string,
): AppDistributionChannel | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      return null;
    if (platform === "android") {
      if (
        url.hostname === "play.google.com" &&
        url.pathname === "/store/apps/details" &&
        [...url.searchParams.keys()].every((key) =>
          ["id", "hl", "gl"].includes(key),
        ) &&
        url.searchParams.getAll("id").length === 1 &&
        /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(
          url.searchParams.get("id") ?? "",
        )
      )
        return "play_store";
      const trustedStorage =
        url.origin === APP_BINARY_STORAGE_ORIGIN &&
        url.pathname.startsWith("/storage/v1/object/public/app-downloads/");
      const trustedWebsite =
        url.origin === APP_WEB_ORIGIN &&
        url.pathname.startsWith("/native-downloads/");
      if (
        (trustedStorage || trustedWebsite) &&
        /^\/[a-zA-Z0-9/_.-]+\.apk$/.test(url.pathname) &&
        !url.pathname.includes("..") &&
        !url.search
      )
        return "apk";
    } else {
      if (
        url.hostname === "apps.apple.com" &&
        /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+$/.test(url.pathname) &&
        [...url.searchParams.keys()].every((key) =>
          ["mt", "l", "uo"].includes(key),
        )
      )
        return "app_store";
      if (
        url.hostname === "testflight.apple.com" &&
        /^\/join\/[a-zA-Z0-9]+$/.test(url.pathname) &&
        !url.search
      )
        return "testflight";
    }
  } catch {
    // Invalid URLs stay unavailable; the server never redirects to them.
  }
  return null;
}

export const AppNativeVersionSchema = z
  .string()
  .trim()
  .max(40)
  .regex(
    /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/,
    "Use uma versão como 1.0.0.",
  );

function nativeInput(platform: AppPlatform) {
  return z
    .object({
      version: AppNativeVersionSchema,
      url: z
        .string()
        .trim()
        .max(2048)
        .refine(
          (value) => classifyAppDownloadUrl(platform, value) !== null,
          platform === "android"
            ? "Use a Play Store ou um APK HTTPS na pasta app-downloads do Storage deste projeto."
            : "Use um endereço oficial da App Store ou do TestFlight; arquivos IPA não são instalação pública.",
        ),
    })
    .strict()
    .nullable();
}

export const UpdateAppDistributionRequestSchema = z
  .object({
    commandId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    payload: z
      .object({
        android: nativeInput("android"),
        ios: nativeInput("ios"),
        releaseNotes: z.string().trim().max(1600),
      })
      .strict(),
  })
  .strict();
export type UpdateAppDistributionRequest = z.infer<
  typeof UpdateAppDistributionRequestSchema
>;

const NativeAvailabilitySchema = z
  .object({
    available: z.boolean(),
    version: AppNativeVersionSchema.nullable(),
    url: z.string().nullable(),
    downloadUrl: z.string().nullable(),
    channel: z
      .enum(["apk", "play_store", "app_store", "testflight"])
      .nullable(),
    updatedAt: z.string().datetime().nullable(),
    managedBy: z.enum(["pipeline", "manual", "none"]).optional(),
  })
  .strict();

export const AppDistributionResponseSchema = z
  .object({
    revision: z.number().int().positive(),
    updatedAt: z.string().datetime(),
    releaseNotes: z.string(),
    web: z
      .object({
        version: z.string(),
        commitSha: z.string(),
        schemaVersion: z.number().int().positive(),
        available: z.boolean(),
        updatedAt: z.string().datetime().nullable(),
        updateMode: z.literal("hosted_web"),
        requiresStoreUpdateForNativeChanges: z.literal(true),
      })
      .strict(),
    android: NativeAvailabilitySchema,
    ios: NativeAvailabilitySchema,
  })
  .strict();
export type AppDistributionResponse = z.infer<
  typeof AppDistributionResponseSchema
>;
export const AdminAppDistributionResponseSchema =
  AppDistributionResponseSchema.extend({
    updatedBy: z.string().uuid().nullable(),
  }).strict();
export type AdminAppDistributionResponse = z.infer<
  typeof AdminAppDistributionResponseSchema
>;

export const AppDistributionUpdateResultSchema = z.discriminatedUnion(
  "status",
  [
    z.object({
      status: z.literal("success"),
      revision: z.number().int().positive(),
      auditEventId: z.string().uuid(),
    }),
    z.object({
      status: z.literal("idempotent_replay"),
      revision: z.number().int().positive(),
      auditEventId: z.string().uuid(),
    }),
    z.object({
      status: z.literal("no_change"),
      revision: z.number().int().positive(),
    }),
  ],
);
export type AppDistributionUpdateResult = z.infer<
  typeof AppDistributionUpdateResultSchema
>;

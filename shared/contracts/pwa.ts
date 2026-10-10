import { z } from "zod";

export const PWA_INSTALL_PATHS = {
  android: "/instalar/android",
  ios: "/instalar/ios",
} as const;
export type PwaPlatform = keyof typeof PWA_INSTALL_PATHS;
export const PwaVersionSchema = z
  .object({
    format: z.literal(1),
    buildId: z.string().regex(/^[a-f0-9]{64}$/),
    commitSha: z.string().regex(/^(?:[a-f0-9]{40})?$/),
    frontendVersion: z.string().min(1).max(80),
    resourceIdentity: z.string().regex(/^[a-f0-9]{64}$/),
    publishedAt: z.string().datetime().nullable(),
    resources: z
      .array(
        z
          .object({
            url: z
              .string()
              .regex(
                /^\/(?:index\.html|manifest\.webmanifest|favicon\.svg|app-icons\/[a-zA-Z0-9_.-]+\.png|assets\/[a-zA-Z0-9_.-]+\.(?:js|css))$/,
              ),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            bytes: z.number().int().positive(),
          })
          .strict(),
      )
      .min(5)
      .max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    const paths = new Set(value.resources.map((r) => r.url));
    if (
      paths.size !== value.resources.length ||
      value.buildId !== value.resourceIdentity ||
      ![
        "/index.html",
        "/manifest.webmanifest",
        "/app-icons/icon-192.png",
        "/app-icons/icon-512.png",
      ].every((p) => paths.has(p))
    )
      ctx.addIssue({ code: "custom", message: "INVALID_PWA_RESOURCES" });
  });
export type PwaVersion = z.infer<typeof PwaVersionSchema>;

import { z } from "zod";
export const DocumentTypeSchema = z.enum([
  "car_sicar",
  "ccir_incra",
  "dap_caf",
  "laudo_agua",
  "certidao_posse",
  "outro",
]);
export const DocumentMimeSchema = z.enum([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);
export const RequestUploadUrlSchema = z
  .object({
    propertyId: z.uuid(),
    documentType: DocumentTypeSchema,
    fileName: z
      .string()
      .trim()
      .min(3)
      .max(255)
      .regex(/^[^/\\\x00-\x1f]+$/),
    fileSizeBytes: z.number().int().min(1024).max(15728640),
    mimeType: DocumentMimeSchema,
    fileHashSha256: z.string().regex(/^[0-9a-f]{64}$/),
    commandId: z.uuid(),
  })
  .strict();
export const CommandSchema = z.object({ commandId: z.uuid() }).strict();
export const ReviewExtractionSchema = CommandSchema.extend({
  decision: z.enum(["confirmed", "disputed"]),
  note: z.string().trim().max(2000).default(""),
})
  .strict()
  .refine((v) => v.decision !== "disputed" || v.note.length >= 5);
export type RequestUploadUrl = z.infer<typeof RequestUploadUrlSchema>;
export type DocumentView = {
  id: string;
  property_id: string;
  document_type: z.infer<typeof DocumentTypeSchema>;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  status: "quarantine" | "clean" | "rejected" | "archived";
  created_at: string;
};
export const documentLabels: Record<
  z.infer<typeof DocumentTypeSchema>,
  string
> = {
  car_sicar: "CAR / SICAR",
  ccir_incra: "CCIR / INCRA",
  dap_caf: "CAF / DAP",
  laudo_agua: "Laudo de água",
  certidao_posse: "Certidão de posse",
  outro: "Outro documento",
};

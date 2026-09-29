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
const optionalArea = z.number().min(0).max(999999).nullable().optional();
export const ManualDocumentDataSchema = z
  .object({
    commandId: z.uuid(),
    carNumber: z.string().trim().max(64).nullable().optional(),
    ccirNumber: z.string().trim().max(64).nullable().optional(),
    propertyRegisteredName: z.string().trim().min(2).max(128),
    holderName: z.string().trim().max(255).nullable().optional(),
    holderCpfNormalized: z
      .string()
      .trim()
      .regex(/^\d{11}$/)
      .nullable()
      .optional(),
    municipality: z.string().trim().min(2).max(100),
    lineVicinal: z.string().trim().min(2).max(64).nullable().optional(),
    ruralZoneSector: z.string().trim().min(2).max(64).nullable().optional(),
    accessDirections: z.string().trim().max(500).nullable().optional(),
    totalAreaHectares: z.number().positive().max(999999),
    cultivatedAreaHectares: optionalArea,
    legalReserveHectares: optionalArea,
    appHectares: optionalArea,
    consolidatedRuralAreaHectares: optionalArea,
    fiscalModules: optionalArea,
    waterSource: z.enum(["poco_artesiano", "nascente_propria", "rio_corrego", "rede_tratada"]).nullable().optional(),
    irrigationSystem: z.enum(["gotejamento", "microaspersao", "aspersao_convencional", "nenhum"]).nullable().optional(),
    activityCategory: z.enum(["hortalicas_folhosas", "legumes_picados", "frutas_tropicais", "ervas_temperos", "misto"]).nullable().optional(),
    productionSystem: z.enum(["organico_certificado", "agroecologico_declarado", "hidroponia", "convencional_transicao"]).nullable().optional(),
    hasWashingFacility: z.boolean().nullable().optional(),
    latitudeSede: z.number().min(-14).max(-7).nullable().optional(),
    longitudeSede: z.number().min(-67).max(-59).nullable().optional(),
  })
  .strict();
export type ManualDocumentData = z.infer<typeof ManualDocumentDataSchema>;
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

import { z } from "zod";
const text = z.string().max(255).nullable(),
  area = z.number().min(0).max(999999).nullable(),
  confidence = z.number().min(0).max(1);
// Null representa informação ausente/ilegível. Não preenche município, áreas ou regularidade por suposição.
export const ExtractionSchema = z
  .object({
    documentType: z.enum(["car_sicar", "ccir_incra"]),
    carNumber: text,
    ccirNumber: text,
    sicarProtocol: text,
    propertyRegisteredName: text,
    holderName: text,
    holderCpfNormalized: text,
    municipality: text,
    state: z.literal("RO").nullable().optional(),
    latitudeSede: z.number().min(-14).max(-7).nullable().optional(),
    longitudeSede: z.number().min(-67).max(-59).nullable().optional(),
    lineVicinal: text.optional(),
    ruralZoneSector: text.optional(),
    accessDirections: z.string().max(500).nullable().optional(),
    totalAreaHectares: area,
    cultivatedAreaHectares: area.optional(),
    legalReserveHectares: area,
    appHectares: area,
    consolidatedRuralAreaHectares: area,
    fiscalModules: area,
    waterSource: z.enum(["poco_artesiano", "nascente_propria", "rio_corrego", "rede_tratada"]).nullable().optional(),
    irrigationSystem: z.enum(["gotejamento", "microaspersao", "aspersao_convencional", "nenhum"]).nullable().optional(),
    activityCategory: z.enum(["hortalicas_folhosas", "legumes_picados", "frutas_tropicais", "ervas_temperos", "misto"]).nullable().optional(),
    productionSystem: z.enum(["organico_certificado", "agroecologico_declarado", "hidroponia", "convencional_transicao"]).nullable().optional(),
    hasWashingFacility: z.boolean().nullable().optional(),
    hasEmbargoOrInfractionDetected: z.boolean().nullable(),
    confidenceScore: confidence,
    fieldConfidence: z
      .object({
        totalAreaHectares: confidence,
        legalReserveHectares: confidence,
        appHectares: confidence,
        consolidatedRuralAreaHectares: confidence,
        fiscalModules: confidence,
      })
      .strict(),
    rawText: z.string().min(1).max(120000),
  })
  .strict();
export type ExtractionPayload = z.infer<typeof ExtractionSchema>;
export type ExtractionView = {
  id: string;
  status: string;
  payload_jsonb: ExtractionPayload;
  discrepancies: string[];
  area_difference_percent: number | null;
  created_at: string;
  extraction_engine: string;
  review?: { decision: string; note: string } | null;
};

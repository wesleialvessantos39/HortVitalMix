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
    totalAreaHectares: area,
    legalReserveHectares: area,
    appHectares: area,
    consolidatedRuralAreaHectares: area,
    fiscalModules: area,
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

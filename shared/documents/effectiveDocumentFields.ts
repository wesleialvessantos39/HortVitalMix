import {
  ExtractionSchema,
  type ExtractionPayload,
  type ExtractionView,
} from "../contracts/aiExtraction.ts";

export const DECLARED_DATA_PREFIX =
  "Dados informados pelo produtor, sem leitura automática.\n";

// Correções são evidências novas. A extração original permanece imutável.
export function declaredDocumentFields(
  extraction: ExtractionView | null,
): Record<string, unknown> | null {
  const note = extraction?.dataReview?.note ?? extraction?.review?.note ?? "";
  if (!note.startsWith(DECLARED_DATA_PREFIX)) return null;
  try {
    const data: unknown = JSON.parse(note.slice(DECLARED_DATA_PREFIX.length));
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function effectiveDocumentFields(
  extraction: ExtractionView | null,
): ExtractionPayload | null {
  if (!extraction) return null;
  if (extraction.effective_payload_jsonb)
    return extraction.effective_payload_jsonb;
  const corrected = declaredDocumentFields(extraction);
  if (!corrected) return extraction.payload_jsonb;
  const payload = { ...extraction.payload_jsonb };
  for (const key of [
    "carNumber",
    "ccirNumber",
    "propertyRegisteredName",
    "holderName",
    "holderCpfNormalized",
    "municipality",
    "totalAreaHectares",
    "legalReserveHectares",
    "appHectares",
    "consolidatedRuralAreaHectares",
    "fiscalModules",
  ] as const) {
    if (Object.hasOwn(corrected, key))
      (payload as Record<string, unknown>)[key] = corrected[key];
  }
  return ExtractionSchema.safeParse(payload).data ?? extraction.payload_jsonb;
}

import {
  ExtractionSchema,
  type ExtractionPayload,
} from "../contracts/aiExtraction.ts";

function hectares(source: string) {
  const match = source.match(/(\d{1,3}(?:\.\d{3})*,\d+|\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const raw = match[1];
  const value = raw.includes(",")
    ? Number(raw.replace(/\./g, "").replace(",", "."))
    : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 999999) return null;
  return Math.round(value * 10000) / 10000;
}
function afterLabel(text: string, label: RegExp) {
  const match = text.match(label);
  if (!match) return null;
  return match[1].replace(/\s+/g, " ").trim();
}
function cut(value: string | null, max: number) {
  if (!value) return null;
  const clean = value
    .split(/\s+(?:UF|CEP|CPF|Área|Area|Munic)/i)[0]
    .replace(/[|;].*$/, "")
    .trim();
  if (clean.length < 2) return null;
  return clean.slice(0, max);
}
export function parseRuralDocumentText(
  text: string,
  documentType: "car_sicar" | "ccir_incra",
): ExtractionPayload | null {
  const source = text.replace(/\u0000/g, " ").replace(/[ \t]+\n/g, "\n");
  if (source.trim().length < 8) return null;
  const compact = source.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const carMatch = compact.match(/RO\d{7}[0-9A-F]{32}/);
  const carNumber = carMatch
    ? `RO-${carMatch[0].slice(2, 9)}-${carMatch[0].slice(9)}`
    : null;
  const ccirMatch = source.match(
    /(?:INCRA|CCIR|c[oó]digo(?:\s+do\s+im[oó]vel)?)[^\d]{0,30}(\d[\d.\s]{11,20}\d)/i,
  );
  const ccirDigits = (ccirMatch?.[1] ?? "").replace(/\D/g, "");
  const ccirNumber = /^\d{13}$/.test(ccirDigits) ? ccirDigits : null;
  const cpfMatch = source.match(
    /CPF[^\d]{0,24}(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/i,
  );
  const holderCpfNormalized = cpfMatch
    ? cpfMatch[1].replace(/\D/g, "")
    : null;
  const propertyRegisteredName = cut(
    afterLabel(
      source,
      /nome\s+do\s+im[oó]vel(?:\s+rural)?\s*[:\-–]?\s*([^\n]{2,160})/i,
    ),
    128,
  );
  const holderName = cut(
    afterLabel(source, /(?:titular|propriet[aá]rio|nome\s+do\s+detentor)\s*[:\-–]?\s*([^\n]{2,160})/i),
    255,
  );
  const municipality = cut(
    afterLabel(source, /munic[ií]pio\s*[:\-–]?\s*([^\n]{2,80})/i),
    100,
  );
  const totalSource =
    afterLabel(
      source,
      /[aá]rea\s+total(?:\s+do\s+im[oó]vel)?\s*[:\-–]?\s*([^\n]{1,40})/i,
    ) ??
    afterLabel(
      source,
      /[aá]rea\s+do\s+im[oó]vel\s*[:\-–]?\s*([^\n]{1,40})/i,
    ) ??
    afterLabel(source, /(?:^|\n)\s*[aá]rea\s*[:\-–]\s*([^\n]{1,40})/i);
  const totalAreaHectares = hectares(totalSource ?? "");
  const legalReserveHectares = hectares(
    afterLabel(source, /reserva\s+legal\s*[:\-–]?\s*([^\n]{1,40})/i) ?? "",
  );
  const appHectares = hectares(
    afterLabel(
      source,
      /(?:APP|[aá]rea\s+de\s+preserva[cç][aã]o(?:\s+permanente)?)\s*[:\-–]?\s*([^\n]{1,40})/i,
    ) ?? "",
  );
  const consolidatedRuralAreaHectares = hectares(
    afterLabel(
      source,
      /[aá]rea\s+consolidada\s*[:\-–]?\s*([^\n]{1,40})/i,
    ) ?? "",
  );
  const fiscalModules = hectares(
    afterLabel(source, /m[oó]dulos?\s+fiscais?\s*[:\-–]?\s*([^\n]{1,40})/i) ??
      "",
  );
  const useful =
    documentType === "ccir_incra"
      ? Boolean(ccirNumber || (propertyRegisteredName && totalAreaHectares))
      : Boolean(carNumber || (propertyRegisteredName && totalAreaHectares));
  if (!useful) return null;
  return ExtractionSchema.parse({
    documentType,
    carNumber,
    ccirNumber,
    sicarProtocol: null,
    propertyRegisteredName,
    holderName,
    holderCpfNormalized:
      holderCpfNormalized && holderCpfNormalized.length === 11
        ? holderCpfNormalized
        : null,
    municipality,
    totalAreaHectares,
    legalReserveHectares,
    appHectares,
    consolidatedRuralAreaHectares,
    fiscalModules,
    hasEmbargoOrInfractionDetected: null,
    confidenceScore: 0.86,
    fieldConfidence: {
      totalAreaHectares: 0.86,
      legalReserveHectares: 0.86,
      appHectares: 0.86,
      consolidatedRuralAreaHectares: 0.86,
      fiscalModules: 0.86,
    },
    rawText: source.trim().slice(0, 120000),
  });
}

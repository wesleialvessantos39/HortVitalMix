import type { ExtractionPayload } from "../../shared/contracts/aiExtraction.ts";
export function validateExtraction(
  p: ExtractionPayload,
  expected: { documentType: string; cpf: string | null; area: number | null },
) {
  const issues: string[] = [];
  if (p.documentType !== expected.documentType)
    issues.push("Tipo documental divergente");
  if (
    p.documentType === "car_sicar" &&
    !/^RO-[0-9]{7}-[0-9A-F]{32}$/.test(p.carNumber ?? "")
  )
    issues.push("Número CAR de Rondônia ausente ou inválido");
  if (p.documentType === "ccir_incra" && !/^\d{13}$/.test(p.ccirNumber ?? ""))
    issues.push("Código INCRA ausente ou inválido (13 dígitos)");
  if (
    !p.holderCpfNormalized ||
    !/^\d{11}$/.test(p.holderCpfNormalized) ||
    p.holderCpfNormalized !== expected.cpf
  )
    issues.push("CPF do titular ausente ou divergente");
  const difference =
    expected.area && p.totalAreaHectares != null
      ? (Math.abs(p.totalAreaHectares - expected.area) / expected.area) * 100
      : null;
  if (difference === null || !p.totalAreaHectares)
    issues.push("Área total não conferida");
  else if (difference > 5 + 1e-8)
    issues.push("Área total difere mais de 5% da declaração");
  if (
    p.totalAreaHectares != null &&
    [
      p.legalReserveHectares,
      p.appHectares,
      p.consolidatedRuralAreaHectares,
    ].some((v) => v != null && v > p.totalAreaHectares!)
  )
    issues.push("Área parcial superior à área total");
  if (p.hasEmbargoOrInfractionDetected)
    issues.push("Documento indica embargo ou infração; conferir manualmente");
  if (
    p.confidenceScore < 0.8 ||
    Object.values(p.fieldConfidence).some((v) => v < 0.8)
  )
    issues.push("Leitura com baixa confiança; conferir original");
  return {
    issues,
    areaDifferencePercent: difference,
    status: issues.length ? "flagged_discrepancy" : "completed",
  };
}

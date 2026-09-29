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
function realPersonName(value: string | null) {
  const clean = cut(value, 255);
  if (!clean) return null;
  if (/^(ou|e|de|da|do|o|a|os|as|rural|possuidor|possuidora|detentor|detentora)$/i.test(clean))
    return null;
  if (clean.split(/\s+/).length === 1 && clean.length < 5) return null;
  return clean;
}
function roundCoord(value: number) {
  return Math.round(value * 1e6) / 1e6;
}
function readCoordinate(source: string, kind: "lat" | "lng") {
  const label = kind === "lat" ? "lat(?:itude)?" : "long(?:itude)?";
  const dms = source.match(
    new RegExp(
      label +
        "\\s*[:\\-–]?\\s*(\\d{1,3})\\s*[°º]\\s*(\\d{1,2})\\s*['’′]\\s*(\\d{1,2}(?:[.,]\\d+)?)\\s*[\\\"”″]?\\s*([A-Za-zÀ-ú]+)?",
      "i",
    ),
  );
  if (dms) {
    const deg = Number(dms[1]);
    const min = Number(dms[2]);
    const sec = Number(dms[3].replace(",", "."));
    if (min < 60 && sec < 60 && deg <= 180) {
      const hemi = dms[4] ?? "";
      const negative =
        kind === "lat" ? /s|sul/i.test(hemi) || !hemi : /o|w|oeste/i.test(hemi) || !hemi;
      const absolute = deg + min / 60 + sec / 3600;
      return roundCoord(negative ? -absolute : absolute);
    }
  }
  const decimal = source.match(
    new RegExp(label + "\\s*[:\\-–]?\\s*(-?\\d{1,3}[.,]\\d+)", "i"),
  );
  if (!decimal) return null;
  const value = Number(decimal[1].replace(",", "."));
  return Number.isFinite(value) ? roundCoord(value) : null;
}
export function parseRuralLocation(text: string) {
  const source = text.replace(/\u0000/g, " ");
  const latitudeSede = readCoordinate(source, "lat");
  const longitudeSede = readCoordinate(source, "lng");
  if (
    latitudeSede == null ||
    longitudeSede == null ||
    latitudeSede < -14 ||
    latitudeSede > -7 ||
    longitudeSede < -67 ||
    longitudeSede > -59
  )
    return { latitudeSede: null, longitudeSede: null };
  return { latitudeSede, longitudeSede };
}
function cut(value: string | null, max: number) {
  if (!value) return null;
  const clean = value
    .split(/\s+(?:UF|CEP|CPF|Área|Area|Munic)/i)[0]
    .replace(/[|;].*$/, "")
    .trim();
  if (clean.length < 2) return null;
  return clean.replace(/\/[A-Za-z]{2}$/, "").slice(0, max);
}

function labeled(source: string, pattern: RegExp, max = 255) {
  return cut(afterLabel(source, pattern), max);
}
function normalizeChoice(value: string | null) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function readWaterSource(source: string) {
  const value = normalizeChoice(labeled(source, /(?:fonte\s+de\s+[aá]gua|abastecimento\s+de\s+[aá]gua|capta[cç][aã]o\s+de\s+[aá]gua)\s*[:\-–]\s*([^\n]{2,100})/i, 100));
  if (!value) return null;
  if (/poco/.test(value)) return "poco_artesiano" as const;
  if (/nascente/.test(value)) return "nascente_propria" as const;
  if (/rio|corrego/.test(value)) return "rio_corrego" as const;
  if (/rede|tratad/.test(value)) return "rede_tratada" as const;
  return null;
}
function readIrrigationSystem(source: string) {
  const value = normalizeChoice(labeled(source, /(?:sistema\s+de\s+irriga[cç][aã]o|irriga[cç][aã]o)\s*[:\-–]\s*([^\n]{2,100})/i, 100));
  if (!value) return null;
  if (/gotej/.test(value)) return "gotejamento" as const;
  if (/microaspers/.test(value)) return "microaspersao" as const;
  if (/aspers/.test(value)) return "aspersao_convencional" as const;
  if (/nenhum|nao possui|sem irriga/.test(value)) return "nenhum" as const;
  return null;
}
function readActivity(source: string) {
  const value = normalizeChoice(labeled(source, /(?:atividade\s+principal|atividade\s+rural|cultura\s+principal)\s*[:\-–]\s*([^\n]{2,120})/i, 120));
  if (!value) return null;
  if (/folhos|alface|couve|rucula/.test(value)) return "hortalicas_folhosas" as const;
  if (/legume.*picad|processad/.test(value)) return "legumes_picados" as const;
  if (/fruta.*tropical|banana|mamao|abacaxi/.test(value)) return "frutas_tropicais" as const;
  if (/erva|tempero|cebolinha|coentro/.test(value)) return "ervas_temperos" as const;
  if (/misto|diversific/.test(value)) return "misto" as const;
  return null;
}
function readProductionSystem(source: string) {
  const value = normalizeChoice(labeled(source, /(?:sistema\s+de\s+produ[cç][aã]o|manejo\s+produtivo)\s*[:\-–]\s*([^\n]{2,120})/i, 120));
  if (!value) return null;
  if (/organico.*cert/.test(value)) return "organico_certificado" as const;
  if (/agroecolog/.test(value)) return "agroecologico_declarado" as const;
  if (/hidropon/.test(value)) return "hidroponia" as const;
  if (/convencional|transi[cç][aã]o/.test(value)) return "convencional_transicao" as const;
  return null;
}
function readWashingFacility(source: string) {
  const value = normalizeChoice(labeled(source, /(?:instala[cç][aã]o\s+de\s+lavagem|estrutura\s+de\s+lavagem|lavagem\s+e\s+higieniza[cç][aã]o)\s*[:\-–]\s*([^\n]{1,40})/i, 40));
  if (!value) return null;
  if (/^(sim|possui|existe|adequada)/.test(value)) return true;
  if (/^(nao|sem|inexistente)/.test(value)) return false;
  return null;
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
  const holderName = realPersonName(
    afterLabel(
      source,
      /(?:^|\n)\s*(?:titular|propriet[aá]rio|nome\s+do\s+detentor)\s*[:\-–]\s*([^\n]{2,160})/i,
    ),
  );
  const municipality = cut(
    afterLabel(source, /munic[ií]pio(?:\s*\/\s*uf)?\s*[:\-–]?\s*([^\n]{2,80})/i),
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
  const cultivatedAreaHectares = hectares(
    afterLabel(source, /[aá]rea\s+(?:cultivada|utilizada|produtiva)(?:\s+ativa)?\s*[:\-–]?\s*([^\n]{1,40})/i) ?? "",
  );
  const location = parseRuralLocation(source);
  const state =
    /(?:^|\n)\s*UF\s*[:\-–]?\s*(?:RO|Rond[oô]nia)\b/i.test(source) ||
    /(?:^|\n)\s*Estado\s*[:\-–]?\s*Rond[oô]nia\b/i.test(source)
      ? ("RO" as const)
      : null;
  const lineVicinal = labeled(source, /(?:linha\s+vicinal|linha|travess[aã]o|vicinal)\s*[:\-–]\s*([^\n]{2,80})/i, 64);
  const ruralZoneSector = labeled(source, /(?:setor\s+rural|gleba)\s*[:\-–]\s*([^\n]{2,80})/i, 64);
  const accessDirections = labeled(source, /(?:orienta[cç][oõ]es?\s+de\s+acesso|acesso\s+ao\s+im[oó]vel|acesso)\s*[:\-–]\s*([^\n]{2,520})/i, 500);
  const waterSource = readWaterSource(source);
  const irrigationSystem = readIrrigationSystem(source);
  const activityCategory = readActivity(source);
  const productionSystem = readProductionSystem(source);
  const hasWashingFacility = readWashingFacility(source);
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
    state,
    latitudeSede: location.latitudeSede,
    longitudeSede: location.longitudeSede,
    lineVicinal,
    ruralZoneSector,
    accessDirections,
    totalAreaHectares,
    cultivatedAreaHectares,
    legalReserveHectares,
    appHectares,
    consolidatedRuralAreaHectares,
    fiscalModules,
    waterSource,
    irrigationSystem,
    activityCategory,
    productionSystem,
    hasWashingFacility,
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

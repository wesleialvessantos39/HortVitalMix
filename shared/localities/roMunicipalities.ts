export type RoMunicipality = {
  ibgeCode: string;
  name: string;
};

// Fonte: https://servicodados.ibge.gov.br/api/v1/localidades/estados/11/municipios
// Snapshot oficial do IBGE (UF 11), versionado para operação sem dependência externa.
export const RO_MUNICIPALITIES: readonly RoMunicipality[] = [
  { ibgeCode: "1100015", name: "Alta Floresta D'Oeste" },
  { ibgeCode: "1100023", name: "Ariquemes" },
  { ibgeCode: "1100031", name: "Cabixi" },
  { ibgeCode: "1100049", name: "Cacoal" },
  { ibgeCode: "1100056", name: "Cerejeiras" },
  { ibgeCode: "1100064", name: "Colorado do Oeste" },
  { ibgeCode: "1100072", name: "Corumbiara" },
  { ibgeCode: "1100080", name: "Costa Marques" },
  { ibgeCode: "1100098", name: "Espigão D'Oeste" },
  { ibgeCode: "1100106", name: "Guajará-Mirim" },
  { ibgeCode: "1100114", name: "Jaru" },
  { ibgeCode: "1100122", name: "Ji-Paraná" },
  { ibgeCode: "1100130", name: "Machadinho D'Oeste" },
  { ibgeCode: "1100148", name: "Nova Brasilândia D'Oeste" },
  { ibgeCode: "1100155", name: "Ouro Preto do Oeste" },
  { ibgeCode: "1100189", name: "Pimenta Bueno" },
  { ibgeCode: "1100205", name: "Porto Velho" },
  { ibgeCode: "1100254", name: "Presidente Médici" },
  { ibgeCode: "1100262", name: "Rio Crespo" },
  { ibgeCode: "1100288", name: "Rolim de Moura" },
  { ibgeCode: "1100296", name: "Santa Luzia D'Oeste" },
  { ibgeCode: "1100304", name: "Vilhena" },
  { ibgeCode: "1100320", name: "São Miguel do Guaporé" },
  { ibgeCode: "1100338", name: "Nova Mamoré" },
  { ibgeCode: "1100346", name: "Alvorada D'Oeste" },
  { ibgeCode: "1100379", name: "Alto Alegre dos Parecis" },
  { ibgeCode: "1100403", name: "Alto Paraíso" },
  { ibgeCode: "1100452", name: "Buritis" },
  { ibgeCode: "1100502", name: "Novo Horizonte do Oeste" },
  { ibgeCode: "1100601", name: "Cacaulândia" },
  { ibgeCode: "1100700", name: "Campo Novo de Rondônia" },
  { ibgeCode: "1100809", name: "Candeias do Jamari" },
  { ibgeCode: "1100908", name: "Castanheiras" },
  { ibgeCode: "1100924", name: "Chupinguaia" },
  { ibgeCode: "1100940", name: "Cujubim" },
  { ibgeCode: "1101005", name: "Governador Jorge Teixeira" },
  { ibgeCode: "1101104", name: "Itapuã do Oeste" },
  { ibgeCode: "1101203", name: "Ministro Andreazza" },
  { ibgeCode: "1101302", name: "Mirante da Serra" },
  { ibgeCode: "1101401", name: "Monte Negro" },
  { ibgeCode: "1101435", name: "Nova União" },
  { ibgeCode: "1101450", name: "Parecis" },
  { ibgeCode: "1101468", name: "Pimenteiras do Oeste" },
  { ibgeCode: "1101476", name: "Primavera de Rondônia" },
  { ibgeCode: "1101484", name: "São Felipe D'Oeste" },
  { ibgeCode: "1101492", name: "São Francisco do Guaporé" },
  { ibgeCode: "1101500", name: "Seringueiras" },
  { ibgeCode: "1101559", name: "Teixeirópolis" },
  { ibgeCode: "1101609", name: "Theobroma" },
  { ibgeCode: "1101708", name: "Urupá" },
  { ibgeCode: "1101757", name: "Vale do Anari" },
  { ibgeCode: "1101807", name: "Vale do Paraíso" },
] as const;

export function normalizeMunicipalityName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export function findRoMunicipality(input: {
  name?: string;
  ibgeCode?: string;
}) {
  if (!input.name?.trim() && !input.ibgeCode?.trim()) return undefined;
  return RO_MUNICIPALITIES.find(
    (municipality) =>
      (!input.name ||
        normalizeMunicipalityName(municipality.name) ===
          normalizeMunicipalityName(input.name)) &&
      (!input.ibgeCode || municipality.ibgeCode === input.ibgeCode),
  );
}

import { describe, expect, it } from "vitest";
import {
  GeoJsonPolygonSchema,
  SaveWizardStepSchema,
  Step1IdentificationSchema,
  Step2DimensionsSchema,
  Step3WaterSchema,
  Step4ActivitySchema,
  Step5ReviewSchema,
  SubmitPropertySchema,
} from "../../shared/contracts/ruralProperty";
import {
  estimatePropertyPerimeter,
  isEstimatedPerimeter,
} from "../../shared/rural/estimatePropertyPerimeter";

const polygon = {
  type: "Polygon" as const,
  coordinates: [[
    [-63.04, -9.91],
    [-63.03, -9.91],
    [-63.03, -9.92],
    [-63.04, -9.91],
  ]],
};

const step1 = {
  propertyName: "Chácara Boa Colheita",
  registrationNumber: null,
  lineVicinal: "Linha C-65",
  ruralZoneSector: "Gleba Jamari",
  municipality: "Ariquemes",
  state: "RO",
  latitudeSede: -9.9132,
  longitudeSede: -63.0408,
  accessDirections: "Terceira porteira à direita",
};

describe("T08 contratos de imóvel rural", () => {
  it("01 aceita identificação válida em Rondônia", () => {
    expect(Step1IdentificationSchema.parse(step1).state).toBe("RO");
  });

  it("02 rejeita nome de propriedade curto", () => {
    expect(
      Step1IdentificationSchema.safeParse({ ...step1, propertyName: "A" })
        .success,
    ).toBe(false);
  });

  it("03 rejeita latitude fora da faixa de Rondônia", () => {
    expect(
      Step1IdentificationSchema.safeParse({ ...step1, latitudeSede: -15 })
        .success,
    ).toBe(false);
  });

  it("04 rejeita longitude fora da faixa de Rondônia", () => {
    expect(
      Step1IdentificationSchema.safeParse({ ...step1, longitudeSede: -68 })
        .success,
    ).toBe(false);
  });

  it("05 mantém município padrão Ariquemes e UF RO", () => {
    const parsed = Step1IdentificationSchema.parse({
      ...step1,
      municipality: undefined,
      state: undefined,
    });
    expect(parsed.municipality).toBe("Ariquemes");
    expect(parsed.state).toBe("RO");
  });

  it("06 aceita áreas válidas e perímetro opcional", () => {
    const parsed = Step2DimensionsSchema.safeParse({
      totalAreaHectares: 12.5,
      cultivatedAreaHectares: 7.25,
      boundaries: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("07 rejeita área cultivada maior que a total", () => {
    expect(
      Step2DimensionsSchema.safeParse({
        totalAreaHectares: 5,
        cultivatedAreaHectares: 6,
        boundaries: [],
      }).success,
    ).toBe(false);
  });

  it("08 aceita Polygon GeoJSON fechado", () => {
    expect(GeoJsonPolygonSchema.safeParse(polygon).success).toBe(true);
  });

  it("09 rejeita anel GeoJSON aberto", () => {
    const open = {
      type: "Polygon",
      coordinates: [[
        [-63.04, -9.91],
        [-63.03, -9.91],
        [-63.03, -9.92],
        [-63.02, -9.92],
      ]],
    };
    expect(GeoJsonPolygonSchema.safeParse(open).success).toBe(false);
  });

  it("10 rejeita coordenada GeoJSON fora de Rondônia", () => {
    const outside = {
      type: "Polygon",
      coordinates: [[
        [-70, -9.91],
        [-63.03, -9.91],
        [-63.03, -9.92],
        [-70, -9.91],
      ]],
    };
    expect(GeoJsonPolygonSchema.safeParse(outside).success).toBe(false);
  });

  it("11 restringe fonte hídrica e irrigação aos enums canônicos", () => {
    expect(
      Step3WaterSchema.safeParse({
        waterSource: "caminhao_pipa",
        irrigationSystem: "gotejamento",
      }).success,
    ).toBe(false);
  });

  it("12 exige instalação de lavagem para legumes picados", () => {
    expect(
      Step4ActivitySchema.safeParse({
        activityCategory: "legumes_picados",
        productionSystem: "agroecologico_declarado",
        hasWashingFacility: false,
      }).success,
    ).toBe(false);
  });

  it("13 permite atividade não picada sem instalação de lavagem", () => {
    expect(
      Step4ActivitySchema.safeParse({
        activityCategory: "frutas_tropicais",
        productionSystem: "convencional_transicao",
        hasWashingFacility: false,
      }).success,
    ).toBe(true);
  });

  it("14 exige aceite explícito no passo 5", () => {
    expect(
      Step5ReviewSchema.safeParse({ agroecologicalCommitment: false }).success,
    ).toBe(false);
  });

  it("15 exige revisão ao salvar etapa de imóvel existente", () => {
    expect(
      SaveWizardStepSchema.safeParse({
        propertyId: crypto.randomUUID(),
        step: 2,
        stepData: {
          totalAreaHectares: 10,
          cultivatedAreaHectares: 4,
          boundaries: [],
        },
        commandId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });

  it("16 submit rejeita campos extras e compromisso ausente", () => {
    expect(
      SubmitPropertySchema.safeParse({
        expectedRevision: 2,
        agroecologicalCommitment: true,
        commandId: crypto.randomUUID(),
        producerId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });

  it("17 desenha a ficha de perímetro com quadrado fechado na sede", () => {
    const result = estimatePropertyPerimeter(-9.533644, -62.437444, 32.1826);
    expect(result).not.toBeNull();
    expect(GeoJsonPolygonSchema.safeParse(result!.polygon).success).toBe(true);
    expect(isEstimatedPerimeter(result!.json)).toBe(true);
    expect(result!.sideMeters).toBeCloseTo(Math.sqrt(32.1826 * 10000), 3);
    const ring = result!.polygon.coordinates[0]!;
    const lats = ring.map((point) => point[1]);
    const lngs = ring.map((point) => point[0]);
    expect((Math.max(...lats) + Math.min(...lats)) / 2).toBeCloseTo(-9.533644, 4);
    expect((Math.max(...lngs) + Math.min(...lngs)) / 2).toBeCloseTo(-62.437444, 4);
    expect(estimatePropertyPerimeter(0, 0, 10)).toBeNull();
    expect(isEstimatedPerimeter(JSON.stringify(polygon))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  hasRequiredDocumentExtraction,
  selectPropertyActivityCategory,
} from "../../server/services/RuralPropertyService";

describe("requisitos do onboarding do imóvel rural", () => {
  it("não permite que dados digitados substituam um documento anexado e processado", () => {
    expect(hasRequiredDocumentExtraction([])).toBe(false);
    expect(
      hasRequiredDocumentExtraction([
        {
          extraction_id: null,
          extraction_status: null,
          property_name: "Sítio preenchido manualmente",
          municipality: "Ariquemes",
          total_area: "10",
        },
      ]),
    ).toBe(false);
  });

  it("só considera extração processada com nome, município e área", () => {
    const document = {
      extraction_id: "extraction-1",
      extraction_status: "completed",
      property_name: "Sítio Esperança",
      municipality: "Ariquemes",
      total_area: "10",
    };
    expect(hasRequiredDocumentExtraction([document])).toBe(true);
    expect(
      hasRequiredDocumentExtraction([
        { ...document, extraction_status: "processing" },
      ]),
    ).toBe(false);
    expect(
      hasRequiredDocumentExtraction([{ ...document, total_area: "" }]),
    ).toBe(false);
    expect(
      hasRequiredDocumentExtraction([
        { ...document, extraction_status: "flagged_discrepancy" },
      ]),
    ).toBe(true);
  });

  it("herda atividade para um novo imóvel, sem sobrescrever escolha explícita", () => {
    expect(selectPropertyActivityCategory(undefined, "frutas_tropicais")).toBe(
      "frutas_tropicais",
    );
    expect(
      selectPropertyActivityCategory("hortalicas_folhosas", "frutas_tropicais"),
    ).toBe("hortalicas_folhosas");
  });
});

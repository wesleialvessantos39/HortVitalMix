import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { inspectDocument } from "../../server/security/magicBytes";
import {
  RequestUploadUrlSchema,
  ReviewExtractionSchema,
} from "../../shared/contracts/documents";
import { ExtractionSchema } from "../../shared/contracts/aiExtraction";
import { validateExtraction } from "../../server/services/CarValidationEngine";
import { extractWithGemini } from "../../server/services/GeminiDocumentProcessor";
const id = "11111111-1111-4111-8111-111111111111";
const input = {
  propertyId: id,
  documentType: "car_sicar",
  fileName: "car.pdf",
  fileSizeBytes: 1024,
  mimeType: "application/pdf",
  fileHashSha256: "a".repeat(64),
  commandId: id,
};
const payload = {
  documentType: "car_sicar" as const,
  carNumber: "RO-1100023-" + "A".repeat(32),
  ccirNumber: null,
  sicarProtocol: null,
  propertyRegisteredName: "Imóvel de teste",
  holderName: "Titular de teste",
  holderCpfNormalized: "12345678901",
  municipality: "Ariquemes",
  totalAreaHectares: 10,
  legalReserveHectares: 3,
  appHectares: 1,
  consolidatedRuralAreaHectares: 6,
  fiscalModules: null,
  hasEmbargoOrInfractionDetected: null,
  confidenceScore: 0.9,
  fieldConfidence: {
    totalAreaHectares: 0.9,
    legalReserveHectares: 0.9,
    appHectares: 0.9,
    consolidatedRuralAreaHectares: 0.9,
    fiscalModules: 0.9,
  },
  rawText: "Texto original do documento",
};
const expected = { documentType: "car_sicar", cpf: "12345678901", area: 10 };
function inspect(
  b: Buffer,
  mime = "application/pdf",
  hash = createHash("sha256").update(b).digest("hex"),
  size = b.length,
) {
  return inspectDocument(b, {
    mime_type: mime,
    file_size_bytes: size,
    file_hash_sha256: hash,
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Custódia documental", () => {
  it("exige hash e commandId antes da reserva", () => {
    expect(RequestUploadUrlSchema.safeParse(input).success).toBe(true);
    expect(
      RequestUploadUrlSchema.safeParse({ ...input, fileHashSha256: undefined })
        .success,
    ).toBe(false);
  });
  it.each([0, 1023, 15728641])("rejeita tamanho %i", (size) =>
    expect(
      RequestUploadUrlSchema.safeParse({ ...input, fileSizeBytes: size })
        .success,
    ).toBe(false),
  );
  it("rejeita caminho e chaves privilegiadas no payload", () => {
    expect(
      RequestUploadUrlSchema.safeParse({ ...input, fileName: "../segredo.pdf" })
        .success,
    ).toBe(false);
    expect(
      RequestUploadUrlSchema.safeParse({ ...input, status: "clean" }).success,
    ).toBe(false);
  });
  it("reconhece PDF e confere hash", () =>
    expect(inspect(Buffer.from("%PDF-1.7\ntexto\n%%EOF")).clean).toBe(true));
  it("rejeita executável renomeado", () =>
    expect(inspect(Buffer.from("MZ executable")).clean).toBe(false));
  it("rejeita PDF truncado", () =>
    expect(inspect(Buffer.from("%PDF-1.7 corrupt")).clean).toBe(false));
  it("rejeita hash incorreto", () =>
    expect(
      inspect(Buffer.from("%PDF-1.7\n%%EOF"), "application/pdf", "0".repeat(64))
        .reason,
    ).toBe("HASH_MISMATCH"));
  it("rejeita tamanho incorreto", () =>
    expect(
      inspect(
        Buffer.from("image"),
        "image/png",
        createHash("sha256").update("image").digest("hex"),
        6,
      ).reason,
    ).toBe("SIZE_MISMATCH"));
  it("rejeita PDF ativo", () =>
    expect(inspect(Buffer.from("%PDF-1.7 /JavaScript\n%%EOF")).reason).toBe(
      "ACTIVE_PDF_CONTENT",
    ));
  it("confere os oito bytes PNG", () =>
    expect(
      inspect(Buffer.from([137, 80, 78, 71, 0, 0, 0, 0]), "image/png").clean,
    ).toBe(false));
  it("reconhece JPEG com marcador final", () =>
    expect(
      inspect(Buffer.from([255, 216, 255, 224, 0, 255, 217]), "image/jpeg")
        .clean,
    ).toBe(true));
  it("rejeita MIME declarado diferente", () =>
    expect(inspect(Buffer.from("%PDF-1.7\n%%EOF"), "image/png").clean).toBe(
      false,
    ));
  it("exige explicação para divergência", () =>
    expect(
      ReviewExtractionSchema.safeParse({
        commandId: id,
        decision: "disputed",
        note: "",
      }).success,
    ).toBe(false));
});
describe("Conferência assistida, nunca decisão automática", () => {
  it("valida leitura completa sem flags e preserva raw text", () => {
    expect(ExtractionSchema.parse(payload).rawText).toBe(payload.rawText);
    expect(validateExtraction(payload, expected).status).toBe("completed");
  });
  it("aceita informação ausente sem inventar zero", () =>
    expect(
      ExtractionSchema.parse({ ...payload, totalAreaHectares: null })
        .totalAreaHectares,
    ).toBeNull());
  it("rejeita confiança acima de 100%", () =>
    expect(
      ExtractionSchema.safeParse({ ...payload, confidenceScore: 2 }).success,
    ).toBe(false));
  it("rejeita saída extra não contratada", () =>
    expect(
      ExtractionSchema.safeParse({ ...payload, approve: true }).success,
    ).toBe(false));
  it("exige texto bruto", () =>
    expect(
      ExtractionSchema.safeParse({ ...payload, rawText: "" }).success,
    ).toBe(false));
  it("flag para CAR de outro estado", () =>
    expect(
      validateExtraction(
        { ...payload, carNumber: "SP-1234567-" + "A".repeat(32) },
        expected,
      ).issues,
    ).toContain("Número CAR de Rondônia ausente ou inválido"));
  it("flag para CPF divergente", () =>
    expect(
      validateExtraction(payload, { ...expected, cpf: "00000000000" }).status,
    ).toBe("flagged_discrepancy"));
  it("tolera exatamente 5%", () =>
    expect(
      validateExtraction({ ...payload, totalAreaHectares: 10.5 }, expected)
        .status,
    ).toBe("completed"));
  it("marca mais de 5%", () =>
    expect(
      validateExtraction({ ...payload, totalAreaHectares: 10.51 }, expected)
        .status,
    ).toBe("flagged_discrepancy"));
  it("confere INCRA de 13 dígitos", () =>
    expect(
      validateExtraction(
        { ...payload, documentType: "ccir_incra", ccirNumber: "1234567890123" },
        { ...expected, documentType: "ccir_incra" },
      ).status,
    ).toBe("completed"));
  it("não ignora baixa confiança por campo", () =>
    expect(
      validateExtraction(
        {
          ...payload,
          fieldConfidence: { ...payload.fieldConfidence, appHectares: 0.3 },
        },
        expected,
      ).status,
    ).toBe("flagged_discrepancy"));
  it("recusa resposta truncada do provedor", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only");
    vi.stubEnv("GEMINI_MODEL", "gemini-test");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => ({ candidates: [{ finishReason: "MAX_TOKENS" }] }),
        }),
    );
    await expect(
      extractWithGemini(Buffer.from("pdf"), "application/pdf", "car_sicar"),
    ).rejects.toThrow("AI_OUTPUT_INCOMPLETE");
  });
  it("envia JSON schema e valida resposta", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only");
    vi.stubEnv("GEMINI_MODEL", "gemini-test");
    const fetcher = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: JSON.stringify(payload) }] },
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetcher);
    expect(
      await extractWithGemini(
        Buffer.from("pdf"),
        "application/pdf",
        "car_sicar",
      ),
    ).toEqual(payload);
    expect(
      JSON.parse(fetcher.mock.calls[0][1].body).generationConfig
        .responseJsonSchema.type,
    ).toBe("object");
  });
  it("sem chave não faz chamada externa", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(
      extractWithGemini(Buffer.from("pdf"), "application/pdf", "car_sicar"),
    ).rejects.toThrow("AI_NOT_CONFIGURED");
    expect(f).not.toHaveBeenCalled();
  });
});

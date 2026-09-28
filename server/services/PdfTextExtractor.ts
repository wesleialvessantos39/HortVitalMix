import { parseRuralDocumentText } from "../../shared/documents/parseRuralDocument.ts";
import type { ExtractionPayload } from "../../shared/contracts/aiExtraction.ts";

export async function extractPdfText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: bytes,
    disableWorker: true,
    isEvalSupported: false,
    verbosity: 0,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;
  const pages = Math.min(doc.numPages, 8);
  const parts: string[] = [];
  for (let index = 1; index <= pages; index++) {
    const page = await doc.getPage(index);
    const content = await page.getTextContent();
    parts.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" "),
    );
  }
  return parts.join("\n");
}
export async function extractPdfDocument(
  bytes: Buffer,
  documentType: string,
): Promise<ExtractionPayload | null> {
  if (documentType !== "car_sicar" && documentType !== "ccir_incra")
    return null;
  try {
    const text = await extractPdfText(new Uint8Array(bytes));
    return parseRuralDocumentText(text, documentType);
  } catch {
    return null;
  }
}

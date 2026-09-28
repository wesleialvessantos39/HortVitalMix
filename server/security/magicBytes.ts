import { createHash } from "node:crypto";
export function inspectDocument(
  buffer: Buffer,
  expected: {
    mime_type: string;
    file_size_bytes: number;
    file_hash_sha256: string;
  },
) {
  let detectedMime: string | null = null;
  if (
    buffer.subarray(0, 5).equals(Buffer.from("%PDF-")) &&
    buffer.subarray(-1024).includes(Buffer.from("%%EOF"))
  )
    detectedMime = "application/pdf";
  else if (
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.subarray(-12).includes(Buffer.from("IEND"))
  )
    detectedMime = "image/png";
  else if (
    buffer[0] === 255 &&
    buffer[1] === 216 &&
    buffer[2] === 255 &&
    buffer.at(-2) === 255 &&
    buffer.at(-1) === 217
  )
    detectedMime = "image/jpeg";
  const hash = createHash("sha256").update(buffer).digest("hex");
  // Esta inspeção não se apresenta como antivírus. Conteúdo PDF ativo é recusado preventivamente.
  const activePdf =
    detectedMime === "application/pdf" &&
    /\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b/.test(
      buffer.toString("latin1"),
    );
  const reason =
    buffer.length !== Number(expected.file_size_bytes)
      ? "SIZE_MISMATCH"
      : hash !== expected.file_hash_sha256
        ? "HASH_MISMATCH"
        : detectedMime !== expected.mime_type
          ? "INVALID_SIGNATURE"
          : activePdf
            ? "ACTIVE_PDF_CONTENT"
            : null;
  return { clean: !reason, detectedMime, hash, reason };
}

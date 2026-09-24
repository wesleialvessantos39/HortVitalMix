// Serverless adapters may supply JSON as an already-decoded object, string,
// or Buffer after consuming the request stream. Never read that stream twice.
export function decodedJsonBody(body: unknown): unknown {
  if (typeof body !== "string" && !Buffer.isBuffer(body)) return body;
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (bytes.length > 32 * 1024)
    throw Object.assign(new Error("JSON body too large"), { type: "entity.too.large" });
  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Expected JSON object");
    return parsed;
  } catch {
    throw Object.assign(new Error("Invalid JSON object"), { type: "entity.parse.failed" });
  }
}

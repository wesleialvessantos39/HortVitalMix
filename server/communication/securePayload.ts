import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export interface EncryptedPayload {
  ciphertext: Buffer;
  nonceHex: string;
  authTagHex: string;
}

function resolveKey(raw: string | undefined | null): Buffer {
  if (!raw) throw new Error("OUTBOX_ENCRYPTION_KEY ausente");
  if (!/^[0-9a-fA-F]{64}$/.test(raw))
    throw new Error("OUTBOX_ENCRYPTION_KEY deve ter 64 caracteres hex");
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32)
    throw new Error("OUTBOX_ENCRYPTION_KEY deve ter 32 bytes");
  return buf;
}

export function encryptPayload(
  payload: Record<string, unknown>,
  keyHex: string | undefined,
): EncryptedPayload {
  const key = resolveKey(keyHex);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext,
    nonceHex: nonce.toString("hex"),
    authTagHex: authTag.toString("hex"),
  };
}

export function decryptPayload(
  ciphertext: Buffer,
  nonceHex: string,
  authTagHex: string,
  keyHex: string | undefined,
): Record<string, unknown> {
  const key = resolveKey(keyHex);
  const nonce = Buffer.from(nonceHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  if (nonce.length !== NONCE_BYTES) throw new Error("nonce inválido");
  if (authTag.length !== AUTH_TAG_BYTES) throw new Error("auth tag inválido");
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as Record<string, unknown>;
}

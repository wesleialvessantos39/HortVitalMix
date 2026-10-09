const KEY = "hvm.admin.session";

type Stored = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  identityVersion?: string;
};

function read(): Stored | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(
      localStorage.getItem(KEY) || "null",
    ) as Stored | null;
    if (!parsed?.accessToken || !parsed.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveAdminSession(input: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  preserveIdentity?: boolean;
}) {
  if (typeof localStorage === "undefined") return;
  const value: Stored = {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: Date.now() + Math.max(60, input.expiresIn) * 1000,
    identityVersion: input.preserveIdentity
      ? readAdminSessionIdentityVersion() || cryptoRandomUUID()
      : cryptoRandomUUID(),
  };
  localStorage.setItem(KEY, JSON.stringify(value));
}

export function readAdminAccessToken() {
  return read()?.accessToken ?? "";
}

export function readAdminRefreshToken() {
  return read()?.refreshToken ?? "";
}

// Versão local usada somente para descartar respostas de uma conta anterior.
// A autenticação e os poderes continuam sendo validados pelo servidor.
export function readAdminSessionIdentityVersion() {
  const stored = read();
  return stored?.identityVersion ?? stored?.refreshToken ?? "";
}

export function clearAdminSession() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KEY);
}
import { cryptoRandomUUID } from "./uuid";

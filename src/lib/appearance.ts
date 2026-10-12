export type ColorTheme = "light" | "dark";
export type AppearancePreference = {
  theme: ColorTheme;
  updatedAt: number;
  source: "manual" | "account";
};

export const APPEARANCE_STORAGE_KEY = "hvm:appearance:v1";
export const APPEARANCE_COOKIE = "hvm_theme";
export const APPEARANCE_EVENT = "hvm:appearance-changed";

export function isColorTheme(value: unknown): value is ColorTheme {
  return value === "light" || value === "dark";
}

export function readAppearancePreference(): AppearancePreference | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === "object" && "theme" in value && isColorTheme(value.theme)) {
      const record = value as Partial<AppearancePreference>;
      return {
        theme: value.theme,
        updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
        source: record.source === "account" ? "account" : "manual",
      };
    }
  } catch { /* Private browsing may restrict storage; the cookie is a fallback. */ }
  try {
    const cookie = document.cookie.split(";").map((part) => part.trim())
      .find((part) => part.startsWith(APPEARANCE_COOKIE + "="));
    const theme = cookie?.slice(APPEARANCE_COOKIE.length + 1);
    if (isColorTheme(theme)) return { theme, updatedAt: 0, source: "manual" };
  } catch { /* An in-memory preference still works when all storage is blocked. */ }
  return null;
}

export function applyColorTheme(theme: ColorTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content", theme === "dark" ? "#11241a" : "#1B4D2E",
  );
}

export function saveAppearancePreference(theme: ColorTheme, source: AppearancePreference["source"] = "manual") {
  const preference: AppearancePreference = { theme, source, updatedAt: Date.now() };
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preference)); } catch { /* Fall back to cookie. */ }
    try {
      document.cookie = APPEARANCE_COOKIE + "=" + theme + "; Path=/; Max-Age=34560000; SameSite=Lax" +
        (location.protocol === "https:" ? "; Secure" : "");
    } catch { /* Retain the active in-memory choice. */ }
  }
  applyColorTheme(theme);
  return preference;
}

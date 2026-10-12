import { useSyncExternalStore } from "react";
import {
  APPEARANCE_EVENT, APPEARANCE_STORAGE_KEY, applyColorTheme,
  readAppearancePreference, saveAppearancePreference,
  type ColorTheme, type AppearancePreference,
} from "../lib/appearance";

let currentTheme: ColorTheme = readAppearancePreference()?.theme ??
  (typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light");
applyColorTheme(currentTheme);

function publish(theme: ColorTheme, source: AppearancePreference["source"]) {
  currentTheme = theme;
  saveAppearancePreference(theme, source);
  window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: { theme, source } }));
}

export function changeColorTheme(theme: ColorTheme, source: AppearancePreference["source"] = "manual") {
  publish(theme, source);
}

function subscribe(onChange: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key !== APPEARANCE_STORAGE_KEY) return;
    const preference = readAppearancePreference();
    if (!preference) return;
    currentTheme = preference.theme;
    applyColorTheme(currentTheme);
    onChange();
  };
  window.addEventListener(APPEARANCE_EVENT, onChange);
  window.addEventListener("storage", storageChanged);
  return () => {
    window.removeEventListener(APPEARANCE_EVENT, onChange);
    window.removeEventListener("storage", storageChanged);
  };
}

export function useColorTheme() {
  const theme = useSyncExternalStore(subscribe, () => currentTheme, () => "light" as ColorTheme);
  return { theme, setTheme: changeColorTheme, toggleTheme: () => changeColorTheme(theme === "dark" ? "light" : "dark") };
}

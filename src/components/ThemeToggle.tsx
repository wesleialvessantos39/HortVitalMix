import { Moon, Sun } from "lucide-react";
import { useColorTheme } from "../hooks/useColorTheme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useColorTheme();
  const dark = theme === "dark";
  const label = dark ? "Ativar modo claro" : "Ativar modo escuro";
  return (
    <button type="button" className="theme-toggle"
      onClick={toggleTheme} aria-label={label} aria-pressed={dark} title={label}>
      {dark ? <Sun aria-hidden="true" size={20} /> : <Moon aria-hidden="true" size={20} />}
    </button>
  );
}

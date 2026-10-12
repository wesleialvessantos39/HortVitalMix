import { Moon, Sun } from "lucide-react";
import { useColorTheme } from "../hooks/useColorTheme";

export function ThemeToggle({ floating = false }: { floating?: boolean }) {
  const { theme, toggleTheme } = useColorTheme();
  const dark = theme === "dark";
  const label = dark ? "Ativar modo claro" : "Ativar modo escuro";
  return (
    <button type="button" className={"theme-toggle" + (floating ? " theme-toggle--floating" : "")}
      onClick={toggleTheme} aria-label={label} aria-pressed={dark} title={label}>
      {dark ? <Sun aria-hidden="true" size={20} /> : <Moon aria-hidden="true" size={20} />}
      {floating && <span>{dark ? "Modo claro" : "Modo escuro"}</span>}
    </button>
  );
}

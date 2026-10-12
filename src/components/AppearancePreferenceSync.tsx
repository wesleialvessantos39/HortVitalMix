import { useEffect } from "react";
import type { ShellSession } from "../hooks/useSession";
import { changeColorTheme } from "../hooks/useColorTheme";
import { APPEARANCE_EVENT, readAppearancePreference, type ColorTheme } from "../lib/appearance";
import { AppearanceSync } from "../lib/appearanceSync";
import { api } from "../lib/api";
import type { AppearanceView } from "../../shared/contracts/appearance";

export function AppearancePreferenceSync({ session }: { session: ShellSession | null }) {
  const userId = session?.userId;
  const administrative = session?.activeRole === "platform_admin" || session?.activeRole === "platform_super_admin";
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    const requestSignal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    const path = administrative ? "/v1/admin/account/appearance" : "/v1/account/appearance";
    const sync = new AppearanceSync({
      userId, readLocal: readAppearancePreference,
      online: () => navigator.onLine !== false,
      applyAccount: (theme) => changeColorTheme(theme, "account"),
      load: () => api<AppearanceView>(path, { signal: requestSignal(), offlineBypass: true }),
      save: (theme) => api<AppearanceView>(path, {
        method: "PATCH", signal: requestSignal(), offlineBypass: true,
        body: JSON.stringify({ theme, expectedUserId: userId }),
      }),
    });
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ theme: ColorTheme; source: string }>).detail;
      if (detail?.source === "manual") sync.changed(detail.theme);
    };
    const reconnect = () => { void sync.restore(); void sync.flush(); };
    window.addEventListener(APPEARANCE_EVENT, changed);
    window.addEventListener("online", reconnect);
    void sync.restore();
    return () => {
      controller.abort(); sync.dispose();
      window.removeEventListener(APPEARANCE_EVENT, changed);
      window.removeEventListener("online", reconnect);
    };
  }, [userId, administrative]);
  return null;
}

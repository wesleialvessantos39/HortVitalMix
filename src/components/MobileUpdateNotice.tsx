import { useEffect, useState } from "react";
import "./mobileUpdateNotice.css";

/** Nunca instala binarios silenciosamente nem recarrega formulários sem acao. */
export function MobileUpdateNotice() {
  const [url, setUrl] = useState("");
  const [version, setVersion] = useState("");
  const [webUpdate, setWebUpdate] = useState(false);
  const installed = Number(import.meta.env.VITE_HVM_MOBILE_BUILD_NUMBER || 0);
  useEffect(() => {
    const onChange = () => setWebUpdate(true);
    navigator.serviceWorker?.addEventListener("controllerchange", onChange);
    return () => navigator.serviceWorker?.removeEventListener("controllerchange", onChange);
  }, []);
  useEffect(() => {
    const platform = (window as Window & {
      Capacitor?: { getPlatform?: () => string };
    }).Capacitor?.getPlatform?.();
    if (platform !== "android" || !Number.isSafeInteger(installed) || installed < 1) return;
    let active = true;
    async function check() {
      try {
        const resp = await fetch("https://api.github.com/repos/wesleialvessantos39/HortVitalMix/releases?per_page=10", {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!resp.ok) return;
        const releases = await resp.json() as Array<{
          tag_name?: string;
          draft?: boolean;
          prerelease?: boolean;
          assets?: Array<{ name?: string; browser_download_url?: string }>;
        }>;
        if (!Array.isArray(releases)) return;
        for (const r of releases) {
          if (r.draft || r.prerelease) continue;
          const match = /^hvm-mobile-r([1-9][0-9]*)$/.exec(r.tag_name || "");
          if (!match) continue;
          const next = Number(match[1]);
          if (!Number.isSafeInteger(next) || next <= installed) continue;
          const apk = "HortiVitalMix-Android-" + next + ".apk";
          const expected = "https://github.com/wesleialvessantos39/HortVitalMix/releases/download/" + r.tag_name + "/" + apk;
          if (r.assets?.some((a) => a.name === apk && a.browser_download_url === expected)) {
            if (active) {
              setUrl(expected);
              setVersion("1.0." + next);
            }
            break;
          }
        }
      } catch {
        // A indisponibilidade do GitHub nao bloqueia o sistema.
      }
    }
    void check();
    const onResume = () => { void check(); };
    window.addEventListener("focus", onResume);
    window.addEventListener("online", onResume);
    return () => {
      active = false;
      window.removeEventListener("focus", onResume);
      window.removeEventListener("online", onResume);
    };
  }, [installed]);
  if (!url && !webUpdate) return null;
  return (
    <aside className="hvm-mobile-update" role="status" aria-live="polite">
      <strong>Atualização disponível</strong>
      <span>Salve seus formulários e finalize operações pendentes antes de atualizar.</span>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">Baixar Android {version}</a>
      ) : (
        <button type="button" onClick={() => location.reload()}>Atualizar página</button>
      )}
      <button type="button" onClick={() => { setUrl(""); setWebUpdate(false); }}>Depois</button>
    </aside>
  );
}

import { ArrowUpRight, Download, Smartphone } from "lucide-react";
import { useState } from "react";
import type { AppDistributionResponse } from "../../shared/contracts/appDistribution";
import { useAppDistribution } from "../hooks/useAppDistribution";
import { nativeDownloadDestination, openNativeDownload } from "../lib/installedApp";
import { isNativeApp } from "../lib/nativeTransport";
import "./appDownloadSection.css";

export function AppPlatformDownloads({ data, loading = false, unavailable = false }: {
  data: AppDistributionResponse | null;
  loading?: boolean;
  unavailable?: boolean;
}) {
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");
  const native = isNativeApp();
  return <><div className="hvm-app-download-platforms" aria-label="Disponibilidade dos aplicativos">
    {(["android", "ios"] as const).map((key) => {
      const platform = data?.[key];
      const title = key === "android" ? "Android" : "iPhone e iPad";
      const available = Boolean(platform?.available && platform.version && platform.channel && platform.downloadUrl === `/downloads/${key}`);
      const detail = available ? `Versão ${platform!.version}` : loading ? "Verificando…" : unavailable ? "Verifique em instantes" : "Publicação em preparação";
      const content = <>
        <span className="hvm-app-platform-title"><Smartphone size={18} aria-hidden="true" /> {title}</span>
        <small>{detail}</small>
        <span className="hvm-app-platform-action">{available ? <><Download size={14} aria-hidden="true" /> {platform?.channel === "apk" ? "Baixar aplicativo" : "Abrir instalação"}</> : unavailable ? "Indisponível agora" : "Em breve"}</span>
      </>;
      return available ? <a key={key} href={native ? nativeDownloadDestination(key) : platform!.downloadUrl!} aria-disabled={opening !== null ? true : undefined} onClick={native ? (event) => {
        event.preventDefault();
        if (opening) return;
        setOpening(key);
        setError("");
        void openNativeDownload(key).catch(() => setError("Não foi possível abrir a instalação. Tente novamente.")).finally(() => setOpening(null));
      } : undefined} aria-label={`${platform?.channel === "apk" ? "Baixar" : "Instalar"} HortiVitalMix para ${title}, versão ${platform!.version}`}>{content}</a>
        : <button key={key} type="button" disabled aria-label={`Aplicativo ${title}: ${detail}`}>{content}</button>;
    })}
  </div>{error && <p role="alert">{error}</p>}</>;
}

export function AppDownloadSection({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { data, error, loading } = useAppDistribution();
  return (
    <section className="hvm-app-download" aria-labelledby="hvm-app-download-title">
      <div className="hvm-app-download-copy">
        <span className="hvm-app-download-mark"><Smartphone size={25} aria-hidden="true" /></span>
        <div>
          <span className="hvm-app-download-eyebrow">Sempre perto de você</span>
          <h2 id="hvm-app-download-title">HortiVitalMix no seu celular</h2>
          <p>Encontre a versão publicada mais recente para Android e iOS e acompanhe as atualizações.</p>
          <a className="hvm-app-download-details" href="/aplicativos" onClick={onNavigate ? (event) => { event.preventDefault(); onNavigate("/aplicativos"); } : undefined}>Aplicativos e atualizações <ArrowUpRight size={14} aria-hidden="true" /></a>
        </div>
      </div>
      <AppPlatformDownloads data={data} loading={loading} unavailable={error} />
    </section>
  );
}

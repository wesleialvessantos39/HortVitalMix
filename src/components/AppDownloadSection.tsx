import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import "./appDownloadSection.css";

type AndroidRelease = { version: string; downloadUrl: string };
export function AppDownloadSection() {
  const [android, setAndroid] = useState<AndroidRelease | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/mobile/releases/latest", {
      credentials: "omit",
      signal: controller.signal,
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data: { android?: AndroidRelease } | null) => {
        if (!controller.signal.aborted && data?.android) setAndroid(data.android);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return (
    <section className="hvm-app-download" aria-labelledby="hvm-app-download-title">
      <div className="hvm-app-download-copy">
        <Smartphone size={24} aria-hidden="true" />
        <div>
          <h2 id="hvm-app-download-title">HortiVitalMix no seu celular</h2>
          <p>{android ? "Versão Android assinada disponível. iPhone e iPad: use o navegador." :
            "Os aplicativos nativos estão em preparação. Enquanto isso, aproveite tudo pelo navegador."}</p>
        </div>
      </div>
      <div className="hvm-app-download-platforms" aria-label="Disponibilidade dos aplicativos">
        {android ? (
          <a className="hvm-app-download-link" href={android.downloadUrl} rel="noopener noreferrer">
            <span>Android APK</span><small>Baixar versão {android.version}</small>
          </a>
        ) : (
          <button type="button" disabled aria-label="Aplicativo Android: em breve">
            <span>Android</span><small>Em breve</small>
          </button>
        )}
        <button type="button" disabled aria-label="Aplicativo iPhone e iPad: em breve">
          <span>iPhone e iPad</span><small>Em breve</small>
        </button>
      </div>
    </section>
  );
}

import { ArrowUpRight, Smartphone } from "lucide-react";
import { PwaInstallCards } from "./pwa/PwaInstallCards";
import "./appDownloadSection.css";

export function AppDownloadSection({
  onNavigate,
}: {
  onNavigate?: (path: string) => void;
}) {
  return (
    <section
      className="hvm-app-download"
      aria-labelledby="hvm-app-download-title"
    >
      <div className="hvm-app-download-copy">
        <span className="hvm-app-download-mark">
          <Smartphone size={25} aria-hidden="true" />
        </span>
        <div>
          <span className="hvm-app-download-eyebrow">Sempre perto de você</span>
          <h2 id="hvm-app-download-title">HortiVitalMix no seu celular</h2>
          <p>
            Instale gratuitamente na tela inicial e receba as melhorias da
            plataforma quando estiver conectado.
          </p>
          <a
            className="hvm-app-download-details"
            href="/aplicativos"
            onClick={
              onNavigate
                ? (event) => {
                    event.preventDefault();
                    onNavigate("/aplicativos");
                  }
                : undefined
            }
          >
            Aplicativos e atualizações{" "}
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </div>
      <PwaInstallCards compact />
    </section>
  );
}

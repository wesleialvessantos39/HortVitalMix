import { Smartphone } from "lucide-react";
import "./appDownloadSection.css";

export function AppDownloadSection() {
  return (
    <section className="hvm-app-download" aria-labelledby="hvm-app-download-title">
      <div className="hvm-app-download-copy">
        <Smartphone size={24} aria-hidden="true" />
        <div>
          <h2 id="hvm-app-download-title">HortiVitalMix no seu celular</h2>
          <p>Os aplicativos estão em preparação. Enquanto isso, aproveite tudo pelo navegador.</p>
        </div>
      </div>
      <div className="hvm-app-download-platforms" aria-label="Disponibilidade dos aplicativos">
        <button type="button" disabled aria-label="Aplicativo Android: em breve">
          <span>Android</span><small>Em breve</small>
        </button>
        <button type="button" disabled aria-label="Aplicativo iPhone e iPad: em breve">
          <span>iPhone e iPad</span><small>Em breve</small>
        </button>
      </div>
    </section>
  );
}

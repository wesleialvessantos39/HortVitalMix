import { ArrowLeft, Cloud, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { AppPlatformDownloads } from "../components/AppDownloadSection";
import { PageLoading } from "../components/PageLoading";
import { useAppDistribution } from "../hooks/useAppDistribution";
import "./appDownloads.css";

export default function AppDownloadsPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { data, error, loading, reload } = useAppDistribution();
  return <section className="app-downloads-page" aria-labelledby="app-downloads-title">
    <a href="/" className="app-downloads-back" onClick={(event) => { event.preventDefault(); onNavigate("/"); }}><ArrowLeft size={16} aria-hidden="true" /> Voltar para o site</a>
    <header className="app-downloads-header">
      <span className="app-downloads-mark"><Smartphone size={29} aria-hidden="true" /></span>
      <span className="app-downloads-eyebrow">HortiVitalMix com você</span>
      <h1 id="app-downloads-title">Aplicativos e atualizações</h1>
      <p>Acompanhe a publicação dos aplicativos e instale sempre a versão atual por este canal.</p>
    </header>
    {loading ? <PageLoading label="Verificando aplicativos" /> : <>
      {error && <div className="app-downloads-alert" role="alert"><p>Não foi possível verificar as versões agora.</p><button type="button" onClick={reload}><RefreshCw size={15} aria-hidden="true" /> Tentar novamente</button></div>}
      <AppPlatformDownloads data={data} unavailable={error} />
      <div className="app-downloads-benefits">
        <article><Cloud size={20} aria-hidden="true" /><h2>Dados sempre atuais</h2><p>Catálogo, pedidos e serviços sincronizados ao conectar.</p></article>
        <article><ShieldCheck size={20} aria-hidden="true" /><h2>Uma conta, seus dados</h2><p>Seus registros no celular e no navegador.</p></article>
      </div>
      <details className="app-downloads-note"><summary>Como funcionam as atualizações</summary><p>Os dados e serviços da plataforma são atualizados ao conectar. Android, iPhone e navegador utilizam seus mesmos cadastros; registros e pedidos permanecem no sistema.</p><p>Quando uma nova versão do aplicativo precisar ser instalada, você receberá um aviso. Este canal sempre oferece a versão publicada mais recente. No iOS, a instalação utiliza um canal autorizado da Apple.</p></details>
      {data?.web.available && <p className="app-downloads-current"><span className="app-downloads-current-dot" aria-hidden="true" /> Plataforma conectada à versão atual</p>}
      {data?.releaseNotes && <details className="app-downloads-changes"><summary>O que mudou na versão atual</summary><p>{data.releaseNotes}</p></details>}
    </>}
  </section>;
}

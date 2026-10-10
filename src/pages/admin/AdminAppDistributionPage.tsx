import {
  ArrowUpRight,
  CheckCircle2,
  Cloud,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { hasAdminPermission } from "../../../shared/adminPermissions";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";
import { PwaInstallCards } from "../../components/pwa/PwaInstallCards";
import { PwaVersionPanel } from "../../components/pwa/PwaVersionPanel";
import { usePwa } from "../../hooks/usePwa";
import "./appDistribution.css";

export default function AdminAppDistributionPage({
  access,
  onNavigate,
}: {
  access: AdminVerifySessionResponse;
  onNavigate: (path: string) => void;
}) {
  const pwa = usePwa();
  const allowed = hasAdminPermission(access, "platform_configuration");
  if (!allowed)
    return (
      <section className="admin-distribution-page">
        <div className="admin-distribution-banner" role="alert">
          <ShieldCheck size={19} />
          <p>
            Este departamento exige o poder de Configuração da plataforma e BI.
          </p>
        </div>
      </section>
    );
  const checks = [
    { label: "Conexão em contexto seguro", ready: window.isSecureContext },
    { label: "Manifesto e ícones oficiais", ready: Boolean(pwa.version) },
    { label: "Arquivos preparados e verificados", ready: pwa.workerReady },
    {
      label: "Atualização web independente dos pacotes nativos",
      ready: Boolean(pwa.version?.buildId),
    },
  ];
  return (
    <section
      className="admin-distribution-page admin-pwa-page"
      aria-labelledby="admin-distribution-title"
    >
      <header className="admin-distribution-header">
        <div>
          <span className="admin-distribution-eyebrow">
            <Smartphone size={15} />
            Central de Aplicativos
          </span>
          <h1 id="admin-distribution-title">Aplicativos e atualizações</h1>
          <p>
            Instalação Android e iOS, versão web publicada e proteção das
            atualizações em uma única plataforma.
          </p>
        </div>
        <a
          className="hvm-pwa-secondary"
          href="/aplicativos"
          onClick={(event) => {
            event.preventDefault();
            onNavigate("/aplicativos");
          }}
        >
          Ver página pública
          <ArrowUpRight size={16} />
        </a>
      </header>
      <div className="admin-pwa-overview">
        <Cloud size={29} aria-hidden="true" />
        <div>
          <strong>Uma aplicação web, todos os dispositivos</strong>
          <p>
            O deployment da branch main na Vercel entrega as melhorias do
            HortiVitalMix. A instalação usa recursos gratuitos do navegador e
            não exige lojas ou pacotes.
          </p>
        </div>
        <span>
          {pwa.device.standalone ? "Modo instalado" : "Modo navegador"}
        </span>
      </div>
      <PwaVersionPanel />
      <section
        className="admin-pwa-health"
        aria-labelledby="admin-pwa-health-title"
      >
        <h2 id="admin-pwa-health-title">Estado da instalação PWA</h2>
        <ul>
          {checks.map((check) => (
            <li key={check.label}>
              <CheckCircle2
                size={19}
                aria-hidden="true"
                className={check.ready ? "is-ready" : ""}
              />
              <span>{check.label}</span>
              <strong>
                {check.ready ? "Verificado" : "Aguardando verificação"}
              </strong>
            </li>
          ))}
        </ul>
        <p>
          Os requisitos técnicos são verificados antes de apresentar a
          instalação como disponível. A confirmação final pertence ao navegador.
        </p>
      </section>
      <PwaInstallCards />
      <section className="admin-pwa-policy">
        <h2>Como as atualizações são aplicadas</h2>
        <p>
          A nova versão prepara todos os recursos e confere sua integridade.
          Cada aba confirma que não há formulário, upload, confirmação
          administrativa, mudança de sessão, comando ou sincronização pendente
          antes da ativação.
        </p>
        <p>
          Uma aba suspensa, uma operação em andamento ou uma falha de download
          mantém a versão funcional. O sistema tenta novamente quando houver
          conexão e uma oportunidade segura, preservando o IndexedDB e os dados
          do Supabase.
        </p>
        <div>
          <a
            href="/instalar/android"
            onClick={(event) => {
              event.preventDefault();
              onNavigate("/instalar/android");
            }}
          >
            Instruções Android
            <ArrowUpRight size={16} />
          </a>
          <a
            href="/instalar/ios"
            onClick={(event) => {
              event.preventDefault();
              onNavigate("/instalar/ios");
            }}
          >
            Instruções iPhone e iPad
            <ArrowUpRight size={16} />
          </a>
        </div>
      </section>
    </section>
  );
}

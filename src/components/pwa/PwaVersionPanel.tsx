import { RefreshCw, ShieldCheck } from "lucide-react";
import { usePwa } from "../../hooks/usePwa";
import "./pwa.css";

export const pwaStateLabels = {
  current: "Aplicativo atualizado",
  checking: "Verificando atualização",
  preparing: "Preparando nova versão",
  waiting: "Atualização aguardando operação",
  applying: "Aplicando atualização",
  offline: "Sem conexão",
  error: "Não foi possível verificar agora",
  unsupported: "Verifique no navegador compatível",
} as const;
export function PwaVersionPanel() {
  const pwa = usePwa();
  const commit =
    typeof __HVM_BUILD_COMMIT_SHA__ === "string"
      ? __HVM_BUILD_COMMIT_SHA__
      : "";
  return (
    <section
      className="hvm-pwa-version"
      aria-labelledby="hvm-pwa-version-title"
      data-hvm-pwa-ui
    >
      <header>
        <span className="hvm-pwa-platform-icon">
          <ShieldCheck size={23} aria-hidden="true" />
        </span>
        <div>
          <h2 id="hvm-pwa-version-title">Atualizações da plataforma</h2>
          <strong role="status">{pwaStateLabels[pwa.updateState]}</strong>
        </div>
      </header>
      {pwa.reason && <p className="hvm-pwa-version-reason">{pwa.reason}</p>}
      <dl>
        <div>
          <dt>Versão em uso</dt>
          <dd>
            {commit
              ? `Web · ${commit.slice(0, 12)}`
              : "Identidade web não disponível"}
          </dd>
        </div>
        <div>
          <dt>Versão publicada</dt>
          <dd>
            {pwa.version
              ? `${pwa.version.frontendVersion} · ${pwa.version.commitSha ? pwa.version.commitSha.slice(0, 12) : pwa.version.buildId.slice(0, 12)}`
              : "Aguardando verificação"}
          </dd>
        </div>
        <div>
          <dt>Última verificação</dt>
          <dd>
            {pwa.lastCheckedAt
              ? new Date(pwa.lastCheckedAt).toLocaleString("pt-BR")
              : "Ainda não concluída"}
          </dd>
        </div>
      </dl>
      <button
        type="button"
        className="hvm-pwa-secondary"
        disabled={["checking", "applying"].includes(pwa.updateState)}
        onClick={() => void pwa.checkUpdates()}
      >
        <RefreshCw size={16} aria-hidden="true" />
        Verificar atualizações
      </button>
    </section>
  );
}

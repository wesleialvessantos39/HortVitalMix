import { useEffect, useId, useRef, useState } from "react";
import {
  Apple,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  Smartphone,
  X,
} from "lucide-react";
import {
  PWA_INSTALL_PATHS,
  type PwaPlatform,
} from "../../../shared/contracts/pwa";
import { usePwa } from "../../hooks/usePwa";
import { requestPwaInstallation } from "../../lib/pwaManager";
import { nativeBackendOrigin } from "../../lib/nativeTransport";
import { IosInstallGuide, PwaInstallAddress } from "./IosInstallGuide";
import "./pwa.css";

export function PwaInstallCards({
  compact = false,
  initialPlatform,
}: {
  compact?: boolean;
  initialPlatform?: PwaPlatform;
}) {
  const pwa = usePwa();
  const [guide, setGuide] = useState<PwaPlatform | null>(null);
  const [feedback, setFeedback] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (initialPlatform && !pwa.device.standalone) setGuide(initialPlatform);
  }, [initialPlatform, pwa.device.standalone]);
  useEffect(() => {
    if (pwa.installState === "confirmed") {
      setFeedback("");
      setGuide(null);
    }
  }, [pwa.installState]);
  useEffect(() => {
    const element = dialog.current;
    if (guide && element && !element.open) element.showModal();
    if (!guide && element?.open) element.close();
    setCopied(false);
    setCopyError("");
  }, [guide]);
  function canPrompt(platform: PwaPlatform) {
    return (
      (pwa.device.platform === platform || pwa.device.platform === "unknown") &&
      pwa.promptAvailable &&
      pwa.readiness === "ready" &&
      !pwa.device.internalBrowser
    );
  }
  async function install(platform: PwaPlatform) {
    setFeedback("");
    if (canPrompt(platform)) {
      const result = await requestPwaInstallation();
      if (result === "guide") setGuide(platform);
      else
        setFeedback(
          result === "accepted"
            ? "Solicitação aceita. Aguarde a confirmação do navegador e abra pelo ícone na tela inicial."
            : "Instalação cancelada. Você pode tentar novamente ou consultar as instruções.",
        );
    } else setGuide(platform);
  }
  const address = guide
    ? new URL(
        PWA_INSTALL_PATHS[guide],
        nativeBackendOrigin() ?? location.origin,
      ).href
    : "";
  async function copy() {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setCopyError(
        "Selecione e copie o endereço abaixo para abrir no seu celular.",
      );
    }
  }
  if (pwa.device.standalone)
    return (
      <div className="hvm-pwa-installed" data-hvm-pwa-ui role="status">
        <CheckCircle2 size={25} aria-hidden="true" />
        <div>
          <strong>Instalado neste dispositivo</strong>
          <p>
            Você abriu o HortiVitalMix pelo aplicativo. As melhorias chegam pela
            atualização web, sem reinstalação.
          </p>
          <button type="button" onClick={() => void pwa.checkUpdates()}>
            Verificar atualizações
          </button>
        </div>
      </div>
    );
  return (
    <div
      className={"hvm-pwa-install" + (compact ? " is-compact" : "")}
      data-hvm-pwa-ui
    >
      <div className="hvm-pwa-cards" aria-label="Instalação do HortiVitalMix">
        {(["android", "ios"] as const).map((platform) => {
          const android = platform === "android";
          const recommended = pwa.device.platform === platform;
          const Icon = android ? Smartphone : Apple;
          const status =
            pwa.readiness === "checking"
              ? "Verificando requisitos de instalação"
              : pwa.readiness === "ready"
                ? canPrompt(platform)
                  ? "Disponível para instalar"
                  : "Abrir instruções de instalação"
                : pwa.readiness === "error"
                  ? "Não foi possível verificar agora"
                  : "Consulte a compatibilidade do navegador";
          return (
            <article
              key={platform}
              className={
                "hvm-pwa-card" + (recommended ? " is-recommended" : "")
              }
            >
              <header>
                <span className="hvm-pwa-platform-icon">
                  <Icon size={25} aria-hidden="true" />
                </span>
                <div>
                  <small>
                    {recommended
                      ? "Para o seu dispositivo"
                      : "Aplicativo web instalável"}
                  </small>
                  <h3>
                    HortiVitalMix para {android ? "Android" : "iPhone e iPad"}
                  </h3>
                </div>
              </header>
              <p>
                {android
                  ? "Instale o HortiVitalMix no seu celular e receba melhorias automaticamente."
                  : "Tenha o HortiVitalMix na tela inicial do seu dispositivo Apple, com atualizações do sistema web."}
              </p>
              <ul>
                <li>
                  <Check size={15} aria-hidden="true" /> Gratuito ·{" "}
                  {android ? "sem Google Play" : "sem App Store"}
                </li>
                <li>
                  <Check size={15} aria-hidden="true" /> Ícone na tela inicial
                </li>
                <li>
                  <Check size={15} aria-hidden="true" />{" "}
                  {android
                    ? "Atualizações automáticas quando disponíveis"
                    : "Atualizações web automáticas"}
                </li>
              </ul>
              <span className="hvm-pwa-install-status">{status}</span>
              <button
                type="button"
                className="hvm-pwa-primary"
                disabled={pwa.installState === "prompting"}
                onClick={() => void install(platform)}
              >
                <Download size={17} aria-hidden="true" />
                Instalar para {android ? "Android" : "iPhone e iPad"}
              </button>
            </article>
          );
        })}
      </div>
      {pwa.installState === "confirmed" && (
        <p className="hvm-pwa-feedback" role="status">
          Instalação confirmada pelo navegador. Abra o HortiVitalMix pelo ícone
          da tela inicial.
        </p>
      )}
      {feedback && (
        <p className="hvm-pwa-feedback" role="status">
          {feedback}
        </p>
      )}
      <dialog
        ref={dialog}
        className={"hvm-pwa-guide" + (guide === "ios" ? " is-ios" : "")}
        aria-labelledby={titleId}
        onCancel={() => setGuide(null)}
        onClose={() => setGuide(null)}
      >
        <header>
          <div>
            <span className="hvm-pwa-eyebrow">Na sua tela inicial</span>
            <h2 id={titleId}>
              {guide === "ios"
                ? "Instalar no iPhone e iPad"
                : "Instalar para Android"}
            </h2>
          </div>
          <button
            type="button"
            className="hvm-pwa-close"
            aria-label="Fechar instruções"
            onClick={() => setGuide(null)}
            autoFocus
          >
            <X size={21} />
          </button>
        </header>
        {guide !== "ios" && (
          <p>
            Uma instalação gratuita do mesmo HortiVitalMix que você já utiliza.
            A confirmação acontece no próprio navegador.
          </p>
        )}
        {guide !== "ios" && pwa.device.internalBrowser && (
          <p className="hvm-pwa-guidance">
            Você está em um navegador interno de aplicativo. Abra o menu e
            escolha abrir em Chrome ou outro navegador compatível. Se essa opção
            não existir, copie o endereço abaixo.
          </p>
        )}
        {guide !== "ios" &&
          !["android", "ios"].includes(pwa.device.platform) && (
            <p className="hvm-pwa-guidance">
              Abra este endereço no seu celular ou tablet para instalar. As duas
              opções continuam disponíveis aqui.
            </p>
          )}
        {pwa.readiness !== "ready" && (
          <p className="hvm-pwa-guidance">
            {pwa.readiness === "checking"
              ? "Verificando o manifesto e os arquivos necessários."
              : pwa.reason ||
                "Abra a versão publicada em um navegador compatível para verificar a instalação."}
            <button type="button" onClick={() => void pwa.checkUpdates()}>
              Verificar novamente
            </button>
          </p>
        )}
        {guide === "ios" ? (
          <IosInstallGuide
            device={pwa.device}
            address={address}
            copied={copied}
            copyError={copyError}
            onCopy={() => void copy()}
          />
        ) : (
          <>
            <ol className="hvm-pwa-steps">
              <li>
                <ExternalLink aria-hidden="true" />
                <div>
                  <strong>Abra em um navegador compatível</strong>
                  <p>
                    Prefira Chrome, Edge ou Samsung Internet no Android, fora do
                    navegador interno de outros aplicativos.
                  </p>
                </div>
              </li>
              <li>
                <Download aria-hidden="true" />
                <div>
                  <strong>Inicie a instalação</strong>
                  <p>
                    {pwa.promptAvailable
                      ? "Use o botão abaixo para abrir a confirmação do navegador."
                      : pwa.device.browser === "firefox"
                        ? "No menu do Firefox, escolha Instalar. Se essa opção não aparecer, abra no Chrome."
                        : pwa.device.browser === "samsung"
                          ? "No menu do Samsung Internet, escolha Adicionar página a → Tela inicial, ou o ícone de instalação quando disponível."
                          : "No menu do navegador, escolha Instalar aplicativo ou Adicionar à tela inicial. A opção varia conforme o navegador."}
                  </p>
                </div>
              </li>
              <li>
                <CheckCircle2 aria-hidden="true" />
                <div>
                  <strong>Confirme no navegador</strong>
                  <p>
                    Confirme a instalação do HortiVitalMix e abra pelo ícone na
                    tela inicial. Se for criado apenas um atalho, tente instalar
                    pelo Chrome.
                  </p>
                </div>
              </li>
            </ol>
            <PwaInstallAddress
              address={address}
              copied={copied}
              copyError={copyError}
              onCopy={() => void copy()}
            />
            <p className="hvm-pwa-limit">
              A confirmação de instalação é fornecida pelo navegador.
            </p>
            <footer>
              {guide === "android" && canPrompt("android") && (
                <button
                  type="button"
                  className="hvm-pwa-primary"
                  onClick={() => {
                    setGuide(null);
                    void install("android");
                  }}
                >
                  Instalar para Android
                </button>
              )}
              <button
                type="button"
                className="hvm-pwa-secondary"
                onClick={() => setGuide(null)}
              >
                Entendi
              </button>
            </footer>
          </>
        )}
      </dialog>
    </div>
  );
}

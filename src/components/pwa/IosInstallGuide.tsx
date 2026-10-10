import {
  CheckCircle2,
  Copy,
  ExternalLink,
  PlusSquare,
  Share,
} from "lucide-react";
import { useId } from "react";
import type { PwaSnapshot } from "../../lib/pwaManager";

type InstallAddressProps = {
  address: string;
  copied: boolean;
  copyError: string;
  onCopy: () => void;
};

export function PwaInstallAddress({
  address,
  copied,
  copyError,
  onCopy,
}: InstallAddressProps) {
  const id = useId();
  return (
    <div className="hvm-pwa-address">
      <label htmlFor={id}>Endereço de instalação</label>
      <input
        id={id}
        readOnly
        value={address}
        onFocus={(event) => event.currentTarget.select()}
      />
      <button type="button" onClick={onCopy} aria-live="polite">
        <Copy size={16} aria-hidden="true" />
        {copied ? "Endereço copiado" : "Copiar endereço"}
      </button>
      {copyError && <p role="alert">{copyError}</p>}
    </div>
  );
}

function IosInstallSteps({ safari }: { safari: boolean }) {
  return (
    <ol
      className="hvm-pwa-ios-steps"
      aria-label="Passos de instalação no navegador"
    >
      <li>
        <span className="hvm-pwa-step-number" aria-hidden="true">
          1
        </span>
        <Share aria-hidden="true" />
        <div>
          <strong>Compartilhar</strong>
          <p>
            {safari
              ? "Na barra ou no menu do Safari."
              : "No menu do seu navegador."}
          </p>
        </div>
      </li>
      <li>
        <span className="hvm-pwa-step-number" aria-hidden="true">
          2
        </span>
        <PlusSquare aria-hidden="true" />
        <div>
          <strong>Adicionar à Tela de Início</strong>
          <p>Role a lista se precisar.</p>
        </div>
      </li>
      <li>
        <span className="hvm-pwa-step-number" aria-hidden="true">
          3
        </span>
        <CheckCircle2 aria-hidden="true" />
        <div>
          <strong>Adicionar</strong>
          <p>Mantenha “Abrir como App da Web” ativado, se aparecer.</p>
        </div>
      </li>
    </ol>
  );
}

function IosOpenInstallation(props: InstallAddressProps) {
  const target = new URL(props.address);
  // Only a presentation hint; no session, identity or permission in this link.
  target.hash = "passos";
  return (
    <div className="hvm-pwa-ios-open">
      <a
        className="hvm-pwa-primary"
        href={target.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        <ExternalLink size={18} aria-hidden="true" />
        Abrir instalação
      </a>
      <p>
        Toque em Abrir instalação para abrir uma nova aba. Depois, siga a ajuda
        para adicionar o HortiVitalMix à tela inicial.
      </p>
      <details className="hvm-pwa-ios-help">
        <summary>Se o endereço não abrir</summary>
        <p>
          Em um navegador interno, use o menu do aplicativo para abrir no Safari
          ou no navegador externo. Você também pode copiar o endereço abaixo.
        </p>
        <PwaInstallAddress {...props} />
      </details>
    </div>
  );
}

/** Browser controls remain outside the page; sharing a URL is not installation. */
export function IosInstallGuide({
  device,
  ...addressProps
}: InstallAddressProps & { device: PwaSnapshot["device"] }) {
  const ios = device.platform === "ios";
  const currentBrowser =
    ios &&
    !device.internalBrowser &&
    ["safari", "chrome", "edge", "firefox"].includes(device.browser);
  const safari = currentBrowser && device.browser === "safari";
  const openedSteps = window.location.hash === "#passos";

  if (!currentBrowser && (!openedSteps || device.internalBrowser)) {
    return (
      <div className="hvm-pwa-ios-handoff">
        <p className="hvm-pwa-guidance">
          <ExternalLink size={20} aria-hidden="true" />
          {device.internalBrowser
            ? "Você está em um navegador interno de aplicativo. Toque em Abrir instalação. Se continuar neste aplicativo, use o menu para abrir no Safari ou no navegador externo."
            : ios
              ? "Abra a instalação no seu iPhone ou iPad e siga os passos do navegador."
              : "Esta instalação é para iPhone e iPad. Use o endereço nesse dispositivo."}
        </p>
        <IosOpenInstallation {...addressProps} />
        <details className="hvm-pwa-ios-help">
          <summary>Veja os passos no iPhone ou iPad</summary>
          <IosInstallSteps safari />
          <p>Depois, abra pelo ícone do HortiVitalMix na tela inicial.</p>
        </details>
      </div>
    );
  }

  return (
    <div className="hvm-pwa-ios-install">
      <p className="hvm-pwa-ios-intro">
        {ios
          ? "Você faz isso uma vez, no próprio navegador:"
          : "No seu iPhone ou iPad, siga estes passos:"}
      </p>
      <IosInstallSteps safari={safari} />
      <p className="hvm-pwa-ios-finish">
        Depois, abra pelo ícone do HortiVitalMix na tela inicial.
      </p>
      <details className="hvm-pwa-ios-help">
        <summary>Não encontrou a opção?</summary>
        <p>
          No iPad, toque em “Ver Mais”, se aparecer. Role as ações do
          compartilhamento até “Adicionar à Tela de Início”.
        </p>
        <p>
          No Safari, se a opção estiver oculta, use “Editar Ações” para
          adicioná-la. O compartilhamento pode estar na barra ou no menu do
          Safari.
        </p>
        {!safari && (
          <>
            <p>
              Se seu navegador não oferecer essa opção, abra a instalação e
              procure Compartilhar no menu. Se necessário, use o Safari.
            </p>
            <IosOpenInstallation {...addressProps} />
          </>
        )}
      </details>
    </div>
  );
}

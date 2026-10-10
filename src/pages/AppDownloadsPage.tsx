import { ArrowLeft, Cloud, ShieldCheck, Smartphone } from "lucide-react";
import type { PwaPlatform } from "../../shared/contracts/pwa";
import { PwaInstallCards } from "../components/pwa/PwaInstallCards";
import { PwaVersionPanel } from "../components/pwa/PwaVersionPanel";
import "./appDownloads.css";

export default function AppDownloadsPage({
  onNavigate,
  initialPlatform,
}: {
  onNavigate: (path: string) => void;
  initialPlatform?: PwaPlatform;
}) {
  return (
    <section
      className="app-downloads-page"
      aria-labelledby="app-downloads-title"
    >
      <a
        href="/"
        className="app-downloads-back"
        onClick={(event) => {
          event.preventDefault();
          onNavigate("/");
        }}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Voltar para o site
      </a>
      <header className="app-downloads-header">
        <span className="app-downloads-mark">
          <Smartphone size={29} aria-hidden="true" />
        </span>
        <span className="app-downloads-eyebrow">HortiVitalMix com você</span>
        <h1 id="app-downloads-title">Aplicativos e atualizações</h1>
        <p>
          Instale o HortiVitalMix no seu dispositivo e receba automaticamente as
          melhorias da plataforma.
        </p>
      </header>
      <PwaInstallCards initialPlatform={initialPlatform} />
      <div className="app-downloads-benefits">
        <article>
          <Cloud size={22} aria-hidden="true" />
          <h2>Um único HortiVitalMix</h2>
          <p>
            A mesma conta, os mesmos cadastros e o mesmo sistema, no celular e
            no navegador.
          </p>
        </article>
        <article>
          <ShieldCheck size={22} aria-hidden="true" />
          <h2>Seu trabalho protegido</h2>
          <p>
            As atualizações aguardam formulários, operações importantes e a
            sincronização das ações offline.
          </p>
        </article>
      </div>
      <PwaVersionPanel />
      <section className="app-downloads-note">
        <h2>Atualizações automáticas</h2>
        <p>
          O HortiVitalMix utiliza tecnologia de aplicativo web instalável.
          Quando publicamos melhorias, seu aplicativo verifica a disponibilidade
          da nova versão e atualiza os recursos automaticamente quando estiver
          conectado e for seguro fazê-lo.
        </p>
        <p>
          Se você estiver preenchendo um formulário ou realizando uma operação
          importante, a atualização aguardará o momento adequado. Não será
          necessário reinstalar o aplicativo após cada melhoria.
        </p>
        <p>
          As atualizações continuam sujeitas à conexão e às regras de execução
          do navegador e do sistema operacional. O aplicativo verifica novamente
          ao abrir, retornar ao primeiro plano e recuperar a conexão.
        </p>
      </section>
      <section className="app-downloads-compatibility">
        <h2>Compatibilidade e ajuda</h2>
        <details>
          <summary>Android: Chrome, Edge e Samsung Internet</summary>
          <p>
            O botão abre a confirmação do navegador quando a instalação
            programática estiver disponível. Caso contrário, o assistente mostra
            a opção de instalação do menu. A instalação sempre depende da sua
            confirmação.
          </p>
        </details>
        <details>
          <summary>iPhone e iPad: Safari</summary>
          <p>
            Toque em Compartilhar na barra ou no menu do Safari, escolha
            Adicionar à Tela de Início e confirme Adicionar. Mantenha Abrir como
            App da Web ativado, se aparecer. Você faz isso uma vez; depois, abra
            pelo ícone na tela inicial. Se a opção estiver oculta, consulte a
            ajuda do botão de instalação.
          </p>
        </details>
        <details>
          <summary>WhatsApp, Instagram e outros navegadores internos</summary>
          <p>
            Escolha abrir no navegador externo. No iPhone/iPad, prefira Safari;
            no Android, Chrome ou outro navegador compatível. O assistente
            permite copiar o endereço de instalação.
          </p>
        </details>
        <details>
          <summary>Computador ou dispositivo não identificado</summary>
          <p>
            As duas opções ficam acessíveis. Abra as instruções e copie o
            endereço para o celular. Windows, macOS e Linux também podem
            oferecer instalação do aplicativo web pelo próprio navegador.
          </p>
        </details>
        <details>
          <summary>Uso sem internet</summary>
          <p>
            A estrutura do aplicativo fica disponível após a preparação do
            cache. As funções offline já existentes do produtor preservam ações
            salvas e sincronizam ao reconectar. Login, consultas atualizadas e
            outras funções podem precisar de conexão.
          </p>
        </details>
      </section>
    </section>
  );
}

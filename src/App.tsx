import { useEffect, useRef, useState } from "react";
import {
  Leaf,
  MapPin,
  Bell,
  UserRound,
  ShoppingCart,
  Search,
  House,
  Store,
  Package,
  CalendarDays,
  ChevronRight,
  ChevronDown,
  Check,
  Truck,
  Salad,
  Sprout,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  GlobalConfigPublicSchema,
  type GlobalConfigPublic,
} from "../shared/contracts/foundation";
import { api } from "./lib/api";
import { Account } from "./components/Account";
import { AdminConfiguracaoPage } from "./pages/admin/config/AdminConfiguracaoPage";
import { ChoosePortalPage } from "./pages/auth/ChoosePortalPage";
import { useSession } from "./hooks/useSession";
const fallback = {
  platformName: "HortiVitalMix",
  slogan: "Tudo fresco. Tudo da sua região.",
  defaultMunicipality: "Ariquemes",
  defaultState: "RO",
  currency: "BRL",
  timezone: "America/Porto_Velho",
  supportEmail: "hortivitalmix@gmail.com",
  supportPhone: null,
  revision: 0,
};
const navigation = [
  ["/", "Início", House],
  ["/produtores", "Produtores", Store],
  ["/produtos", "Produtos", Salad],
  ["/planos", "Planos", CalendarDays],
  ["/sobre", "Sobre nós", Sprout],
] as const;
const categories = [
  "Todos os produtos",
  "Hortaliças folhosas",
  "Legumes picados",
  "Mix prontos",
  "Temperos e ervas",
  "Frutas",
];
const accountPaths = new Set([
  "/conta",
  "/minha-conta",
  "/entrar",
  "/entrar/consumidor",
  "/entrar/produtor",
  "/entrar/administrador",
  "/entrar/super-administrador",
  "/administracao",
  "/admin/entrar",
  "/admin/painel",
  "/cadastro/consumidor",
  "/cadastro/produtor",
  "/acesso/administracao",
  "/acesso/super-administracao",
  "/recuperar-senha",
  "/redefinir-senha",
  "/redefinirsenha",
  "/confirmar-contato",
  "/confirmarcontato",
]);
export default function App() {
  const [config, setConfig] = useState<GlobalConfigPublic | null>(null),
    [path, setPath] = useState(location.pathname),
    [modal, setModal] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState(categories[0]);
  const dialog = useRef<HTMLDialogElement>(null);
  const {
    session: shellSession,
    adoptSession,
    refresh: refreshSession,
  } = useSession();
  const display = config ?? fallback;
  const accountTarget = shellSession ? "/minha-conta" : "/conta";
  const publicPortalSession =
    Boolean(shellSession) &&
    (shellSession?.portalKind === "public" ||
      shellSession?.activeRole === "consumer" ||
      shellSession?.activeRole === "producer");
  const showAdministrationEntry = !publicPortalSession;
  const adminTarget =
    shellSession &&
    (shellSession.activeRole === "platform_admin" ||
      shellSession.activeRole === "platform_super_admin")
      ? "/admin/painel"
      : "/administracao";
  useEffect(() => {
    const abort = new AbortController();
    api<unknown>("/v1/config", { signal: abort.signal })
      .then((v) => setConfig(GlobalConfigPublicSchema.parse(v)))
      .catch(() => {});
    return () => abort.abort();
  }, []);
  useEffect(() => {
    const fn = () => setPath(location.pathname);
    addEventListener("popstate", fn);
    return () => removeEventListener("popstate", fn);
  }, []);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);
  function go(to: string) {
    const next = new URL(to, location.origin);
    history.pushState({}, "", next.pathname + next.search + next.hash);
    setPath(next.pathname);
    window.scrollTo(0, 0);
  }
  const logo = (
    <a
      className="brand"
      href="/"
      onClick={(e) => {
        e.preventDefault();
        go("/");
      }}
    >
      <span className="brand-icon">
        <Leaf />
      </span>
      <span>
        <strong>
          {display.platformName === "HortiVitalMix" ? (
            <>
              Horti<span>Vital</span>Mix
            </>
          ) : (
            display.platformName
          )}
        </strong>
        <small>{display.slogan}</small>
      </span>
    </a>
  );
  const search = (
    <form
      className="search"
      onSubmit={(e) => {
        e.preventDefault();
        go("/produtos");
      }}
    >
      <Search size={19} />
      <input
        aria-label="Buscar produtos"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="O que você está procurando?"
      />
      <button type="submit">Buscar</button>
    </form>
  );
  return (
    <>
      <a className="skip" href="#conteudo">
        Ir para conteúdo
      </a>
      <header className="desktop-header">
        <div className="header-inner">
          {logo}
          <nav aria-label="Navegação principal">
            {navigation.map(([to, label]) => (
              <a
                href={to}
                key={to}
                aria-current={path === to ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  go(to);
                }}
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <button
              className="location-pill"
              onClick={() => setModal("Localização")}
            >
              <MapPin size={16} />
              <span>Selecionar localização</span>
            </button>
            <button
              className="icon"
              aria-label="Notificações"
              onClick={() => setModal("Notificações")}
            >
              <Bell />
            </button>
            {showAdministrationEntry && (
              <button
                className="icon admin-home-entry"
                aria-label="Administração"
                title="Administração"
                onClick={() => go(adminTarget)}
              >
                <ShieldCheck />
              </button>
            )}
            <button
              className="icon"
              aria-label="Conta"
              title="Conta"
              onClick={() => go("/conta")}
            >
              <UserRound />
            </button>
            <button
              className="icon"
              aria-label="Carrinho"
              onClick={() => setModal("Carrinho")}
            >
              <ShoppingCart />
            </button>
          </div>
        </div>
      </header>
      <header className="mobile-header">
        <div className="mobile-top">
          {logo}
          <div className="header-actions">
            <button
              className="icon"
              aria-label="Notificações"
              onClick={() => setModal("Notificações")}
            >
              <Bell />
            </button>
            {showAdministrationEntry && (
              <button
                className="icon admin-home-entry"
                aria-label="Administração"
                title="Administração"
                onClick={() => go(adminTarget)}
              >
                <ShieldCheck />
              </button>
            )}
            <button
              className="icon"
              aria-label="Carrinho"
              onClick={() => setModal("Carrinho")}
            >
              <ShoppingCart />
            </button>
          </div>
        </div>
        {search}
      </header>
      <main id="conteudo" className="layout">
        {path === "/admin/configuracao" ? (
          <AdminConfiguracaoPage onNavigate={go} />
        ) : path === "/cadastro" ? (
          <ChoosePortalPage onNavigate={go} />
        ) : accountPaths.has(path) ? (
          <Account
            path={path}
            onNavigate={go}
            session={shellSession}
            onSessionAdopt={adoptSession}
            onSessionRefresh={refreshSession}
          />
        ) : (
          <>
            <aside>
              <div className="card delivery">
                <MapPin />
                <div>
                  <small>Entrega para</small>
                  <strong>Selecionar localização</strong>
                  <button
                    className="text-button"
                    onClick={() => setModal("Localização")}
                  >
                    Alterar localização
                  </button>
                </div>
                <ChevronDown size={15} />
              </div>
              <section className="card categories">
                <h2>Categorias</h2>
                <nav aria-label="Categorias de produtos">
                  {categories.map((c, i) => (
                    <button
                      key={c}
                      aria-pressed={category === c}
                      onClick={() => {
                        setCategory(c);
                        go("/produtos");
                      }}
                    >
                      <span className="category-icon">
                        {i === 0 ? <Package size={18} /> : <Leaf size={18} />}
                      </span>
                      <span>{c}</span>
                      <ChevronRight className="chevron" size={14} />
                    </button>
                  ))}
                </nav>
              </section>
              <section className="producer-invite">
                <Sprout />
                <h3>Você produz por aqui?</h3>
                <p>Traga o frescor da sua produção para mais famílias.</p>
                <button
                  className="text-button"
                  onClick={() => go("/cadastro/produtor")}
                >
                  Faça parte <ChevronRight size={15} />
                </button>
              </section>
            </aside>
            <div className="main-content">
              {path === "/" && (
                <section className="hero">
                  <div className="hero-copy">
                    <span className="eyebrow">
                      Da nossa região para sua mesa
                    </span>
                    <h1>
                      Conectamos produtores da nossa região com você e sua
                      família!
                    </h1>
                    <div className="benefits">
                      {[
                        [Leaf, "Produtos frescos"],
                        [Store, "Direto do produtor"],
                        [Check, "Já higienizados e picados"],
                        [Salad, "Prontos para o preparo"],
                        [Truck, "Mais praticidade"],
                      ].map(([Icon, label]) => {
                        const I = Icon as typeof Leaf;
                        return (
                          <span key={String(label)}>
                            <I size={17} />
                            {String(label)}
                          </span>
                        );
                      })}
                    </div>
                    <div className="hero-search">{search}</div>
                  </div>
                  <div className="hero-art" aria-hidden="true">
                    <Leaf size={86} />
                    <div className="art-caption">
                      <Sprout size={18} />
                      Tudo da sua região.
                    </div>
                  </div>
                </section>
              )}
              {path === "/sobre" ? (
                <section className="card about">
                  <span className="eyebrow">Nossa essência</span>
                  <h1>Mais perto de quem produz.</h1>
                  <p>
                    O HortiVitalMix conecta produtores locais e consumidores com
                    praticidade e frescor. Nossa região é o ponto de partida
                    para valorizar os alimentos e as pessoas que os cultivam.
                  </p>
                  <p>{display.slogan}</p>
                  <a href={"mailto:" + display.supportEmail}>
                    Fale com a gente
                  </a>
                </section>
              ) : (
                <section className="catalog">
                  <div className="section-heading">
                    <div>
                      <h2>
                        {path === "/planos"
                          ? "Planos"
                          : path === "/produtos"
                            ? category
                            : "Produtores próximos de você"}
                      </h2>
                      <p>
                        {path === "/" || path === "/produtores"
                          ? "Compre direto de quem planta com carinho na sua cidade"
                          : "Frescor e praticidade para o seu dia."}
                      </p>
                    </div>
                    {path === "/" && (
                      <button
                        className="text-button"
                        onClick={() => go("/produtores")}
                      >
                        Ver todos <ChevronRight size={16} />
                      </button>
                    )}
                  </div>
                  <div className="empty">
                    <span className="empty-icon">
                      {path === "/planos" ? (
                        <CalendarDays />
                      ) : path === "/produtos" ? (
                        <Salad />
                      ) : (
                        <Store />
                      )}
                    </span>
                    <h3>
                      {path === "/planos"
                        ? "Os planos ainda não estão disponíveis"
                        : path === "/produtos"
                          ? "O catálogo ainda não está disponível"
                          : "A consulta de produtores ainda não está disponível"}
                    </h3>
                    <p>
                      {query && path === "/produtos"
                        ? `Não foi possível consultar “${query}” agora.`
                        : "Estamos preparando este espaço para conectar você à nossa região."}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => go("/cadastro")}
                    >
                      Conheça as opções de cadastro <ChevronRight size={15} />
                    </button>
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </main>
      <footer>
        <strong>{display.platformName}</strong>
        <span>Conectando produtores e consumidores.</span>
        <span>{display.slogan}</span>
      </footer>
      <nav className="bottom-nav" aria-label="Navegação mobile">
        {[
          ...navigation.slice(0, 4),
          [accountTarget, "Conta", UserRound] as const,
        ].map(([to, label, Icon]) => (
          <a
            href={to}
            key={to}
            aria-current={path === to ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              go(to);
            }}
          >
            <Icon size={20} />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      <dialog
        ref={dialog}
        onCancel={() => setModal(null)}
        onClose={() => setModal(null)}
      >
        <div className="dialog-title">
          <h2>{modal}</h2>
          <button
            className="icon"
            aria-label="Fechar"
            onClick={() => setModal(null)}
          >
            <X />
          </button>
        </div>
        <p>
          {modal === "Localização"
            ? `Nossa região de referência é ${display.defaultMunicipality} – ${display.defaultState}. A seleção de endereço ainda não está disponível.`
            : modal === "Carrinho"
              ? "As compras ainda não estão disponíveis."
              : "A consulta de notificações ainda não está disponível."}
        </p>
        <button className="primary" onClick={() => setModal(null)}>
          Entendi
        </button>
      </dialog>
    </>
  );
}

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  Leaf,
  MapPin,
  UserRound,
  ShoppingCart,
  Search,
  House,
  Store,
  Package,
  CalendarDays,
  ChevronRight,
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
import { localityBlockedMessage } from "../shared/contracts/locality";
import { api } from "./lib/api";
import { useLocality } from "./hooks/useLocality";
import { Account } from "./components/Account";
import { AccountHub } from "./pages/account/AccountHub";
import { AdminRouter } from "./pages/admin/AdminRouter";
import { ChoosePortalPage } from "./pages/auth/ChoosePortalPage";
import { ContactConfirmationPage } from "./pages/auth/ContactConfirmationPage";
import { RecoverPasswordPage } from "./pages/auth/RecoverPasswordPage";
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage";
import { useSession } from "./hooks/useSession";
import { PublicLoginPage } from "./pages/auth/PublicLoginPage";
import { AccountStatusIcon, accountSessionLabel } from "./components/AccountStatusIcon";
import { ProducerPropertiesPage } from "./pages/producer/ProducerPropertiesPage";
import { DeliveryScopePage } from "./pages/producer/DeliveryScopePage";
import { DocumentsPanel } from "./pages/documents/DocumentsPanel";
import { ProducerTrialBanner } from "./pages/producer/ProducerTrialBanner";
import { CategoryNavSection } from "./components/catalog/CategoryNavSection";
import type { Category } from "../shared/contracts/category";
import { PublicProductCatalog } from "./components/catalog/PublicProductCatalog";
import { ConsumerAccessNotice } from "./components/ConsumerAccessNotice";
import { NotificationProvider, NotificationBell } from "./components/notifications/NotificationProvider";
import { LocationSelector } from "./components/LocationSelector";
const ProducerCatalogPage = lazy(() => import("./pages/producer/ProducerCatalogPage"));
const InventoryLotsPage = lazy(() => import("./pages/producer/InventoryLotsPage"));
const ProducerDeliveryAreaPage = lazy(() => import("./pages/producer/ProducerDeliveryAreaPage"));
const ProductEditorPage = lazy(() => import("./pages/producer/ProductEditorPage"));
const ProducerStoreSettingsPage = lazy(() => import("./pages/producer/ProducerStoreSettingsPage"));
const PublicProducerStorePage = lazy(() => import("./pages/public/PublicProducerStorePage"));
const RegionalHighlights = lazy(() => import("./components/catalog/RegionalHighlights"));
const HomeDiscoveryPage = lazy(() => import("./pages/public/HomeDiscoveryPage"));
const CartPage = lazy(() => import("./pages/public/CartPage"));
const CheckoutReviewPage = lazy(() => import("./pages/public/CheckoutReviewPage"));
const PaymentPreparedPage = lazy(() => import("./pages/commerce/PaymentPreparedPage"));
const SubscriptionPlansPage = lazy(() => import("./pages/public/SubscriptionPlansPage"));
const ProducerPosPage = lazy(() => import("./pages/commerce/ProducerPosPage"));
const PurchasesPage = lazy(() => import("./pages/commerce/PurchasesPage"));
const PosSaleReviewPage = lazy(() => import("./pages/commerce/PosSaleReviewPage"));
const CasesPage = lazy(() => import("./pages/commerce/CasesPage"));
const DeliveryWindowsPage = lazy(() => import("./pages/producer/DeliveryWindowsPage"));
const ProducerOrdersPage = lazy(() => import("./pages/producer/ProducerOrdersPage"));
const NotificationsPage = lazy(() => import("./pages/account/NotificationsPage"));
const ProducerSalesPage = lazy(() => import("./pages/producer/ProducerSalesPage"));
const ProducerRefundsPage = lazy(() => import("./pages/producer/ProducerRefundsPage"));
const OrderTrackingPage = lazy(() => import("./pages/public/OrderTrackingPage"));
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
]);
export default function App() {
  const [config, setConfig] = useState<GlobalConfigPublic | null>(null),
    [path, setPath] = useState(location.pathname),
    [modal, setModal] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("Todos os produtos"),
    [categoryId, setCategoryId] = useState<string | null>(null),
    [deliveryLabel, setDeliveryLabel] = useState<string | null>(null),
    [cartCount, setCartCount] = useState(0);
  const [,setNavigationRevision] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const {
    session: shellSession,
    loading: sessionLoading,
    adoptSession,
    refresh: refreshSession,
  } = useSession();
  useEffect(() => {
    const update = (event: Event) => setCartCount((event as CustomEvent<number>).detail);
    window.addEventListener("hvm:cart-updated",update);
    return () => window.removeEventListener("hvm:cart-updated",update);
  },[]);
  useEffect(() => setCartCount(0),[shellSession?.userId,shellSession?.activeRole]);
  // Item 4: a região da vitrine é escolhida pelo visitante e não depende do
  // login — vale igual para visitante, consumidor, produtor, Administrador e
  // Super administrador.
  const locality = useLocality();
  const display = config ?? fallback;
  const localityBlocked =
    locality.coverage !== null && locality.coverage !== "active";
  const openLocality = () => setModal("Localização");
  const isAdminRoute =
    path.startsWith("/admin/") ||
    path === "/entrar/administrador" ||
    path === "/entrar/super-administrador" ||
    path === "/acesso/administracao" ||
    path === "/acesso/super-administracao";
  const publicLoginRole = path === "/entrar/produtor" ? "producer" : path === "/entrar/consumidor" ? "consumer" : null;
  const guestAccessRoute = path === "/entrar" || path.startsWith("/entrar/") || path === "/cadastro" || path.startsWith("/cadastro/") || path === "/administracao" || path === "/admin/entrar" || path.startsWith("/acesso/");
  const administrativeSession = shellSession?.activeRole === "platform_admin" || shellSession?.activeRole === "platform_super_admin";
  const canShop = !shellSession || shellSession.activeRole === "consumer";
  const shoppingRoute = ["/compras","/pedidos","/checkout","/carrinho"].includes(path) || /^\/pedidos\/[^/]+(?:\/pagamento)?$/.test(path) || /^\/pos\/venda\//.test(path);
  const accountTarget = administrativeSession ? "/admin/conta" : "/conta";
  const paymentId = path.match(/^\/pagamentos\/([^/]+)$/)?.[1] ?? path.match(/^\/pedidos\/([^/]+)\/pagamento$/)?.[1];
  const posCode = path.match(/^\/pos\/venda\/([a-f0-9]{32})$/)?.[1];
  const trackingId = path.match(/^\/pedidos\/([^/]+)$/)?.[1];
  useEffect(() => {
    if (!shellSession || !guestAccessRoute) return;
    const destination = administrativeSession ? "/admin/painel" : "/";
    history.replaceState({}, "", destination);
    setPath(destination);
  }, [shellSession, guestAccessRoute, administrativeSession]);
  const isAccountDataRoute = path === "/conta" || path.startsWith("/conta/");
  const isProducerPropertyRoute =
    path.startsWith("/produtor/documentos") ||
    path === "/produtor/propriedades" ||
    path === "/produtor/propriedades/novo";
  const isProducerScopeRoute = path === "/produtor/entrega";
  const isProducerDeliveryAreaRoute = path === "/produtor/loja/entrega";
  const isProducerStoreRoute = path === "/produtor/loja" || isProducerDeliveryAreaRoute;
  const productEditorId = path.match(/^\/produtor\/produtos\/([^/]+)\/editar$/)?.[1];
  const inventoryProductId = path.match(/^\/produtor\/produtos\/([^/]+)\/lotes$/)?.[1];
  const isProducerProductRoute = path === "/produtor/produtos" || path === "/produtor/produtos/novo" || Boolean(productEditorId) || Boolean(inventoryProductId);
  const publicStoreSlug = path.match(/^\/produtores\/([^/]+)\/?$/)?.[1];
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
  useEffect(() => {
    let cancelled = false;
    async function refreshDefaultAddress() {
      if (!publicPortalSession) {
        if (!cancelled) setDeliveryLabel(null);
        return;
      }
      try {
        const result = await api<{
          addresses: Array<{
            isDefault: boolean;
            neighborhood: string;
            city: string;
            state: string;
          }>;
        }>("/v1/account/addresses");
        const current = result.addresses.find((address) => address.isDefault);
        if (!cancelled)
          setDeliveryLabel(
            current
              ? current.neighborhood + " · " + current.city + "/" + current.state
              : null,
          );
      } catch {
        if (!cancelled) setDeliveryLabel(null);
      }
    }
    void refreshDefaultAddress();
    const sync = () => void refreshDefaultAddress();
    window.addEventListener("hortivitalmix:default-address-changed", sync);
    return () => {
      cancelled = true;
      window.removeEventListener("hortivitalmix:default-address-changed", sync);
    };
  }, [publicPortalSession, shellSession?.userId]);
  const go = useCallback((to: string) => {
    const next = new URL(to, location.origin);
    history.pushState({}, "", next.pathname + next.search + next.hash);
    setPath(next.pathname);
    setNavigationRevision(n=>n+1);
    window.scrollTo(0, 0);
  }, []);
  const refreshCategorySelection = useCallback((selected: Category | null) => {
    setCategoryId(selected?.id ?? null);
    setCategory(selected?.name ?? "Todos os produtos");
  }, []);
  const selectCategory = useCallback((selected: Category | null) => {
    refreshCategorySelection(selected);
    go("/produtos");
  }, [go, refreshCategorySelection]);
  const logo = (
    <a
      className="brand"
      href={administrativeSession ? "/admin/painel" : "/"}
      onClick={(e) => {
        e.preventDefault();
        go(administrativeSession ? "/admin/painel" : "/");
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
    <NotificationProvider session={shellSession}>
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
            <LocationSelector
              region={locality.label}
              expanded={modal === "Localização"}
              onOpen={openLocality}
            />
            <NotificationBell onClick={() => go(administrativeSession ? "/admin/notificacoes" : "/notificacoes")}/>
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
              aria-description={accountSessionLabel(shellSession)}
              title={accountSessionLabel(shellSession)}
              onClick={() => go(accountTarget)}
            >
              <AccountStatusIcon session={shellSession}/>
            </button>
            {canShop&&<button
              className="icon"
              aria-label="Carrinho"
              onClick={() => go("/carrinho")}
            >
              <ShoppingCart />
              {cartCount>0&&<span className="hvm-cart-count" aria-hidden="true">{cartCount}</span>}
            </button>}
          </div>
        </div>
      </header>
      <header className="mobile-header">
        <div className="mobile-top">
          {logo}
          <div className="header-actions">
            <NotificationBell onClick={() => go(administrativeSession ? "/admin/notificacoes" : "/notificacoes")}/>
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
            {canShop&&<button
              className="icon"
              aria-label="Carrinho"
              onClick={() => go("/carrinho")}
            >
              <ShoppingCart />
              {cartCount>0&&<span className="hvm-cart-count" aria-hidden="true">{cartCount}</span>}
            </button>}
          </div>
        </div>
        {path !== "/" && !isProducerPropertyRoute && !isProducerStoreRoute && !isProducerProductRoute && search}
        <LocationSelector
          region={locality.label}
          expanded={modal === "Localização"}
          onOpen={openLocality}
        />
      </header>
      <main id="conteudo" className={isAdminRoute || publicLoginRole ? "layout admin-route-layout" : isProducerPropertyRoute ? "layout producer-route-layout rural-property-layout" : isProducerScopeRoute || isProducerStoreRoute || isProducerProductRoute || path === "/carrinho" || path === "/checkout" ? "layout producer-route-layout" : "layout"}>
        {shellSession?.localityWarning && !isAdminRoute && (
          <p className="account-notice locality-blocked" role="alert">
            {shellSession.localityWarning}
          </p>
        )}
        {shellSession?.activeRole === "producer" && (path.startsWith("/produtor/") || path === "/conta") && <ProducerTrialBanner key={shellSession.userId} userId={shellSession.userId} onNavigate={go}/>}
        {(sessionLoading && (guestAccessRoute || isAccountDataRoute || isProducerPropertyRoute || isProducerStoreRoute || isProducerProductRoute || path === "/minha-conta")) || (shellSession && guestAccessRoute) ? <p role="status" className="account-notice">Carregando sua conta…</p> : publicLoginRole ? (
          <PublicLoginPage key={publicLoginRole} role={publicLoginRole} onNavigate={go} onSessionAdopt={adoptSession}/>
        ) : isAdminRoute ? (
          <AdminRouter path={path} onNavigate={go} onSessionRefresh={refreshSession} />
        ) : path === "/confirmar-contato" || path === "/confirmarcontato" ? (
          <ContactConfirmationPage
            session={shellSession}
            onNavigate={go}
            onSessionAdopt={adoptSession}
            onSessionRefresh={refreshSession}
          />
        ) : path === "/recuperar-senha" ? (
          <RecoverPasswordPage onNavigate={go} />
        ) : path === "/redefinir-senha" || path === "/redefinirsenha" ? (
          <ResetPasswordPage
            session={shellSession}
            onNavigate={go}
            onSessionAdopt={adoptSession}
            onSessionRefresh={refreshSession}
          />
        ) : path === "/cadastro" ? (
          <ChoosePortalPage onNavigate={go} />
        ) : ["/assinaturas","/planos","/assinaturas/minhas","/produtor/assinaturas"].includes(path) ? (
          <Suspense fallback={<p role="status">Carregando assinaturas…</p>}>{sessionLoading ? <p role="status">Conferindo sua conta…</p> : <SubscriptionPlansPage key={(shellSession?.userId??"guest")+":"+path} audience={path.startsWith("/produtor/") || (path === "/assinaturas/minhas" && shellSession?.activeRole === "producer") ? "producer":"consumer"} session={publicPortalSession?shellSession:null} onlyMine={path === "/assinaturas/minhas"} onNavigate={go}/>}</Suspense>
        ) : path === "/notificacoes" ? (
          <Suspense fallback={<p role="status">Carregando notificações…</p>}><NotificationsPage onNavigate={go}/></Suspense>
        ) : shoppingRoute && shellSession && shellSession.activeRole !== "consumer" ? (
          <ConsumerAccessNotice session={shellSession} onNavigate={go}/>
        ) : ["/produtor/vendas","/vendas"].includes(path) ? (
          <Suspense fallback={<p role="status">Carregando vendas…</p>}>{sessionLoading?<p role="status">Conferindo sua conta…</p>:shellSession?.activeRole==="producer"?<ProducerSalesPage key={shellSession.userId+location.search} userId={shellSession.userId} onNavigate={go}/>:<section className="account-notice"><h1>Minhas vendas</h1><p>Entre como produtor para consultar as vendas da sua loja.</p><button className="primary" onClick={()=>go("/entrar/produtor")}>Entrar como produtor</button></section>}</Suspense>
        ) : path === "/produtor/reembolsos" || (path === "/reembolsos" && shellSession?.activeRole === "producer") ? (
          <Suspense fallback={<p role="status">Carregando reembolsos das vendas…</p>}>{sessionLoading?<p role="status">Conferindo sua conta…</p>:shellSession?.activeRole==="producer"?<ProducerRefundsPage key={shellSession.userId+location.search} userId={shellSession.userId} onNavigate={go}/>:<section className="account-notice"><h1>Reembolsos das vendas</h1><p>Entre como produtor para acompanhar os reembolsos da sua loja.</p></section>}</Suspense>
        ) : paymentId ? (
          <Suspense fallback={<p role="status">Carregando pagamento…</p>}>
            {sessionLoading ? <p role="status">Conferindo sua conta…</p> : <PaymentPreparedPage key={shellSession?.userId+":"+paymentId} id={paymentId} userId={publicPortalSession?shellSession?.userId??null:null} onNavigate={go}/>}
          </Suspense>
        ) : posCode ? (
          <Suspense fallback={<p role="status">Carregando revisão presencial…</p>}>
            {sessionLoading ? <p role="status">Conferindo sua conta…</p> : <PosSaleReviewPage key={shellSession?.userId+":"+posCode} code={posCode} userId={publicPortalSession?shellSession?.userId??null:null} onNavigate={go}/>}
          </Suspense>
        ) : path === "/pedidos" || trackingId ? (
          <Suspense fallback={<p role="status">Carregando pedidos…</p>}>
            {sessionLoading ? <p role="status">Conferindo sua conta…</p> : <OrderTrackingPage key={(shellSession?.userId??"guest")+":"+(trackingId??"list")} id={trackingId} userId={publicPortalSession?shellSession?.userId??null:null} onNavigate={go}/>}
          </Suspense>
        ) : path === "/produtor/loja/janelas" ? (
          <Suspense fallback={<p role="status">Carregando janelas…</p>}>{sessionLoading ? <p role="status">Conferindo sua conta…</p> : shellSession?.activeRole === "producer" ? <DeliveryWindowsPage key={shellSession.userId} userId={shellSession.userId} onNavigate={go}/> : <section className="account-notice"><h1>Janelas de entrega</h1><p>Entre como produtor para configurar as janelas da loja.</p><button className="primary" onClick={()=>go("/entrar/produtor")}>Entrar como produtor</button></section>}</Suspense>
        ) : path === "/produtor/pedidos" ? (
          <Suspense fallback={<p role="status">Carregando pedidos da loja…</p>}>
            {sessionLoading ? <p role="status">Conferindo sua conta…</p> : shellSession?.activeRole === "producer" ? <ProducerOrdersPage key={shellSession.userId+location.search} userId={shellSession.userId} onNavigate={go}/> : <section className="account-notice"><h1>Pedidos da minha loja</h1><p>Entre como produtor para gerenciar os pedidos da sua loja.</p><button className="primary" onClick={()=>go("/entrar/produtor")}>Entrar como produtor</button></section>}
          </Suspense>
        ) : path === "/compras" ? (
          <Suspense fallback={<p role="status">Carregando suas compras…</p>}>
            {sessionLoading ? <p role="status">Conferindo sua conta…</p> : <PurchasesPage key={shellSession?.userId??"guest"} userId={publicPortalSession?shellSession?.userId??null:null} onNavigate={go}/>}
          </Suspense>
        ) : path === "/denuncias" || path === "/reembolsos" ? (
          <Suspense fallback={<p role="status">Carregando solicitações…</p>}>
            {sessionLoading ? <p role="status">Conferindo sua conta…</p> : <CasesPage key={(shellSession?.userId??"guest")+path+location.search} kind={path==="/reembolsos"?"refund":"complaint"} session={publicPortalSession?shellSession:null} onNavigate={go}/>}
          </Suspense>
        ) : path === "/produtor/caixa" ? (
          <Suspense fallback={<p role="status">Abrindo seu caixa…</p>}>
            {sessionLoading?<p role="status">Conferindo sua conta…</p>:shellSession?.activeRole==="producer"?<ProducerPosPage key={shellSession.userId} userId={shellSession.userId} onNavigate={go}/>:<section className="account-notice"><p>Entre como produtor para acessar o caixa da sua loja.</p><button className="primary" onClick={()=>go("/entrar/produtor")}>Entrar como produtor</button></section>}
          </Suspense>
        ) : path === "/checkout" ? (
          <Suspense fallback={<p role="status">Preparando a revisão do pedido…</p>}>
            {sessionLoading ? <p role="status">Preparando a revisão do pedido…</p> : <CheckoutReviewPage key={shellSession?.userId ?? "guest"} userId={publicPortalSession ? shellSession?.userId ?? null : null} onNavigate={go}/>}
          </Suspense>
        ) : path === "/carrinho" ? (
          <Suspense fallback={<p role="status">Carregando sua cesta…</p>}>
            {sessionLoading ? <p role="status">Carregando sua cesta…</p> : <CartPage key={shellSession?.userId ?? "guest"} signedIn={!!shellSession} onNavigate={go}/>}
          </Suspense>
        ) : publicStoreSlug ? (
          <Suspense fallback={<p role="status">Carregando a vitrine…</p>}>
            <PublicProducerStorePage key={publicStoreSlug} slug={publicStoreSlug} onNavigate={go} />
          </Suspense>
        ) : isProducerProductRoute && shellSession?.activeRole === "producer" ? (
          <Suspense fallback={<p role="status">Carregando seu catálogo…</p>}>
            {inventoryProductId ? <InventoryLotsPage key={shellSession.userId + ":" + inventoryProductId} id={inventoryProductId} session={shellSession} onNavigate={go}/> : path === "/produtor/produtos" ? <ProducerCatalogPage key={shellSession.userId} session={shellSession} onNavigate={go}/> : <ProductEditorPage key={shellSession.userId + ":" + (productEditorId ?? "novo")} id={productEditorId} session={shellSession} onNavigate={go}/>}
          </Suspense>
        ) : isProducerStoreRoute && shellSession?.activeRole === "producer" ? (
          <Suspense fallback={<p role="status">Carregando sua loja…</p>}>
            {isProducerDeliveryAreaRoute ? <ProducerDeliveryAreaPage key={shellSession.userId} session={shellSession} onNavigate={go} /> : <ProducerStoreSettingsPage key={shellSession.userId} session={shellSession} onNavigate={go} />}
          </Suspense>
        ) : path.startsWith("/produtor/documentos") && shellSession?.activeRole === "producer" ? (
          <DocumentsPanel propertyId={new URLSearchParams(location.search).get("propertyId") ?? ""} initialDocumentId={path.split("/")[3]} onNavigate={go} />
        ) : isProducerPropertyRoute && shellSession?.activeRole === "producer" ? (
          <ProducerPropertiesPage
            key={shellSession.userId + ":" + path}
            path={path}
            session={shellSession}
            onNavigate={go}
          />
        ) : isProducerScopeRoute && shellSession?.activeRole === "producer" ? (
          <DeliveryScopePage session={shellSession} onNavigate={go} />
        ) : isProducerPropertyRoute || isProducerScopeRoute || isProducerStoreRoute || isProducerProductRoute ? (
          <Account
            path="/minha-conta"
            onNavigate={go}
            session={shellSession}
            onSessionAdopt={adoptSession}
            onSessionRefresh={refreshSession}
          />
        ) : isAccountDataRoute && shellSession ? (
          <AccountHub key={shellSession.userId + ":" + shellSession.activeRole} path={path} session={shellSession} onNavigate={go} />
        ) : isAccountDataRoute && path !== "/conta" ? (
          <Account
            path="/minha-conta"
            onNavigate={go}
            session={shellSession}
            onSessionAdopt={adoptSession}
            onSessionRefresh={refreshSession}
          />
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
              {deliveryLabel && <div className="card delivery delivery-summary">
                <MapPin aria-hidden="true" />
                <div>
                  <small>Endereço de entrega</small>
                  <strong>{deliveryLabel}</strong>
                  <span className="delivery-summary-help">
                    Endereço padrão da sua conta.
                  </span>
                </div>
              </div>}
              <CategoryNavSection selectedId={categoryId} onSelect={selectCategory} onSelectionRefresh={refreshCategorySelection} />
              {!shellSession && !sessionLoading && <section className="producer-invite">
                <Sprout />
                <h3>Você produz por aqui?</h3>
                <p>Traga o frescor da sua produção para mais famílias.</p>
                <button
                  className="text-button"
                  onClick={() => go("/cadastro/produtor")}
                >
                  Faça parte <ChevronRight size={15} />
                </button>
              </section>}
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
                  </div>
                  <Suspense fallback={<p role="status">Preparando os destaques…</p>}>
                    <RegionalHighlights key={locality.selected?.municipalityId??"all"} municipalityId={locality.selected?.municipalityId} regionLabel={locality.label} blocked={localityBlocked} onNavigate={go}/>
                  </Suspense>
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
                        {localityBlocked && locality.coverage
                          ? localityBlockedMessage(locality.coverage)
                          : (path === "/" || path === "/produtores") &&
                              locality.label
                            ? `Compre direto de quem planta com carinho em ${locality.label}`
                            : path === "/" || path === "/produtores"
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
                  {path === "/" || path === "/produtores" ? <Suspense fallback={<p role="status">Buscando produtores…</p>}><HomeDiscoveryPage session={shellSession} sessionLoading={sessionLoading} municipalityId={locality.selected?.municipalityId} regionLabel={locality.label} blocked={localityBlocked} onNavigate={go}/></Suspense> : path === "/produtos" && !localityBlocked ? <PublicProductCatalog categoryId={categoryId} search={query} onNavigate={go}/> : <div className="empty">
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
                    {!shellSession && !sessionLoading && <button
                      className="text-button"
                      onClick={() => go("/cadastro")}
                    >
                      Conheça as opções de cadastro <ChevronRight size={15} />
                    </button>}
                  </div>}
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
        <a href="/reembolsos" onClick={event=>{event.preventDefault();go("/reembolsos");}}>Política de reembolso</a>
        <a href="/denuncias" onClick={event=>{event.preventDefault();go("/denuncias");}}>Denúncias e segurança</a>
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
            aria-description={to===accountTarget?accountSessionLabel(shellSession):undefined}
            onClick={(e) => {
              e.preventDefault();
              go(to);
            }}
          >
            {to===accountTarget?<AccountStatusIcon session={shellSession} size={20}/>:<Icon size={20} />}
            <span>{label}</span>
          </a>
        ))}
      </nav>
      <dialog
        ref={dialog}
        id="shell-dialog"
        aria-labelledby="shell-dialog-title"
        aria-describedby={modal === "Localização" ? "locality-picker-description" : undefined}
        onCancel={() => setModal(null)}
        onClose={() => setModal(null)}
      >
        <div className="dialog-title">
          <h2 id="shell-dialog-title">{modal}</h2>
          <button
            className="icon"
            aria-label="Fechar"
            onClick={() => setModal(null)}
          >
            <X />
          </button>
        </div>
        {modal === "Localização" ? (
          <div className="locality-picker">
            <p id="locality-picker-description">
              Escolha o município da sua região. A escolha funciona com ou sem login.
            </p>
            {localityBlocked && locality.coverage ? (
              <p role="alert" className="locality-blocked">
                {localityBlockedMessage(locality.coverage)}
              </p>
            ) : null}
            {locality.unavailable ? (
              <p role="alert" className="locality-blocked">
                Não foi possível carregar as localidades agora. Tente novamente
                em instantes.
              </p>
            ) : locality.municipalities.length === 0 ? (
              <p>
                {locality.loading
                  ? "Carregando localidades…"
                  : "Nenhuma localidade está ativa no momento."}
              </p>
            ) : (
              <ul className="locality-list">
                {locality.municipalities.map((municipality) => {
                  const chosen =
                    locality.selected?.municipalityId === municipality.id;
                  return (
                    <li key={municipality.id}>
                      <button
                        type="button"
                        className={
                          chosen
                            ? "locality-option is-selected"
                            : "locality-option"
                        }
                        aria-pressed={chosen}
                        onClick={() => {
                          locality.select(municipality);
                          setModal(null);
                        }}
                      >
                        <MapPin size={16} />
                        <span>
                          {municipality.name} – {municipality.state}
                        </span>
                        {chosen && <Check size={16} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {locality.selected && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  locality.select(null);
                  setModal(null);
                }}
              >
                Ver todas as regiões
              </button>
            )}
          </div>
        ) : (
          <p>
            {modal === "Carrinho"
              ? "As compras ainda não estão disponíveis."
              : "A consulta de notificações ainda não está disponível."}
          </p>
        )}
        <button className="primary" onClick={() => setModal(null)}>
          Entendi
        </button>
      </dialog>
    </NotificationProvider>
  );
}

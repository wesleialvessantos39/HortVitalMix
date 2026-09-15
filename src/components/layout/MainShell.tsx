import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {Leaf, MapPin, PackageSearch, ShoppingCart, UserRound, UsersRound} from 'lucide-react';
import {NavLink} from 'react-router-dom';
import {
  GlobalConfigPublicSchema,
  type GlobalConfigPublic,
} from '../../../shared/contracts/foundation';

type ConfigStatus = 'loading' | 'ready' | 'error';

type FoundationContextValue = {
  config: GlobalConfigPublic | null;
  status: ConfigStatus;
  reload: () => void;
};

const FoundationContext = createContext<FoundationContextValue | null>(null);

export function useFoundationConfig(): FoundationContextValue {
  const value = useContext(FoundationContext);
  if (!value) throw new Error('useFoundationConfig deve ser usado dentro de MainShell.');
  return value;
}

function Brand({compact = false}: {compact?: boolean}) {
  return (
    <NavLink to="/" className="brand" aria-label="HortiVitalMix - início">
      <span className={compact ? 'brand-icon compact' : 'brand-icon'}>
        <Leaf aria-hidden="true" />
      </span>
      <span className="brand-copy">
        <strong>
          <span>Horti</span>
          <em>Vital</em>
          <span>Mix</span>
        </strong>
        {!compact && <small>Tudo fresco. Tudo da sua região.</small>}
      </span>
    </NavLink>
  );
}

const navigation = [
  ['/', 'Início'],
  ['/produtores', 'Produtores'],
  ['/produtos', 'Produtos'],
  ['/planos', 'Planos'],
  ['/sobre', 'Sobre nós'],
] as const;

function DesktopHeader({location}: {location: string}) {
  return (
    <header className="desktop-header">
      <div className="header-inner">
        <Brand />
        <nav aria-label="Navegação principal">
          {navigation.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          <button className="location-button" type="button">
            <MapPin aria-hidden="true" />
            <span>{location}</span>
          </button>
          <NavLink className="login-button" to="/entrar">
            Entrar
          </NavLink>
          <NavLink className="signup-link" to="/cadastro">
            Cadastre-se
          </NavLink>
        </div>
      </div>
    </header>
  );
}

function MobileHeader() {
  return (
    <header className="mobile-header">
      <div className="mobile-top">
        <Brand compact />
        <NavLink className="icon-button mobile-cart" to="/carrinho" aria-label="Carrinho">
          <ShoppingCart />
        </NavLink>
      </div>
    </header>
  );
}

function BottomNav() {
  const items = [
    ['/', 'Início', Leaf],
    ['/produtores', 'Produtores', UsersRound],
    ['/produtos', 'Produtos', PackageSearch],
    ['/planos', 'Planos', ShoppingCart],
    ['/conta', 'Conta', UserRound],
  ] as const;

  return (
    <nav className="bottom-nav" aria-label="Navegação móvel">
      {items.map(([to, label, Icon]) => (
        <NavLink key={to} to={to} end={to === '/'}>
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function MainShell({children}: {children: ReactNode}) {
  const [config, setConfig] = useState<GlobalConfigPublic | null>(null);
  const [status, setStatus] = useState<ConfigStatus>('loading');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');

    fetch('/api/v1/config', {
      headers: {accept: 'application/json'},
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('CONFIG_UNAVAILABLE');
        return response.json();
      })
      .then((payload) => {
        const parsed = GlobalConfigPublicSchema.safeParse(payload);
        if (!parsed.success) throw new Error('CONFIG_INVALID');
        setConfig(parsed.data);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setConfig(null);
        setStatus('error');
      });

    return () => controller.abort();
  }, [reloadToken]);

  const value = useMemo<FoundationContextValue>(
    () => ({
      config,
      status,
      reload: () => setReloadToken((value) => value + 1),
    }),
    [config, status],
  );

  const location = config
    ? `${config.defaultMunicipality} - ${config.defaultState}`
    : 'Ariquemes - RO';

  return (
    <FoundationContext.Provider value={value}>
      <div className="app-shell">
        <DesktopHeader location={location} />
        <MobileHeader />
        {status === 'error' && (
          <div className="shell-alert" role="alert">
            <span>Configuração do servidor indisponível. A interface está em modo seguro.</span>
            <button type="button" onClick={() => setReloadToken((value) => value + 1)}>
              Tentar novamente
            </button>
          </div>
        )}
        <main className="shell-main">{children}</main>
        <footer className="site-footer">
          <div>
            <Brand />
            <span>HortiVitalMix — Conectando produtores e consumidores.</span>
          </div>
        </footer>
        <BottomNav />
      </div>
    </FoundationContext.Provider>
  );
}

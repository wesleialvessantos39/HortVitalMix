import {type ReactNode} from 'react';
import {BrowserRouter, NavLink, Route, Routes} from 'react-router-dom';
import {Leaf, PackageSearch, ShoppingCart, UserRound, UsersRound} from 'lucide-react';
import {MainShell, useFoundationConfig} from './components/layout/MainShell';

function Home() {
  const {config, status} = useFoundationConfig();
  const slogan = config?.slogan ?? 'Tudo fresco. Tudo da sua região.';

  return (
    <section className="home-page">
      {status === 'loading' && (
        <div className="system-state" role="status">
          Carregando configuração segura do sistema…
        </div>
      )}
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">DO CAMPO PARA A CIDADE</span>
          <h1>Produtos frescos da nossa região, direto para você.</h1>
          <p>
            {slogan} Conectamos famílias a produtores locais com praticidade e
            transparência.
          </p>
          <div className="hero-actions">
            <NavLink to="/produtos" className="primary-cta">
              Conhecer produtos
            </NavLink>
            <NavLink to="/produtores" className="secondary-cta">
              Ver produtores
            </NavLink>
          </div>
          <div className="benefits">
            <span>
              <Leaf /> Produtos frescos
            </span>
            <span>
              <UsersRound /> Direto do produtor
            </span>
          </div>
        </div>
        <div className="hero-visual" aria-label="Identidade visual HortiVitalMix">
          <div className="leaf-orbit">
            <Leaf />
            <Leaf />
            <Leaf />
          </div>
          <div className="hero-seal">
            <strong>
              {config
                ? `${config.defaultMunicipality} - ${config.defaultState}`
                : 'Ariquemes - RO'}
            </strong>
            <span>Região inicial da plataforma</span>
          </div>
        </div>
      </section>

      <section className="empty-showcase" aria-labelledby="showcase-title">
        <div>
          <span className="eyebrow">VITRINE REGIONAL</span>
          <h2 id="showcase-title">Conteúdo real, sem dados fictícios</h2>
          <p>
            Produtores e produtos serão exibidos somente quando existirem registros
            publicados pelo backend.
          </p>
        </div>
        <NavLink to="/produtos">Explorar catálogo</NavLink>
      </section>
    </section>
  );
}

function PendingPage({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <section className="content-page">
      <div className="content-icon">{icon}</div>
      <span className="eyebrow">HORTIVITALMIX</span>
      <h1>{title}</h1>
      <p>{description}</p>
      <NavLink to="/">Voltar ao início</NavLink>
    </section>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/produtores"
        element={
          <PendingPage
            title="Produtores locais"
            description="A listagem será habilitada pela trilha responsável pelo domínio de produtores. Nenhum cadastro fictício é exibido."
            icon={<UsersRound />}
          />
        }
      />
      <Route
        path="/produtos"
        element={
          <PendingPage
            title="Produtos frescos"
            description="O catálogo será alimentado exclusivamente por produtos reais persistidos e publicados no servidor."
            icon={<PackageSearch />}
          />
        }
      />
      <Route
        path="/planos"
        element={
          <PendingPage
            title="Planos HortiVitalMix"
            description="Planos e condições aparecerão quando a trilha de assinaturas estiver implementada e persistida."
            icon={<ShoppingCart />}
          />
        }
      />
      <Route
        path="/sobre"
        element={
          <PendingPage
            title="HortiVitalMix"
            description="A plataforma conecta produtores regionais e consumidores, mantendo os dados operacionais no backend real."
            icon={<Leaf />}
          />
        }
      />
      <Route
        path="/entrar"
        element={
          <PendingPage
            title="Acesso à conta"
            description="A autenticação será habilitada na trilha própria de identidade e autorização."
            icon={<UserRound />}
          />
        }
      />
      <Route
        path="/cadastro"
        element={
          <PendingPage
            title="Cadastre-se"
            description="Os fluxos de cadastro serão habilitados nas trilhas de identidade e perfis, sem simulações."
            icon={<UserRound />}
          />
        }
      />
      <Route
        path="/conta"
        element={
          <PendingPage
            title="Conta"
            description="A área da conta será habilitada após a implementação da autenticação."
            icon={<UserRound />}
          />
        }
      />
      <Route
        path="/carrinho"
        element={
          <PendingPage
            title="Carrinho"
            description="O carrinho será habilitado na trilha transacional correspondente."
            icon={<ShoppingCart />}
          />
        }
      />
      <Route
        path="*"
        element={
          <PendingPage
            title="Página não encontrada"
            description="O endereço informado não existe."
            icon={<PackageSearch />}
          />
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <MainShell>
        <AppRoutes />
      </MainShell>
    </BrowserRouter>
  );
}

import {
  ArrowRight,
  BadgeCheck,
  Clock3,
  Leaf,
  Mail,
  MapPin,
  PackageCheck,
  Phone,
  Sprout,
  Truck,
} from 'lucide-react';
import type { PublicConfig } from '../../../shared/contracts/configuration';
import type { EnvironmentResponse } from '../../../shared/contracts/foundation';
import { EnvironmentNotice } from '../../components/environment/EnvironmentNotice';
import { PublicHeader } from '../../components/layout/PublicHeader';

interface PublicHomeProps {
  config: PublicConfig;
  environment: EnvironmentResponse;
  databaseReady: boolean;
}

const journey = [
  { icon: Sprout, title: 'Produtor local', text: 'Apresenta sua produção e sua disponibilidade local.' },
  { icon: Leaf, title: 'Escolha prática', text: 'Encontre opções da sua região em uma experiência simples.' },
  { icon: PackageCheck, title: 'Mix personalizado', text: 'Escolha combinações de hortaliças para a sua rotina.' },
  { icon: Truck, title: 'Entrega planejada', text: 'A proposta conecta escolha, preparo e entrega local.' },
];

export function PublicHome({ config, environment, databaseReady }: PublicHomeProps) {
  const location = `${config.region.city} - ${config.region.stateCode}`;

  return (
    <div
      id="inicio"
      className="site-page"
      data-config-revision={config.revision}
      data-environment={environment.environment}
    >
      <PublicHeader config={config} />
      <EnvironmentNotice environment={environment} />
      <main>
        <section className="hero page-shell" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div className="hero-kicker"><span>{config.brand.name}</span> • conexão local</div>
            <h1 id="hero-title">Valorizamos <em>quem produz.</em><br />Facilitamos para quem consome.</h1>
            <p className="hero-lead">
              Uma plataforma para aproximar produtores locais e consumidores com praticidade,
              frescor e identidade regional.
            </p>
            <div className="hero-actions">
              <a className="primary-button" href="#como-funciona">
                Conhecer a proposta <ArrowRight size={18} />
              </a>
              <a className="secondary-button" href="#produtores">Sou produtor</a>
            </div>
            <div className="runtime-strip" role="status">
              <span className={databaseReady ? 'status-dot online' : 'status-dot offline'} />
              <strong>{databaseReady ? 'Infraestrutura conectada' : 'Apresentação disponível'}</strong>
              <span>
                {databaseReady
                  ? 'Configuração e banco respondendo normalmente.'
                  : 'Operações com persistência permanecem indisponíveis até a conexão ser restabelecida.'}
              </span>
            </div>
          </div>
          <div className="hero-visual" aria-label="Hortaliças frescas e conexão com produtores locais">
            <div className="produce-bowl">
              <span className="veg lettuce">🥬</span>
              <span className="veg carrot">🥕</span>
              <span className="veg tomato">🍅</span>
              <span className="veg cucumber">🥒</span>
              <span className="veg broccoli">🥦</span>
            </div>
            <div className="hero-badge">
              <MapPin size={20} />
              <span>Mercado inicial<br /><strong>{location}</strong></span>
            </div>
          </div>
        </section>

        <section id="como-funciona" className="section page-shell">
          <div className="section-heading">
            <p className="eyebrow">Dois lados. Uma mesma conexão.</p>
            <h2>Do campo para a mesa, com menos distância entre quem produz e quem consome.</h2>
          </div>
          <div className="two-sides-grid">
            <article className="side-card producer-card">
              <div className="side-label"><Sprout size={22} /> Produtor</div>
              <h3>Mais alcance e valor para o trabalho local.</h3>
              <ul><li>Canal digital organizado</li><li>Presença regional</li><li>Relacionamento direto</li></ul>
            </article>
            <article className="side-card consumer-card">
              <div className="side-label"><BadgeCheck size={22} /> Consumidor</div>
              <h3>Mais praticidade sem abrir mão do frescor.</h3>
              <ul><li>Escolha simplificada</li><li>Origem mais próxima</li><li>Rotina facilitada</li></ul>
            </article>
          </div>
        </section>

        <section id="beneficios" className="section section-tinted">
          <div className="page-shell">
            <div className="section-heading compact">
              <p className="eyebrow">A proposta</p>
              <h2>Praticidade, frescor e conexão local em um único ecossistema.</h2>
            </div>
            <div className="benefit-grid">
              <article><Leaf /><h3>Produtos frescos</h3><p>Uma experiência pensada para destacar frescor, origem e variedade.</p></article>
              <article><Clock3 /><h3>Menos tempo perdido</h3><p>Navegação clara e responsiva para celular, tablet e computador.</p></article>
              <article><MapPin /><h3>Começo regional</h3><p>{location} como configuração inicial, sem limitar a expansão.</p></article>
              <article><Truck /><h3>Estrutura real</h3><p>Uma base confiável para crescer com produtores, produtos e entregas.</p></article>
            </div>
          </div>
        </section>

        <section id="produtores" className="section page-shell">
          <div className="section-heading compact">
            <p className="eyebrow">Como o {config.brand.name} cresce</p>
            <h2>Uma experiência pensada para aproximar produção local, praticidade e confiança.</h2>
          </div>
          <div className="journey-grid">
            {journey.map((item, index) => (
              <article key={item.title} className="journey-item">
                <div className="journey-number">{index + 1}</div>
                <item.icon size={28} />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <div className="page-shell footer-inner">
          <div>
            <strong>{config.brand.name}</strong>
            <span>{config.brand.tagline}</span>
          </div>
          <div className="footer-meta" aria-label="Informações da plataforma">
            <span><MapPin size={15} aria-hidden="true" /> {location}</span>
            {config.contacts.email && <span><Mail size={15} aria-hidden="true" /> {config.contacts.email}</span>}
            {config.contacts.phone && <span><Phone size={15} aria-hidden="true" /> {config.contacts.phone}</span>}
          </div>
        </div>
      </footer>
    </div>
  );
}

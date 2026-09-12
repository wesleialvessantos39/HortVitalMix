import { useState } from 'react';
import { MapPin, Menu, X } from 'lucide-react';
import type { PublicConfig } from '../../../shared/contracts/configuration';
import { BrandLogo } from '../brand/BrandLogo';

interface PublicHeaderProps {
  config: PublicConfig;
}

const navigation = [
  { href: '#inicio', label: 'Início' },
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#produtores', label: 'Produtores' },
  { href: '#beneficios', label: 'Benefícios' },
];

export function PublicHeader({ config }: PublicHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = `${config.region.city} - ${config.region.stateCode}`;

  return (
    <header className="public-header">
      <div className="page-shell header-inner">
        <a
          href="#inicio"
          className="brand-link"
          aria-label={`Ir para o início de ${config.brand.name}`}
          onClick={() => setMenuOpen(false)}
        >
          <BrandLogo brand={config.brand} />
        </a>
        <nav className="desktop-nav" aria-label="Navegação principal">
          {navigation.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
        </nav>
        <div className="header-actions">
          <span className="location-chip">
            <MapPin size={17} aria-hidden="true" /> {location}
          </span>
          <button
            className="menu-button"
            type="button"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMenuOpen((current) => !current)}
          >
            {menuOpen ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav id="mobile-navigation" className="mobile-nav page-shell" aria-label="Navegação móvel">
          {navigation.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>{item.label}</a>
          ))}
          <span className="mobile-location"><MapPin size={17} aria-hidden="true" /> {location}</span>
        </nav>
      )}
    </header>
  );
}

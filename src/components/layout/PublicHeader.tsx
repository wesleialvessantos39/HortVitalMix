import { useState } from 'react';
import { MapPin, Menu, X } from 'lucide-react';
import { BrandLogo } from '../brand/BrandLogo';

const navigation = [
  { href: '#inicio', label: 'Início' },
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#produtores', label: 'Produtores' },
  { href: '#beneficios', label: 'Benefícios' },
];

export function PublicHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="public-header">
      <div className="page-shell header-inner">
        <a href="#inicio" className="brand-link" aria-label="Ir para o início" onClick={() => setMenuOpen(false)}>
          <BrandLogo />
        </a>
        <nav className="desktop-nav" aria-label="Navegação principal">
          {navigation.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
        </nav>
        <div className="header-actions">
          <span className="location-chip"><MapPin size={17} aria-hidden="true" /> Ariquemes - RO</span>
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
          <span className="mobile-location"><MapPin size={17} aria-hidden="true" /> Ariquemes - RO</span>
        </nav>
      )}
    </header>
  );
}

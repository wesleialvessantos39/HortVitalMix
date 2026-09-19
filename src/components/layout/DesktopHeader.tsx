import { Bell, MapPin, ShoppingCart, UserRound } from 'lucide-react';
import type { GlobalConfigPublic } from '../../../shared/contracts/foundation';
import { Brand } from './Brand';

export function DesktopHeader({config}:{config:GlobalConfigPublic}){
  return <header className="desktop-header">
    <div className="header-inner">
      <Brand platformName={config.platformName} slogan={config.slogan}/>
      <nav className="top-nav" aria-label="Navegação principal">
        <a className="active" href="#inicio">Início</a><a href="#produtores">Produtores</a><a href="#produtos">Produtos</a><a href="#planos">Planos</a><a href="#sobre">Sobre nós</a>
      </nav>
      <div className="header-actions">
        <button className="location-chip"><MapPin size={16}/><span>{config.defaultMunicipality} - {config.defaultState}</span></button>
        <button aria-label="Notificações"><Bell size={20}/></button>
        <button aria-label="Perfil"><UserRound size={20}/></button>
        <button aria-label="Carrinho"><ShoppingCart size={20}/></button>
      </div>
    </div>
  </header>;
}

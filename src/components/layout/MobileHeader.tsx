import { Bell, ShoppingCart } from 'lucide-react';
import type { GlobalConfigPublic } from '../../../shared/contracts/foundation';
import { Brand } from './Brand';
export function MobileHeader({config}:{config:GlobalConfigPublic}){return <header className="mobile-header"><Brand compact platformName={config.platformName} slogan={config.slogan}/><div><button aria-label="Notificações"><Bell size={19}/></button><button aria-label="Carrinho"><ShoppingCart size={19}/></button></div></header>}

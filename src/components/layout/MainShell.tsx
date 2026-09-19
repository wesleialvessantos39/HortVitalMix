import { useEffect, useState, type ReactNode } from 'react';
import { GlobalConfigPublicSchema, type GlobalConfigPublic } from '../../../shared/contracts/foundation';
import { BottomNavigation } from './BottomNavigation';
import { DesktopHeader } from './DesktopHeader';
import { MobileHeader } from './MobileHeader';

const fallback:GlobalConfigPublic={
  platformName:'HortiVitalMix',slogan:'Tudo fresco. Tudo da sua região.',defaultMunicipality:'Ariquemes',defaultState:'RO',
  currency:'BRL',timezone:'America/Porto_Velho',supportEmail:'hortivitalmix@gmail.com',supportPhone:null,revision:0
};

export function MainShell({children}:{children:ReactNode}){
  const[config,setConfig]=useState<GlobalConfigPublic>(fallback);
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/v1/config',{signal:controller.signal})
      .then(async(response)=>response.ok?response.json():null)
      .then(value=>{const parsed=GlobalConfigPublicSchema.safeParse(value);if(parsed.success)setConfig(parsed.data);})
      .catch(()=>undefined);
    return()=>controller.abort();
  },[]);
  return <div className="app-shell"><DesktopHeader config={config}/><MobileHeader config={config}/><main className="shell-main">{children}</main><BottomNavigation/></div>;
}

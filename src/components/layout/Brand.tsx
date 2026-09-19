import { Leaf } from 'lucide-react';

export function Brand({compact=false,platformName='HortiVitalMix',slogan='Tudo fresco. Tudo da sua região.'}:{compact?:boolean;platformName?:string;slogan?:string}){
  const canonical=platformName==='HortiVitalMix';
  return <div className="brand">
    <span className="brand-icon"><Leaf size={compact?18:23} strokeWidth={2.2}/></span>
    <span>
      {canonical
        ? <strong aria-label={platformName}><i>Horti</i><b>Vital</b><i>Mix</i></strong>
        : <strong className="brand-plain">{platformName}</strong>}
      {!compact&&<small>{slogan}</small>}
    </span>
  </div>;
}

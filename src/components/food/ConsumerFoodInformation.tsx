import { useState } from "react";
import { api } from "../../lib/api";
export function ConsumerFoodInformation({productId}:{productId:string}) {
  const [data,setData]=useState<{guidance:Array<{title:string;text:string;sources:Array<{title:string;url:string}>}>;rightsNotice:string;declarationNotice:string}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
  async function load(){setLoading(true);setError("");try{setData(await api(`/v1/food/products/${productId}`));}catch{setError("As informações mudaram ou o produto ficou indisponível. Atualize a página.");}finally{setLoading(false);}}
  return <details className="food-consumer-information" onToggle={e=>{if(e.currentTarget.open && !data && !loading)void load();}}><summary>Cuidados e informações de segurança</summary>
    {loading && <p role="status">Carregando cuidados…</p>}{error && <p role="alert">{error}</p>}
    {data && <><p>{data.declarationNotice}</p>{data.guidance.map((g,i)=><div key={i}><strong>{g.title}</strong><p>{g.text}</p><details><summary>Fontes</summary><ul>{g.sources.map((s,j)=><li key={j}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>)}</ul></details></div>)}<p>{data.rightsNotice}</p><a href="/cuidados-com-alimentos">Ver ensinamentos sobre alimentos</a></>}
  </details>;
}

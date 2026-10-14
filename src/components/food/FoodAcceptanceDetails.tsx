import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { readAdminSessionIdentityVersion } from "../../lib/adminSessionStore";
import type { FoodRule } from "../../../shared/contracts/foodSafety";
import { FoodSources } from "./FoodLearningCards";
type RecordView={productTitle:string;acceptedAt:string;location:{state:string;municipality:string};rules:FoodRule[];checkedKeys:string[];terms:{responsibility:string;rights:string;additional:string[]}};
export function FoodAcceptanceDetails({id}:{id:string}) {
  const [open,setOpen]=useState(false),[data,setData]=useState<RecordView|null>(null),[error,setError]=useState("");
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  async function load(){
    request.current?.abort();const abort=new AbortController();request.current=abort;
    const identity=readAdminSessionIdentityVersion();setError("");
    try{const value=await api<RecordView>(`/v1/admin/food/acceptances/${id}`,{signal:abort.signal});if(!abort.signal.aborted && readAdminSessionIdentityVersion()===identity)setData(value);}
    catch{if(!abort.signal.aborted)setError("Não foi possível consultar esta declaração. Atualize seu acesso e tente novamente.");}
  }
  return <div className="food-acceptance-details"><button type="button" className="secondary" onClick={()=>{setOpen(v=>!v);if(!data)void load();}}>{open ? "Fechar declaração" : "Ver declaração"}</button>
    {open && <div className="food-panel">{error ? <p role="alert">{error}</p> : !data ? <p role="status">Carregando declaração…</p> : <>
      <h3>{data.productTitle}</h3><p>{data.location.municipality} / {data.location.state} · {new Date(data.acceptedAt).toLocaleString("pt-BR")}</p>
      {data.rules.map(r=><section key={r.versionId}><h4>{r.body.title}</h4><ul>{r.body.checklist.map(i=><li key={i.key}>{data.checkedKeys.includes(r.versionId+":"+i.key) ? "✓ " : ""}{i.title}</li>)}</ul><FoodSources rule={r}/></section>)}
      <h4>Termos aceitos</h4><p>{data.terms.responsibility}</p><p>{data.terms.rights}</p>{data.terms.additional.map((t,i)=><p key={i}>{t}</p>)}
    </>}</div>}
  </div>;
}

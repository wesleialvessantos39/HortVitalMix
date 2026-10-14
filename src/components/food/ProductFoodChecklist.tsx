import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, CheckCircle2, RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
import { FoodRequirementsSchema, type FoodAcceptanceInput, type FoodRequirements } from "../../../shared/contracts/foodSafety";
import { FoodIllustration } from "./FoodIllustration";
import { FoodSources } from "./FoodLearningCards";
import "./foodSafety.css";
export function ProductFoodChecklist({productId,revision,disabled,onChange,onNavigate}:{productId:string;revision:number;disabled:boolean;onChange:(value:FoodAcceptanceInput|null)=>void;onNavigate:(path:string)=>void}) {
  const [data,setData]=useState<FoodRequirements|null>(null),[error,setError]=useState(""),[checked,setChecked]=useState<string[]>([]),[responsibility,setResponsibility]=useState(false),[terms,setTerms]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const [loading,setLoading]=useState(true);
  const lastToken=useRef("");
  const reset=useCallback(()=>{setChecked([]);setResponsibility(false);setTerms(false);},[]);
  useEffect(()=>{
    const abort=new AbortController();setLoading(true);setError("");
    void api(`/v1/producer/food/products/${productId}`,{signal:abort.signal}).then(v=>{
      if(abort.signal.aborted)return;const next=FoodRequirementsSchema.parse(v);
      if(lastToken.current!==next.token){reset();lastToken.current=next.token;}setData(next);
    }).catch(()=>{if(!abort.signal.aborted){setData(null);setError("Não foi possível carregar os cuidados. Atualize para continuar.");}})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[productId,revision,attempt,reset]);
  useEffect(()=>{
    if(loading || !data || data.held || data.requiresClassification || !data.checklist.length || checked.length!==data.checklist.length || !responsibility || !terms)onChange(null);
    else onChange({requirementsToken:data.token,checkedKeys:checked,acceptResponsibility:true,acceptTerms:true});
  },[loading,data,checked,responsibility,terms,onChange]);
  // Keep answers when returning from a lesson; changed requirements clear them.
  useEffect(()=>{const reload=()=>setAttempt(n=>n+1);window.addEventListener("focus",reload);return()=>window.removeEventListener("focus",reload);},[]);
  return <div className="food-safety food-checklist">
    <div className="food-heading"><div><h3>Vamos conferir os cuidados?</h3><p>Confirme apenas o que você já faz. Se precisar aprender, abra a explicação ou visite os ensinamentos.</p></div>
      <button type="button" className="secondary" onClick={()=>onNavigate("/produtor/legislacoes")}><BookOpen size={17}/> Aprender</button></div>
    {error && <p className="food-notice" role="alert">{error}</p>}
    <button type="button" className="text-button" disabled={disabled} onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={15}/> Atualizar cuidados</button>
    {!data && !error && <p role="status">Buscando os cuidados deste alimento…</p>}
    {data && <>
      <p className="food-scope-note">Local de produção: {data.location.municipality} / {data.location.state}</p>
      {data.held && <p role="alert" className="food-notice">A venda está pausada para acompanhamento: {data.holdReason}. Fale com o suporte antes de publicar.</p>}
      {data.requiresClassification && <p role="status" className="food-notice">Selecione o tipo de alimento e a forma de preparo e salve as informações para receber os cuidados corretos.</p>}
      <fieldset disabled={disabled || loading || data.held || data.requiresClassification} className="food-checklist-items">
        {data.checklist.map(i=><div className={checked.includes(i.acceptanceKey) ? "food-check-item is-checked" : "food-check-item"} key={i.acceptanceKey}>
          <FoodIllustration kind={i.illustration}/><div><label><input type="checkbox" checked={checked.includes(i.acceptanceKey)} onChange={e=>setChecked(current=>e.target.checked ? [...current,i.acceptanceKey] : current.filter(k=>k!==i.acceptanceKey))}/><strong>{i.title}</strong></label>
            <details><summary>Como cuidar</summary><p>{i.explanation}</p></details></div></div>)}
        <div className="food-consent"><label><input type="checkbox" checked={responsibility} onChange={e=>setResponsibility(e.target.checked)}/><span>Confirmo os cuidados acima e assumo minhas responsabilidades por este produto.</span></label><details><summary>Ler responsabilidades</summary><p>{data.responsibilityTerms}</p></details></div>
        <div className="food-consent"><label><input type="checkbox" checked={terms} onChange={e=>setTerms(e.target.checked)}/><span>Li e aceito os termos aplicáveis, preservando os direitos do consumidor.</span></label><details><summary>Ler os termos</summary><p>{data.rightsNotice}</p>{data.additionalTerms.map((t,i)=><p key={i}>{t}</p>)}</details></div>
      </fieldset>
      <p className="food-progress"><CheckCircle2 size={17}/>{checked.length} de {data.checklist.length} cuidados confirmados</p>
      <details><summary>Consultar as referências usadas</summary>{data.rules.map(r=><FoodSources key={r.versionId} rule={r}/>)}</details>
    </>}
  </div>;
}

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, BookOpen, Search } from "lucide-react";
import { api } from "../../lib/api";
import { FoodLearningResponseSchema, type FoodLearning } from "../../../shared/contracts/foodSafety";
import { BRAZIL_STATES, FOOD_FAMILY_LABELS, FOOD_PROCESS_LABELS } from "../../../shared/foodSafety";
import { FoodMaterialCard, FoodSources } from "../../components/food/FoodLearningCards";
import { FoodIllustration } from "../../components/food/FoodIllustration";
import { PageLoading } from "../../components/PageLoading";
import "../../components/food/foodSafety.css";
export default function FoodLearningPage({producer=false,onNavigate}:{producer?:boolean;onNavigate:(path:string)=>void}) {
  const [data,setData]=useState<FoodLearning|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  const [filters,setFilters]=useState({state:"",municipality:"",family:"",process:""});
  const [query,setQuery]=useState("");
  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError("");
    try {const d=FoodLearningResponseSchema.parse(await api((producer ? "/v1/producer/food/learning" : "/v1/food/learning")+query,{signal}));if(!signal?.aborted)setData(d);}
    catch {if(!signal?.aborted)setError("Não foi possível carregar os ensinamentos. Tente novamente.");}
    finally {if(!signal?.aborted)setLoading(false);}
  },[producer,query]);
  useEffect(()=>{const abort=new AbortController();void load(abort.signal);return()=>abort.abort();},[load]);
  useEffect(()=>{const reload=()=>{void load();};window.addEventListener("focus",reload);return()=>window.removeEventListener("focus",reload);},[load]);
  const apply=(e:FormEvent)=>{e.preventDefault();const p=new URLSearchParams(Object.entries(filters).filter(([,v])=>!!v));setQuery(p.size ? "?"+p.toString() : "");};
  return <section className="food-safety food-learning">
    <button type="button" className="text-button" onClick={()=>onNavigate(producer ? "/conta" : "/")}><ArrowLeft size={17}/> {producer ? "Minha conta" : "Voltar"}</button>
    <header className="food-heading"><div><span className="eyebrow">Conhecimento para cuidar</span><h1>{producer ? "Legislação e boas práticas" : "Cuidados com os alimentos"}</h1>
      <p>Aprenda com desenhos, orientações e vídeos. Cada cuidado ajuda o alimento a chegar bem à mesa.</p></div><BookOpen aria-hidden="true" size={36}/></header>
    <form className="food-panel food-filters" onSubmit={apply}>
      <label>Alimento<select value={filters.family} onChange={e=>setFilters({...filters,family:e.target.value})}><option value="">Todos os alimentos</option>{Object.entries(FOOD_FAMILY_LABELS).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>
      <label>Preparo<select value={filters.process} onChange={e=>setFilters({...filters,process:e.target.value})}><option value="">Todas as formas de preparo</option>{Object.entries(FOOD_PROCESS_LABELS).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>
      <label>Estado<select value={filters.state} onChange={e=>setFilters({...filters,state:e.target.value,municipality:""})}><option value="">{producer ? "Local da minha produção" : "Referências nacionais"}</option>{BRAZIL_STATES.map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Município<input value={filters.municipality} maxLength={120} disabled={!filters.state} onChange={e=>setFilters({...filters,municipality:e.target.value})} placeholder="Nome do município"/></label>
      <button className="primary" disabled={loading}><Search size={17}/> Ver orientações</button>
    </form>
    {error && <div className="food-notice" role="alert"><p>{error}</p><button type="button" className="secondary" onClick={()=>void load()}>Tentar novamente</button></div>}
    {loading && !data ? <PageLoading label="Carregando orientações…"/> : data && <>
      <div className="food-learning-grid">{data.materials.map(m=><FoodMaterialCard material={m} key={m.id}/>)}</div>
      {!data.materials.length && <p className="food-notice">Ainda não há materiais específicos para este filtro. Consulte as referências abaixo.</p>}
      <h2>O que se aplica ao alimento</h2>
      <div className="food-rule-list">{data.rules.map(r=><article className="food-panel" key={r.versionId}><h3>{r.body.title}</h3><p>{r.body.summary}</p>
        <details><summary>Entender os cuidados</summary><div className="food-care-grid">{r.body.checklist.map(i=><div className="food-care" key={i.key}><FoodIllustration kind={i.illustration}/><div><strong>{i.title}</strong><p>{i.explanation}</p></div></div>)}</div></details>
        <p>{producer ? r.body.producerTerms : r.body.consumerGuidance}</p><FoodSources rule={r}/></article>)}</div>
      {producer && <details className="food-panel"><summary>Responsabilidades na venda</summary><p>{data.responsibilityTerms}</p><p>{data.rightsNotice}</p></details>}
      <p className="food-scope-note">{data.scopeNote}</p>
    </>}
  </section>;
}

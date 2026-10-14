import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, FileCheck2, Plus, RefreshCw, Upload, ShieldCheck } from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import { readAdminSessionIdentityVersion } from "../../lib/adminSessionStore";
import { AdminReauthentication } from "../../components/commerce/AdminReauthentication";
import { PageLoading } from "../../components/PageLoading";
import { useOperationsQuery, localToday, type AdminOperationsPageProps } from "./adminOperationsView";
import { FoodAdminOverviewSchema, FoodRuleBodySchema, FoodMaterialBodySchema,
  type FoodRuleBody, type FoodMaterialBody, type FoodRule, type FoodMaterial } from "../../../shared/contracts/foodSafety";
import { BRAZIL_STATES, FOOD_FAMILIES, FOOD_PROCESSES, FOOD_FAMILY_LABELS, FOOD_PROCESS_LABELS, FOOD_RIGHTS_NOTICE } from "../../../shared/foodSafety";
import { FoodMaterialCard } from "../../components/food/FoodLearningCards";
import "../../components/food/foodSafety.css";
const parseOverview=(raw:unknown)=>FoodAdminOverviewSchema.parse(raw);
type Targets=Pick<FoodRuleBody,"scope"|"state"|"municipality"|"families"|"processes"|"categoryIds">;
const targetDefaults:Targets={scope:"national",state:null,municipality:null,families:[],processes:[],categoryIds:[]};
const newRule=():FoodRuleBody=>({...targetDefaults,title:"",summary:"",consumerGuidance:"",producerTerms:"",
  checklist:[{key:"care_1",title:"",explanation:"",illustration:"wash"}],sources:[{title:"",url:"",authority:"",reviewedAt:localToday()}]});
const newMaterial=():FoodMaterialBody=>({...targetDefaults,title:"",description:"",kind:"guide",audience:"producer",url:null,assetId:null,illustration:"wash"});
const illustrationOptions={wash:"Higiene",water:"Água",cold:"Conservação",label:"Embalagem e rótulo",trace:"Rastreabilidade",environment:"Meio ambiente",license:"Regularização"};
function TargetFields({value,categories,onChange}:{value:Targets;categories:Array<{id:string;name:string}>;onChange:(patch:Partial<Targets>)=>void}) {
  return <>
    <label>Abrangência<select value={value.scope} onChange={e=>{const scope=e.target.value as Targets["scope"];onChange({scope,state:scope==="national" ? null : value.state,municipality:scope==="municipality" ? value.municipality : null});}}>
      <option value="national">Todo o Brasil</option><option value="state">Um estado</option><option value="municipality">Um município</option></select></label>
    {value.scope!=="national" && <label>Estado<select required value={value.state ?? ""} onChange={e=>onChange({state:e.target.value as Targets["state"]})}><option value="">Selecione</option>{BRAZIL_STATES.map(s=><option key={s}>{s}</option>)}</select></label>}
    {value.scope==="municipality" && <label>Município de produção<input required maxLength={120} value={value.municipality ?? ""} onChange={e=>onChange({municipality:e.target.value})}/></label>}
    <fieldset className="food-editor-group food-full"><legend>Tipos de alimento</legend><p>Sem seleção, aplica-se a todas as famílias.</p><div className="food-editor-options">
      {FOOD_FAMILIES.map(f=><label key={f}><input type="checkbox" checked={value.families.includes(f)} onChange={e=>onChange({families:e.target.checked ? [...value.families,f] : value.families.filter(v=>v!==f)})}/>{FOOD_FAMILY_LABELS[f]}</label>)}
    </div></fieldset>
    <fieldset className="food-editor-group food-full"><legend>Formas de preparo</legend><p>Sem seleção, aplica-se a todas. Se selecionar também uma família, as duas condições precisam ser atendidas.</p><div className="food-editor-options">
      {FOOD_PROCESSES.map(f=><label key={f}><input type="checkbox" checked={value.processes.includes(f)} onChange={e=>onChange({processes:e.target.checked ? [...value.processes,f] : value.processes.filter(v=>v!==f)})}/>{FOOD_PROCESS_LABELS[f]}</label>)}
    </div></fieldset>
    <details className="food-full"><summary>Restringir a categorias do catálogo</summary><p>Sem seleção, não restringe por categoria.</p><div className="food-editor-options">{categories.map(c=><label key={c.id}><input type="checkbox" checked={value.categoryIds.includes(c.id)} onChange={e=>onChange({categoryIds:e.target.checked ? [...value.categoryIds,c.id] : value.categoryIds.filter(v=>v!==c.id)})}/>{c.name}</label>)}</div></details>
  </>;
}
export default function AdminFoodSafetyPage({access,onNavigate}:AdminOperationsPageProps) {
  const query=useOperationsQuery(access,"food_legislation","/v1/admin/food/overview",parseOverview);
  const [tab,setTab]=useState<"rules"|"materials"|"products"|"history">("rules"),[editing,setEditing]=useState<FoodRule|FoodMaterial|null>(null);
  const [editor,setEditor]=useState<"rule"|"material"|null>(null),[ruleBody,setRuleBody]=useState<FoodRuleBody>(newRule),[materialBody,setMaterialBody]=useState<FoodMaterialBody>(newMaterial);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[reauth,setReauth]=useState(false);
  const [holdTarget,setHoldTarget]=useState<{id:string;title:string;held:boolean}|null>(null),[reason,setReason]=useState("");
  const [search,setSearch]=useState(""),[filter,setFilter]=useState("all"),[file,setFile]=useState<File|null>(null);
  const pending=useRef<null|(()=>Promise<void>)>(null),flight=useRef(false),preservingReauth=useRef(false);
  const identity=readAdminSessionIdentityVersion();
  useEffect(()=>{if(preservingReauth.current)return;setEditor(null);setEditing(null);setHoldTarget(null);setFile(null);pending.current=null;setError("");setNotice("");},[identity,access.role]);
  const fail=(e:unknown)=>{
    const f=e as ApiFailure;
    if(["ADMIN_REAUTHENTICATION_REQUIRED","ADMIN_REAUTH_REQUIRED","REAUTH_REQUIRED"].includes(f.message)){setReauth(true);setError("Confirme sua sessão para concluir. Sua edição foi preservada.");return;}
    const messages:Record<string,string>={FOOD_REVISION_CHANGED:"Este conteúdo mudou em outra sessão. Atualize e confira a versão atual antes de salvar.",
      FOOD_BASE_RULE_REQUIRED:"A regra de cuidados gerais precisa permanecer ativa. Você pode atualizá-la, mas não arquivá-la.",
      FOOD_ASSET_NOT_READY:"Envie e conclua o arquivo antes de publicar.",FOOD_UPLOAD_INVALID:"O arquivo enviado não corresponde ao tipo e ao tamanho informados.",
      FORBIDDEN:"Sua permissão para este departamento mudou. Atualize seu acesso.",SESSION_CHANGED:"A sessão mudou. Entre novamente antes de continuar."};
    setError(messages[f.message] ?? "Não foi possível concluir. Seus dados foram preservados; tente novamente.");
  };
  async function mutation(path:string,body:object,message:string) {
    if(flight.current)return;
    const payload={...body,commandId:crypto.randomUUID()};
    const send=async()=>{
      if(flight.current)return;flight.current=true;setBusy(true);setError("");setNotice("");
      try {await api(path,{method:"POST",body:JSON.stringify(payload),offlineBypass:true});pending.current=null;setReauth(false);setEditor(null);setEditing(null);setHoldTarget(null);setNotice(message);query.refresh();window.dispatchEvent(new Event("hvm:departments-changed"));}
      catch(e){pending.current=send;fail(e);}finally{flight.current=false;setBusy(false);}
    };
    await send();
  }
  async function save(status:"draft"|"published"|"archived") {
    const parsed=editor==="rule" ? FoodRuleBodySchema.safeParse(ruleBody) : FoodMaterialBodySchema.safeParse(materialBody);
    if(!parsed.success){setError(parsed.error.issues.map(i=>i.message).slice(0,4).join(" "));return;}
    await mutation(editor==="rule" ? "/v1/admin/food/rules" : "/v1/admin/food/materials",{...(editing ? {id:editing.id,expectedRevision:editing.revision} : {}),status,body:parsed.data},
      status==="published" ? "Conteúdo publicado. As orientações já estão disponíveis; regras novas exigem os aceites correspondentes." : status==="draft" ? "Rascunho salvo. A versão publicada anterior continua vigente." : "Conteúdo arquivado.");
  }
  async function upload() {
    if(!file || busy)return;
    if(file.size>33554432){setError("O arquivo deve ter até 32 MB. Para vídeos maiores, use um link do YouTube.");return;}
    setBusy(true);setError("");
    try {
      const ticket=await api<{assetId:string;uploadUrl:string}>("/v1/admin/food/uploads",{method:"POST",body:JSON.stringify({mimeType:file.type,size:file.size,commandId:crypto.randomUUID()}),offlineBypass:true});
      const u=new URL(ticket.uploadUrl);if(u.origin!=="https://xipbsazvymkqqfmfegwu.supabase.co" || !u.pathname.startsWith("/storage/v1/object/upload/sign/food-education/"))throw Error("INVALID_UPLOAD_URL");
      const sent=await fetch(ticket.uploadUrl,{method:"PUT",headers:{"Content-Type":file.type},body:file,signal:AbortSignal.timeout(180000)});
      if(!sent.ok)throw Error("UPLOAD_FAILED");
      await api(`/v1/admin/food/uploads/${ticket.assetId}/complete`,{method:"POST",body:"{}",offlineBypass:true});
      setMaterialBody(v=>({...v,assetId:ticket.assetId}));setNotice("Arquivo enviado. Salve ou publique o ensinamento para disponibilizá-lo.");setFile(null);
    }catch(e){fail(e);}finally{setBusy(false);}
  }
  function editRule(r?:FoodRule){setEditor("rule");setEditing(r ?? null);setRuleBody(r ? structuredClone(r.body) : newRule());setError("");setNotice("");}
  function editMaterial(m?:FoodMaterial){setEditor("material");setEditing(m ?? null);setMaterialBody(m ? structuredClone(m.body) : newMaterial());setFile(null);setError("");setNotice("");}
  if(!query.permitted)return <p className="food-notice">Você não tem permissão para este departamento.</p>;
  return <section className="food-safety admin-page">
    <header className="food-heading"><div><span className="eyebrow">Departamento de legislação</span><h1>Alimentos, cuidado e responsabilidade</h1><p>Gerencie regras por produto e localidade, publique ensinamentos e acompanhe pendências que afetam a oferta ao consumidor.</p></div>
      <button type="button" className="secondary" disabled={busy || query.loading} onClick={()=>query.refresh()}><RefreshCw size={17}/> Atualizar</button></header>
    {(error || query.error) && <p className="food-notice" role="alert">{error || query.error}</p>}{notice && <p className="food-notice" role="status">{notice}</p>}
    {reauth && <AdminReauthentication expectedRole={access.role} onBusyChange={v=>{preservingReauth.current=v;}} onConfirmed={async()=>{setReauth(false);setError("");await pending.current?.();}} onCancel={()=>{setReauth(false);pending.current=null;}}/>}
    <nav className="food-tabs" aria-label="Áreas de legislação">{([["rules","Regras e checklists"],["materials","Ensinamentos"],["products","Acompanhamento"],["history","Aceites"]] as const).map(([k,label])=><button type="button" key={k} aria-pressed={tab===k} disabled={busy} onClick={()=>{setTab(k);setEditor(null);setEditing(null);setHoldTarget(null);setError("");}}>{label}</button>)}</nav>
    {query.loading && !query.data ? <PageLoading label="Carregando departamento…"/> : query.data && <>
      {editor && <form className="food-panel" onSubmit={(e:FormEvent)=>{e.preventDefault();void save("draft");}}>
        <h2>{editing ? "Editar" : "Criar"} {editor==="rule" ? "regra e checklist" : "ensinamento"}</h2>
        <fieldset disabled={busy} className="food-editor-content"><div className="food-editor-fields">
          {editor==="rule" ? <>
            <label className="food-full">Título<input required maxLength={180} value={ruleBody.title} onChange={e=>setRuleBody({...ruleBody,title:e.target.value})}/></label>
            <label className="food-full">Explicação em linguagem simples<textarea required maxLength={1500} value={ruleBody.summary} onChange={e=>setRuleBody({...ruleBody,summary:e.target.value})}/></label>
            <TargetFields value={ruleBody} categories={query.data.categories} onChange={p=>setRuleBody({...ruleBody,...p})}/>
            <fieldset className="food-editor-group food-full"><legend>Cuidados que o produtor deve confirmar</legend>{ruleBody.checklist.map((care,i)=><div className="food-editor-row" key={care.key}>
              <label>Nome do cuidado<input required maxLength={180} value={care.title} onChange={e=>setRuleBody({...ruleBody,checklist:ruleBody.checklist.map((c,j)=>j===i ? {...c,title:e.target.value} : c)})}/></label>
              <label>Como fazer / quando se aplica<textarea required maxLength={1500} value={care.explanation} onChange={e=>setRuleBody({...ruleBody,checklist:ruleBody.checklist.map((c,j)=>j===i ? {...c,explanation:e.target.value} : c)})}/></label>
              <label>Desenho<select value={care.illustration} onChange={e=>setRuleBody({...ruleBody,checklist:ruleBody.checklist.map((c,j)=>j===i ? {...c,illustration:e.target.value as typeof c.illustration} : c)})}>{Object.entries(illustrationOptions).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
              <button type="button" className="text-button" disabled={ruleBody.checklist.length===1} onClick={()=>setRuleBody({...ruleBody,checklist:ruleBody.checklist.filter((_,j)=>j!==i)})}>Remover cuidado</button>
            </div>)}<button type="button" className="secondary" disabled={ruleBody.checklist.length>=20} onClick={()=>setRuleBody({...ruleBody,checklist:[...ruleBody.checklist,{key:"care_"+crypto.randomUUID().replaceAll("-",""),title:"",explanation:"",illustration:"wash"}]})}><Plus size={16}/> Adicionar cuidado</button></fieldset>
            <fieldset className="food-editor-group food-full"><legend>Fontes da legislação</legend>{ruleBody.sources.map((s,i)=><div className="food-editor-row" key={i}>
              {(["title","authority","url","reviewedAt"] as const).map(k=><label key={k}>{({title:"Norma / título",authority:"Órgão responsável",url:"Link oficial",reviewedAt:"Data da consulta"})[k]}<input required type={k==="reviewedAt" ? "date" : k==="url" ? "url" : "text"} value={s[k]} maxLength={k==="url" ? 2048 : 180} onChange={e=>setRuleBody({...ruleBody,sources:ruleBody.sources.map((v,j)=>j===i ? {...v,[k]:e.target.value} : v)})}/></label>)}
              <button type="button" className="text-button" disabled={ruleBody.sources.length===1} onClick={()=>setRuleBody({...ruleBody,sources:ruleBody.sources.filter((_,j)=>j!==i)})}>Remover fonte</button>
            </div>)}<button type="button" className="secondary" disabled={ruleBody.sources.length>=30} onClick={()=>setRuleBody({...ruleBody,sources:[...ruleBody.sources,{title:"",url:"",authority:"",reviewedAt:localToday()}]})}>Adicionar fonte</button></fieldset>
            <label className="food-full">Orientação exibida ao consumidor<textarea required maxLength={2000} value={ruleBody.consumerGuidance} onChange={e=>setRuleBody({...ruleBody,consumerGuidance:e.target.value})}/></label>
            <label className="food-full">Termos complementares para o produtor (opcional)<textarea maxLength={4000} value={ruleBody.producerTerms} onChange={e=>setRuleBody({...ruleBody,producerTerms:e.target.value})}/></label>
            <p className="food-scope-note food-full">{FOOD_RIGHTS_NOTICE}</p>
            <p className="food-notice food-full">Ao publicar, os produtos abrangidos precisarão confirmar a nova versão antes de novas vendas. Salvar rascunho mantém a versão publicada anterior.</p>
          </> : <>
            <label className="food-full">Título<input required maxLength={180} value={materialBody.title} onChange={e=>setMaterialBody({...materialBody,title:e.target.value})}/></label>
            <label className="food-full">Explicação / legenda<textarea required maxLength={4000} value={materialBody.description} onChange={e=>setMaterialBody({...materialBody,description:e.target.value})}/></label>
            <label>Formato<select value={materialBody.kind} onChange={e=>{setMaterialBody({...materialBody,kind:e.target.value as FoodMaterialBody["kind"],url:null,assetId:null});setFile(null);}}><option value="guide">Desenho com orientação</option><option value="image">Foto ou imagem</option><option value="video">Vídeo enviado</option><option value="youtube">Vídeo do YouTube</option><option value="link">Link de material</option></select></label>
            <label>Público<select value={materialBody.audience} onChange={e=>setMaterialBody({...materialBody,audience:e.target.value as FoodMaterialBody["audience"]})}><option value="producer">Produtores</option><option value="consumer">Consumidores</option><option value="both">Produtores e consumidores</option></select></label>
            <TargetFields value={materialBody} categories={query.data.categories} onChange={p=>setMaterialBody({...materialBody,...p})}/>
            {materialBody.kind==="guide" && <label>Desenho<select value={materialBody.illustration} onChange={e=>setMaterialBody({...materialBody,illustration:e.target.value as FoodMaterialBody["illustration"]})}>{Object.entries(illustrationOptions).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>}
            {["youtube","link"].includes(materialBody.kind) && <label className="food-full">Endereço HTTPS<input type="url" required maxLength={2048} value={materialBody.url ?? ""} onChange={e=>setMaterialBody({...materialBody,url:e.target.value})} placeholder={materialBody.kind==="youtube" ? "https://www.youtube.com/watch?v=..." : "https://..."}/></label>}
            {["image","video"].includes(materialBody.kind) && <div className="food-full"><label>Arquivo (até 32 MB)<input type="file" accept={materialBody.kind==="image" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/webm"} onChange={e=>setFile(e.target.files?.[0] ?? null)}/></label>
              <div className="food-actions"><button type="button" className="secondary" disabled={!file || busy} onClick={()=>void upload()}><Upload size={16}/> {busy ? "Enviando…" : "Enviar arquivo"}</button>{materialBody.assetId && <span>Arquivo pronto para este ensinamento.</span>}</div>
              <p className="food-scope-note">Para vídeos maiores, selecione o formato YouTube. O vídeo só aparece no portal depois de publicar este ensinamento.</p></div>}
          </>}
        </div></fieldset>
        <div className="food-actions"><button className="secondary" disabled={busy}>Salvar rascunho</button><button type="button" className="primary" disabled={busy} onClick={()=>void save("published")}>Publicar</button>
          {editing && <button type="button" className="text-button" disabled={busy} onClick={()=>void save("archived")}>Arquivar</button>}
          <button type="button" className="text-button" disabled={busy} onClick={()=>{setEditor(null);setEditing(null);}}>Fechar edição</button></div>
      </form>}
      {tab==="rules" && <><div className="food-heading"><h2>Regras versionadas</h2><button className="primary" type="button" disabled={busy} onClick={()=>editRule()}><Plus size={17}/> Nova regra</button></div><div className="food-admin-list">{query.data.rules.map(r=><article key={r.id}><div><h3>{r.body.title}</h3><p>{r.body.summary}</p><small>{r.body.scope==="national" ? "Todo o Brasil" : `${r.body.municipality ?? ""} ${r.body.state}`} · {r.status==="published" ? "Publicada" : r.status==="draft" ? r.versionId ? "Rascunho com versão anterior vigente" : "Rascunho" : "Arquivada"}</small></div><button className="secondary" type="button" disabled={busy} onClick={()=>editRule(r)}>Editar</button></article>)}</div></>}
      {tab==="materials" && <><div className="food-heading"><h2>Ensinamentos do portal</h2><button className="primary" type="button" disabled={busy} onClick={()=>editMaterial()}><Plus size={17}/> Novo ensinamento</button></div><div className="food-learning-grid">{query.data.materials.map(m=><div key={m.id}><FoodMaterialCard material={m}/><div className="food-actions"><small>{m.status==="published" ? "Publicado" : m.status==="draft" ? "Rascunho" : "Arquivado"}</small><button className="secondary" type="button" disabled={busy} onClick={()=>editMaterial(m)}>Editar</button></div></div>)}</div></>}
      {tab==="products" && <><h2>Acompanhamento dos produtos</h2><p>Uma pausa impede novas ofertas e compras. Liberar a pausa mantém a exigência de confirmar os cuidados vigentes. Pedidos já realizados preservam seus registros e os direitos do consumidor.</p>
        <div className="food-filters food-panel"><label>Buscar produto ou loja<input value={search} maxLength={100} onChange={e=>setSearch(e.target.value)}/></label><label>Situação<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todos</option><option value="pending">Aceite pendente</option><option value="held">Em acompanhamento</option><option value="ready">Cuidados confirmados</option></select></label></div>
        {holdTarget && <form className="food-panel" onSubmit={e=>{e.preventDefault();void mutation("/v1/admin/food/holds",{productId:holdTarget.id,hold:!holdTarget.held,reason},holdTarget.held ? "Acompanhamento liberado. Os aceites vigentes continuam obrigatórios." : "Oferta pausada para acompanhamento.");}}><h3>{holdTarget.held ? "Resolver acompanhamento" : "Pausar oferta"}: {holdTarget.title}</h3><label>Motivo / solução registrada<textarea required minLength={10} maxLength={1500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="food-actions"><button className="primary" disabled={busy || reason.trim().length<10}>{holdTarget.held ? "Liberar acompanhamento" : "Pausar novas vendas"}</button><button type="button" className="secondary" disabled={busy} onClick={()=>setHoldTarget(null)}>Cancelar</button></div></form>}
        <div className="food-admin-list">{query.data.products.filter(p=>(p.title+" "+p.storeName).toLowerCase().includes(search.toLowerCase()) && (filter==="all" || filter==="held" && p.held || filter==="pending" && !p.compliant && !p.held || filter==="ready" && p.compliant)).map(p=><article key={p.id}><div><h3>{p.title}</h3><p>{p.storeName} · {p.municipality} / {p.state}</p><p>{p.family ? FOOD_FAMILY_LABELS[p.family] : "Classificação pendente"} · {p.held ? "Em acompanhamento" : p.compliant ? "Cuidados confirmados" : "Confirmação pendente"} · {p.published ? "Marcado para publicação" : "Rascunho"}</p>{p.holdReason && <p>{p.holdReason}</p>}</div><button className="secondary" type="button" disabled={busy} onClick={()=>{setHoldTarget({id:p.id,title:p.title,held:p.held});setReason("");}}>{p.held ? "Resolver" : "Acompanhar"}</button></article>)}</div>
      </>}
      {tab==="history" && <><h2>Aceites registrados</h2><p>As versões, os cuidados, os termos e o momento da declaração ficam preservados. Aceite é declaração do produtor e não aprovação sanitária oficial.</p><div className="food-admin-list">{query.data.recentAcceptances.map(a=><article key={a.id}><div><h3>{a.productTitle}</h3><p>{new Date(a.acceptedAt).toLocaleString("pt-BR")} · {a.ruleCount} conjuntos de cuidados confirmados</p></div><FileCheck2 aria-hidden="true"/></article>)}{!query.data.recentAcceptances.length && <p>Os aceites aparecerão aqui conforme os produtores confirmarem os cuidados.</p>}</div></>}
      <div className="food-actions"><button type="button" className="text-button" onClick={()=>onNavigate("/cuidados-com-alimentos")}><BookOpen size={16}/> Ensinamentos do consumidor</button><span className="food-scope-note"><ShieldCheck size={14}/> Acesso e alterações seguem os poderes do departamento.</span></div>
    </>}
  </section>;
}

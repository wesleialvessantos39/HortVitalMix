import { useState } from "react";
import { ExternalLink, PlayCircle } from "lucide-react";
import type { FoodMaterial, FoodRule } from "../../../shared/contracts/foodSafety";
import { youtubeVideoId } from "../../../shared/foodSafety";
import { FoodIllustration } from "./FoodIllustration";
export function FoodSources({rule}:{rule:FoodRule}) {
  return <details className="food-sources"><summary>Fontes e legislação · {rule.body.sources.length}</summary><ul>
    {rule.body.sources.map((s,i)=><li key={i}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title} <ExternalLink size={13} aria-hidden="true"/></a>
      <small>{s.authority} · consultado em {s.reviewedAt.split("-").reverse().join("/")}</small></li>)}
  </ul></details>;
}
export function FoodMaterialCard({material}:{material:FoodMaterial}) {
  const [watching,setWatching]=useState(false);
  const m=material.body,id=m.url ? youtubeVideoId(m.url) : null;
  return <article className="food-learning-card">
    {m.kind==="image" && material.mediaUrl ? <img src={material.mediaUrl} alt={m.title} loading="lazy"/> :
      m.kind==="video" && material.mediaUrl ? <video controls preload="metadata" src={material.mediaUrl} aria-label={m.title}/> :
      m.kind==="youtube" && id ? <div className="food-video">{watching ?
        <iframe src={`https://www.youtube-nocookie.com/embed/${id}`} title={m.title} loading="lazy" allow="encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/> :
        <button type="button" onClick={()=>setWatching(true)}><PlayCircle size={38} aria-hidden="true"/><span>Assistir ao vídeo</span><small>Carregar vídeo do YouTube</small></button>}</div> : <FoodIllustration kind={m.illustration}/>}
    <div><h3>{m.title}</h3><p className="food-preserve-lines">{m.description}</p>
      {m.kind==="link" && m.url && <a href={m.url} target="_blank" rel="noopener noreferrer">Abrir material <ExternalLink size={15}/></a>}
      {m.kind==="youtube" && m.url && <a href={m.url} target="_blank" rel="noopener noreferrer">Abrir no YouTube <ExternalLink size={15}/></a>}
    </div>
  </article>;
}

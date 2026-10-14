export const FOOD_FAMILIES = ["fruits", "leafy", "vegetables", "mixes", "herbs", "juices_pulps", "grains", "nuts", "animal", "other"] as const;
export type FoodFamily = typeof FOOD_FAMILIES[number];
export const FOOD_FAMILY_LABELS: Record<FoodFamily, string> = {
  fruits: "Frutas", leafy: "Folhas e hortaliças", vegetables: "Legumes e raízes", mixes: "Mixes e alimentos preparados",
  herbs: "Ervas, chás e temperos", juices_pulps: "Sucos e polpas", grains: "Grãos, cereais e farinhas",
  nuts: "Castanhas e sementes", animal: "Alimentos de origem animal", other: "Outros alimentos",
};
export const FOOD_PROCESSES = ["fresh", "washed_cut", "frozen", "dried", "pressed_pulped", "prepared"] as const;
export type FoodProcess = typeof FOOD_PROCESSES[number];
export const FOOD_PROCESS_LABELS: Record<FoodProcess, string> = {
  fresh: "Inteiro / in natura", washed_cut: "Lavado, descascado ou cortado", frozen: "Congelado",
  dried: "Seco ou desidratado", pressed_pulped: "Extraído como suco ou polpa", prepared: "Preparado / combinação de ingredientes",
};
export const BRAZIL_STATES = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"] as const;
export const FOOD_RIGHTS_NOTICE = "Este aceite não exclui direitos do consumidor, nem responsabilidades civis, sanitárias, ambientais ou legais do produtor ou do HortiVitalMix. A responsabilidade de cada participante será apurada conforme a legislação e sua atuação no caso concreto.";
export const FOOD_RESPONSIBILITY_TERMS = "Declaro que as informações deste alimento são verdadeiras e que sou responsável por sua origem, preparo, higiene, segurança, embalagem, conservação, validade, transporte sob minha responsabilidade e cumprimento das exigências aplicáveis. Manterei os documentos e a rastreabilidade, prestarei atendimento ao consumidor e colaborarei com correções e recolhimentos. O HortiVitalMix oferece a intermediação e as ferramentas da plataforma; este aceite não representa licença sanitária, inspeção oficial ou garantia automática de conformidade.";
export function normalizeFoodCity(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g," ");
}
export function youtubeVideoId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.split("/")[1];
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "www.youtube-nocookie.com"].includes(host)) {
      id = url.pathname === "/watch" ? url.searchParams.get("v") : /^\/(?:embed|shorts)\//.test(url.pathname) ? url.pathname.split("/")[2] : null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}
export function safeFoodLink(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port &&
      !/^(localhost|.*\.localhost|.*\.local|\[.*\]|\d+(?:\.\d+){0,3})$/i.test(u.hostname);
  } catch { return false; }
}
export type FoodSelector = {
  scope: "national" | "state" | "municipality"; state: string | null; municipality: string | null;
  families: readonly string[]; processes: readonly string[]; categoryIds: readonly string[];
};
export function foodRuleMatches(rule: FoodSelector, product: { family: string; process: string; categoryId: string; state: string; municipality: string }) {
  return (!rule.families.length || rule.families.includes(product.family)) &&
    (!rule.processes.length || rule.processes.includes(product.process)) &&
    (!rule.categoryIds.length || rule.categoryIds.includes(product.categoryId)) &&
    (rule.scope === "national" || rule.state === product.state) &&
    (rule.scope !== "municipality" || normalizeFoodCity(rule.municipality ?? "") === normalizeFoodCity(product.municipality));
}
export function foodAcceptanceState(requirements: {token:string;keys:readonly string[];held:boolean;classified:boolean},
  acceptance?: {requirementsToken:string;checkedKeys:readonly string[];acceptResponsibility:boolean;acceptTerms:boolean}) {
  if(requirements.held)return "held";
  if(!requirements.classified)return "classification";
  if(!acceptance)return "incomplete";
  if(acceptance.requirementsToken!==requirements.token)return "stale";
  const keys=new Set(acceptance.checkedKeys);
  return acceptance.acceptResponsibility && acceptance.acceptTerms && requirements.keys.length>0 &&
    keys.size===acceptance.checkedKeys.length && keys.size===requirements.keys.length && requirements.keys.every(k=>keys.has(k)) ? "valid" : "incomplete";
}

import { nativeBackendOrigin } from "./nativeTransport";

const STORAGE_ORIGIN = "https://xipbsazvymkqqfmfegwu.supabase.co";
const publicPath = /^\/(?:api|_hvm_api)\/v1\/public-media\/(product|store)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Images do not go through the HTTP plugin. Translate only recognized public
// API photos to the compiled backend; preserve managed Storage signatures.
export function publicMediaSource(value: string): string | null {
  const origin = nativeBackendOrigin();
  if (!origin) return value;
  if (value.startsWith("blob:") || /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(value)) return value;
  if (value === "/favicon.svg" || /^\/(?:assets|app-icons)\//.test(value)) {
    if (/%(?:2e|2f|5c)/i.test(value) || value.includes("\\") || value.includes("..")) return null;
    return value;
  }
  if (/%(?:2e|2f|5c)/i.test(value.split(/[?#]/)[0]) || value.includes("\\")) return null;
  let parsed: URL;
  try { parsed = new URL(value, origin); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) return null;
  if (parsed.origin === STORAGE_ORIGIN &&
      /^\/storage\/v1\/object\/(?:sign|public)\/(?:product-media|store-media)\//.test(parsed.pathname)) return value;
  const match = parsed.origin === origin ? parsed.pathname.match(publicPath) : null;
  if (!match || [...parsed.searchParams.keys()].some((key) => key !== "width") ||
      parsed.searchParams.getAll("width").length > 1 ||
      (parsed.searchParams.has("width") && !["320", "640", "1280"].includes(parsed.searchParams.get("width")!))) return null;
  return origin + "/api/v1/public-media/" + match[1] + "/" + match[2] + parsed.search;
}

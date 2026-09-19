import { createClient } from "@supabase/supabase-js";
import { runtime } from "../config/runtime.ts";
/** JWT validado no serviço de identidade; cliente isolado para nunca trocar sessão global. */
export async function signedDocumentUrl(accessToken: string, path: string) {
  const client = createClient(runtime.supabaseUrl, runtime.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer " + accessToken } },
  });
  const { data, error } = await client.storage
    .from("documents")
    .createSignedUrl(path, 900);
  if (error) throw new Error("DOCUMENT_NOT_ACCESSIBLE");
  return data.signedUrl;
}

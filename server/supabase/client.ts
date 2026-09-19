import { createClient } from "@supabase/supabase-js";
import { runtime } from "../config/runtime.ts";

const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

const valid = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(runtime.supabaseUrl);

export function createSupabasePublicClient() {
  return valid && runtime.anonKey
    ? createClient(runtime.supabaseUrl, runtime.anonKey, options)
    : null;
}

export const supabasePublic = createSupabasePublicClient();

export const supabaseAdmin =
  valid && runtime.serviceKey
    ? createClient(runtime.supabaseUrl, runtime.serviceKey, options)
    : null;

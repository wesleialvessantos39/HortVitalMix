import { createClient } from "@supabase/supabase-js";
import { runtime } from "../config/runtime.ts";

async function timedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const timeout = AbortSignal.timeout(8000);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;

  return fetch(input, { ...init, signal });
}

const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: timedFetch,
  },
};

const cleanUrl = (runtime.supabaseUrl || "").trim().replace(/\/+$/, "");
const valid = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cleanUrl);

export function createSupabasePublicClient() {
  return valid && runtime.anonKey
    ? createClient(cleanUrl, runtime.anonKey, options)
    : null;
}

export const supabasePublic = createSupabasePublicClient();

export const supabaseAdmin =
  valid && runtime.serviceKey
    ? createClient(cleanUrl, runtime.serviceKey, options)
    : null;

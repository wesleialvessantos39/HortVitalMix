import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runtime } from '../config/runtime';
export const supabaseAdmin: SupabaseClient | null = runtime.supabaseUrl && runtime.supabaseServiceRoleKey ? createClient(runtime.supabaseUrl,runtime.supabaseServiceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}}) : null;
export const supabasePublic: SupabaseClient | null = runtime.supabaseUrl && runtime.supabaseAnonKey ? createClient(runtime.supabaseUrl,runtime.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false}}) : null;

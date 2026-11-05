import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

// Cliente anônimo para as páginas públicas: nunca herda a sessão de quem está logado no painel.
export function createPublicClient() {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

// service_role ignora RLS. Só pode ser usado aqui no servidor e depois de validar a entrada ou o papel
// do usuário. O import 'server-only' faz o build falhar se este módulo chegar a um componente de cliente.
export function createServiceClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

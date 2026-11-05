import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { authCookieOptions } from './cookies';

// Cliente com a sessão do usuário logado: toda consulta passa pelas políticas RLS dele.
export async function createSessionClient() {
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll: () => store.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) store.set(name, value, options);
        } catch {
          // Em Server Components não é possível gravar cookies; o proxy renova a sessão.
        }
      },
    },
  });
}

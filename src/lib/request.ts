import 'server-only';
import { createHmac } from 'node:crypto';
import { headers } from 'next/headers';
import { env } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/admin';

export async function clientIp(): Promise<string> {
  const list = await headers();
  return list.get('x-real-ip') ?? list.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'desconhecido';
}

// Guardamos só uma assinatura do IP (LGPD): serve para limitar abuso, não identifica a pessoa.
export function hashValue(value: string): string {
  return createHmac('sha256', env.ipHashSecret).update(value).digest('hex').slice(0, 40);
}

// Limite durável no banco: funciona entre instâncias serverless. Em caso de falha do banco, nega.
export async function isWithinRateLimit(scope: string, identifier: string, limit: number, windowSeconds: number) {
  const { data, error } = await createServiceClient().rpc('check_rate_limit', {
    p_key: `${scope}:${hashValue(identifier)}`,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error('Falha no limite de tentativas', error.message);
    return false;
  }
  return data === true;
}

// Rotas de API aceitam apenas chamadas vindas do próprio site (proteção contra CSRF).
export function isSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

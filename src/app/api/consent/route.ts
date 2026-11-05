import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp, hashValue, isSameOrigin, isWithinRateLimit } from '@/lib/request';
import { createServiceClient } from '@/lib/supabase/admin';
import { getSite } from '@/lib/tenant';

const bodySchema = z.object({
  subject_id: z.uuid(),
  action: z.enum(['accept_all', 'reject_all', 'custom', 'revoke']),
  analytics: z.boolean(),
  marketing: z.boolean(),
  policy_version: z.string().max(20),
});

// Registro de prova do consentimento (LGPD, art. 8º, § 2º): quem decidiu o quê, quando e em qual versão.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new NextResponse(null, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  const ip = await clientIp();
  if (!(await isWithinRateLimit('consent', ip, 30, 3600))) return new NextResponse(null, { status: 429 });

  const site = await getSite();
  if (!site) return new NextResponse(null, { status: 503 });

  const { error } = await createServiceClient()
    .from('cookie_consents')
    .insert({ ...parsed.data, company_id: site.company.id, ip_hash: hashValue(ip) });
  if (error) {
    console.error('Falha ao registrar consentimento', error.code);
    return new NextResponse(null, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}

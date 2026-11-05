import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createSessionClient } from '@/lib/supabase/server';

const ALLOWED_TYPES: EmailOtpType[] = ['recovery', 'invite', 'magiclink', 'email'];
const ALLOWED_NEXT = ['/admin', '/admin/nova-senha', '/admin/mfa'];

// Confirma links de recuperação e convite. O destino é fixo em lista para impedir redirecionamento aberto.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const requestedNext = searchParams.get('next') ?? '/admin';
  const next = ALLOWED_NEXT.includes(requestedNext) ? requestedNext : '/admin';

  const supabase = await createSessionClient();
  let failed = true;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(error);
  } else if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    failed = Boolean(error);
  }

  if (failed) return NextResponse.redirect(new URL('/admin/login?erro=link-invalido', origin));
  return NextResponse.redirect(new URL(next, origin));
}

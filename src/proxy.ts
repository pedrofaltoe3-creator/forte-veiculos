import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { authCookieOptions } from '@/lib/supabase/cookies';

const PUBLIC_ADMIN_PATHS = ['/admin/login', '/admin/recuperar-senha'];

function buildCsp(nonce: string, supabaseUrl: string | undefined, isHttps: boolean): string {
  const isDev = process.env.NODE_ENV === 'development';
  const supabase = supabaseUrl ? new URL(supabaseUrl).origin : '';
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${supabase} https://www.facebook.com https://*.google-analytics.com https://*.googletagmanager.com`,
    `font-src 'self'`,
    `media-src 'self' blob: ${supabase}`,
    `connect-src 'self' ${supabase} https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://www.facebook.com${isDev ? ' ws:' : ''}`,
    `frame-src https://www.google.com https://www.instagram.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isHttps ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const isHttps = request.headers.get('x-forwarded-proto') === 'https' || request.nextUrl.protocol === 'https:';
  const csp = buildCsp(nonce, supabaseUrl, isHttps);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);

  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/admin')) {
    // Site de demonstração: fica fora dos buscadores até ir para o domínio oficial.
    if (process.env.SITE_NOINDEX === '1') response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  }

  // Painel: nunca em cache compartilhado. Proteção em camadas: esta barreira, as guardas de servidor e a RLS.
  response.headers.set('Cache-Control', 'private, no-store');
  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(new URL(path, request.url));
    redirect.headers.set('Cache-Control', 'private, no-store');
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };
  const isPublicPath = PUBLIC_ADMIN_PATHS.includes(pathname);

  if (!supabaseUrl || !supabaseKey) return isPublicPath ? response : redirectTo('/admin/login');

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        response.headers.set('Content-Security-Policy', csp);
        response.headers.set('Cache-Control', 'private, no-store');
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  if (!data.user) return isPublicPath ? response : redirectTo('/admin/login');
  // Com ?erro a página explica a recusa; redirecionar aqui criaria um laço para quem não tem acesso.
  if (pathname === '/admin/login' && !request.nextUrl.searchParams.has('erro')) return redirectTo('/admin');
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon.svg|hero/|brand/|images/|robots.txt|sitemap.xml).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};

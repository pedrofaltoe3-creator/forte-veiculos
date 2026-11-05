// Cookies de sessão: inacessíveis ao JavaScript da página, só por HTTPS em produção.
// Sem atividade por 8 horas, a sessão expira no navegador.
export const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 8,
};

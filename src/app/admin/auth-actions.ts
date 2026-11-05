'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireSessionForMfa } from '@/lib/auth/guards';
import { accessEmail, accessLink, isEmailConfigured, sendEmail } from '@/lib/email';
import { env } from '@/lib/env';
import { clientIp, isWithinRateLimit } from '@/lib/request';
import { createServiceClient } from '@/lib/supabase/admin';
import { createSessionClient } from '@/lib/supabase/server';
import { getSite } from '@/lib/tenant';
import type { FormState } from '@/lib/types';
import { passwordSchema } from '@/lib/validation';

const INVALID_LOGIN = 'E-mail ou senha incorretos.';
const TOO_MANY = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';

async function logEvent(companyId: string, actorId: string | null, email: string | null, action: string) {
  const { error } = await createServiceClient().rpc('log_admin_event', {
    p_company: companyId,
    p_actor: actorId,
    p_actor_email: email,
    p_action: action,
  });
  if (error) console.error('Falha ao registrar evento', action, error.code);
}

const loginSchema = z.object({
  email: z.email().max(180),
  password: z.string().min(1).max(128),
});

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: formData.get('email'), password: formData.get('password') });
  if (!parsed.success) return { ok: false, message: INVALID_LOGIN };

  const { email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();
  const ip = await clientIp();
  const [byIp, byEmail] = await Promise.all([
    isWithinRateLimit('login-ip', ip, 20, 900),
    isWithinRateLimit('login-email', normalizedEmail, 5, 900),
  ]);
  if (!byIp || !byEmail) return { ok: false, message: TOO_MANY };

  const site = await getSite();
  if (!site) return { ok: false, message: 'O sistema ainda não foi configurado.' };

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
  if (error || !data.user) {
    await logEvent(site.company.id, null, normalizedEmail, 'auth.login_failed');
    return { ok: false, message: INVALID_LOGIN };
  }

  const { data: member } = await supabase
    .from('company_members')
    .select('is_active')
    .eq('company_id', site.company.id)
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (!member?.is_active) {
    await supabase.auth.signOut();
    await logEvent(site.company.id, data.user.id, normalizedEmail, 'auth.login_denied');
    return { ok: false, message: INVALID_LOGIN };
  }

  await logEvent(site.company.id, data.user.id, normalizedEmail, 'auth.login');
  redirect('/admin/mfa');
}

export async function logout() {
  const supabase = await createSessionClient();
  const site = await getSite();
  const { data } = await supabase.auth.getUser();
  if (site && data.user) await logEvent(site.company.id, data.user.id, data.user.email ?? null, 'auth.logout');
  // scope global: encerra a sessão em todos os aparelhos.
  await supabase.auth.signOut({ scope: 'global' });
  redirect('/admin/login');
}

export async function requestPasswordReset(_: FormState, formData: FormData): Promise<FormState> {
  const SENT = 'Se este e-mail tiver acesso, enviamos um link para criar uma nova senha.';
  const email = z.email().max(180).safeParse(formData.get('email'));
  if (!email.success) return { ok: true, message: SENT };

  const ip = await clientIp();
  const [byIp, byEmail] = await Promise.all([
    isWithinRateLimit('reset-ip', ip, 10, 3600),
    isWithinRateLimit('reset-email', email.data.toLowerCase(), 3, 3600),
  ]);
  if (!byIp || !byEmail) return { ok: true, message: SENT };

  // Com envio próprio, o link vai por e-mail e abre em qualquer aparelho. Sem ele, o Supabase envia,
  // e o link só abre no navegador que pediu.
  if (isEmailConfigured()) {
    const { data, error } = await createServiceClient().auth.admin.generateLink({ type: 'recovery', email: email.data });
    const site = await getSite();
    if (!error && data.properties) {
      const storeName = site?.settings.display_name ?? 'loja';
      await sendEmail({
        to: email.data,
        fromName: storeName,
        ...accessEmail({ kind: 'recovery', storeName, link: accessLink(data.properties.hashed_token, data.properties.verification_type) }),
      });
    }
    return { ok: true, message: SENT };
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${env.siteUrl}/auth/callback?next=/admin/nova-senha`,
  });
  if (error) console.error('Falha ao solicitar recuperação de senha', error.code);
  return { ok: true, message: SENT };
}

const newPasswordSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string(),
    code: z.string().trim().optional(),
  })
  .refine((v) => v.password === v.confirm, { message: 'As senhas não conferem.', path: ['confirm'] });

export async function updatePassword(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
    code: formData.get('code') ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const supabase = await createSessionClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: 'O link expirou. Solicite outro.' };

  if (!(await isWithinRateLimit('new-password', auth.user.id, 8, 900))) return { ok: false, message: TOO_MANY };

  // Quem já tem MFA precisa confirmar o código antes de trocar a senha.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp.find((f) => f.status === 'verified');
    if (!factor || !parsed.data.code) return { ok: false, message: 'Informe o código do aplicativo autenticador.' };
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: parsed.data.code });
    if (error) return { ok: false, message: 'Código do autenticador incorreto.' };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const reused = error.code === 'same_password';
    return { ok: false, message: reused ? 'Escolha uma senha diferente da atual.' : 'Não foi possível salvar a senha. Tente de novo.' };
  }
  // Invalida as outras sessões do usuário depois da troca de senha.
  await supabase.auth.signOut({ scope: 'others' });
  redirect('/admin/mfa');
}

export type MfaEnrollment = { factorId: string; qrCode: string; secret: string } | { error: string };

export async function startMfaEnrollment(): Promise<MfaEnrollment> {
  const session = await requireSessionForMfa();
  if (!session) return { error: 'Sua sessão expirou. Entre novamente.' };
  const { supabase } = session;

  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (factors?.totp.some((f) => f.status === 'verified')) return { error: 'O MFA já está ativo nesta conta.' };
  for (const factor of factors?.all ?? []) {
    if (factor.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    // O Supabase recusa dois fatores com o mesmo nome no mesmo usuário.
    friendlyName: `Painel ${Date.now()}`,
    issuer: session.site.settings.display_name,
  });
  if (error || !data) {
    console.error('Falha ao iniciar MFA', error?.code);
    return { error: 'Não foi possível iniciar o MFA. Tente de novo.' };
  }
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

const mfaSchema = z.object({
  factor_id: z.uuid(),
  code: z.string().trim().regex(/^[0-9]{6}$/),
});

export async function verifyMfa(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = mfaSchema.safeParse({ factor_id: formData.get('factor_id'), code: formData.get('code') });
  if (!parsed.success) return { ok: false, message: 'Digite os 6 números do aplicativo.' };

  const session = await requireSessionForMfa();
  if (!session) return { ok: false, message: 'Sua sessão expirou. Entre novamente.' };
  if (!(await isWithinRateLimit('mfa', session.user.id, 6, 300))) return { ok: false, message: TOO_MANY };

  const { error } = await session.supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factor_id,
    code: parsed.data.code,
  });
  if (error) {
    await logEvent(session.site.company.id, session.user.id, session.user.email ?? null, 'auth.mfa_failed');
    return { ok: false, message: 'Código incorreto. Confira o aplicativo e tente de novo.' };
  }
  await logEvent(session.site.company.id, session.user.id, session.user.email ?? null, 'auth.mfa_ok');
  redirect('/admin');
}

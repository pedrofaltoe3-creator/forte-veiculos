import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createSessionClient } from '@/lib/supabase/server';
import { getSite } from '@/lib/tenant';
import type { MemberRole, SiteData } from '@/lib/types';

export type AdminContext = {
  supabase: Awaited<ReturnType<typeof createSessionClient>>;
  userId: string;
  email: string;
  role: MemberRole;
  site: SiteData;
};

type GuardFailure = 'no-session' | 'no-access' | 'mfa-required';

// Validação de servidor usada por todas as páginas e ações do painel.
// getUser() confere o token no Supabase Auth; o papel vem do banco, nunca do navegador.
const loadContext = cache(async (): Promise<AdminContext | GuardFailure> => {
  const site = await getSite();
  if (!site) return 'no-access';

  const supabase = await createSessionClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return 'no-session';

  const { data: member } = await supabase
    .from('company_members')
    .select('role, is_active, profiles!inner(is_active)')
    .eq('company_id', site.company.id)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  const profile = member?.profiles as unknown as { is_active: boolean } | undefined;
  if (!member || !member.is_active || !profile?.is_active) return 'no-access';

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== 'aal2') return 'mfa-required';

  return { supabase, userId: auth.user.id, email: auth.user.email ?? '', role: member.role as MemberRole, site };
});

export async function requireAdminPage(requiredRole?: MemberRole): Promise<AdminContext> {
  const context = await loadContext();
  if (context === 'no-session') redirect('/admin/login');
  if (context === 'no-access') redirect('/admin/login?erro=sem-acesso');
  if (context === 'mfa-required') redirect('/admin/mfa');
  if (requiredRole && context.role !== requiredRole) redirect('/admin');
  return context;
}

export class AdminAccessError extends Error {}

export async function requireAdminAction(requiredRole?: MemberRole): Promise<AdminContext> {
  const context = await loadContext();
  if (typeof context === 'string') throw new AdminAccessError('Sua sessão expirou. Entre novamente.');
  if (requiredRole && context.role !== requiredRole) {
    throw new AdminAccessError('Você não tem permissão para esta operação.');
  }
  return context;
}

// Etapa anterior ao MFA: exige login e vínculo ativo, sem exigir aal2.
export async function requireSessionForMfa() {
  const site = await getSite();
  const supabase = await createSessionClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!site || !auth.user) return null;
  const { data: member } = await supabase
    .from('company_members')
    .select('role, is_active')
    .eq('company_id', site.company.id)
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (!member?.is_active) return null;
  return { supabase, user: auth.user, site };
}

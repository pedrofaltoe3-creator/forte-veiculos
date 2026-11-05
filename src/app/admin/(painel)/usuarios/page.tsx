import type { Metadata } from 'next';
import { InviteUserForm, MemberCard } from '@/components/admin/UserManagement';
import { requireAdminPage } from '@/lib/auth/guards';
import type { MemberRole } from '@/lib/types';

export const metadata: Metadata = { title: 'Usuários' };

export default async function UsersPage() {
  const { supabase, site, userId } = await requireAdminPage('master');
  const { data } = await supabase
    .from('company_members')
    .select('user_id, role, is_active, profiles!inner(email, full_name)')
    .eq('company_id', site.company.id)
    .order('created_at');

  const members = (data ?? []).map((row) => {
    const profile = row.profiles as unknown as { email: string; full_name: string | null };
    return {
      userId: row.user_id,
      email: profile.email,
      fullName: profile.full_name,
      role: row.role as MemberRole,
      active: row.is_active,
    };
  });

  return (
    <>
      <header className="a-head"><h1>Usuários</h1></header>
      <p className="muted a-lede">Só um administrador master cria acessos. O cadastro público é desativado. A pessoa recebe um link único para criar a senha e cadastra o MFA no primeiro login.</p>
      <InviteUserForm />
      <section className="a-section-gap" aria-label="Pessoas com acesso">
        <ul className="a-members">
          {members.map((member) => (
            <MemberCard key={member.userId} member={member} isSelf={member.userId === userId} />
          ))}
        </ul>
      </section>
    </>
  );
}

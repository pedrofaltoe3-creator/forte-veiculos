import Link from 'next/link';
import type { ReactNode } from 'react';
import { logout } from '@/app/admin/auth-actions';
import { AdminNav } from '@/components/admin/AdminNav';
import { requireAdminPage } from '@/lib/auth/guards';

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const { supabase, role, email, site } = await requireAdminPage();

  const { count: newLeads } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', site.company.id)
    .eq('status', 'new');

  const items = [
    { href: '/admin', label: 'Início' },
    { href: '/admin/veiculos', label: 'Veículos' },
    { href: '/admin/fotos', label: 'Fotos do site' },
    { href: '/admin/leads', label: 'Leads', badge: newLeads ?? 0 },
    { href: '/admin/configuracoes', label: 'Informações da loja' },
    ...(role === 'master'
      ? [
          { href: '/admin/historico', label: 'Histórico' },
          { href: '/admin/usuarios', label: 'Usuários' },
          { href: '/admin/tecnico', label: 'Ajustes técnicos' },
        ]
      : []),
    { href: '/admin/conta', label: 'Minha conta' },
  ];

  return (
    <div className="a-shell">
      <AdminNav
        items={items}
        footer={
          <>
            <p className="a-user" title={email}>
              {email}
              <span>{role === 'master' ? 'Administrador master' : 'Proprietário'}</span>
            </p>
            <Link href="/" target="_blank" className="a-side-link">Ver o site</Link>
            <form action={logout}>
              <button className="a-side-link a-side-button">Sair</button>
            </form>
          </>
        }
      />
      <main className="a-main">{children}</main>
    </div>
  );
}

import type { Metadata } from 'next';
import { logout } from '@/app/admin/auth-actions';
import { ChangePasswordForm } from '@/components/admin/SettingsForms';
import { requireAdminPage } from '@/lib/auth/guards';

export const metadata: Metadata = { title: 'Minha conta' };

export default async function AccountPage() {
  const { email, role } = await requireAdminPage();
  return (
    <>
      <header className="a-head"><h1>Minha conta</h1></header>
      <section className="a-card">
        <div className="a-card-head"><h2>Dados de acesso</h2></div>
        <dl className="a-dl">
          <div><dt>E-mail</dt><dd>{email}</dd></div>
          <div><dt>Permissão</dt><dd>{role === 'master' ? 'Administrador master' : 'Proprietário'}</dd></div>
          <div><dt>Verificação em duas etapas</dt><dd>Ativa</dd></div>
        </dl>
      </section>
      <section className="a-card a-section-gap">
        <div className="a-card-head"><h2>Alterar senha</h2></div>
        <ChangePasswordForm />
      </section>
      <section className="a-card a-section-gap">
        <div className="a-card-head"><h2>Sessões</h2></div>
        <p className="muted">Sair encerra o acesso em todos os aparelhos em que você entrou.</p>
        <form action={logout}>
          <button className="a-btn">Sair de todos os aparelhos</button>
        </form>
      </section>
    </>
  );
}

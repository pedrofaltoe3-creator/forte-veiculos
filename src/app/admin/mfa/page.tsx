import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { logout } from '@/app/admin/auth-actions';
import { MfaChallengeForm, MfaEnrollForm } from '@/components/admin/AuthForms';
import { requireSessionForMfa } from '@/lib/auth/guards';

export const metadata: Metadata = { title: 'Verificação em duas etapas' };

export default async function MfaPage() {
  const session = await requireSessionForMfa();
  if (!session) redirect('/admin/login?erro=sem-acesso');

  const { data: aal } = await session.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === 'aal2') redirect('/admin');

  const { data: factors } = await session.supabase.auth.mfa.listFactors();
  const factor = factors?.totp.find((item) => item.status === 'verified');

  return (
    <main className="auth-page">
      <div className="auth-card">
        <img src="/brand/logo.svg" alt="Forte Veículos" width="150" height="66" className="auth-logo" />
        <h1>Verificação em duas etapas</h1>
        {factor ? (
          <>
            <p className="muted">Abra o aplicativo autenticador e digite o código atual.</p>
            <MfaChallengeForm factorId={factor.id} />
          </>
        ) : (
          <>
            <p className="muted">Para proteger o painel, cada acesso pede um código do seu celular. Faça isso só uma vez.</p>
            <MfaEnrollForm />
          </>
        )}
        <form action={logout}>
          <button className="auth-link auth-link-button">Sair e usar outra conta</button>
        </form>
      </div>
    </main>
  );
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { NewPasswordForm } from '@/components/admin/AuthForms';
import { createSessionClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Criar senha' };

export default async function NewPasswordPage() {
  const supabase = await createSessionClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/admin/login?erro=link-invalido');

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const needsCode = aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2';

  return (
    <main className="auth-page">
      <div className="auth-card">
        <img src="/brand/logo.svg" alt="Forte Veículos" width="150" height="66" className="auth-logo" />
        <h1>Criar senha</h1>
        <p className="muted">Conta: {data.user.email}</p>
        <NewPasswordForm needsCode={needsCode} />
      </div>
    </main>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetForm } from '@/components/admin/AuthForms';
import { isEmailConfigured } from '@/lib/email';

export const metadata: Metadata = { title: 'Recuperar senha' };

// O aviso depende de o envio próprio estar ligado, o que muda pelas variáveis de ambiente.
export const dynamic = 'force-dynamic';

export default function RecoverPage() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <img src="/brand/logo.svg" alt="Forte Veículos" width="150" height="66" className="auth-logo" />
        <h1>Recuperar senha</h1>
        <p className="muted">Informe seu e-mail. Enviamos um link para criar uma nova senha.{isEmailConfigured() ? '' : ' Abra o link neste mesmo navegador.'}</p>
        <ResetForm />
        <Link className="auth-link" href="/admin/login">Voltar para o login</Link>
      </div>
    </main>
  );
}

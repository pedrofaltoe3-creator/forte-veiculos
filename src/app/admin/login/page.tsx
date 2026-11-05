import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from '@/components/admin/AuthForms';

export const metadata: Metadata = { title: 'Entrar' };

const MESSAGES: Record<string, string> = {
  'sem-acesso': 'Esta conta não tem acesso a este painel.',
  'link-invalido': 'Este link expirou, já foi usado ou foi aberto em outro navegador. Peça outro.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  const message = erro ? MESSAGES[erro] : undefined;
  return (
    <main className="auth-page">
      <div className="auth-card">
        <img src="/brand/logo.svg" alt="Forte Veículos" width="150" height="66" className="auth-logo" />
        <h1>Painel da loja</h1>
        {message && <p className="alert alert-error" role="alert">{message}</p>}
        <LoginForm />
        <Link className="auth-link" href="/admin/recuperar-senha">Esqueci minha senha</Link>
      </div>
    </main>
  );
}

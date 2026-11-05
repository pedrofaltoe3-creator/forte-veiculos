import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './admin.css';

// O painel nunca pode ser pré-renderizado: toda página depende da sessão de quem acessa.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Painel', template: '%s | Painel Forte Veículos' },
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return <div className="admin-root">{children}</div>;
}

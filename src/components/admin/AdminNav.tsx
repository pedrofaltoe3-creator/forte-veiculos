'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

type Item = { href: string; label: string; badge?: number };

export function AdminNav({ items, footer }: { items: Item[]; footer: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href));

  return (
    <aside className={`a-side${open ? ' is-open' : ''}`}>
      <div className="a-side-top">
        <Link href="/admin" className="a-logo" aria-label="Início do painel">
          <img src="/brand/logo.svg" alt="" width="112" height="50" />
        </Link>
        <button
          type="button"
          className="a-menu-toggle"
          aria-expanded={open}
          aria-controls="a-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Fechar' : 'Menu'}
        </button>
      </div>
      <div className="a-side-body" id="a-nav">
        <nav aria-label="Painel">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={isActive(item.href) ? 'is-active' : ''}
              aria-current={isActive(item.href) ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              {item.label}
              {item.badge ? <span className="a-nav-badge" aria-label={`${item.badge} novos`}>{item.badge}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="a-side-footer">{footer}</div>
      </div>
    </aside>
  );
}

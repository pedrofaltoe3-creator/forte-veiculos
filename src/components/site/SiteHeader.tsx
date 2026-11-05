'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/veiculos', label: 'Estoque' },
  { href: '/#avaliacao', label: 'Avaliar meu carro' },
  { href: '/#sobre', label: 'A loja' },
  { href: '/#localizacao', label: 'Onde estamos' },
  { href: '/#contato', label: 'Contato' },
];

export function SiteHeader({ whatsappHref, name }: { whatsappHref: string; name: string }) {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    let last = false;
    const onScroll = () => {
      const next = scrollY > 32;
      if (next !== last) {
        last = next;
        setSolid(next);
      }
    };
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    return () => removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    document.body.classList.toggle('menu-open', open);
    return () => document.body.classList.remove('menu-open');
  }, [open]);

  return (
    <header className={`site-header${solid || pathname !== '/' ? ' is-solid' : ''}${open ? ' is-open' : ''}`}>
      <Link href="/" className="site-logo" aria-label={`${name}, página inicial`}>
        <img src="/brand/logo.svg" alt="" width="148" height="66" />
      </Link>

      <nav aria-label="Principal" className="site-nav" id="menu-principal">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>
            {link.label}
          </Link>
        ))}
      </nav>

      <a className="btn btn-accent btn-small header-cta" href={whatsappHref} target="_blank" rel="noopener noreferrer">
        WhatsApp
      </a>

      <button
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="menu-principal"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sr-only">{open ? 'Fechar menu' : 'Abrir menu'}</span>
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
    </header>
  );
}

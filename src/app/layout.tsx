import type { Metadata, Viewport } from 'next';
import { Archivo, IBM_Plex_Mono, Instrument_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// next/font hospeda as fontes no próprio site: nenhuma requisição aos servidores do Google no navegador.
const display = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-display', display: 'swap' });
const body = Instrument_Sans({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

export const viewport: Viewport = { themeColor: '#06082B' };

export const metadata: Metadata = {
  title: 'Forte Veículos',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

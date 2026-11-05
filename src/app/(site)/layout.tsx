import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CookieConsent } from '@/components/site/CookieConsent';
import { MotionEngine } from '@/components/site/MotionEngine';
import { SiteFooter } from '@/components/site/SiteFooter';
import { SiteHeader } from '@/components/site/SiteHeader';
import { getPublicContext } from '@/lib/site-fallback';
import { siteImageUrl } from '@/lib/site-images';
import { getNonce } from '@/lib/tenant';
import { GENERAL_MESSAGE, whatsappLink } from '@/lib/whatsapp';
import './site.css';

export async function generateMetadata(): Promise<Metadata> {
  const { settings, siteUrl } = await getPublicContext();
  const city = settings.address_city ?? 'Cachoeiro de Itapemirim';
  const title = `${settings.display_name} | Seminovos em ${city}`;
  const description = `Carros seminovos e usados em ${city}, ${settings.address_state ?? 'ES'}. Compra, venda e troca com procedência e atendimento direto. Veja o estoque e fale pelo WhatsApp.`;
  return {
    metadataBase: new URL(siteUrl),
    title: { default: title, template: `%s | ${settings.display_name}` },
    description,
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      locale: 'pt_BR',
      siteName: settings.display_name,
      title,
      description,
      url: '/',
      images: [{ url: siteImageUrl(settings, 'compartilhar'), width: 1200, height: 675 }],
    },
    twitter: { card: 'summary_large_image' },
  };
}

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const { settings, technical } = await getPublicContext();
  const nonce = await getNonce();
  const whatsappHref = whatsappLink(settings.whatsapp, GENERAL_MESSAGE);

  return (
    <div className="site">
      <a href="#main" className="skip-link">Pular para o conteúdo</a>
      <noscript>
        <style>{`[data-reveal]{opacity:1!important;transform:none!important}.hero-track{display:none!important}.hero-static{display:grid!important}`}</style>
      </noscript>
      <div className="ambient" aria-hidden="true" />
      <MotionEngine />
      <SiteHeader whatsappHref={whatsappHref} name={settings.display_name} />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter settings={settings} technical={technical} />
      <a className="whatsapp-fab" href={whatsappHref} target="_blank" rel="noopener noreferrer" aria-label="Falar no WhatsApp">
        <svg viewBox="0 0 16 16" width="24" height="24" fill="currentColor" aria-hidden="true">
          <path d="M13.6 2.33A7.85 7.85 0 0 0 8 0 7.94 7.94 0 0 0 1.12 11.9L0 16l4.2-1.1A7.9 7.9 0 0 0 8 15.86 7.94 7.94 0 0 0 13.6 2.33ZM8 14.52a6.6 6.6 0 0 1-3.36-.92l-.24-.14-2.5.65.67-2.43-.16-.25A6.59 6.59 0 1 1 8 14.52Zm3.61-4.93c-.2-.1-1.17-.58-1.35-.65-.18-.06-.31-.1-.45.1-.13.2-.51.65-.62.78-.12.13-.24.15-.44.05-.2-.1-.84-.31-1.6-.99a6 6 0 0 1-1.1-1.37c-.12-.2-.01-.3.09-.4.09-.09.2-.23.3-.35.1-.11.13-.2.2-.33.06-.13.03-.25-.02-.35-.05-.1-.45-1.07-.61-1.47-.16-.39-.33-.33-.45-.34h-.38a.73.73 0 0 0-.53.25c-.18.2-.69.68-.69 1.65s.71 1.92.81 2.05c.1.13 1.4 2.13 3.38 2.99.47.2.84.33 1.13.42.47.15.9.13 1.25.08.38-.06 1.17-.48 1.34-.94.16-.47.16-.86.11-.95-.05-.08-.18-.13-.38-.23Z" />
        </svg>
      </a>
      <CookieConsent ga4Id={technical.ga4_id} metaPixelId={technical.meta_pixel_id} nonce={nonce} />
    </div>
  );
}

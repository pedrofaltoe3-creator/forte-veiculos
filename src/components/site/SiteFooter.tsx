import Link from 'next/link';
import { CookiePreferencesButton } from '@/components/site/CookieConsent';
import { fullAddress, socialHandle } from '@/lib/site-fallback';
import { usesGeneratedImages } from '@/lib/site-images';
import type { SiteSettings, TechnicalSettings } from '@/lib/types';
import { GENERAL_MESSAGE, whatsappLink } from '@/lib/whatsapp';

const NEXT_PG_INSTAGRAM = 'https://www.instagram.com/nextpg_/';

export function SiteFooter({ settings, technical }: { settings: SiteSettings; technical: TechnicalSettings }) {
  const handle = socialHandle(settings.instagram_url);
  const facebookHandle = socialHandle(settings.facebook_url);
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <div className="footer-brand">
          <img src="/brand/logo.svg" alt={settings.display_name} width="180" height="80" loading="lazy" />
          <p>Compra, venda e troca de seminovos e usados em {settings.address_city ?? 'Cachoeiro de Itapemirim'}.</p>
        </div>

        <div>
          <h2 className="footer-heading mono">Navegue</h2>
          <ul>
            <li><Link href="/veiculos">Estoque completo</Link></li>
            <li><Link href="/#avaliacao">Avaliar meu carro</Link></li>
            <li><Link href="/#sobre">A loja</Link></li>
            <li><Link href="/#contato">Contato</Link></li>
          </ul>
        </div>

        <div>
          <h2 className="footer-heading mono">Fale com a gente</h2>
          <ul>
            <li>
              <a href={whatsappLink(settings.whatsapp, GENERAL_MESSAGE)} target="_blank" rel="noopener noreferrer">
                WhatsApp {settings.phone_display}
              </a>
            </li>
            {settings.email && <li><a href={`mailto:${settings.email}`}>{settings.email}</a></li>}
            {settings.instagram_url && (
              <li><a href={settings.instagram_url} target="_blank" rel="noopener noreferrer">Instagram @{handle}</a></li>
            )}
            {settings.facebook_url && (
              <li>
                <a href={settings.facebook_url} target="_blank" rel="noopener noreferrer">
                  Facebook{facebookHandle ? ` @${facebookHandle}` : ''}
                </a>
              </li>
            )}
          </ul>
        </div>

        <div>
          <h2 className="footer-heading mono">Visite a loja</h2>
          <address>{fullAddress(settings)}</address>
          <ul className="footer-hours">
            {settings.hours.map((slot) => (
              <li key={slot.label}>
                {slot.label}: {slot.open.replace(':00', 'h')} às {slot.close.replace(':00', 'h')}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="footer-legal">
        <p>
          <Link className="owner-door" href="/admin" prefetch={false} rel="nofollow" aria-label="Entrar no painel da loja">©</Link>{' '}
          {new Date().getFullYear()} {technical.legal_name ?? settings.display_name}
          {technical.cnpj ? `, CNPJ ${technical.cnpj}` : ''}. Todos os direitos reservados.
        </p>
        <p className="footer-note">
          {usesGeneratedImages(settings) && 'Imagens de abertura e de apoio são ilustrativas e geradas por inteligência artificial. '}
          As fotos dos veículos do estoque são reais. Preços e disponibilidade sujeitos a alteração sem aviso.
        </p>
        <div className="footer-legal-links">
          <Link href="/politica-de-privacidade">Política de Privacidade</Link>
          <Link href="/politica-de-cookies">Política de Cookies</Link>
          <CookiePreferencesButton className="link-button" />
          <a className="credit" href={NEXT_PG_INSTAGRAM} target="_blank" rel="noopener noreferrer">
            <span>Desenvolvido pela Next PG</span>
            <img src="/brand/nextpg-logo.webp" alt="" width="94" height="18" decoding="async" />
          </a>
        </div>
      </div>
    </footer>
  );
}

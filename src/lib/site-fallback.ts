import 'server-only';
import { env } from '@/lib/env';
import { getSite } from '@/lib/tenant';
import type { SiteSettings, TechnicalSettings } from '@/lib/types';

// Se o banco estiver fora do ar, o site continua mostrando os contatos reais da loja.
const FALLBACK_SETTINGS: SiteSettings = {
  company_id: '',
  display_name: 'Forte Veículos',
  whatsapp: '5528999097412',
  phone_display: '(28) 99909-7412',
  email: null,
  address_street: 'Avenida Jones dos Santos Neves, 673',
  address_district: 'Otton Marins',
  address_city: 'Cachoeiro de Itapemirim',
  address_state: 'ES',
  address_zip: '29317-022',
  hours: [
    { days: [1, 2, 3, 4, 5], open: '08:00', close: '18:00', label: 'Segunda a sexta' },
    { days: [6], open: '08:00', close: '12:00', label: 'Sábado' },
  ],
  instagram_url: 'https://www.instagram.com/forteveiculoscachoeiro',
  facebook_url: 'https://www.facebook.com/joserobertovianafilho.roberto',
  about_text:
    'A Forte Veículos trabalha com compra, venda e troca de seminovos e usados em Cachoeiro de Itapemirim. Carros selecionados, procedência garantida e atendimento direto, do primeiro contato até a entrega das chaves.',
  images: {},
};

const FALLBACK_TECHNICAL: TechnicalSettings = {
  company_id: '',
  canonical_url: null,
  ga4_id: null,
  meta_pixel_id: null,
  legal_name: null,
  cnpj: null,
  dpo_name: null,
  dpo_email: null,
};

export async function getPublicContext() {
  const site = await getSite();
  const technical = site?.technical ?? FALLBACK_TECHNICAL;
  return {
    companyId: site?.company.id ?? null,
    settings: site?.settings ?? FALLBACK_SETTINGS,
    technical,
    siteUrl: (technical.canonical_url && process.env.NODE_ENV === 'production' ? technical.canonical_url : env.siteUrl).replace(/\/$/, ''),
  };
}

export const fullAddress = (s: SiteSettings) =>
  [s.address_street, s.address_district, [s.address_city, s.address_state].filter(Boolean).join(' - '), s.address_zip]
    .filter(Boolean)
    .join(', ');

export const socialHandle = (url: string | null) => {
  const handle = url?.replace(/\/$/, '').split('/').pop();
  return handle && !handle.includes('.php') ? handle : null;
};

import 'server-only';
import type { SiteSettings } from '@/lib/types';
import { photoUrl } from '@/lib/vehicles';

type SlotConfig = {
  label: string;
  hint: string;
  original: string;
  // Tamanho final da foto. "cover" corta para a proporção do espaço; "inside" mantém a foto inteira.
  output: { width: number; height: number; fit: 'cover' | 'inside' };
  // A foto original foi gerada por inteligência artificial e o rodapé precisa avisar enquanto ela estiver no site.
  generated: boolean;
};

export const SITE_IMAGE_SLOTS = {
  abertura: {
    label: 'Abertura do site',
    hint: 'Topo da página inicial. Ao trocar, o vídeo de abertura sai e fica esta foto. Voltar à original traz o vídeo de volta.',
    original: '/hero/hero-ending-1100.webp',
    output: { width: 2000, height: 2000, fit: 'inside' },
    generated: true,
  },
  fachada: {
    label: 'Fachada da loja',
    hint: 'Fundo da seção "A loja", na página inicial.',
    original: '/images/fachada.jpg',
    output: { width: 2000, height: 2000, fit: 'inside' },
    generated: false,
  },
  comprar: {
    label: 'Comprar',
    hint: 'Cartão "Comprar", em Compra, venda e troca.',
    original: '/images/comprar.webp',
    output: { width: 1200, height: 800, fit: 'cover' },
    generated: true,
  },
  vender: {
    label: 'Vender',
    hint: 'Cartão "Vender", em Compra, venda e troca.',
    original: '/images/vender.webp',
    output: { width: 1200, height: 800, fit: 'cover' },
    generated: true,
  },
  trocar: {
    label: 'Trocar',
    hint: 'Cartão "Trocar", em Compra, venda e troca.',
    original: '/images/trocar.webp',
    output: { width: 1200, height: 800, fit: 'cover' },
    generated: true,
  },
  compartilhar: {
    label: 'Ao compartilhar o site',
    hint: 'Aparece quando alguém manda o link do site no WhatsApp ou em redes sociais.',
    original: '/images/og-forte.jpg',
    output: { width: 1200, height: 675, fit: 'cover' },
    generated: false,
  },
} satisfies Record<string, SlotConfig>;

export type SiteImageSlot = keyof typeof SITE_IMAGE_SLOTS;

export const SITE_IMAGE_SLOT_NAMES = Object.keys(SITE_IMAGE_SLOTS) as SiteImageSlot[];

export const isSiteImageSlot = (value: string): value is SiteImageSlot => Object.hasOwn(SITE_IMAGE_SLOTS, value);

export const hasCustomImage = (settings: SiteSettings, slot: SiteImageSlot) => Boolean(settings.images?.[slot]);

export function siteImageUrl(settings: SiteSettings, slot: SiteImageSlot): string {
  const path = settings.images?.[slot];
  return path ? photoUrl(path) : SITE_IMAGE_SLOTS[slot].original;
}

export const usesGeneratedImages = (settings: SiteSettings) =>
  SITE_IMAGE_SLOT_NAMES.some((slot) => SITE_IMAGE_SLOTS[slot].generated && !hasCustomImage(settings, slot));

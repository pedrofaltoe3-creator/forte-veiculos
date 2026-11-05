import { currentPriceCents, formatPrice, vehicleTitle } from './format';

export function whatsappLink(number: string, message?: string): string {
  const digits = number.replace(/\D/g, '');
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

export function vehicleInterestMessage(
  vehicle: { brand: string; model: string; version?: string | null; model_year: number; price_cents: number; offer_price_cents?: number | null; offer_until?: string | null; slug: string },
  siteUrl: string,
): string {
  const url = `${siteUrl.replace(/\/$/, '')}/veiculos/${vehicle.slug}`;
  return `Olá! Tenho interesse no ${vehicleTitle(vehicle)}, anunciado por ${formatPrice(currentPriceCents(vehicle))}. ${url}`;
}

export const GENERAL_MESSAGE = 'Olá! Vim pelo site da Forte Veículos e queria falar sobre um carro.';
export const EVALUATION_MESSAGE = 'Olá! Quero avaliar meu carro na Forte Veículos.';

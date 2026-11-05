import type {
  LeadStatus,
  LeadType,
  PaymentMethod,
  VehicleCategory,
  VehicleFuel,
  VehicleStatus,
  VehicleTransmission,
} from './types';

export const CATEGORY_LABEL: Record<VehicleCategory, string> = {
  suv: 'SUV',
  sedan: 'Sedã',
  hatch: 'Hatch',
  pickup: 'Picape',
  premium: 'Premium',
  other: 'Outros',
};

export const TRANSMISSION_LABEL: Record<VehicleTransmission, string> = {
  automatic: 'Automático',
  manual: 'Manual',
  cvt: 'CVT',
  automated: 'Automatizado',
};

export const FUEL_LABEL: Record<VehicleFuel, string> = {
  flex: 'Flex',
  gasoline: 'Gasolina',
  ethanol: 'Etanol',
  diesel: 'Diesel',
  hybrid: 'Híbrido',
  electric: 'Elétrico',
};

export const STATUS_LABEL: Record<VehicleStatus, string> = {
  draft: 'Rascunho',
  available: 'Disponível',
  reserved: 'Reservado',
  sold: 'Vendido',
};

export const LEAD_TYPE_LABEL: Record<LeadType, string> = {
  contact: 'Contato',
  vehicle_interest: 'Interesse em veículo',
  evaluation: 'Avaliação de usado',
};

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'Novo',
  in_progress: 'Em andamento',
  answered: 'Atendimento concluído',
  won: 'Fechado',
  lost: 'Perdido',
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  card: 'Cartão',
  financing: 'Financiamento',
  trade_in: 'Troca',
  transfer: 'Transferência',
  other: 'Outro',
};

export const todayInBrazil = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

type OfferFields = { price_cents: number; offer_price_cents?: number | null; offer_until?: string | null };

// Preço de oferta só vale até a data informada e abaixo do preço normal.
export function activeOfferCents(vehicle: OfferFields, today = todayInBrazil()): number | null {
  const offer = vehicle.offer_price_cents;
  if (offer == null || offer >= vehicle.price_cents) return null;
  if (vehicle.offer_until && vehicle.offer_until < today) return null;
  return offer;
}

export const currentPriceCents = (vehicle: OfferFields) => activeOfferCents(vehicle) ?? vehicle.price_cents;

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export const formatPrice = (cents: number) => brl.format(Math.round(cents / 100));

export const formatKm = (km: number | null | undefined) =>
  km == null ? null : `${new Intl.NumberFormat('pt-BR').format(km)} km`;

// Data sem horário, como a validade da oferta e a data da venda.
export const formatDay = (value: string) => value.slice(0, 10).split('-').reverse().join('/');

export const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));

export const vehicleName = (v: { brand: string; model: string; version?: string | null }) =>
  [v.brand, v.model, v.version].filter(Boolean).join(' ');

export const vehicleTitle = (v: { brand: string; model: string; version?: string | null; model_year: number }) =>
  `${vehicleName(v)} ${v.model_year}`;

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 130);
}

// "R$ 129.990,00", "129990" e "129.990" viram centavos.
export function parsePriceToCents(input: string): number | null {
  const clean = input.replace(/[^\d,.]/g, '');
  if (!clean) return null;
  let normalized = clean;
  if (clean.includes(',')) {
    normalized = clean.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(clean)) {
    normalized = clean.replace(/\./g, '');
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

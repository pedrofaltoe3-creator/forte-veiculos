import { z } from 'zod';
import { parsePriceToCents } from './format';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => (v === '' ? null : v)).nullable().optional();

const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v.length >= 10 && v.length <= 13, 'Informe um telefone com DDD.');

const optionalEmail = z
  .string()
  .trim()
  .max(180)
  .refine((v) => v === '' || z.email().safeParse(v).success, 'E-mail inválido.')
  .transform((v) => (v === '' ? null : v.toLowerCase()));

export const CURRENT_YEAR = new Date().getFullYear();

// Formulários públicos ---------------------------------------------------------

const leadBase = {
  name: text(120).min(2, 'Informe seu nome.'),
  phone,
  email: optionalEmail,
  consent: z.literal('on', { error: 'É preciso concordar para enviarmos sua mensagem.' }),
};

export const contactLeadSchema = z.object({
  ...leadBase,
  message: text(2000).min(5, 'Escreva sua mensagem.'),
});

export const vehicleLeadSchema = z.object({
  ...leadBase,
  message: text(2000).optional().default(''),
  vehicle_slug: z.string().regex(/^[a-z0-9-]{1,140}$/),
});

export const evaluationLeadSchema = z.object({
  ...leadBase,
  brand: text(60).min(1, 'Informe a marca.'),
  model: text(80).min(1, 'Informe o modelo.'),
  year: z.coerce.number().int().min(1950, 'Ano inválido.').max(CURRENT_YEAR + 1, 'Ano inválido.'),
  mileage_km: z.coerce.number().int().min(0, 'Quilometragem inválida.').max(3_000_000, 'Quilometragem inválida.'),
  intent: z.enum(['vender', 'trocar']),
  message: text(1000).optional().default(''),
});

// Painel --------------------------------------------------------------------------

const MAX_CENTS = 10_000_000_000;

const requiredPrice = (message: string) =>
  z.string().transform((v, ctx) => {
    const cents = parsePriceToCents(v);
    if (cents === null || cents <= 0 || cents > MAX_CENTS) {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    }
    return cents;
  });

const optionalPrice = (message: string) =>
  z
    .string()
    .optional()
    .default('')
    .transform((v, ctx) => {
      if (v.trim() === '') return null;
      const cents = parsePriceToCents(v);
      if (cents === null || cents < 0 || cents > MAX_CENTS) {
        ctx.addIssue({ code: 'custom', message });
        return z.NEVER;
      }
      return cents;
    });

const isDate = (v: string) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const requiredDate = z.string().refine(isDate, 'Informe a data.');
const optionalDate = z
  .string()
  .optional()
  .default('')
  .refine((v) => v === '' || isDate(v), 'Data inválida.')
  .transform((v) => (v === '' ? null : v));

export const vehicleSchema = z.object({
  brand: text(60).min(1, 'Informe a marca.'),
  model: text(80).min(1, 'Informe o modelo.'),
  version: optionalText(120),
  category: z.enum(['suv', 'sedan', 'hatch', 'pickup', 'premium', 'other']),
  model_year: z.coerce.number().int().min(1950, 'Ano inválido.').max(CURRENT_YEAR + 2, 'Ano inválido.'),
  mileage_km: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .transform((v) => (v === '' ? null : Number(v)))
    .refine((v) => v === null || v <= 3_000_000, 'Quilometragem inválida.'),
  transmission: z
    .enum(['automatic', 'manual', 'cvt', 'automated', ''])
    .transform((v) => (v === '' ? null : v)),
  fuel: z
    .enum(['flex', 'gasoline', 'ethanol', 'diesel', 'hybrid', 'electric', ''])
    .transform((v) => (v === '' ? null : v)),
  color: optionalText(40),
  price: requiredPrice('Informe um preço válido.'),
  offer_price: optionalPrice('Informe um preço de oferta válido.'),
  offer_until: optionalDate,
  purchase_cost: optionalPrice('Informe um custo válido.'),
  fipe_code: optionalText(20),
  fipe_price_cents: z.string().optional().default('').transform((v) => (/^[0-9]{1,12}$/.test(v) ? Number(v) : null)),
  fipe_reference: optionalText(40),
  description: optionalText(6000),
  features: z
    .string()
    .max(4000)
    .transform((v) =>
      v
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 60),
    ),
  status: z.enum(['draft', 'available', 'reserved', 'sold']),
  is_featured: z
    .string()
    .optional()
    .transform((v) => v === 'on'),
}).refine((v) => v.offer_price === null || v.offer_price < v.price, {
  path: ['offer_price'],
  message: 'A oferta precisa ser menor que o preço.',
});

export const saleSchema = z.object({
  vehicle_id: z.uuid('Escolha o carro.'),
  amount: requiredPrice('Informe o valor da venda.'),
  sold_on: requiredDate,
  payment_method: z.enum(['pix', 'cash', 'card', 'financing', 'trade_in', 'transfer', 'other']),
  cost: optionalPrice('Informe um custo válido.'),
});

export const financialEntrySchema = z.object({
  kind: z.enum(['income', 'expense']),
  description: text(200).min(2, 'Descreva o lançamento.'),
  amount: requiredPrice('Informe o valor.'),
  occurred_on: requiredDate,
});

export const siteSettingsSchema = z.object({
  display_name: text(120).min(2, 'Informe o nome.'),
  whatsapp: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => /^[0-9]{10,13}$/.test(v), 'Informe o WhatsApp com DDI e DDD, por exemplo 5528999097412.'),
  phone_display: optionalText(30),
  email: optionalEmail,
  address_street: optionalText(160),
  address_district: optionalText(80),
  address_city: optionalText(80),
  address_state: optionalText(2),
  address_zip: optionalText(10),
  hours_week: optionalText(40),
  hours_saturday: optionalText(40),
  instagram_url: z
    .string()
    .trim()
    .refine((v) => v === '' || /^https:\/\/(www\.)?instagram\.com\//.test(v), 'Use o link completo do Instagram.')
    .transform((v) => (v === '' ? null : v)),
  facebook_url: z
    .string()
    .trim()
    .refine((v) => v === '' || /^https:\/\/(www\.)?facebook\.com\//.test(v), 'Use o link completo do Facebook.')
    .transform((v) => (v === '' ? null : v)),
  about_text: optionalText(2000),
});

export const technicalSettingsSchema = z.object({
  canonical_url: z
    .string()
    .trim()
    .refine((v) => v === '' || /^https?:\/\/[^\s]+$/.test(v), 'Informe uma URL válida.')
    .transform((v) => (v === '' ? null : v.replace(/\/$/, ''))),
  ga4_id: z
    .string()
    .trim()
    .refine((v) => v === '' || /^G-[A-Z0-9]{4,20}$/.test(v), 'Formato esperado: G-XXXXXXXXXX.')
    .transform((v) => (v === '' ? null : v)),
  meta_pixel_id: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[0-9]{6,20}$/.test(v), 'O Pixel ID contém só números.')
    .transform((v) => (v === '' ? null : v)),
  legal_name: optionalText(160),
  cnpj: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[0-9]{2}\.[0-9]{3}\.[0-9]{3}\/[0-9]{4}-[0-9]{2}$/.test(v), 'Formato: 00.000.000/0000-00.')
    .transform((v) => (v === '' ? null : v)),
  dpo_name: optionalText(120),
  dpo_email: optionalEmail,
});

export const instagramPermalinkSchema = z
  .string()
  .trim()
  .transform((v) => v.match(/^https:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(p|reels?)\/([A-Za-z0-9_-]+)/))
  .refine((match) => match !== null, 'Cole o link de uma publicação do Instagram.')
  .transform((match) => `https://www.instagram.com/${match![1] === 'p' ? 'p' : 'reel'}/${match![2]}/`);

export const passwordSchema = z
  .string()
  .min(12, 'Use ao menos 12 caracteres.')
  .max(128)
  .regex(/[a-zA-Z]/, 'Inclua letras.')
  .regex(/[0-9]/, 'Inclua números.');

export const inviteUserSchema = z.object({
  email: z.email('E-mail inválido.').max(180),
  full_name: text(120).min(2, 'Informe o nome.'),
  role: z.enum(['master', 'owner']),
});

export const LEAD_CONSENT_VERSION = '2026-11';
export const COOKIE_POLICY_VERSION = '2026-11';

export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    result[key] ??= issue.message;
  }
  return result;
}

// Assinatura real do arquivo: não confiamos na extensão nem no Content-Type enviados.
export function detectImageType(bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

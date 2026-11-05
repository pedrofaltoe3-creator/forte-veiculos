import { describe, expect, it } from 'vitest';
import { formatKm, formatPrice, parsePriceToCents, slugify, vehicleTitle } from '../../src/lib/format';
import { vehicleInterestMessage, whatsappLink } from '../../src/lib/whatsapp';
import {
  contactLeadSchema,
  detectImageType,
  evaluationLeadSchema,
  instagramPermalinkSchema,
  inviteUserSchema,
  passwordSchema,
  technicalSettingsSchema,
  vehicleSchema,
} from '../../src/lib/validation';

const validVehicle = {
  brand: 'Toyota',
  model: 'Corolla',
  version: 'XEi',
  category: 'sedan',
  model_year: '2023',
  mileage_km: '12.000',
  transmission: 'automatic',
  fuel: 'flex',
  color: 'Preto',
  price: '129.990,00',
  description: '',
  features: 'Câmera de ré\n\n  Teto solar  ',
  status: 'available',
};

describe('preço', () => {
  it.each([
    ['129990', 12999000],
    ['129.990', 12999000],
    ['129.990,00', 12999000],
    ['R$ 129.990,50', 12999050],
    ['99,9', 9990],
  ])('%s vira %i centavos', (input, cents) => {
    expect(parsePriceToCents(input)).toBe(cents);
  });

  it('texto sem número é inválido', () => {
    expect(parsePriceToCents('abc')).toBeNull();
  });

  it('formata em reais', () => {
    expect(formatPrice(12999000).replace(/\s/g, ' ')).toBe('R$ 129.990');
    expect(formatKm(62000)).toBe('62.000 km');
    expect(formatKm(null)).toBeNull();
  });
});

describe('slug', () => {
  it('gera endereço amigável sem acento', () => {
    expect(slugify('Volkswagen Fox Xtreme 1.6 São Paulo 2020')).toBe('volkswagen-fox-xtreme-1-6-sao-paulo-2020');
    expect(slugify('  <script>alert(1)</script>  ')).toBe('script-alert-1-script');
  });
});

describe('WhatsApp', () => {
  const vehicle = { brand: 'Toyota', model: 'Corolla', version: 'XEi', model_year: 2023, price_cents: 12999000, slug: 'corolla-xei-2023' };

  it('monta o link com a mensagem do veículo', () => {
    const message = vehicleInterestMessage(vehicle, 'https://exemplo.com.br/');
    expect(message).toContain(vehicleTitle(vehicle));
    expect(message).toContain('https://exemplo.com.br/veiculos/corolla-xei-2023');
    const link = whatsappLink('(55) 28 99909-7412', message);
    expect(link.startsWith('https://wa.me/5528999097412?text=')).toBe(true);
    expect(decodeURIComponent(link)).toContain('Corolla');
  });
});

describe('formulários públicos', () => {
  const lead = { name: 'Maria', phone: '(28) 99999-1234', email: '', message: 'Quero saber do carro', consent: 'on' };

  it('aceita dados válidos e normaliza o telefone', () => {
    const parsed = contactLeadSchema.parse(lead);
    expect(parsed.phone).toBe('28999991234');
    expect(parsed.email).toBeNull();
  });

  it('exige consentimento', () => {
    expect(contactLeadSchema.safeParse({ ...lead, consent: undefined }).success).toBe(false);
  });

  it('recusa telefone curto e e-mail inválido', () => {
    expect(contactLeadSchema.safeParse({ ...lead, phone: '123' }).success).toBe(false);
    expect(contactLeadSchema.safeParse({ ...lead, email: 'nao-e-email' }).success).toBe(false);
  });

  it('avaliação recusa ano e quilometragem fora da faixa', () => {
    const base = { ...lead, brand: 'Fiat', model: 'Uno', year: '2018', mileage_km: '80000', intent: 'vender' };
    expect(evaluationLeadSchema.safeParse(base).success).toBe(true);
    expect(evaluationLeadSchema.safeParse({ ...base, year: '1800' }).success).toBe(false);
    expect(evaluationLeadSchema.safeParse({ ...base, mileage_km: '-5' }).success).toBe(false);
    expect(evaluationLeadSchema.safeParse({ ...base, intent: 'roubar' }).success).toBe(false);
  });
});

describe('veículo', () => {
  it('normaliza os campos do formulário', () => {
    const parsed = vehicleSchema.parse(validVehicle);
    expect(parsed.price).toBe(12999000);
    expect(parsed.mileage_km).toBe(12000);
    expect(parsed.features).toEqual(['Câmera de ré', 'Teto solar']);
    expect(parsed.is_featured).toBe(false);
    expect(parsed.description).toBeNull();
  });

  it('campos vazios viram nulos e checkbox marcado vira verdadeiro', () => {
    const parsed = vehicleSchema.parse({ ...validVehicle, mileage_km: '', transmission: '', fuel: '', is_featured: 'on' });
    expect(parsed.mileage_km).toBeNull();
    expect(parsed.transmission).toBeNull();
    expect(parsed.fuel).toBeNull();
    expect(parsed.is_featured).toBe(true);
  });

  it('recusa valores fora do domínio', () => {
    expect(vehicleSchema.safeParse({ ...validVehicle, price: 'abc' }).success).toBe(false);
    expect(vehicleSchema.safeParse({ ...validVehicle, price: '0' }).success).toBe(false);
    expect(vehicleSchema.safeParse({ ...validVehicle, status: 'apagado' }).success).toBe(false);
    expect(vehicleSchema.safeParse({ ...validVehicle, category: 'trator' }).success).toBe(false);
    expect(vehicleSchema.safeParse({ ...validVehicle, model_year: '1900' }).success).toBe(false);
  });
});

describe('painel', () => {
  it('senha fraca é recusada', () => {
    expect(passwordSchema.safeParse('curta1').success).toBe(false);
    expect(passwordSchema.safeParse('somenteletrasaqui').success).toBe(false);
    expect(passwordSchema.safeParse('123456789012').success).toBe(false);
    expect(passwordSchema.safeParse('uma-senha-forte-2026').success).toBe(true);
  });

  it('convite aceita só papéis conhecidos', () => {
    const base = { email: 'pessoa@exemplo.com', full_name: 'Pessoa' };
    expect(inviteUserSchema.safeParse({ ...base, role: 'owner' }).success).toBe(true);
    expect(inviteUserSchema.safeParse({ ...base, role: 'superadmin' }).success).toBe(false);
  });

  it('ajustes técnicos validam formatos', () => {
    const base = { canonical_url: '', ga4_id: '', meta_pixel_id: '', legal_name: '', cnpj: '', dpo_name: '', dpo_email: '' };
    expect(technicalSettingsSchema.safeParse(base).success).toBe(true);
    expect(technicalSettingsSchema.safeParse({ ...base, ga4_id: 'errado' }).success).toBe(false);
    expect(technicalSettingsSchema.safeParse({ ...base, meta_pixel_id: 'abc' }).success).toBe(false);
    expect(technicalSettingsSchema.safeParse({ ...base, cnpj: '123' }).success).toBe(false);
    expect(technicalSettingsSchema.parse({ ...base, canonical_url: 'https://exemplo.com.br/' }).canonical_url).toBe('https://exemplo.com.br');
  });

  it('publicação do Instagram aceita só links do próprio Instagram', () => {
    expect(instagramPermalinkSchema.parse('https://www.instagram.com/p/ABC123/?igsh=xyz')).toBe('https://www.instagram.com/p/ABC123/');
    expect(instagramPermalinkSchema.safeParse('https://site-malicioso.test/p/ABC').success).toBe(false);
    expect(instagramPermalinkSchema.safeParse('javascript:alert(1)').success).toBe(false);
  });
});

describe('assinatura de arquivos', () => {
  it('reconhece imagens pelos primeiros bytes', () => {
    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(detectImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('webp');
  });

  it('recusa HTML, SVG e executáveis com nome de imagem', () => {
    const text = new TextEncoder();
    expect(detectImageType(text.encode('<html>'))).toBeNull();
    expect(detectImageType(text.encode('<svg xmlns='))).toBeNull();
    expect(detectImageType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
  });
});

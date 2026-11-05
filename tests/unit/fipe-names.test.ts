import { describe, expect, it } from 'vitest';
import {
  brandDisplayName,
  brlTextToCents,
  categoryFromSegment,
  fuelFromText,
  groupFipeModels,
  parsePlacaFipeText,
  splitModelName,
  transmissionFromText,
} from '../../src/lib/fipe-names';
import { activeOfferCents, currentPriceCents } from '../../src/lib/format';
import { instagramPermalinkSchema, vehicleSchema } from '../../src/lib/validation';

describe('nomes da tabela FIPE', () => {
  it('marca vira o nome usado no site e nos filtros', () => {
    expect(brandDisplayName('GM - Chevrolet')).toBe('Chevrolet');
    expect(brandDisplayName('VW - VolksWagen')).toBe('Volkswagen');
    expect(brandDisplayName('VW')).toBe('Volkswagen');
    expect(brandDisplayName('Kia Motors')).toBe('Kia');
    expect(brandDisplayName('KIA MOTORS')).toBe('Kia');
    expect(brandDisplayName('I/KIA')).toBe('Kia');
    expect(brandDisplayName('LAMBORGHINI')).toBe('Lamborghini');
    expect(brandDisplayName('GREAT WALL')).toBe('Great Wall');
    expect(brandDisplayName('BMW')).toBe('BMW');
    expect(brandDisplayName('Toyota')).toBe('Toyota');
    expect(brandDisplayName('Mercedes-Benz')).toBe('Mercedes-Benz');
  });

  it('separa modelo e versão', () => {
    expect(splitModelName('Corolla XEi 2.0 Flex 16V Aut.')).toEqual({ model: 'Corolla', version: 'XEi 2.0 Flex 16V Aut.' });
    expect(splitModelName('Grand Siena 1.0 EVO Flex 8V 4p')).toEqual({ model: 'Grand Siena', version: '1.0 EVO Flex 8V 4p' });
    expect(splitModelName('CROSSFOX 1.6 Mi Total Flex 8V 5p')).toEqual({ model: 'Crossfox', version: '1.6 Mi Total Flex 8V 5p' });
    expect(splitModelName('HB20 Comfort 1.0 Flex')).toEqual({ model: 'HB20', version: 'Comfort 1.0 Flex' });
    expect(splitModelName('Uno')).toEqual({ model: 'Uno', version: '' });
    expect(splitModelName('Strada/ Adventure 1.8 Flex')).toEqual({ model: 'Strada', version: 'Adventure 1.8 Flex' });
  });

  it('agrupa as versões de um modelo, sem diferenciar maiúsculas', () => {
    const groups = groupFipeModels([
      { code: '1', name: 'Gol 1.0 Flex' },
      { code: '2', name: 'GOL 1.6 Flex' },
      { code: '3', name: 'Amarok CD 2.0' },
    ]);
    expect([...groups.keys()]).toEqual(['Amarok', 'Gol']);
    expect(groups.get('Gol')).toEqual([{ code: '1', version: '1.0 Flex' }, { code: '2', version: '1.6 Flex' }]);
  });

  it('reconhece combustível, câmbio, categoria e valor', () => {
    expect(fuelFromText('Álcool / Gasolina')).toBe('flex');
    expect(fuelFromText('Gasolina')).toBe('gasoline');
    expect(fuelFromText('Diesel')).toBe('diesel');
    expect(fuelFromText('Híbrido')).toBe('hybrid');
    expect(fuelFromText(null, 'Onix 1.0 Flex 12V')).toBe('flex');
    expect(fuelFromText('')).toBeNull();
    expect(transmissionFromText('Civic EXL 2.0 Aut.')).toBe('automatic');
    expect(transmissionFromText('Argo 1.0 Mec.')).toBe('manual');
    expect(transmissionFromText('Corolla 2.0 CVT')).toBe('cvt');
    expect(transmissionFromText('Punto 1.8 Dualogic')).toBe('automated');
    expect(transmissionFromText('Uno 1.0')).toBeNull();
    expect(categoryFromSegment('AU - HATCH PEQUENO')).toBe('hatch');
    expect(categoryFromSegment('AU - SEDAN MEDIO')).toBe('sedan');
    expect(categoryFromSegment('Moto')).toBeNull();
    expect(brlTextToCents('R$ 28.799,00')).toBe(2879900);
    expect(brlTextToCents(undefined)).toBeNull();
  });
});

describe('texto copiado do Placa FIPE', () => {
  const page = `Placa INT-8C36
Detalhes do carro com placa INT-8C36
Foram registrados 115.603 carros da mesma marca e modelo em todo o Brasil.
VOLKSWAGEN
Marca: VOLKSWAGEN
Genérico: Crossfox
Modelo: CROSSFOX
Importado: Não
Ano: 2007
Ano Modelo: 2008
Cor: Prata
Cilindrada: 1599 cc
Combustível: Álcool / Gasolina
Chassi: *****4110137
Município: SAO LEOPOLDO
Valores FIPE para o carro INT8C36
As informações de valores são referentes à Tabela FIPE de Novembro 2026, que corresponde à última tabela disponível.
Código FIPE\tModelo\tValor
005225-6\tCROSSFOX 1.6 Mi Total Flex 8V 5p\tR$ 29.285,00
Valor Venal: R$ 28.780,00`;

  it('lê os dados do carro e deixa o resto de fora', () => {
    expect(parsePlacaFipeText(page)).toEqual({
      brand: 'Volkswagen',
      model: 'Crossfox',
      version: '1.6 Mi Total Flex 8V 5p',
      year: 2008,
      color: 'Prata',
      fuel: 'flex',
      transmission: null,
      fipe: { code: '005225-6', priceCents: 2928500, reference: 'Novembro 2026' },
      fipeOptions: 1,
    });
  });

  it('funciona quando a tabela vem em linhas separadas e avisa quantas versões vieram', () => {
    const data = parsePlacaFipeText('Marca: HONDA\nModelo: CIVIC\nAno Modelo: 2020\n001-1\n005225-6\nCivic EXL 2.0 Aut.\nR$ 100.000,00\n005226-1\nCivic LX 1.8 Mec.\nR$ 90.000,00');
    expect(data?.fipeOptions).toBe(2);
    expect(data?.model).toBe('Civic');
    expect(data?.transmission).toBe('automatic');
    expect(data?.fipe?.priceCents).toBe(10000000);
  });

  it('sem tabela FIPE usa o modelo da ficha', () => {
    const data = parsePlacaFipeText('Marca: FIAT\nGenérico: Uno\nModelo: UNO MILLE\nAno: 2010');
    expect(data).toMatchObject({ brand: 'Fiat', model: 'Uno', version: '', year: 2010, fipe: null });
  });

  it('texto que não é da página não preenche nada', () => {
    expect(parsePlacaFipeText('um texto qualquer')).toBeNull();
    expect(parsePlacaFipeText('')).toBeNull();
  });
});

describe('oferta', () => {
  const car = { price_cents: 10000000 };

  it('vale abaixo do preço e até a data', () => {
    expect(activeOfferCents({ ...car, offer_price_cents: 9000000 }, '2026-11-03')).toBe(9000000);
    expect(activeOfferCents({ ...car, offer_price_cents: 9000000, offer_until: '2026-11-03' }, '2026-11-03')).toBe(9000000);
    expect(activeOfferCents({ ...car, offer_price_cents: 9000000, offer_until: '2026-11-02' }, '2026-11-03')).toBeNull();
    expect(activeOfferCents({ ...car, offer_price_cents: 10000000 }, '2026-11-03')).toBeNull();
    expect(activeOfferCents({ ...car, offer_price_cents: null }, '2026-11-03')).toBeNull();
    expect(currentPriceCents(car)).toBe(10000000);
  });

  const valid = {
    brand: 'Fiat', model: 'Uno', version: '', category: 'hatch', model_year: '2020', mileage_km: '', transmission: '', fuel: '', color: '',
    price: '50000', description: '', features: '', status: 'available',
  };

  it('formulário recusa oferta maior ou igual ao preço', () => {
    const result = vehicleSchema.safeParse({ ...valid, offer_price: '50000' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['offer_price']);
    expect(vehicleSchema.parse({ ...valid, offer_price: '45000', offer_until: '2030-01-01' })).toMatchObject({ offer_price: 4500000, offer_until: '2030-01-01' });
    expect(vehicleSchema.parse(valid)).toMatchObject({ offer_price: null, offer_until: null, purchase_cost: null, fipe_price_cents: null });
    expect(vehicleSchema.safeParse({ ...valid, offer_until: 'amanhã' }).success).toBe(false);
  });
});

describe('link do Instagram', () => {
  it('aceita os formatos que o Instagram gera e guarda um só', () => {
    const canonical = 'https://www.instagram.com/reel/DfH3u18BsjR/';
    expect(instagramPermalinkSchema.parse('https://www.instagram.com/forteveiculoscachoeiro/reel/DfH3u18BsjR/')).toBe(canonical);
    expect(instagramPermalinkSchema.parse('https://www.instagram.com/reel/DfH3u18BsjR/?igsh=abc')).toBe(canonical);
    expect(instagramPermalinkSchema.parse('https://instagram.com/reels/DfH3u18BsjR')).toBe(canonical);
    expect(instagramPermalinkSchema.parse('https://www.instagram.com/p/ABC123/')).toBe('https://www.instagram.com/p/ABC123/');
    expect(instagramPermalinkSchema.safeParse('https://www.instagram.com/forteveiculoscachoeiro/').success).toBe(false);
    expect(instagramPermalinkSchema.safeParse('https://site-malicioso.test/reel/ABC').success).toBe(false);
  });
});

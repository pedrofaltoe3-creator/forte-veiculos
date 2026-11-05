'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Field } from '@/components/admin/AdminField';
import { fuelFromText, groupFipeModels, parsePlacaFipeText, transmissionFromText } from '@/lib/fipe-names';
import { formatPrice } from '@/lib/format';

type Fipe = { code: string | null; priceCents: number | null; reference: string | null };
type Option = { code: string; name: string };
type YearOption = { code: string; year: number; label: string };
type PlateResult = {
  brand: string;
  model: string;
  version: string;
  year: number | null;
  color: string | null;
  fuel: string | null;
  transmission: string | null;
  category: string | null;
  situation: string | null;
  fipe: Fipe | null;
};

const OTHER = '__outro__';

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path);
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

function setField(form: HTMLFormElement | null | undefined, name: string, value: string | null, onlyIfEmpty = false) {
  const field = form?.elements.namedItem(name);
  if (!value || !(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
  if (!onlyIfEmpty || field.value === '') field.value = value;
}

// Lista da FIPE para escolher, sempre com a saída de digitar. Valor que não está na lista continua valendo.
function SelectOrType({ name, label, value, options, onChange, error, required, maxLength, placeholder }: {
  name: string;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  maxLength: number;
  placeholder: string;
}) {
  const [typing, setTyping] = useState(false);
  const showInput = typing || options.length === 0 || (value !== '' && !options.includes(value));

  return (
    <Field label={label} error={error}>
      {showInput ? (
        <>
          <input name={name} value={value} onChange={(event) => onChange(event.target.value)} required={required} maxLength={maxLength} />
          {options.length > 0 && (
            <button
              type="button"
              className="a-text-link a-link-small"
              onClick={() => {
                setTyping(false);
                onChange('');
              }}
            >
              Escolher da lista
            </button>
          )}
        </>
      ) : (
        <select
          name={name}
          value={value}
          required={required}
          onChange={(event) => {
            if (event.target.value === OTHER) {
              setTyping(true);
              onChange('');
            } else {
              onChange(event.target.value);
            }
          }}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
          <option value={OTHER}>Outro (digitar)</option>
        </select>
      )}
    </Field>
  );
}

type Props = {
  vehicle?: {
    brand?: string;
    model?: string;
    version?: string | null;
    model_year?: number;
    fipe_code?: string | null;
    fipe_price_cents?: number | null;
    fipe_reference?: string | null;
  };
  errors: Record<string, string>;
  plateEnabled: boolean;
  children: ReactNode;
};

export function VehicleIdentity({ vehicle, errors, plateEnabled, children }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [brand, setBrand] = useState(vehicle?.brand ?? '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const [version, setVersion] = useState(vehicle?.version ?? '');
  const [year, setYear] = useState(vehicle?.model_year ? String(vehicle.model_year) : '');
  const [brands, setBrands] = useState<Option[]>([]);
  const [fipeModels, setFipeModels] = useState<Option[]>([]);
  const [years, setYears] = useState<YearOption[]>([]);
  const [fipe, setFipe] = useState<Fipe | null>(
    vehicle?.fipe_code ? { code: vehicle.fipe_code, priceCents: vehicle.fipe_price_cents ?? null, reference: vehicle.fipe_reference ?? null } : null,
  );
  const [plate, setPlate] = useState('');
  const [plateBusy, setPlateBusy] = useState(false);
  const [plateMessage, setPlateMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pasted, setPasted] = useState('');
  const cleanPlate = plate.replace(/[^A-Z0-9]/g, '');
  const plateIsValid = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(cleanPlate);

  const brandCode = brands.find((item) => item.name === brand)?.code;
  const groups = useMemo(() => groupFipeModels(fipeModels), [fipeModels]);
  const versions = useMemo(() => groups.get(model) ?? [], [groups, model]);
  const modelCode = versions.find((item) => item.version === version)?.code ?? (versions.length === 1 ? versions[0].code : undefined);
  const yearCode = years.find((item) => String(item.year) === year)?.code;

  useEffect(() => {
    let active = true;
    void getJson<Option[]>('/api/admin/fipe').then((data) => {
      if (active && data) setBrands([...data].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (brandCode ? getJson<Option[]>(`/api/admin/fipe?marca=${brandCode}`) : Promise.resolve(null)).then((data) => {
      if (active) setFipeModels(data ?? []);
    });
    return () => {
      active = false;
    };
  }, [brandCode]);

  useEffect(() => {
    let active = true;
    void (brandCode && modelCode ? getJson<YearOption[]>(`/api/admin/fipe?marca=${brandCode}&modelo=${modelCode}`) : Promise.resolve(null)).then((data) => {
      if (active) setYears(data ?? []);
    });
    return () => {
      active = false;
    };
  }, [brandCode, modelCode]);

  useEffect(() => {
    if (!brandCode || !modelCode || !yearCode) return;
    let active = true;
    void getJson<Fipe & { fuel: string | null }>(`/api/admin/fipe?marca=${brandCode}&modelo=${modelCode}&ano=${yearCode}`).then((data) => {
      if (!active || !data) return;
      setFipe({ code: data.code, priceCents: data.priceCents, reference: data.reference });
      setField(rootRef.current?.closest('form'), 'fuel', data.fuel, true);
    });
    return () => {
      active = false;
    };
  }, [brandCode, modelCode, yearCode]);

  const chooseBrand = (value: string) => {
    setBrand(value);
    setModel('');
    setVersion('');
    setFipe(null);
  };
  const chooseModel = (value: string) => {
    setModel(value);
    setVersion('');
    setFipe(null);
  };
  const chooseVersion = (value: string) => {
    setVersion(value);
    const form = rootRef.current?.closest('form');
    setField(form, 'transmission', transmissionFromText(value), true);
    setField(form, 'fuel', fuelFromText(value), true);
  };

  async function lookUpPlate() {
    setPlateBusy(true);
    setPlateMessage(null);
    try {
      const response = await fetch('/api/admin/placa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placa: plate }),
      });
      const data = (await response.json().catch(() => null)) as (PlateResult & { message?: string }) | null;
      if (!response.ok || !data) {
        setPlateMessage({ ok: false, text: data?.message ?? 'Não foi possível consultar. Preencha à mão.' });
        return;
      }
      setBrand(data.brand);
      setModel(data.model);
      setVersion(data.version);
      setYear(data.year ? String(data.year) : '');
      setFipe(data.fipe);
      const form = rootRef.current?.closest('form');
      setField(form, 'color', data.color);
      setField(form, 'fuel', data.fuel);
      setField(form, 'transmission', data.transmission);
      setField(form, 'category', data.category);
      setPlateMessage({ ok: true, text: `Dados preenchidos. Confira antes de salvar.${data.situation ? ` Situação informada: ${data.situation}.` : ''}` });
    } catch {
      setPlateMessage({ ok: false, text: 'Não foi possível consultar. Preencha à mão.' });
    } finally {
      setPlateBusy(false);
    }
  }

  const applyPasted = (text: string) => {
    setPasted(text);
    if (!text.trim()) return;
    const data = parsePlacaFipeText(text);
    if (!data) {
      setPlateMessage({ ok: false, text: 'Não reconheci o texto. Copie a página inteira do Placa FIPE, com Ctrl+A e Ctrl+C.' });
      return;
    }
    setBrand(data.brand);
    setModel(data.model);
    setVersion(data.version);
    setYear(data.year ? String(data.year) : '');
    setFipe(data.fipe);
    const form = rootRef.current?.closest('form');
    setField(form, 'color', data.color);
    setField(form, 'fuel', data.fuel);
    setField(form, 'transmission', data.transmission);
    setPasted('');
    const others = data.fipeOptions > 1 ? ` A página mostrou ${data.fipeOptions} versões na FIPE: usei a primeira.` : '';
    setPlateMessage({ ok: true, text: `Dados preenchidos. Confira antes de salvar.${others}` });
  };

  const useFipeAsPrice = () => {
    if (fipe?.priceCents) setField(rootRef.current?.closest('form'), 'price', String(fipe.priceCents / 100));
  };

  return (
    <div ref={rootRef} className="a-identity">
      <div className="a-plate">
        <label className="a-field">
          <span>Placa do carro</span>
          <input
            value={plate}
            maxLength={8}
            placeholder="ABC1D23"
            autoCapitalize="characters"
            onChange={(event) => setPlate(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (plateEnabled && plateIsValid) void lookUpPlate();
              }
            }}
          />
        </label>
        {plateIsValid ? (
          <a className="a-btn a-btn-primary" href={`https://placafipe.com/placa/${cleanPlate}`} target="_blank" rel="noopener noreferrer">Abrir no Placa FIPE</a>
        ) : (
          <span className="a-btn is-disabled">Abrir no Placa FIPE</span>
        )}
        {plateEnabled && (
          <button type="button" className="a-btn" disabled={plateBusy || !plateIsValid} onClick={() => void lookUpPlate()}>
            {plateBusy ? 'Buscando...' : 'Buscar automático'}
          </button>
        )}
        <label className="a-field a-plate-paste">
          <span>Colar os dados do Placa FIPE</span>
          <textarea
            rows={2}
            value={pasted}
            placeholder="Na página que abriu, aperte Ctrl+A e depois Ctrl+C. Volte aqui e cole. O formulário preenche sozinho."
            onChange={(event) => applyPasted(event.target.value)}
          />
        </label>
        {plateMessage && <p className={plateMessage.ok ? 'a-plate-ok' : 'a-field-error'} role={plateMessage.ok ? 'status' : 'alert'}>{plateMessage.text}</p>}
      </div>

      <div className="a-grid">
        <SelectOrType name="brand" label="Marca" value={brand} options={brands.map((item) => item.name)} onChange={chooseBrand} error={errors.brand} required maxLength={60} placeholder="Escolha a marca" />
        <SelectOrType name="model" label="Modelo" value={model} options={[...groups.keys()]} onChange={chooseModel} error={errors.model} required maxLength={80} placeholder="Escolha o modelo" />
        <SelectOrType name="version" label="Versão" value={version} options={versions.map((item) => item.version).filter(Boolean)} onChange={chooseVersion} error={errors.version} maxLength={120} placeholder="Escolha a versão" />
        <Field label="Ano" error={errors.model_year}>
          <input name="model_year" type="number" inputMode="numeric" list="anos-fipe" value={year} onChange={(event) => setYear(event.target.value)} required min={1950} max={2100} />
          <datalist id="anos-fipe">
            {[...new Set(years.map((item) => item.year))].map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </Field>
        {children}
      </div>

      <input type="hidden" name="fipe_code" value={fipe?.code ?? ''} />
      <input type="hidden" name="fipe_price_cents" value={fipe?.priceCents ?? ''} />
      <input type="hidden" name="fipe_reference" value={fipe?.reference ?? ''} />
      {fipe?.priceCents != null && (
        <div className="a-fipe" role="status">
          <span>Tabela FIPE{fipe.reference ? ` de ${fipe.reference}` : ''}</span>
          <strong>{formatPrice(fipe.priceCents)}</strong>
          {fipe.code && <span className="muted">Código {fipe.code}</span>}
          <button type="button" className="a-btn a-btn-small" onClick={useFipeAsPrice}>Usar como preço</button>
        </div>
      )}
    </div>
  );
}

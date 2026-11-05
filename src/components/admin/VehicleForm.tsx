'use client';

import { useActionState } from 'react';
import { Field } from '@/components/admin/AdminField';
import { VehicleIdentity } from '@/components/admin/VehicleIdentity';
import { CATEGORY_LABEL, FUEL_LABEL, STATUS_LABEL, TRANSMISSION_LABEL } from '@/lib/format';
import { submitKeepingValues } from '@/lib/forms';
import type { FormState, Vehicle, VehiclePrivateFields } from '@/lib/types';

type VehicleValues = Partial<Omit<Vehicle, 'vehicle_photos'> & VehiclePrivateFields>;

const reais = (cents: number | null | undefined) => (cents != null ? String(Number(cents) / 100) : '');

export function VehicleForm({ action, vehicle, submitLabel, plateEnabled }: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  vehicle?: VehicleValues;
  submitLabel: string;
  plateEnabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} onSubmit={submitKeepingValues(formAction)} className="a-form">
      <fieldset className="a-fieldset">
        <legend>Identificação</legend>
        <VehicleIdentity vehicle={vehicle} errors={errors} plateEnabled={plateEnabled}>
          <Field label="Categoria" error={errors.category}>
            <select name="category" defaultValue={vehicle?.category ?? 'sedan'}>
              {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Cor" error={errors.color}>
            <input name="color" defaultValue={vehicle?.color ?? ''} maxLength={40} />
          </Field>
        </VehicleIdentity>
      </fieldset>

      <fieldset className="a-fieldset">
        <legend>Ficha</legend>
        <div className="a-grid">
          <Field label="Quilometragem" error={errors.mileage_km} hint="Deixe vazio para mostrar sob consulta.">
            <input name="mileage_km" inputMode="numeric" defaultValue={vehicle?.mileage_km ?? ''} placeholder="62000" />
          </Field>
          <Field label="Câmbio" error={errors.transmission}>
            <select name="transmission" defaultValue={vehicle?.transmission ?? ''}>
              <option value="">Sob consulta</option>
              {Object.entries(TRANSMISSION_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Combustível" error={errors.fuel}>
            <select name="fuel" defaultValue={vehicle?.fuel ?? ''}>
              <option value="">Sob consulta</option>
              {Object.entries(FUEL_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>

      <fieldset className="a-fieldset">
        <legend>Venda</legend>
        <div className="a-grid">
          <Field label="Preço" error={errors.price} hint="Exemplo: 129990">
            <input
              name="price"
              inputMode="decimal"
              defaultValue={reais(vehicle?.price_cents)}
              required
              placeholder="129990"
            />
          </Field>
          <Field label="Preço de oferta" error={errors.offer_price} hint="Vazio: sem oferta. Precisa ser menor que o preço.">
            <input name="offer_price" inputMode="decimal" defaultValue={reais(vehicle?.offer_price_cents)} placeholder="119990" />
          </Field>
          <Field label="Oferta válida até" error={errors.offer_until} hint="Vazio: vale até você tirar.">
            <input name="offer_until" type="date" defaultValue={vehicle?.offer_until ?? ''} />
          </Field>
          <Field label="Quanto a loja pagou" error={errors.purchase_cost} hint="Só aparece no painel. Usado no financeiro.">
            <input name="purchase_cost" inputMode="decimal" defaultValue={reais(vehicle?.purchase_cost_cents)} placeholder="105000" />
          </Field>
          <Field label="Situação" error={errors.status}>
            <select name="status" defaultValue={vehicle?.status ?? 'available'}>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          <label className="a-check">
            <input type="checkbox" name="is_featured" defaultChecked={vehicle?.is_featured} />
            <span>
              Mostrar em destaque na página inicial
              <small>Carro vendido sai dos destaques automaticamente.</small>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset className="a-fieldset">
        <legend>Texto do anúncio</legend>
        <div className="a-grid">
          <Field label="Descrição" error={errors.description} wide>
            <textarea name="description" rows={5} maxLength={6000} defaultValue={vehicle?.description ?? ''} />
          </Field>
          <Field label="Itens do carro" error={errors.features} hint="Um item por linha." wide>
            <textarea name="features" rows={7} maxLength={4000} defaultValue={vehicle?.features?.join('\n') ?? ''} placeholder={'Câmera de ré\nCentral multimídia\nPiloto automático'} />
          </Field>
        </div>
      </fieldset>

      {state && (
        <p className={`alert ${state.ok ? 'alert-ok' : 'alert-error'}`} role={state.ok ? 'status' : 'alert'}>
          {state.message}
        </p>
      )}
      <div className="a-form-actions">
        <button className="a-btn a-btn-primary" disabled={pending}>
          {pending ? 'Salvando...' : submitLabel}
        </button>
      </div>
    </form>
  );
}

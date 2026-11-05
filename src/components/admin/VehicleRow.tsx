'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteVehicle, quickUpdateVehicle } from '@/app/admin/(painel)/actions';
import { activeOfferCents, formatKm, formatPrice, parsePriceToCents, STATUS_LABEL, vehicleName } from '@/lib/format';
import type { VehicleStatus } from '@/lib/types';

export type VehicleRowData = {
  id: string;
  slug: string;
  brand: string;
  model: string;
  version: string | null;
  model_year: number;
  mileage_km: number | null;
  price_cents: number;
  offer_price_cents: number | null;
  offer_until: string | null;
  status: VehicleStatus;
  is_featured: boolean;
  thumb: string | null;
  photoCount: number;
};

export function VehicleRow({ vehicle }: { vehicle: VehicleRowData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState(false);
  const [status, setStatus] = useState(vehicle.status);
  const [featured, setFeatured] = useState(vehicle.is_featured);
  const name = vehicleName(vehicle);

  const apply = (change: object, onSuccess?: () => void, onFailure?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await quickUpdateVehicle(vehicle.id, change);
      if (result.ok) {
        onSuccess?.();
        router.refresh();
      } else {
        setError(result.message ?? 'Não foi possível salvar.');
        onFailure?.();
      }
    });
  };

  const onDelete = () => {
    if (!window.confirm(`Excluir ${name} ${vehicle.model_year} e todas as fotos? Esta ação não pode ser desfeita.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteVehicle(vehicle.id);
      if (result.ok) router.refresh();
      else setError(result.message ?? 'Não foi possível excluir.');
    });
  };

  return (
    <tr className={pending ? 'is-pending' : ''}>
      <td className="a-cell-photo">
        {vehicle.thumb ? <img src={vehicle.thumb} alt="" width={88} height={66} loading="lazy" /> : <span className="a-no-photo">Sem foto</span>}
      </td>
      <td>
        <Link href={`/admin/veiculos/${vehicle.id}`} className="a-row-title">{name}</Link>
        <span className="a-row-sub">
          {[vehicle.model_year, formatKm(vehicle.mileage_km), `${vehicle.photoCount} fotos`].filter(Boolean).join(' · ')}
        </span>
        {error && <span className="a-row-error" role="alert">{error}</span>}
      </td>
      <td>
        {editingPrice ? (
          <form
            className="a-price-edit"
            onSubmit={(event) => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get('price');
              const cents = parsePriceToCents(String(value));
              if (!cents) {
                setError('Informe um preço válido.');
                return;
              }
              apply({ field: 'price_cents', value: cents }, () => setEditingPrice(false));
            }}
          >
            <label className="sr-only" htmlFor={`price-${vehicle.id}`}>Novo preço de {name}</label>
            <input id={`price-${vehicle.id}`} name="price" inputMode="decimal" defaultValue={String(vehicle.price_cents / 100)} autoFocus />
            <button className="a-btn a-btn-small a-btn-primary">Salvar</button>
            <button type="button" className="a-btn a-btn-small" onClick={() => setEditingPrice(false)}>Cancelar</button>
          </form>
        ) : (
          <button type="button" className="a-price" onClick={() => setEditingPrice(true)} aria-label={`Alterar preço de ${name}`}>
            {formatPrice(vehicle.price_cents)}
          </button>
        )}
        {activeOfferCents(vehicle) !== null && <span className="a-row-offer">Oferta {formatPrice(vehicle.offer_price_cents!)}</span>}
      </td>
      <td>
        <label className="sr-only" htmlFor={`status-${vehicle.id}`}>Situação de {name}</label>
        <select
          id={`status-${vehicle.id}`}
          className={`a-status a-status-${status}`}
          value={status}
          onChange={(event) => {
            const previous = status;
            const next = event.target.value as VehicleStatus;
            setStatus(next);
            if (next === 'sold') setFeatured(false);
            apply({ field: 'status', value: next }, undefined, () => setStatus(previous));
          }}
        >
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </td>
      <td>
        <label className="a-switch">
          <input
            type="checkbox"
            checked={featured}
            disabled={status === 'sold'}
            onChange={(event) => {
              const next = event.target.checked;
              setFeatured(next);
              apply({ field: 'is_featured', value: next }, undefined, () => setFeatured(!next));
            }}
          />
          <span className="sr-only">Destacar {name}</span>
        </label>
      </td>
      <td className="a-cell-actions">
        {status !== 'sold' && status !== 'draft' && <Link className="a-btn a-btn-small" href={`/admin?vender=${vehicle.id}#confirmar-venda`}>Vendi</Link>}
        <Link className="a-btn a-btn-small" href={`/admin/veiculos/${vehicle.id}`}>Editar</Link>
        <button type="button" className="a-btn a-btn-small a-btn-danger" onClick={onDelete}>Excluir</button>
      </td>
    </tr>
  );
}

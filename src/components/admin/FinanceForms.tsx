'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import { addFinancialEntry, confirmSale, deleteFinancialEntry, undoSale } from '@/app/admin/(painel)/finance-actions';
import { Field } from '@/components/admin/AdminField';
import { PAYMENT_LABEL } from '@/lib/format';
import { submitKeepingValues } from '@/lib/forms';

export type SaleCandidate = {
  id: string;
  label: string;
  group: 'pending' | 'reserved' | 'available';
  priceCents: number;
  costCents: number | null;
};

const GROUP_LABEL: Record<SaleCandidate['group'], string> = {
  pending: 'Marcados como vendidos, falta o valor',
  reserved: 'Reservados',
  available: 'Disponíveis',
};

const reais = (cents: number | null) => (cents != null ? String(cents / 100) : '');

export function SaleForm({ vehicles, preselected, today }: { vehicles: SaleCandidate[]; preselected?: string; today: string }) {
  const [state, action, pending] = useActionState(confirmSale, null);
  const errors = state?.fieldErrors ?? {};
  const initial = vehicles.find((vehicle) => vehicle.id === preselected);
  const [selected, setSelected] = useState(initial?.id ?? '');
  const [amount, setAmount] = useState(reais(initial?.priceCents ?? null));
  const [cost, setCost] = useState(reais(initial?.costCents ?? null));

  // Depois de confirmar, o carro sai da lista e o formulário volta ao início.
  if (selected && !vehicles.some((vehicle) => vehicle.id === selected)) {
    setSelected('');
    setAmount('');
    setCost('');
  }

  const choose = (id: string) => {
    const vehicle = vehicles.find((item) => item.id === id);
    setSelected(id);
    setAmount(reais(vehicle?.priceCents ?? null));
    setCost(reais(vehicle?.costCents ?? null));
  };

  return (
    <form action={action} onSubmit={submitKeepingValues(action)} className="a-form a-grid" id="confirmar-venda">
      <Field label="Carro vendido" error={errors.vehicle_id} wide>
        <select name="vehicle_id" value={selected} onChange={(event) => choose(event.target.value)} required>
          <option value="">Escolha o carro</option>
          {(['pending', 'reserved', 'available'] as const).map((group) => {
            const items = vehicles.filter((vehicle) => vehicle.group === group);
            return items.length > 0 ? (
              <optgroup key={group} label={GROUP_LABEL[group]}>
                {items.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>{vehicle.label}</option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
      </Field>
      <Field label="Valor da venda" error={errors.amount}>
        <input name="amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required placeholder="129990" />
      </Field>
      <Field label="Quanto a loja pagou" error={errors.cost} hint="Para calcular o lucro. Pode ficar vazio.">
        <input name="cost" inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="105000" />
      </Field>
      <Field label="Data da venda" error={errors.sold_on}>
        <input name="sold_on" type="date" defaultValue={today} required />
      </Field>
      <Field label="Forma de pagamento" error={errors.payment_method}>
        <select name="payment_method" defaultValue="pix">
          {Object.entries(PAYMENT_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Field>
      {state && (
        <p className={`alert ${state.ok ? 'alert-ok' : 'alert-error'} a-field-wide`} role={state.ok ? 'status' : 'alert'}>{state.message}</p>
      )}
      <div className="a-form-actions a-field-wide">
        <button className="a-btn a-btn-primary" disabled={pending}>{pending ? 'Confirmando...' : 'Confirmar venda'}</button>
      </div>
    </form>
  );
}

export function EntryForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(addFinancialEntry, null);
  const errors = state?.fieldErrors ?? {};
  return (
    <form action={action} onSubmit={submitKeepingValues(action)} className="a-form a-grid">
      <Field label="Tipo" error={errors.kind}>
        <select name="kind" defaultValue="expense">
          <option value="expense">Despesa</option>
          <option value="income">Outra entrada</option>
        </select>
      </Field>
      <Field label="Descrição" error={errors.description}>
        <input name="description" required maxLength={200} placeholder="Aluguel, lavagem, comissão..." />
      </Field>
      <Field label="Valor" error={errors.amount}>
        <input name="amount" inputMode="decimal" required placeholder="1500" />
      </Field>
      <Field label="Data" error={errors.occurred_on}>
        <input name="occurred_on" type="date" defaultValue={today} required />
      </Field>
      {state && (
        <p className={`alert ${state.ok ? 'alert-ok' : 'alert-error'} a-field-wide`} role={state.ok ? 'status' : 'alert'}>{state.message}</p>
      )}
      <div className="a-form-actions a-field-wide">
        <button className="a-btn" disabled={pending}>{pending ? 'Salvando...' : 'Lançar'}</button>
      </div>
    </form>
  );
}

export function RemoveEntryButton({ entryId, isSale, label }: { entryId: string; isSale: boolean; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        className="a-btn a-btn-small a-btn-danger"
        disabled={pending}
        onClick={() => {
          const question = isSale ? `Desfazer a venda de ${label}? O carro volta para o estoque.` : `Excluir o lançamento "${label}"?`;
          if (!window.confirm(question)) return;
          setFailed(false);
          startTransition(async () => {
            const result = await (isSale ? undoSale(entryId) : deleteFinancialEntry(entryId));
            setFailed(!result.ok);
            router.refresh();
          });
        }}
      >
        {isSale ? 'Desfazer' : 'Excluir'}
      </button>
      {failed && <span className="a-row-error" role="alert">Não foi possível concluir.</span>}
    </>
  );
}

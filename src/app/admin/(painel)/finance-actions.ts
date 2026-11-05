'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AdminAccessError, requireAdminAction, type AdminContext } from '@/lib/auth/guards';
import type { FormState } from '@/lib/types';
import { fieldErrorsOf, financialEntrySchema, saleSchema } from '@/lib/validation';

const SAVE_ERROR = 'Não foi possível salvar. Tente de novo.';
const idSchema = z.uuid();

async function context(): Promise<AdminContext | FormState> {
  try {
    return await requireAdminAction();
  } catch (error) {
    if (error instanceof AdminAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

const isDenied = (value: AdminContext | FormState): value is NonNullable<FormState> => value !== null && 'ok' in value;

// A função do banco grava a venda e marca o carro como vendido juntas: ou as duas acontecem, ou nenhuma.
export async function confirmSale(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await context();
  if (isDenied(ctx)) return ctx;
  const { supabase, site } = ctx as AdminContext;

  const parsed = saleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: 'Confira os campos destacados.', fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const { vehicle_id, amount, sold_on, payment_method, cost } = parsed.data;

  if (cost !== null) {
    const { error } = await supabase.from('vehicles').update({ purchase_cost_cents: cost }).eq('id', vehicle_id).eq('company_id', site.company.id);
    if (error) return { ok: false, message: SAVE_ERROR };
  }

  const { error } = await supabase.rpc('confirm_vehicle_sale', {
    p_company: site.company.id,
    p_vehicle: vehicle_id,
    p_amount_cents: amount,
    p_sold_on: sold_on,
    p_payment: payment_method,
  });
  if (error) {
    console.error('Falha ao confirmar venda', error.code);
    return { ok: false, message: error.code === '23505' ? 'Esta venda já foi confirmada.' : SAVE_ERROR };
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Venda confirmada. O carro saiu do estoque do site.' };
}

export async function undoSale(entryId: string): Promise<{ ok: boolean }> {
  const ctx = await context();
  if (isDenied(ctx) || !idSchema.safeParse(entryId).success) return { ok: false };
  const { supabase, site } = ctx as AdminContext;
  const { error } = await supabase.rpc('undo_vehicle_sale', { p_company: site.company.id, p_entry: entryId });
  revalidatePath('/', 'layout');
  return { ok: !error };
}

export async function addFinancialEntry(_: FormState, formData: FormData): Promise<FormState> {
  const ctx = await context();
  if (isDenied(ctx)) return ctx;
  const { supabase, site } = ctx as AdminContext;

  const parsed = financialEntrySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: 'Confira os campos destacados.', fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const { amount, ...entry } = parsed.data;
  const { error } = await supabase.from('financial_entries').insert({ ...entry, amount_cents: amount, company_id: site.company.id });
  if (error) {
    console.error('Falha ao lançar no financeiro', error.code);
    return { ok: false, message: SAVE_ERROR };
  }
  revalidatePath('/admin');
  return { ok: true, message: 'Lançamento salvo.' };
}

// Venda não sai por aqui: desfazer também devolve o carro ao estoque.
export async function deleteFinancialEntry(entryId: string): Promise<{ ok: boolean }> {
  const ctx = await context();
  if (isDenied(ctx) || !idSchema.safeParse(entryId).success) return { ok: false };
  const { supabase, site } = ctx as AdminContext;
  const { error } = await supabase
    .from('financial_entries')
    .delete()
    .eq('id', entryId)
    .eq('company_id', site.company.id)
    .neq('kind', 'sale');
  revalidatePath('/admin');
  return { ok: !error };
}

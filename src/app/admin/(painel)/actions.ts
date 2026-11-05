'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AdminAccessError, requireAdminAction, type AdminContext } from '@/lib/auth/guards';
import { env } from '@/lib/env';
import { slugify } from '@/lib/format';
import { createServiceClient } from '@/lib/supabase/admin';
import { accessEmail, accessLink, sendEmail } from '@/lib/email';
import type { BusinessHours, FormState, LeadStatus } from '@/lib/types';
import {
  fieldErrorsOf,
  instagramPermalinkSchema,
  inviteUserSchema,
  passwordSchema,
  siteSettingsSchema,
  technicalSettingsSchema,
  vehicleSchema,
} from '@/lib/validation';

const SAVE_ERROR = 'Não foi possível salvar. Tente de novo.';
const idSchema = z.uuid();

function denied(error: unknown): FormState {
  if (error instanceof AdminAccessError) return { ok: false, message: error.message };
  throw error;
}

function refreshPublicSite() {
  revalidatePath('/', 'layout');
}

// Veículos ------------------------------------------------------------------

function vehicleRow(data: z.infer<typeof vehicleSchema>) {
  const { price, offer_price, purchase_cost, ...rest } = data;
  return { ...rest, price_cents: price, offer_price_cents: offer_price, purchase_cost_cents: purchase_cost };
}

// Os formulários enviam "" para campos vazios e não enviam o checkbox desmarcado.
export async function createVehicle(_: FormState, formData: FormData): Promise<FormState> {
  let ctx: AdminContext;
  try {
    ctx = await requireAdminAction();
  } catch (error) {
    return denied(error);
  }
  const parsed = vehicleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: 'Confira os campos destacados.', fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const row = vehicleRow(parsed.data);
  const baseSlug = slugify(`${row.brand} ${row.model} ${row.version ?? ''} ${row.model_year}`);
  let createdId: string | null = null;

  for (let attempt = 0; attempt < 6 && !createdId; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const { data, error } = await ctx.supabase
      .from('vehicles')
      .insert({ ...row, slug, company_id: ctx.site.company.id })
      .select('id')
      .single();
    if (data) createdId = data.id;
    else if (error?.code !== '23505') {
      console.error('Falha ao criar veículo', error?.code);
      return { ok: false, message: SAVE_ERROR };
    }
  }
  if (!createdId) return { ok: false, message: SAVE_ERROR };

  refreshPublicSite();
  redirect(`/admin/veiculos/${createdId}?novo=1`);
}

export async function updateVehicle(vehicleId: string, _: FormState, formData: FormData): Promise<FormState> {
  let ctx: AdminContext;
  try {
    ctx = await requireAdminAction();
  } catch (error) {
    return denied(error);
  }
  if (!idSchema.safeParse(vehicleId).success) return { ok: false, message: SAVE_ERROR };
  const parsed = vehicleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: 'Confira os campos destacados.', fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const { error, count } = await ctx.supabase
    .from('vehicles')
    .update(vehicleRow(parsed.data), { count: 'exact' })
    .eq('id', vehicleId)
    .eq('company_id', ctx.site.company.id);
  if (error || count === 0) {
    console.error('Falha ao atualizar veículo', error?.code);
    return { ok: false, message: SAVE_ERROR };
  }
  refreshPublicSite();
  return { ok: true, message: 'Veículo salvo. O site já está atualizado.' };
}

const quickUpdateSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('status'), value: z.enum(['draft', 'available', 'reserved', 'sold']) }),
  z.object({ field: z.literal('is_featured'), value: z.boolean() }),
  z.object({ field: z.literal('price_cents'), value: z.number().int().positive().max(10_000_000_000) }),
]);

export async function quickUpdateVehicle(vehicleId: string, change: unknown): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await requireAdminAction();
    const parsed = quickUpdateSchema.safeParse(change);
    if (!parsed.success || !idSchema.safeParse(vehicleId).success) return { ok: false, message: SAVE_ERROR };
    const { error, count } = await ctx.supabase
      .from('vehicles')
      .update({ [parsed.data.field]: parsed.data.value }, { count: 'exact' })
      .eq('id', vehicleId)
      .eq('company_id', ctx.site.company.id);
    if (error || count === 0) return { ok: false, message: SAVE_ERROR };
    refreshPublicSite();
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function deleteVehicle(vehicleId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await requireAdminAction();
    if (!idSchema.safeParse(vehicleId).success) return { ok: false, message: SAVE_ERROR };

    const { data: photos } = await ctx.supabase
      .from('vehicle_photos')
      .select('storage_path, thumb_path')
      .eq('vehicle_id', vehicleId)
      .eq('company_id', ctx.site.company.id);

    const { error, count } = await ctx.supabase
      .from('vehicles')
      .delete({ count: 'exact' })
      .eq('id', vehicleId)
      .eq('company_id', ctx.site.company.id);
    if (error || count === 0) return { ok: false, message: 'Não foi possível excluir o veículo.' };

    const paths = (photos ?? []).flatMap((p) => [p.storage_path, p.thumb_path]);
    if (paths.length > 0) {
      const { error: storageError } = await ctx.supabase.storage.from('vehicle-photos').remove(paths);
      if (storageError) console.error('Arquivos órfãos no Storage', storageError.message);
    }
    refreshPublicSite();
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

// Fotos -----------------------------------------------------------------------

export async function setPrimaryPhoto(photoId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await requireAdminAction();
    if (!idSchema.safeParse(photoId).success) return { ok: false };
    const { error } = await ctx.supabase.rpc('set_primary_photo', { p_photo_id: photoId });
    if (error) return { ok: false, message: 'Não foi possível definir a foto principal.' };
    refreshPublicSite();
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function deletePhoto(photoId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const ctx = await requireAdminAction();
    if (!idSchema.safeParse(photoId).success) return { ok: false };
    const { data: photo } = await ctx.supabase
      .from('vehicle_photos')
      .select('storage_path, thumb_path')
      .eq('id', photoId)
      .eq('company_id', ctx.site.company.id)
      .maybeSingle();
    if (!photo) return { ok: false, message: 'Foto não encontrada.' };

    const { error } = await ctx.supabase.from('vehicle_photos').delete().eq('id', photoId);
    if (error) return { ok: false, message: 'Não foi possível excluir a foto.' };
    const { error: storageError } = await ctx.supabase.storage
      .from('vehicle-photos')
      .remove([photo.storage_path, photo.thumb_path]);
    if (storageError) console.error('Arquivos órfãos no Storage', storageError.message);
    refreshPublicSite();
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function reorderPhotos(vehicleId: string, photoIds: string[]): Promise<{ ok: boolean }> {
  try {
    const ctx = await requireAdminAction();
    const parsed = z.array(z.uuid()).max(60).safeParse(photoIds);
    if (!parsed.success || !idSchema.safeParse(vehicleId).success) return { ok: false };
    const { error } = await ctx.supabase.rpc('reorder_vehicle_photos', {
      p_vehicle_id: vehicleId,
      p_photo_ids: parsed.data,
    });
    if (error) return { ok: false };
    refreshPublicSite();
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminAccessError) return { ok: false };
    throw error;
  }
}

// Leads -------------------------------------------------------------------------

export async function updateLeadStatus(leadId: string, status: unknown): Promise<{ ok: boolean }> {
  try {
    const ctx = await requireAdminAction();
    const parsed = z.enum(['new', 'in_progress', 'answered', 'won', 'lost']).safeParse(status);
    if (!parsed.success || !idSchema.safeParse(leadId).success) return { ok: false };
    const { error, count } = await ctx.supabase
      .from('leads')
      .update({ status: parsed.data }, { count: 'exact' })
      .eq('id', leadId)
      .eq('company_id', ctx.site.company.id);
    revalidatePath('/admin', 'layout');
    return { ok: !error && count !== 0 };
  } catch (error) {
    if (error instanceof AdminAccessError) return { ok: false };
    throw error;
  }
}

// Avanços automáticos: abrir um lead novo põe em andamento, responder pelo WhatsApp conclui.
// Só andam para frente, então um lead já fechado ou perdido não muda sozinho.
async function advanceLead(leadId: string, next: LeadStatus, from: LeadStatus[]): Promise<{ ok: boolean }> {
  try {
    const ctx = await requireAdminAction();
    if (!idSchema.safeParse(leadId).success) return { ok: false };
    const { error } = await ctx.supabase
      .from('leads')
      .update({ status: next })
      .eq('id', leadId)
      .eq('company_id', ctx.site.company.id)
      .in('status', from);
    revalidatePath('/admin', 'layout');
    return { ok: !error };
  } catch (error) {
    if (error instanceof AdminAccessError) return { ok: false };
    throw error;
  }
}

export async function markLeadOpened(leadId: string) {
  return advanceLead(leadId, 'in_progress', ['new']);
}

export async function markLeadAnswered(leadId: string) {
  return advanceLead(leadId, 'answered', ['new', 'in_progress']);
}

export async function saveLeadNotes(leadId: string, notes: string): Promise<{ ok: boolean }> {
  try {
    const ctx = await requireAdminAction();
    const parsed = z.string().trim().max(2000).safeParse(notes);
    if (!parsed.success || !idSchema.safeParse(leadId).success) return { ok: false };
    const { error, count } = await ctx.supabase
      .from('leads')
      .update({ notes: parsed.data || null }, { count: 'exact' })
      .eq('id', leadId)
      .eq('company_id', ctx.site.company.id);
    return { ok: !error && count !== 0 };
  } catch (error) {
    if (error instanceof AdminAccessError) return { ok: false };
    throw error;
  }
}

export async function deleteLead(leadId: string): Promise<{ ok: boolean }> {
  try {
    const ctx = await requireAdminAction();
    if (!idSchema.safeParse(leadId).success) return { ok: false };
    const { error, count } = await ctx.supabase
      .from('leads')
      .delete({ count: 'exact' })
      .eq('id', leadId)
      .eq('company_id', ctx.site.company.id);
    revalidatePath('/admin', 'layout');
    return { ok: !error && count !== 0 };
  } catch (error) {
    if (error instanceof AdminAccessError) return { ok: false };
    throw error;
  }
}

// Configurações --------------------------------------------------------------------

function hoursFromForm(week: string | null | undefined, saturday: string | null | undefined): BusinessHours[] {
  const parse = (value: string | null | undefined) => value?.match(/(\d{2}:\d{2})\s*(?:às|-|a)\s*(\d{2}:\d{2})/);
  const result: BusinessHours[] = [];
  const weekMatch = parse(week);
  if (weekMatch) result.push({ days: [1, 2, 3, 4, 5], open: weekMatch[1], close: weekMatch[2], label: 'Segunda a sexta' });
  const saturdayMatch = parse(saturday);
  if (saturdayMatch) result.push({ days: [6], open: saturdayMatch[1], close: saturdayMatch[2], label: 'Sábado' });
  return result;
}

export async function updateSiteSettings(_: FormState, formData: FormData): Promise<FormState> {
  let ctx: AdminContext;
  try {
    ctx = await requireAdminAction();
  } catch (error) {
    return denied(error);
  }
  const parsed = siteSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: 'Confira os campos destacados.', fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const { hours_week, hours_saturday, ...rest } = parsed.data;
  const { error, count } = await ctx.supabase
    .from('site_settings')
    .update({ ...rest, hours: hoursFromForm(hours_week, hours_saturday) }, { count: 'exact' })
    .eq('company_id', ctx.site.company.id);
  if (error || count === 0) {
    console.error('Falha ao salvar configurações', error?.code);
    return { ok: false, message: SAVE_ERROR };
  }
  refreshPublicSite();
  return { ok: true, message: 'Informações salvas. O site já está atualizado.' };
}

export async function addInstagramPost(_: FormState, formData: FormData): Promise<FormState> {
  let ctx: AdminContext;
  try {
    ctx = await requireAdminAction();
  } catch (error) {
    return denied(error);
  }
  const parsed = instagramPermalinkSchema.safeParse(formData.get('permalink'));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  // O caminho vem do navegador, então precisa ser um vídeo da pasta desta empresa.
  const rawVideo = String(formData.get('video_path') ?? '');
  const videoPattern = new RegExp(`^${ctx.site.company.id}/instagram/[0-9a-f-]{36}\\.(mp4|webm|mov)$`);
  if (rawVideo && !videoPattern.test(rawVideo)) return { ok: false, message: SAVE_ERROR };
  const { error } = await ctx.supabase.from('instagram_posts').insert({
    company_id: ctx.site.company.id,
    permalink: parsed.data,
    position: Date.now() % 100000,
    video_path: rawVideo || null,
  });
  if (error) {
    if (rawVideo) await ctx.supabase.storage.from('site-videos').remove([rawVideo]);
    return { ok: false, message: error.code === '23505' ? 'Esta publicação já foi adicionada.' : SAVE_ERROR };
  }
  refreshPublicSite();
  return { ok: true, message: 'Publicação adicionada.' };
}

export async function removeInstagramPost(postId: string): Promise<{ ok: boolean }> {
  try {
    const ctx = await requireAdminAction();
    if (!idSchema.safeParse(postId).success) return { ok: false };
    const { data: post } = await ctx.supabase
      .from('instagram_posts')
      .select('video_path')
      .eq('id', postId)
      .eq('company_id', ctx.site.company.id)
      .maybeSingle();
    const { error } = await ctx.supabase
      .from('instagram_posts')
      .delete()
      .eq('id', postId)
      .eq('company_id', ctx.site.company.id);
    if (!error && post?.video_path) await ctx.supabase.storage.from('site-videos').remove([post.video_path]);
    refreshPublicSite();
    return { ok: !error };
  } catch (error) {
    if (error instanceof AdminAccessError) return { ok: false };
    throw error;
  }
}

export async function updateTechnicalSettings(_: FormState, formData: FormData): Promise<FormState> {
  let ctx: AdminContext;
  try {
    ctx = await requireAdminAction('master');
  } catch (error) {
    return denied(error);
  }
  const parsed = technicalSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: 'Confira os campos destacados.', fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const { error, count } = await ctx.supabase
    .from('technical_settings')
    .update(parsed.data, { count: 'exact' })
    .eq('company_id', ctx.site.company.id);
  if (error || count === 0) return { ok: false, message: SAVE_ERROR };
  refreshPublicSite();
  return { ok: true, message: 'Configurações técnicas salvas.' };
}

// Usuários (somente master) ------------------------------------------------------------
// O papel é validado aqui no servidor e de novo pela RLS nas escritas em company_members.
// A chave service_role só é usada para a API de Auth, depois de confirmar que o alvo é desta empresa.

export type InviteState = (NonNullable<FormState> & { link?: string }) | null;

export async function inviteUser(_: InviteState, formData: FormData): Promise<InviteState> {
  let ctx: AdminContext;
  try {
    ctx = await requireAdminAction('master');
  } catch (error) {
    return denied(error);
  }
  const parsed = inviteUserSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: 'Confira os campos destacados.', fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const { email, full_name, role } = parsed.data;
  const service = createServiceClient();
  const options = { data: { full_name }, redirectTo: `${env.siteUrl}/auth/callback?next=/admin/nova-senha` };

  // Usuário novo recebe convite; quem já existe (por exemplo, master de outra empresa) recebe link de acesso.
  let generated = await service.auth.admin.generateLink({ type: 'invite', email, options });
  if (generated.error?.code === 'email_exists') {
    generated = await service.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: options.redirectTo } });
  }
  if (generated.error || !generated.data.user) {
    console.error('Falha ao convidar usuário', generated.error?.code);
    return { ok: false, message: 'Não foi possível criar o convite.' };
  }

  const { error } = await ctx.supabase.from('company_members').insert({
    company_id: ctx.site.company.id,
    user_id: generated.data.user.id,
    role,
  });
  if (error) {
    return { ok: false, message: error.code === '23505' ? 'Este usuário já tem acesso.' : 'Não foi possível vincular o usuário.' };
  }

  revalidatePath('/admin/usuarios');
  const link = accessLink(generated.data.properties.hashed_token, generated.data.properties.verification_type);
  const storeName = ctx.site.settings.display_name;
  const sent = await sendEmail({ to: email, fromName: storeName, ...accessEmail({ kind: 'invite', name: full_name, storeName, link }) });
  if (sent) return { ok: true, message: `Acesso criado. Enviamos o link para ${email}.` };
  return { ok: true, message: 'Acesso criado, mas o e-mail não foi enviado. Envie este link para a pessoa. Ele funciona uma vez e expira em breve.', link };
}

async function assertMemberOfCompany(ctx: AdminContext, userId: string) {
  if (!idSchema.safeParse(userId).success) throw new AdminAccessError('Usuário inválido.');
  const { data } = await ctx.supabase
    .from('company_members')
    .select('user_id, profiles!inner(email)')
    .eq('company_id', ctx.site.company.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) throw new AdminAccessError('Usuário não pertence a esta empresa.');
  return (data.profiles as unknown as { email: string }).email;
}

type UserAction = { ok: boolean; message?: string; link?: string };

async function userAction(run: (ctx: AdminContext) => Promise<UserAction>): Promise<UserAction> {
  try {
    const ctx = await requireAdminAction('master');
    const result = await run(ctx);
    revalidatePath('/admin/usuarios');
    return result;
  } catch (error) {
    if (error instanceof AdminAccessError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function setMemberRole(userId: string, role: unknown) {
  return userAction(async (ctx) => {
    await assertMemberOfCompany(ctx, userId);
    const parsed = z.enum(['master', 'owner']).safeParse(role);
    if (!parsed.success) return { ok: false, message: 'Papel inválido.' };
    const { error } = await ctx.supabase
      .from('company_members')
      .update({ role: parsed.data })
      .eq('company_id', ctx.site.company.id)
      .eq('user_id', userId);
    return error ? { ok: false, message: error.message } : { ok: true };
  });
}

export async function setMemberActive(userId: string, active: boolean) {
  return userAction(async (ctx) => {
    await assertMemberOfCompany(ctx, userId);
    const { error } = await ctx.supabase
      .from('company_members')
      .update({ is_active: active })
      .eq('company_id', ctx.site.company.id)
      .eq('user_id', userId);
    if (error) return { ok: false, message: error.message };
    if (!active) await createServiceClient().rpc('revoke_user_sessions', { p_user: userId });
    return { ok: true };
  });
}

export async function removeMember(userId: string) {
  return userAction(async (ctx) => {
    await assertMemberOfCompany(ctx, userId);
    const { error } = await ctx.supabase
      .from('company_members')
      .delete()
      .eq('company_id', ctx.site.company.id)
      .eq('user_id', userId);
    if (error) return { ok: false, message: error.message };
    await createServiceClient().rpc('revoke_user_sessions', { p_user: userId });
    return { ok: true };
  });
}

export async function endUserSessions(userId: string) {
  return userAction(async (ctx) => {
    await assertMemberOfCompany(ctx, userId);
    const { error } = await createServiceClient().rpc('revoke_user_sessions', { p_user: userId });
    return error ? { ok: false, message: 'Não foi possível encerrar as sessões.' } : { ok: true, message: 'Sessões encerradas.' };
  });
}

export async function resetUserMfa(userId: string) {
  return userAction(async (ctx) => {
    await assertMemberOfCompany(ctx, userId);
    const service = createServiceClient();
    const { data, error } = await service.auth.admin.mfa.listFactors({ userId });
    if (error) return { ok: false, message: 'Não foi possível consultar o MFA.' };
    for (const factor of data.factors) {
      await service.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
    }
    await service.rpc('revoke_user_sessions', { p_user: userId });
    await service.rpc('log_admin_event', {
      p_company: ctx.site.company.id,
      p_actor: ctx.userId,
      p_actor_email: ctx.email,
      p_action: 'auth.mfa_reset',
      p_entity: 'company_members',
      p_entity_id: userId,
    });
    return { ok: true, message: 'MFA redefinido. A pessoa cadastra de novo no próximo login.' };
  });
}

export async function createRecoveryLink(userId: string) {
  return userAction(async (ctx) => {
    const email = await assertMemberOfCompany(ctx, userId);
    const { data, error } = await createServiceClient().auth.admin.generateLink({ type: 'recovery', email });
    if (error) return { ok: false, message: 'Não foi possível gerar o link.' };
    const link = accessLink(data.properties.hashed_token, data.properties.verification_type);
    const storeName = ctx.site.settings.display_name;
    const sent = await sendEmail({ to: email, fromName: storeName, ...accessEmail({ kind: 'recovery', storeName, link }) });
    if (sent) return { ok: true, message: `Enviamos o link para ${email}.` };
    return { ok: true, message: 'O e-mail não foi enviado. Envie este link para a pessoa. Ele funciona uma vez e expira em breve.', link };
  });
}

// Conta -----------------------------------------------------------------------------------

export async function changeOwnPassword(_: FormState, formData: FormData): Promise<FormState> {
  let ctx: AdminContext;
  try {
    ctx = await requireAdminAction();
  } catch (error) {
    return denied(error);
  }
  const password = passwordSchema.safeParse(formData.get('password'));
  if (!password.success) return { ok: false, message: password.error.issues[0].message };
  if (formData.get('password') !== formData.get('confirm')) return { ok: false, message: 'As senhas não conferem.' };

  const { error } = await ctx.supabase.auth.updateUser({ password: password.data });
  if (error) {
    return { ok: false, message: error.code === 'same_password' ? 'Escolha uma senha diferente da atual.' : SAVE_ERROR };
  }
  await ctx.supabase.auth.signOut({ scope: 'others' });
  return { ok: true, message: 'Senha alterada. As outras sessões foram encerradas.' };
}

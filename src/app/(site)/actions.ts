'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { vehicleTitle } from '@/lib/format';
import { clientIp, hashValue, isWithinRateLimit } from '@/lib/request';
import { createServiceClient } from '@/lib/supabase/admin';
import { getSite } from '@/lib/tenant';
import type { FormState, LeadType } from '@/lib/types';
import {
  contactLeadSchema,
  evaluationLeadSchema,
  fieldErrorsOf,
  LEAD_CONSENT_VERSION,
  vehicleLeadSchema,
} from '@/lib/validation';
import { getVehicleBySlug } from '@/lib/vehicles';

const GENERIC_ERROR = 'Não conseguimos enviar agora. Tente de novo ou chame no WhatsApp.';
const SUCCESS = 'Recebemos sua mensagem. Respondemos em breve no telefone informado.';
const MIN_FILL_MS = 2500;

type LeadInsert = {
  type: LeadType;
  name: string;
  phone: string;
  email: string | null;
  message: string | null;
  vehicle_id?: string | null;
  vehicle_label?: string | null;
  evaluation?: Record<string, string | number> | null;
};

// Filtros contra robôs e abuso antes de qualquer gravação.
async function passesAbuseChecks(formData: FormData): Promise<'ok' | 'bot' | 'limited'> {
  if (String(formData.get('empresa_site') ?? '') !== '') return 'bot';
  // Sem JavaScript o carimbo de tempo vem vazio: quem é humano segue, limitado só pelas tentativas abaixo.
  const startedAt = Number(formData.get('started_at'));
  if (startedAt > 0 && Date.now() - startedAt < MIN_FILL_MS) return 'bot';

  const ip = await clientIp();
  const [perWindow, perDay] = await Promise.all([
    isWithinRateLimit('lead-10min', ip, 5, 600),
    isWithinRateLimit('lead-dia', ip, 20, 86_400),
  ]);
  return perWindow && perDay ? 'ok' : 'limited';
}

async function saveLead(lead: LeadInsert): Promise<FormState> {
  const site = await getSite();
  if (!site) return { ok: false, message: GENERIC_ERROR };

  const referer = (await headers()).get('referer');
  let sourcePath: string | null = null;
  try {
    sourcePath = referer ? new URL(referer).pathname.slice(0, 300) : null;
  } catch {
    sourcePath = null;
  }

  const { error } = await createServiceClient()
    .from('leads')
    .insert({
      ...lead,
      company_id: site.company.id,
      consent_version: LEAD_CONSENT_VERSION,
      source_path: sourcePath,
      ip_hash: hashValue(await clientIp()),
    });
  if (error) {
    console.error('Falha ao gravar lead', error.code);
    return { ok: false, message: GENERIC_ERROR };
  }
  return { ok: true, message: SUCCESS };
}

function respondToAbuse(result: 'bot' | 'limited'): FormState {
  // Robô recebe resposta de sucesso para não aprender como foi detectado.
  if (result === 'bot') return { ok: true, message: SUCCESS };
  return { ok: false, message: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos ou chame no WhatsApp.' };
}

function invalid(error: z.ZodError): FormState {
  return { ok: false, message: 'Confira os campos destacados.', fieldErrors: fieldErrorsOf(error) };
}

export async function submitContact(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = contactLeadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const check = await passesAbuseChecks(formData);
  if (check !== 'ok') return respondToAbuse(check);
  const { name, phone, email, message } = parsed.data;
  return saveLead({ type: 'contact', name, phone, email, message });
}

export async function submitVehicleInterest(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = vehicleLeadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const check = await passesAbuseChecks(formData);
  if (check !== 'ok') return respondToAbuse(check);

  const site = await getSite();
  if (!site) return { ok: false, message: GENERIC_ERROR };
  const vehicle = await getVehicleBySlug(site.company.id, parsed.data.vehicle_slug);
  if (!vehicle) return { ok: false, message: GENERIC_ERROR };

  const { name, phone, email, message } = parsed.data;
  return saveLead({
    type: 'vehicle_interest',
    name,
    phone,
    email,
    message: message || null,
    vehicle_id: vehicle.id,
    vehicle_label: vehicleTitle(vehicle),
  });
}

export async function submitEvaluation(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = evaluationLeadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const check = await passesAbuseChecks(formData);
  if (check !== 'ok') return respondToAbuse(check);
  const { name, phone, email, message, brand, model, year, mileage_km, intent } = parsed.data;
  return saveLead({
    type: 'evaluation',
    name,
    phone,
    email,
    message: message || null,
    evaluation: { brand, model, year, mileage_km, intent },
  });
}

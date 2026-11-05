'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState, type ReactNode } from 'react';
import { submitContact, submitEvaluation, submitVehicleInterest } from '@/app/(site)/actions';
import { submitKeepingValues } from '@/lib/forms';
import type { FormState } from '@/lib/types';

type Action = (state: FormState, data: FormData) => Promise<FormState>;

function Field({ label, name, error, children, hint }: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={name}>{label}</label>
      {children}
      {hint && !error && <small>{hint}</small>}
      {error && <small className="field-error" role="alert">{error}</small>}
    </div>
  );
}

function FormFrame({ action, submitLabel, children, whatsappHref }: {
  action: Action;
  submitLabel: string;
  whatsappHref: string;
  children: (errors: Record<string, string>) => ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [startedAt, setStartedAt] = useState('');

  useEffect(() => setStartedAt(String(Date.now())), []);

  if (state?.ok) {
    return (
      <div className="form-success" role="status">
        <p className="form-success-title">Mensagem recebida.</p>
        <p>{state.message}</p>
        <a className="btn btn-line" href={whatsappHref} target="_blank" rel="noopener noreferrer">
          Prefere agilizar? Chame no WhatsApp
        </a>
      </div>
    );
  }

  const errors = state?.fieldErrors ?? {};
  return (
    <form action={formAction} onSubmit={submitKeepingValues(formAction)} className="lead-form" noValidate>
      <input type="hidden" name="started_at" value={startedAt} />
      <div className="form-trap" aria-hidden="true">
        <label>
          Site da empresa
          <input type="text" name="empresa_site" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {children(errors)}

      <div className={`field-check${errors.consent ? ' has-error' : ''}`}>
        <label>
          <input type="checkbox" name="consent" required />
          <span>
            Concordo com o uso destes dados para a Forte Veículos responder ao meu contato, conforme a{' '}
            <Link href="/politica-de-privacidade">Política de Privacidade</Link>.
          </span>
        </label>
        {errors.consent && <small className="field-error" role="alert">{errors.consent}</small>}
      </div>

      {state && !state.ok && <p className="form-error" role="alert">{state.message}</p>}

      <button type="submit" className="btn btn-accent" disabled={pending}>
        {pending ? 'Enviando...' : submitLabel}
      </button>
    </form>
  );
}

function ContactFields({ errors }: { errors: Record<string, string> }) {
  return (
    <div className="form-row">
      <Field label="Seu nome" name="name" error={errors.name}>
        <input id="name" name="name" autoComplete="name" required maxLength={120} />
      </Field>
      <Field label="WhatsApp ou telefone" name="phone" error={errors.phone}>
        <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="(28) 99999-9999" maxLength={20} />
      </Field>
    </div>
  );
}

export function ContactForm({ whatsappHref }: { whatsappHref: string }) {
  return (
    <FormFrame action={submitContact} submitLabel="Enviar mensagem" whatsappHref={whatsappHref}>
      {(errors) => (
        <>
          <ContactFields errors={errors} />
          <Field label="E-mail (opcional)" name="email" error={errors.email}>
            <input id="email" name="email" type="email" autoComplete="email" maxLength={180} />
          </Field>
          <Field label="Como podemos ajudar?" name="message" error={errors.message}>
            <textarea id="message" name="message" rows={4} required maxLength={2000} />
          </Field>
        </>
      )}
    </FormFrame>
  );
}

export function VehicleInterestForm({ slug, title, whatsappHref }: { slug: string; title: string; whatsappHref: string }) {
  return (
    <FormFrame action={submitVehicleInterest} submitLabel="Quero saber mais" whatsappHref={whatsappHref}>
      {(errors) => (
        <>
          <input type="hidden" name="vehicle_slug" value={slug} />
          <ContactFields errors={errors} />
          <Field label="E-mail (opcional)" name="email" error={errors.email}>
            <input id="email" name="email" type="email" autoComplete="email" maxLength={180} />
          </Field>
          <Field label="Mensagem (opcional)" name="message" error={errors.message}>
            <textarea id="message" name="message" rows={3} maxLength={2000} placeholder={`Quero mais informações sobre ${title}.`} />
          </Field>
        </>
      )}
    </FormFrame>
  );
}

export function EvaluationForm({ whatsappHref }: { whatsappHref: string }) {
  return (
    <FormFrame action={submitEvaluation} submitLabel="Pedir avaliação" whatsappHref={whatsappHref}>
      {(errors) => (
        <>
          <div className="form-row">
            <Field label="Marca do seu carro" name="brand" error={errors.brand}>
              <input id="brand" name="brand" required maxLength={60} placeholder="Toyota" />
            </Field>
            <Field label="Modelo e versão" name="model" error={errors.model}>
              <input id="model" name="model" required maxLength={80} placeholder="Corolla XEi" />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Ano" name="year" error={errors.year}>
              <input id="year" name="year" type="number" inputMode="numeric" min={1950} required placeholder="2020" />
            </Field>
            <Field label="Quilometragem" name="mileage_km" error={errors.mileage_km}>
              <input id="mileage_km" name="mileage_km" type="number" inputMode="numeric" min={0} required placeholder="60000" />
            </Field>
          </div>
          <fieldset className="field-choice">
            <legend>O que você quer fazer?</legend>
            <label><input type="radio" name="intent" value="vender" defaultChecked /> <span>Vender</span></label>
            <label><input type="radio" name="intent" value="trocar" /> <span>Trocar por outro</span></label>
          </fieldset>
          <ContactFields errors={errors} />
          <Field label="E-mail (opcional)" name="email" error={errors.email}>
            <input id="email" name="email" type="email" autoComplete="email" maxLength={180} />
          </Field>
        </>
      )}
    </FormFrame>
  );
}

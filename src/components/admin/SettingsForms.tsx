'use client';

import { useRouter } from 'next/navigation';
import { startTransition as startActionTransition, useActionState, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import {
  addInstagramPost,
  changeOwnPassword,
  removeInstagramPost,
  updateSiteSettings,
  updateTechnicalSettings,
} from '@/app/admin/(painel)/actions';
import { submitKeepingValues } from '@/lib/forms';
import type { FormState, InstagramPost, SiteSettings, TechnicalSettings } from '@/lib/types';

function Field({ label, error, hint, wide, children }: {
  label: string;
  error?: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`a-field${wide ? ' a-field-wide' : ''}${error ? ' has-error' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && !error && <small>{hint}</small>}
      {error && <small className="a-field-error" role="alert">{error}</small>}
    </label>
  );
}

function Feedback({ state }: { state: FormState }) {
  if (!state) return null;
  return (
    <p className={`alert ${state.ok ? 'alert-ok' : 'alert-error'}`} role={state.ok ? 'status' : 'alert'}>
      {state.message}
    </p>
  );
}

const hoursText = (settings: SiteSettings, day: number) => {
  const slot = settings.hours.find((item) => item.days.includes(day));
  return slot ? `${slot.open} às ${slot.close}` : '';
};

export function SiteSettingsForm({ settings }: { settings: SiteSettings }) {
  const [state, action, pending] = useActionState(updateSiteSettings, null);
  const errors = state?.fieldErrors ?? {};
  return (
    <form action={action} onSubmit={submitKeepingValues(action)} className="a-form">
      <fieldset className="a-fieldset">
        <legend>Contato</legend>
        <div className="a-grid">
          <Field label="Nome da loja" error={errors.display_name}>
            <input name="display_name" defaultValue={settings.display_name} required maxLength={120} />
          </Field>
          <Field label="WhatsApp" error={errors.whatsapp} hint="Com 55 e DDD, só números: 5528999097412">
            <input name="whatsapp" inputMode="numeric" defaultValue={settings.whatsapp} required maxLength={20} />
          </Field>
          <Field label="Telefone exibido" error={errors.phone_display}>
            <input name="phone_display" defaultValue={settings.phone_display ?? ''} maxLength={30} />
          </Field>
          <Field label="E-mail" error={errors.email}>
            <input name="email" type="email" defaultValue={settings.email ?? ''} maxLength={180} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="a-fieldset">
        <legend>Endereço e horário</legend>
        <div className="a-grid">
          <Field label="Rua e número" error={errors.address_street}>
            <input name="address_street" defaultValue={settings.address_street ?? ''} maxLength={160} />
          </Field>
          <Field label="Bairro" error={errors.address_district}>
            <input name="address_district" defaultValue={settings.address_district ?? ''} maxLength={80} />
          </Field>
          <Field label="Cidade" error={errors.address_city}>
            <input name="address_city" defaultValue={settings.address_city ?? ''} maxLength={80} />
          </Field>
          <Field label="Estado" error={errors.address_state}>
            <input name="address_state" defaultValue={settings.address_state ?? ''} maxLength={2} />
          </Field>
          <Field label="CEP" error={errors.address_zip}>
            <input name="address_zip" defaultValue={settings.address_zip ?? ''} maxLength={10} />
          </Field>
          <Field label="Segunda a sexta" error={errors.hours_week} hint="Exemplo: 08:00 às 18:00. Vazio significa fechado.">
            <input name="hours_week" defaultValue={hoursText(settings, 1)} maxLength={40} />
          </Field>
          <Field label="Sábado" error={errors.hours_saturday} hint="Exemplo: 08:00 às 12:00. Vazio significa fechado.">
            <input name="hours_saturday" defaultValue={hoursText(settings, 6)} maxLength={40} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="a-fieldset">
        <legend>Redes e apresentação</legend>
        <div className="a-grid">
          <Field label="Instagram" error={errors.instagram_url}>
            <input name="instagram_url" type="url" defaultValue={settings.instagram_url ?? ''} />
          </Field>
          <Field label="Facebook" error={errors.facebook_url}>
            <input name="facebook_url" type="url" defaultValue={settings.facebook_url ?? ''} />
          </Field>
          <Field label="Texto sobre a loja" error={errors.about_text} wide>
            <textarea name="about_text" rows={5} maxLength={2000} defaultValue={settings.about_text ?? ''} />
          </Field>
        </div>
      </fieldset>

      <Feedback state={state} />
      <div className="a-form-actions">
        <button className="a-btn a-btn-primary" disabled={pending}>{pending ? 'Salvando...' : 'Salvar informações'}</button>
      </div>
    </form>
  );
}

export function InstagramPostsForm({ posts }: { posts: InstagramPost[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(addInstagramPost, null);
  const [removing, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // O vídeo vai direto para o Storage por uma URL assinada no servidor, e a publicação só é salva depois disso.
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = fileRef.current?.files?.[0];
    data.delete('video');
    setUploadError(null);
    if (file) {
      setUploading(true);
      try {
        const signed = await fetch('/api/admin/instagram-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: file.type, size: file.size }),
        });
        const payload = (await signed.json().catch(() => null)) as { url?: string; path?: string; message?: string } | null;
        if (!signed.ok || !payload?.url || !payload.path) throw new Error(payload?.message ?? 'Não foi possível enviar o vídeo.');
        const sent = await fetch(payload.url, { method: 'PUT', headers: { 'Content-Type': file.type, 'Cache-Control': 'max-age=31536000' }, body: file });
        if (!sent.ok) throw new Error('Não foi possível enviar o vídeo. Confira se tem até 50 MB.');
        data.set('video_path', payload.path);
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : 'Não foi possível enviar o vídeo.');
        setUploading(false);
        return;
      }
      setUploading(false);
    }
    startActionTransition(() => action(data));
    form.reset();
  }
  return (
    <section className="a-card a-section-gap" aria-labelledby="instagram-title">
      <div className="a-card-head"><h2 id="instagram-title">Publicações do Instagram no site</h2></div>
      <p className="muted">
        Cole o link de até 6 vídeos e envie o arquivo do mesmo vídeo. Com o arquivo, ele roda sozinho no site, sem som, dentro da moldura.
        Só com o link, o Instagram não deixa rodar sozinho: a pessoa precisa aceitar os cookies de marketing e tocar para ver.
      </p>
      <form onSubmit={submit} className="a-form a-grid">
        <Field label="Link da publicação">
          <input id="permalink" name="permalink" type="url" required placeholder="https://www.instagram.com/reel/..." />
        </Field>
        <Field label="Arquivo do vídeo" hint="MP4, WebM ou MOV, até 50 MB. Opcional.">
          <input ref={fileRef} name="video" type="file" accept="video/mp4,video/webm,video/quicktime" />
        </Field>
        <div className="a-form-actions a-field-wide">
          <button className="a-btn" disabled={pending || uploading}>{uploading ? 'Enviando vídeo...' : pending ? 'Salvando...' : 'Adicionar'}</button>
        </div>
      </form>
      {uploadError && <p className="alert alert-error" role="alert">{uploadError}</p>}
      <Feedback state={state} />
      {posts.length > 0 && (
        <ul className="a-list a-list-plain">
          {posts.map((post) => (
            <li key={post.id}>
              <a href={post.permalink} target="_blank" rel="noopener noreferrer">{post.permalink}</a>
              <span className="muted">{post.video_path ? 'Com vídeo' : 'Só o link'}</span>
              <button
                type="button"
                className="a-btn a-btn-small a-btn-danger"
                disabled={removing}
                onClick={() =>
                  startTransition(async () => {
                    await removeInstagramPost(post.id);
                    router.refresh();
                  })
                }
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TechnicalSettingsForm({ technical }: { technical: TechnicalSettings }) {
  const [state, action, pending] = useActionState(updateTechnicalSettings, null);
  const errors = state?.fieldErrors ?? {};
  return (
    <form action={action} onSubmit={submitKeepingValues(action)} className="a-form">
      <fieldset className="a-fieldset">
        <legend>Site e medição</legend>
        <div className="a-grid">
          <Field label="Endereço oficial do site" error={errors.canonical_url} hint="Usado em SEO e nos links compartilhados.">
            <input name="canonical_url" type="url" defaultValue={technical.canonical_url ?? ''} />
          </Field>
          <Field label="Google Analytics (GA4)" error={errors.ga4_id} hint="Só carrega depois do consentimento.">
            <input name="ga4_id" defaultValue={technical.ga4_id ?? ''} placeholder="G-XXXXXXXXXX" />
          </Field>
          <Field label="Meta Pixel" error={errors.meta_pixel_id} hint="Só carrega depois do consentimento.">
            <input name="meta_pixel_id" inputMode="numeric" defaultValue={technical.meta_pixel_id ?? ''} />
          </Field>
        </div>
      </fieldset>
      <fieldset className="a-fieldset">
        <legend>Dados legais (LGPD)</legend>
        <div className="a-grid">
          <Field label="Razão social" error={errors.legal_name}>
            <input name="legal_name" defaultValue={technical.legal_name ?? ''} maxLength={160} />
          </Field>
          <Field label="CNPJ" error={errors.cnpj}>
            <input name="cnpj" defaultValue={technical.cnpj ?? ''} placeholder="00.000.000/0000-00" />
          </Field>
          <Field label="Encarregado de dados" error={errors.dpo_name}>
            <input name="dpo_name" defaultValue={technical.dpo_name ?? ''} maxLength={120} />
          </Field>
          <Field label="E-mail do encarregado" error={errors.dpo_email}>
            <input name="dpo_email" type="email" defaultValue={technical.dpo_email ?? ''} maxLength={180} />
          </Field>
        </div>
      </fieldset>
      <Feedback state={state} />
      <div className="a-form-actions">
        <button className="a-btn a-btn-primary" disabled={pending}>{pending ? 'Salvando...' : 'Salvar ajustes'}</button>
      </div>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changeOwnPassword, null);
  return (
    <form action={action} className="a-form a-form-narrow">
      <Field label="Nova senha" hint="Ao menos 12 caracteres, com letras e números.">
        <input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
      </Field>
      <Field label="Repita a nova senha">
        <input name="confirm" type="password" autoComplete="new-password" required maxLength={128} />
      </Field>
      <Feedback state={state} />
      <div className="a-form-actions">
        <button className="a-btn a-btn-primary" disabled={pending}>{pending ? 'Salvando...' : 'Alterar senha'}</button>
      </div>
    </form>
  );
}

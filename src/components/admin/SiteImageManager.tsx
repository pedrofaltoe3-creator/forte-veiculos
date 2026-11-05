'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ACCEPTED_PHOTOS, MAX_INPUT_BYTES, prepareForUpload } from '@/lib/prepare-photo';

export type ManagedSiteImage = { slot: string; label: string; hint: string; url: string; isCustom: boolean };

export function SiteImageManager({ images }: { images: ManagedSiteImage[] }) {
  const router = useRouter();
  // Uma foto por vez: todas ficam na mesma linha do banco.
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ slot: string; message: string } | null>(null);

  async function send(slot: string, method: 'POST' | 'DELETE', body?: FormData) {
    setBusy(slot);
    setProblem(null);
    try {
      const response = await fetch(`/api/admin/site-images/${slot}`, { method, body });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        setProblem({ slot, message: payload?.message ?? 'Não foi possível salvar. Tente de novo.' });
      }
    } catch {
      setProblem({ slot, message: 'Não foi possível salvar. Tente de novo.' });
    }
    setBusy(null);
    router.refresh();
  }

  async function replace(slot: string, file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_PHOTOS.includes(file.type)) {
      setProblem({ slot, message: 'Use uma foto JPG, PNG ou WebP.' });
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      setProblem({ slot, message: 'Arquivo grande demais.' });
      return;
    }
    setBusy(slot);
    try {
      const body = new FormData();
      body.append('file', await prepareForUpload(file), file.name);
      await send(slot, 'POST', body);
    } catch {
      setBusy(null);
      setProblem({ slot, message: 'Não foi possível ler esta foto. Tente outra.' });
    }
  }

  const restore = (slot: string) => {
    if (window.confirm('Voltar para a foto original do site?')) void send(slot, 'DELETE');
  };

  return (
    <ul className="a-site-images">
      {images.map((image) => (
        <li key={image.slot} className="a-card a-site-image" data-slot={image.slot}>
          <img src={image.url} alt={`Foto atual: ${image.label}`} width={480} height={320} loading="lazy" />
          <span className="a-photo-badge">{image.isCustom ? 'Foto da loja' : 'Original'}</span>
          <h2>{image.label}</h2>
          <p className="muted">{image.hint}</p>
          {problem?.slot === image.slot && <p className="alert alert-error" role="alert">{problem.message}</p>}
          <div className="a-photo-actions">
            <input
              id={`foto-${image.slot}`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={busy !== null}
              onChange={(event) => {
                void replace(image.slot, event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <label htmlFor={`foto-${image.slot}`} className={`a-btn a-btn-primary a-btn-small${busy !== null ? ' is-disabled' : ''}`}>
              {busy === image.slot ? 'Salvando...' : 'Trocar foto'}
            </label>
            {image.isCustom && (
              <button type="button" className="a-btn a-btn-small" disabled={busy !== null} onClick={() => restore(image.slot)}>
                Voltar à original
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

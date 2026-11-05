'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { deletePhoto, reorderPhotos, setPrimaryPhoto } from '@/app/admin/(painel)/actions';
import { ACCEPTED_PHOTOS, MAX_INPUT_BYTES, prepareForUpload } from '@/lib/prepare-photo';

export type ManagedPhoto = { id: string; url: string; is_primary: boolean };

export function PhotoManager({ vehicleId, photos }: { vehicleId: string; photos: ManagedPhoto[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState(photos);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [pending, startTransition] = useTransition();

  // Depois de cada atualização do servidor a lista recebida volta a ser a fonte da verdade.
  const [lastPhotos, setLastPhotos] = useState(photos);
  if (photos !== lastPhotos) {
    setLastPhotos(photos);
    setItems(photos);
  }

  async function upload(files: File[]) {
    const problems: string[] = [];
    let done = 0;
    for (const file of files) {
      setProgress(`Enviando foto ${done + 1} de ${files.length}...`);
      if (!ACCEPTED_PHOTOS.includes(file.type)) {
        problems.push(`${file.name}: use JPG, PNG ou WebP.`);
        done += 1;
        continue;
      }
      if (file.size > MAX_INPUT_BYTES) {
        problems.push(`${file.name}: arquivo grande demais.`);
        done += 1;
        continue;
      }
      try {
        const body = new FormData();
        body.append('file', await prepareForUpload(file), file.name);
        const response = await fetch(`/api/admin/vehicles/${vehicleId}/photos`, { method: 'POST', body });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: string } | null;
          problems.push(`${file.name}: ${payload?.message ?? 'não foi possível enviar.'}`);
        }
      } catch {
        problems.push(`${file.name}: não foi possível enviar.`);
      }
      done += 1;
    }
    setProgress(null);
    setErrors(problems);
    router.refresh();
  }

  const onSelect = (list: FileList | null) => {
    if (!list?.length) return;
    void upload([...list]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const makePrimary = (id: string) => {
    setErrors([]);
    setItems((current) => current.map((item) => ({ ...item, is_primary: item.id === id })));
    startTransition(async () => {
      const result = await setPrimaryPhoto(id);
      if (!result.ok) setErrors([result.message ?? 'Não foi possível definir a foto principal.']);
      router.refresh();
    });
  };

  const remove = (id: string) => {
    if (!window.confirm('Excluir esta foto?')) return;
    setErrors([]);
    startTransition(async () => {
      const result = await deletePhoto(id);
      if (!result.ok) setErrors([result.message ?? 'Não foi possível excluir a foto.']);
      router.refresh();
    });
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    startTransition(async () => {
      const result = await reorderPhotos(vehicleId, next.map((item) => item.id));
      if (!result.ok) setErrors(['Não foi possível reordenar.']);
      router.refresh();
    });
  };

  return (
    <section className="a-card" aria-labelledby="fotos-title">
      <div className="a-card-head">
        <h2 id="fotos-title">Fotos</h2>
        <span className="muted">{items.length} de 40</span>
      </div>

      <div
        className={`a-dropzone${dragOver ? ' is-over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          onSelect(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          id="fotos-input"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => onSelect(event.target.files)}
        />
        <label htmlFor="fotos-input" className="a-btn a-btn-primary">Adicionar fotos</label>
        <p className="muted">Arraste aqui ou escolha do celular ou computador. JPG, PNG ou WebP.</p>
        {progress && <p role="status" className="a-progress">{progress}</p>}
      </div>

      {errors.length > 0 && (
        <ul className="alert alert-error a-error-list" role="alert">
          {errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}

      {items.length === 0 ? (
        <p className="muted">Nenhuma foto ainda. A primeira enviada vira a foto principal.</p>
      ) : (
        <ul className={`a-photos${pending ? ' is-pending' : ''}`}>
          {items.map((photo, index) => (
            <li key={photo.id} className={photo.is_primary ? 'is-primary' : ''}>
              <img src={photo.url} alt={`Foto ${index + 1}`} width={320} height={240} loading="lazy" />
              {photo.is_primary && <span className="a-photo-badge">Principal</span>}
              <div className="a-photo-actions">
                <button type="button" className="a-btn a-btn-small" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Mover foto ${index + 1} para trás`}>‹</button>
                <button type="button" className="a-btn a-btn-small" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label={`Mover foto ${index + 1} para frente`}>›</button>
                {!photo.is_primary && (
                  <button type="button" className="a-btn a-btn-small" onClick={() => makePrimary(photo.id)}>Principal</button>
                )}
                <button type="button" className="a-btn a-btn-small a-btn-danger" onClick={() => remove(photo.id)} aria-label={`Excluir foto ${index + 1}`}>Excluir</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

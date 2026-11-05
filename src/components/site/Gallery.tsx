'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type GalleryPhoto = { full: string; thumb: string; alt: string; width: number; height: number };

export function Gallery({ photos, title }: { photos: GalleryPhoto[]; title: string }) {
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const touchStart = useRef<number | null>(null);
  const count = photos.length;

  const go = useCallback((delta: number) => setIndex((current) => (current + delta + count) % count), [count]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const onKey = (event: KeyboardEvent) => {
      if (!dialog?.open) return;
      if (event.key === 'ArrowRight') go(1);
      if (event.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  if (count === 0) {
    return <div className="gallery-empty mono">Fotos em breve. Peça pelo WhatsApp.</div>;
  }

  const current = photos[index];
  const swipe = {
    onTouchStart: (event: React.TouchEvent) => {
      touchStart.current = event.touches[0].clientX;
    },
    onTouchEnd: (event: React.TouchEvent) => {
      if (touchStart.current === null) return;
      const distance = event.changedTouches[0].clientX - touchStart.current;
      touchStart.current = null;
      if (Math.abs(distance) > 40) go(distance < 0 ? 1 : -1);
    },
  };

  return (
    <div className="gallery">
      <div className="gallery-main" {...swipe}>
        <button type="button" className="gallery-open" onClick={() => dialogRef.current?.showModal()} aria-label={`Ampliar foto ${index + 1} de ${count}`}>
          <img src={current.full} alt={current.alt} width={current.width} height={current.height} fetchPriority="high" />
        </button>
        {count > 1 && (
          <>
            <button type="button" className="gallery-nav gallery-prev" onClick={() => go(-1)} aria-label="Foto anterior">‹</button>
            <button type="button" className="gallery-nav gallery-next" onClick={() => go(1)} aria-label="Próxima foto">›</button>
          </>
        )}
        <span className="gallery-count mono" aria-live="polite">{index + 1} / {count}</span>
      </div>

      {count > 1 && (
        <ul className="gallery-thumbs">
          {photos.map((photo, photoIndex) => (
            <li key={photo.full}>
              <button
                type="button"
                className={photoIndex === index ? 'is-current' : ''}
                aria-label={`Ver foto ${photoIndex + 1}`}
                aria-current={photoIndex === index}
                onClick={() => setIndex(photoIndex)}
              >
                <img src={photo.thumb} alt="" loading="lazy" width={160} height={120} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <dialog ref={dialogRef} className="lightbox" aria-label={`Fotos de ${title}`}>
        <form method="dialog">
          <button className="lightbox-close" aria-label="Fechar">×</button>
        </form>
        <div className="lightbox-body" {...swipe}>
          <img src={current.full} alt={current.alt} />
          {count > 1 && (
            <>
              <button type="button" className="gallery-nav gallery-prev" onClick={() => go(-1)} aria-label="Foto anterior">‹</button>
              <button type="button" className="gallery-nav gallery-next" onClick={() => go(1)} aria-label="Próxima foto">›</button>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}

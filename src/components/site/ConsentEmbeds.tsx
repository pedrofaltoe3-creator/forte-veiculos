'use client';

import { useEffect, useRef, useState } from 'react';
import { CookiePreferencesButton, useConsent } from '@/components/site/CookieConsent';

// O vídeo fica no próprio site: só toca enquanto está na tela e sem som, para não gastar a internet de quem visita.
function ReelVideo({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReduced(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void video.play().catch(() => undefined);
        else video.pause();
      },
      { threshold: 0.35 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return <video ref={videoRef} src={src} muted loop playsInline preload="none" controls={reduced} aria-label="Vídeo publicado no Instagram da loja" />;
}

// O vídeo enviado pela loja roda sozinho e não grava cookies. Só com o link, quem toca é o Instagram:
// ele grava cookies, então só carrega com consentimento de marketing, e pede um toque para começar.
export function InstagramEmbeds({ posts, profileUrl }: { posts: { id: string; permalink: string; videoUrl: string | null }[]; profileUrl: string | null }) {
  const consent = useConsent();

  if (posts.length === 0) return null;

  return (
    <ul className="ig-grid">
      {posts.map((post) => (
        <li key={post.id} className="ig-item">
          <div className="ig-frame">
            {post.videoUrl ? (
              <>
                <ReelVideo src={post.videoUrl} />
                <a className="ig-frame-link" href={post.permalink} target="_blank" rel="noopener noreferrer" aria-label="Abrir este vídeo no Instagram" />
              </>
            ) : consent?.marketing ? (
              <iframe
                src={`${post.permalink}embed/`}
                title="Vídeo do Instagram"
                loading="lazy"
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            ) : (
              <div className="ig-gate">
                <p>Este vídeo vem do Instagram e aparece se você aceitar os cookies de marketing.</p>
                <CookiePreferencesButton className="btn btn-line btn-small" />
                <a className="btn btn-line btn-small" href={post.permalink} target="_blank" rel="noopener noreferrer">
                  Abrir no Instagram
                </a>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MapEmbed({ query, title, mapsUrl }: { query: string; title: string; mapsUrl: string }) {
  const consent = useConsent();
  const [clicked, setClicked] = useState(false);

  if (consent?.marketing || clicked) {
    return (
      <iframe
        className="map-frame"
        src={`https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`}
        title={title}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    );
  }

  return (
    <div className="map-gate">
      <span className="map-pin" aria-hidden="true" />
      <p className="map-gate-address">{query}</p>
      <div className="embed-gate-actions">
        <button type="button" className="btn btn-accent btn-small" onClick={() => setClicked(true)}>
          Mostrar mapa
        </button>
        <a className="btn btn-line btn-small" href={mapsUrl} target="_blank" rel="noopener noreferrer">
          Traçar rota
        </a>
      </div>
      <small>O mapa é do Google e só carrega depois do seu clique.</small>
    </div>
  );
}

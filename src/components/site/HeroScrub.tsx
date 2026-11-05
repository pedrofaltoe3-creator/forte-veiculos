'use client';

import Link from 'next/link';
import { Fragment, useEffect, useRef, type CSSProperties } from 'react';

const VIDEO_URL = '/hero/hero-scrub.mp4';
const POSTER_URL = '/hero/hero-poster.webp';
const VIDEO_BYTES = 3_669_886;

// As cinco condições precisam ser idênticas às media queries de .hero em site.css.
const GATES = [
  '(max-width: 720px)',
  '(orientation: portrait) and (max-width: 1024px)',
  '(orientation: portrait) and (pointer: coarse)',
  '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)',
  '(prefers-reduced-motion: reduce)',
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smoothstep = (p: number, e0: number, e1: number) => {
  const t = clamp((p - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// Divisão determinística: servidor e navegador geram os mesmos deslocamentos.
function SplitWords({ text, seed, spread = 0.5, as = 'p', className }: {
  text: string;
  seed: number;
  spread?: number;
  as?: 'h1' | 'p';
  className?: string;
}) {
  const random = rng(seed);
  const words = text.split(' ');
  const Tag = as;
  return (
    <Tag className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((word, index) => {
          const style = {
            '--th': ((index / Math.max(1, words.length - 1)) * spread + random() * 0.04).toFixed(3),
            '--jy': `${(14 + random() * 22).toFixed(1)}px`,
          } as CSSProperties;
          return (
            <Fragment key={`${word}-${index}`}>
              <span className="w" style={style}>{word}</span>{' '}
            </Fragment>
          );
        })}
      </span>
    </Tag>
  );
}

const HERO_TITLE = 'Seu próximo carro está na Forte.';
const HERO_TEXT = 'Compra, venda e troca de seminovos em Cachoeiro de Itapemirim. Escolha o carro, peça os detalhes e venha ver de perto.';

export function HeroScrub({ whatsappHref, customImage }: { whatsappHref: string; customImage: string | null }) {
  const rootRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const posterRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const video = videoRef.current;
    const stage = stageRef.current;
    const poster = posterRef.current;
    const ring = ringRef.current;
    if (!root || !video || !stage || !poster || !ring) return;

    const bands = [...root.querySelectorAll<HTMLElement>('.band')].map((el, index) => ({
      el,
      index,
      from: Number(el.dataset.from),
      to: Number(el.dataset.to),
      ramp: el.dataset.ramp ? Number(el.dataset.ramp) : 0,
      opacity: -1,
      k: -1,
    }));
    const last = bands.length - 1;

    let target = 0;
    let shown = 0;
    let rafId: number | null = null;
    let lastTick = 0;
    let heroOnScreen = true;
    let scrubOn = false;
    let started = false;
    let disposed = false;
    let seekBusy = false;
    let pendingTime: number | null = null;
    let loadK = 0;
    let loadRaf: number | null = null;
    let controller: AbortController | null = null;
    let objectUrl: string | null = null;

    const heroProgress = () => {
      const rect = root.getBoundingClientRect();
      const range = rect.height - innerHeight;
      return range > 0 ? clamp(-rect.top / range, 0, 1) : 0;
    };

    const requestSeek = (time: number) => {
      if (!video.duration) return;
      if (seekBusy) {
        pendingTime = time;
        return;
      }
      seekBusy = true;
      video.currentTime = time;
    };

    const onSeeked = () => {
      seekBusy = false;
      if (pendingTime !== null) {
        const time = pendingTime;
        pendingTime = null;
        requestSeek(time);
      }
    };

    const updateCaptions = (p: number) => {
      for (const band of bands) {
        const f = Math.min(0.02, (band.to - band.from) / 3);
        const fadeIn = band.index === 0 ? 1 : smoothstep(p, band.from, band.from + f);
        const fadeOut = band.index === last ? 1 : 1 - smoothstep(p, band.to - f, band.to);
        const opacity = Math.round(fadeIn * fadeOut * 1000) / 1000;
        if (opacity !== band.opacity) {
          band.opacity = opacity;
          band.el.style.opacity = String(opacity);
          band.el.classList.toggle('band-on', opacity > 0.5);
        }
        const ramp = band.ramp || Math.min(0.025, (band.to - band.from) * 0.35);
        let k = clamp((p - band.from) / ramp, 0, 1);
        if (band.index === 0) k = Math.max(k, loadK);
        if (Math.abs(k - band.k) > 0.008 || (k !== band.k && (k === 0 || k === 1))) {
          band.k = k;
          band.el.style.setProperty('--k', k.toFixed(3));
        }
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(100, now - (lastTick || now));
      lastTick = now;
      shown += (target - shown) * (1 - Math.pow(1 - 0.16, dt / 16.667));
      if (Math.abs(target - shown) < 0.0005) {
        shown = target;
        rafId = null;
        lastTick = 0;
      } else {
        rafId = requestAnimationFrame(tick);
      }
      requestSeek(shown * (video.duration || 0));
      updateCaptions(shown);
    };

    const onScroll = () => {
      target = heroProgress();
      if (rafId === null && heroOnScreen) rafId = requestAnimationFrame(tick);
    };

    const failVideo = () => {
      if (!disposed) stage.classList.add('video-failed');
    };

    async function loadBlob() {
      controller = new AbortController();
      const ctrl = controller;
      let watchdog = setTimeout(() => ctrl.abort(), 20000);
      const response = await fetch(VIDEO_URL, { priority: 'low', signal: ctrl.signal } as RequestInit);
      if (!response.ok || !response.body) throw new Error(`Vídeo indisponível: ${response.status}`);
      const total = Number(response.headers.get('Content-Length')) || VIDEO_BYTES;
      const reader = response.body.getReader();
      const chunks: BlobPart[] = [];
      let received = 0;
      let lastRing = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(watchdog);
        watchdog = setTimeout(() => ctrl.abort(), 20000);
        chunks.push(value);
        received += value.length;
        const fraction = Math.min(1, received / total);
        const now = performance.now();
        if (now - lastRing > 100 || fraction === 1) {
          lastRing = now;
          ring!.style.setProperty('--ld', String(Math.round(126 * (1 - fraction))));
        }
      }
      clearTimeout(watchdog);
      if (disposed) return;
      ring!.style.setProperty('--ld', '0');
      objectUrl = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
      video!.src = objectUrl;
      video!.load();
      video!.addEventListener(
        'canplay',
        () => {
          requestSeek(heroProgress() * video!.duration);
          stage!.classList.add('video-ready');
        },
        { once: true },
      );
    }

    const startBlobFetch = () => {
      if (started || disposed) return;
      started = true;
      loadBlob().catch(failVideo);
    };

    let initialized = false;
    const initHeroOnce = () => {
      if (initialized) return;
      initialized = true;
      poster.style.backgroundImage = `url('${POSTER_URL}')`;
      const image = new Image();
      image.onload = startBlobFetch;
      image.onerror = startBlobFetch;
      image.src = POSTER_URL;
      setTimeout(startBlobFetch, 4000);
    };

    const enableScrub = () => {
      if (scrubOn) return;
      scrubOn = true;
      initHeroOnce();
      addEventListener('scroll', onScroll, { passive: true });
      for (const band of bands) {
        band.opacity = -1;
        band.k = -1;
      }
      updateCaptions(heroProgress());
      onScroll();
      // A primeira faixa abre montada: rampa única no carregamento, depois o scroll comanda.
      const startedAt = performance.now();
      const ramp = (now: number) => {
        loadK = clamp((now - startedAt - 150) / 900, 0, 1);
        updateCaptions(heroProgress());
        loadRaf = loadK < 1 ? requestAnimationFrame(ramp) : null;
      };
      loadRaf = requestAnimationFrame(ramp);
    };

    const disableScrub = () => {
      if (!scrubOn) return;
      scrubOn = false;
      removeEventListener('scroll', onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (loadRaf !== null) cancelAnimationFrame(loadRaf);
      rafId = null;
      loadRaf = null;
    };

    const applyHeroMode = () => {
      if (GATES.some((query) => matchMedia(query).matches)) disableScrub();
      else enableScrub();
    };

    const onVideoError = () => {
      seekBusy = false;
      pendingTime = null;
      failVideo();
    };

    const observer = new IntersectionObserver((entries) => {
      heroOnScreen = entries[0].isIntersecting;
      if (heroOnScreen) onScroll();
    });
    observer.observe(root);

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onVideoError);
    const lists = GATES.map((query) => matchMedia(query));
    lists.forEach((list) => list.addEventListener('change', applyHeroMode));
    applyHeroMode();

    return () => {
      disposed = true;
      disableScrub();
      controller?.abort();
      observer.disconnect();
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onVideoError);
      lists.forEach((list) => list.removeEventListener('change', applyHeroMode));
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  return (
    <section className={`hero${customImage ? ' hero-custom' : ''}`} ref={rootRef} aria-label="Apresentação">
      {!customImage && <div className="hero-track">
        <div className="hero-stage" ref={stageRef}>
          <div className="hero-poster" ref={posterRef} aria-hidden="true" />
          <video ref={videoRef} preload="none" muted playsInline aria-hidden="true" tabIndex={-1} />
          <div className="scrim" aria-hidden="true" />

          <div className="band band-a" data-from="0" data-to="0.24" data-ramp="0.02">
            <p className="chip mono">Forte Veículos · Cachoeiro de Itapemirim, ES</p>
            <SplitWords className="band-title enter-sharpen" text="Carro bom. Negócio forte." seed={11} />
          </div>

          <div className="band band-b" data-from="0.27" data-to="0.5">
            <SplitWords
              className="band-title band-title-m enter-drift"
              text="Você fecha negócio sabendo de tudo."
              seed={23}
            />
            <p className="band-sub">Procedência, quilometragem e documentos, sem enrolação.</p>
          </div>

          <div className="band band-c" data-from="0.53" data-to="0.76">
            <SplitWords className="band-title band-title-m enter-approach" text="Nenhum carro está aqui por acaso." seed={37} />
            <p className="band-sub">Cada um é escolhido antes de chegar ao pátio.</p>
          </div>

          <div className="band band-d" data-from="0.8" data-to="1" data-ramp="0.05">
            <SplitWords as="h1" className="band-title band-title-m enter-rise" text={HERO_TITLE} seed={41} spread={0.42} />
            <p className="band-sub stage-sub">{HERO_TEXT}</p>
            <div className="hero-actions stage-cta">
              <Link className="btn btn-accent" href="/veiculos">
                Ver estoque
              </Link>
              <a className="btn btn-line" href={whatsappHref} target="_blank" rel="noopener noreferrer">
                Falar no WhatsApp
              </a>
            </div>
          </div>

          <svg className="ring" ref={ringRef} viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="126" />
          </svg>
          <div className="scroll-cue mono" aria-hidden="true">
            Role para conhecer
          </div>
        </div>
      </div>}

      <div className="hero-static">
        <div className="hero-static-copy">
          <p className="chip mono">Forte Veículos · Cachoeiro de Itapemirim, ES</p>
          <h1 className="hero-static-title">{HERO_TITLE}</h1>
          <p className="hero-static-text">{HERO_TEXT}</p>
          <div className="hero-actions">
            <Link className="btn btn-accent" href="/veiculos">
              Ver estoque
            </Link>
            <a className="btn btn-line" href={whatsappHref} target="_blank" rel="noopener noreferrer">
              Falar no WhatsApp
            </a>
          </div>
        </div>
        <div
          className="hero-static-image"
          role="img"
          aria-label={customImage ? 'Foto de abertura da loja' : 'Sedã iluminado por uma linha de luz amarela em um estúdio azul'}
          style={customImage ? ({ '--hero-image': `url("${customImage}")` } as CSSProperties) : undefined}
        />
      </div>
    </section>
  );
}

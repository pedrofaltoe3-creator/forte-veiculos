'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ANALYTICS_COOKIES,
  clearTrackingCookies,
  CONSENT_EVENT,
  COOKIE_POLICY_VERSION,
  MARKETING_COOKIES,
  OPEN_PREFERENCES_EVENT,
  readConsent,
  writeConsent,
  type ConsentState,
} from '@/lib/consent';

type Props = { ga4Id: string | null; metaPixelId: string | null; nonce?: string };
type Action = 'accept_all' | 'reject_all' | 'custom' | 'revoke';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; callMethod?: unknown; loaded?: boolean; version?: string; push?: unknown };
    _fbq?: unknown;
  }
}

function addScript(src: string, nonce?: string) {
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  if (nonce) script.nonce = nonce;
  document.head.appendChild(script);
}

function loadAnalytics(id: string, nonce?: string) {
  if (window.gtag) return;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // O gtag exige o objeto arguments, não um array.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', id, { anonymize_ip: true });
  addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`, nonce);
}

function loadPixel(id: string, nonce?: string) {
  if (window.fbq) return;
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) (fbq.callMethod as (...a: unknown[]) => void)(...args);
    else fbq.queue!.push(args);
  } as NonNullable<Window['fbq']>;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  window.fbq = fbq;
  window._fbq = fbq;
  addScript('https://connect.facebook.net/en_US/fbevents.js', nonce);
  fbq('init', id);
  fbq('track', 'PageView');
}

export function CookieConsent({ ga4Id, metaPixelId, nonce }: Props) {
  const [visible, setVisible] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const previous = useRef<ConsentState | null>(null);

  const applyTrackers = useCallback(
    (state: ConsentState | null) => {
      if (state?.analytics && ga4Id) loadAnalytics(ga4Id, nonce);
      if (state?.marketing && metaPixelId) loadPixel(metaPixelId, nonce);
    },
    [ga4Id, metaPixelId, nonce],
  );

  useEffect(() => {
    const saved = readConsent();
    previous.current = saved;
    if (saved) {
      setAnalytics(saved.analytics);
      setMarketing(saved.marketing);
      applyTrackers(saved);
    } else {
      setVisible(true);
    }
    const open = () => {
      setCustomizing(true);
      setVisible(true);
    };
    window.addEventListener(OPEN_PREFERENCES_EVENT, open);
    return () => window.removeEventListener(OPEN_PREFERENCES_EVENT, open);
  }, [applyTrackers]);

  function decide(action: Action, nextAnalytics: boolean, nextMarketing: boolean) {
    const before = previous.current;
    const state: ConsentState = {
      id: before?.id ?? crypto.randomUUID(),
      analytics: nextAnalytics,
      marketing: nextMarketing,
      version: COOKIE_POLICY_VERSION,
      decidedAt: new Date().toISOString(),
    };
    const revokedAnalytics = Boolean(before?.analytics && !nextAnalytics);
    const revokedMarketing = Boolean(before?.marketing && !nextMarketing);

    writeConsent(state);
    previous.current = state;
    setAnalytics(nextAnalytics);
    setMarketing(nextMarketing);
    setVisible(false);
    setCustomizing(false);

    void fetch('/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject_id: state.id,
        action: revokedAnalytics || revokedMarketing ? 'revoke' : action,
        analytics: nextAnalytics,
        marketing: nextMarketing,
        policy_version: COOKIE_POLICY_VERSION,
      }),
      keepalive: true,
    }).catch(() => undefined);

    if (revokedAnalytics) clearTrackingCookies(ANALYTICS_COOKIES);
    if (revokedMarketing) clearTrackingCookies(MARKETING_COOKIES);
    // Rastreadores já carregados só deixam a página ao recarregar.
    if (revokedAnalytics || revokedMarketing) location.reload();
    else applyTrackers(state);
  }

  if (!visible) return null;

  return (
    <aside className="consent" role="dialog" aria-modal="false" aria-labelledby="consent-title">
      <p className="consent-title" id="consent-title">
        Cookies, só com a sua decisão
      </p>
      <p className="consent-text">
        Usamos cookies necessários para o site funcionar. Os de análise e marketing ficam desligados até você escolher.
        Saiba mais na <Link href="/politica-de-cookies">Política de Cookies</Link>.
      </p>

      {customizing && (
        <div className="consent-options">
          <label className="consent-option">
            <input type="checkbox" checked disabled />
            <span>
              <strong>Necessários</strong>
              <small>Mantêm o site funcionando e guardam esta escolha. Sempre ligados.</small>
            </span>
          </label>
          <label className="consent-option">
            <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} />
            <span>
              <strong>Analíticos</strong>
              <small>Google Analytics: mostram quais páginas são mais vistas, de forma agregada.</small>
            </span>
          </label>
          <label className="consent-option">
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
            <span>
              <strong>Marketing</strong>
              <small>Meta Pixel, publicações do Instagram e mapa do Google incorporados na página.</small>
            </span>
          </label>
        </div>
      )}

      <div className="consent-actions">
        <button type="button" className="btn btn-accent btn-small" onClick={() => decide('accept_all', true, true)}>
          Aceitar todos
        </button>
        <button type="button" className="btn btn-line btn-small" onClick={() => decide('reject_all', false, false)}>
          Rejeitar não essenciais
        </button>
        {customizing ? (
          <button type="button" className="btn btn-line btn-small" onClick={() => decide('custom', analytics, marketing)}>
            Salvar escolhas
          </button>
        ) : (
          <button type="button" className="btn btn-line btn-small" onClick={() => setCustomizing(true)}>
            Personalizar
          </button>
        )}
      </div>
    </aside>
  );
}

export function CookiePreferencesButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PREFERENCES_EVENT))}>
      Preferências de cookies
    </button>
  );
}

export function useConsent() {
  const [state, setState] = useState<ConsentState | null>(null);
  useEffect(() => {
    setState(readConsent());
    const onChange = (event: Event) => setState((event as CustomEvent<ConsentState>).detail);
    window.addEventListener(CONSENT_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_EVENT, onChange);
  }, []);
  return state;
}

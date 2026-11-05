// Preferências de cookies do visitante. Não há nada ativo além do necessário até a pessoa decidir.
export const CONSENT_COOKIE = 'fv_consent';
export const CONSENT_EVENT = 'fv:consent-change';
export const OPEN_PREFERENCES_EVENT = 'fv:open-cookie-preferences';
export const COOKIE_POLICY_VERSION = '2026-11';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export type ConsentState = {
  id: string;
  analytics: boolean;
  marketing: boolean;
  version: string;
  decidedAt: string;
};

export function readConsent(): ConsentState | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`));
  if (!match) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as ConsentState;
    return parsed.version === COOKIE_POLICY_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function writeConsent(state: ConsentState) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(state))}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: state }));
}

// Ao revogar, apaga os cookies de terceiros já gravados no domínio.
export function clearTrackingCookies(names: RegExp) {
  const host = location.hostname;
  const domains = ['', `; Domain=${host}`, `; Domain=.${host.replace(/^www\./, '')}`];
  for (const part of document.cookie.split('; ')) {
    const name = part.split('=')[0];
    if (names.test(name)) {
      for (const domain of domains) document.cookie = `${name}=; Max-Age=0; Path=/${domain}`;
    }
  }
}

export const ANALYTICS_COOKIES = /^(_ga|_gid|_gat)/;
export const MARKETING_COOKIES = /^(_fbp|_fbc)/;

import { chromium } from 'playwright';

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export async function launch() {
  return chromium.launch({ channel: 'chrome', headless: true });
}

// Decide os cookies uma vez para o banner não cobrir as capturas de tela.
export const CONSENT_REJECTED = (url = BASE_URL) => ({
  name: 'fv_consent',
  value: encodeURIComponent(
    JSON.stringify({
      id: '11111111-1111-4111-8111-111111111111',
      analytics: false,
      marketing: false,
      version: '2026-11',
      decidedAt: new Date().toISOString(),
    }),
  ),
  url,
});

export function collectProblems(page) {
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`página: ${error.message}`));
  return problems;
}

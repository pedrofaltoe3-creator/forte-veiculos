// Autoteste visual da skill: capturas em tamanhos reais, scrub do hero, teste de flick e portões do hero estático.
// Uso: node tests/e2e/visual-check.mjs <pasta-de-saida>
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_URL, collectProblems, CONSENT_REJECTED, launch } from './lib/browser.mjs';

const out = process.argv[2] ?? 'test-results/visual';
mkdirSync(out, { recursive: true });

const browser = await launch();
const report = [];

async function fullPage(name, path, viewport, options = {}) {
  const context = await browser.newContext({ viewport, ...options });
  await context.addCookies([CONSENT_REJECTED()]);
  const page = await context.newPage();
  const problems = collectProblems(page);
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' });
  // Rola a página inteira para disparar entradas e imagens preguiçosas.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => {
    window.scrollTo(4000, 0);
    const moved = window.scrollX;
    window.scrollTo(0, 0);
    return { moved, scrollWidth: document.documentElement.scrollWidth, width: innerWidth };
  });
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  report.push({ name, overflow, problems });
  await context.close();
}

await fullPage('catalogo-1440', '/veiculos', { width: 1440, height: 900 });
await fullPage('veiculo-1440', '/veiculos/pajero-sport-2024', { width: 1440, height: 900 });
await fullPage('privacidade-1440', '/politica-de-privacidade', { width: 1440, height: 900 });
await fullPage('404-1440', '/nao-existe-esta-pagina', { width: 1440, height: 900 });
await fullPage('admin-login-1280', '/admin/login', { width: 1280, height: 800 });

const mobile = { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true };
for (const [name, path] of [['home-375', '/'], ['catalogo-375', '/veiculos'], ['veiculo-375', '/veiculos/corolla-xei-2023']]) {
  await fullPage(name, path, mobile.viewport, { hasTouch: true, isMobile: true });
}

// Hero no desktop: scrub, faixas e abaixo da dobra.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([CONSENT_REJECTED()]);
const page = await context.newPage();
const problems = collectProblems(page);
await page.goto(BASE_URL, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('.hero-stage')?.classList.contains('video-ready'), null, { timeout: 30000 });
await page.waitForTimeout(1300);

const heroState = () =>
  page.evaluate(() => {
    const video = document.querySelector('.hero-stage video');
    return {
      y: Math.round(scrollY),
      time: Number(video.currentTime.toFixed(2)),
      bands: [...document.querySelectorAll('.band')].map((band) => Number(getComputedStyle(band).opacity)),
    };
  });

const scrollRange = await page.evaluate(() => document.querySelector('.hero').offsetHeight - innerHeight);
const scrub = [];
for (const fraction of [0, 0.12, 0.38, 0.64, 0.9, 1]) {
  await page.evaluate((y) => window.scrollTo(0, y), Math.round(scrollRange * fraction));
  await page.waitForTimeout(1500);
  const state = await heroState();
  scrub.push({ fraction, ...state });
  await page.screenshot({ path: join(out, `hero-${String(Math.round(fraction * 100)).padStart(3, '0')}.png`) });
}

// Teste de flick: passos de roda; nenhuma faixa pode ser pulada.
async function flick(step, count) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  const maxima = [0, 0, 0, 0];
  const fullSteps = [0, 0, 0, 0];
  for (let index = 0; index < count; index += 1) {
    await page.mouse.wheel(0, step);
    await page.waitForTimeout(420);
    const { bands } = await heroState();
    bands.forEach((opacity, band) => {
      maxima[band] = Math.max(maxima[band], opacity);
      if (opacity > 0.98) fullSteps[band] += 1;
    });
  }
  return { step, maxima, fullSteps };
}
const flicks = [];
await page.mouse.move(700, 450);
flicks.push(await flick(120, Math.ceil(scrollRange / 120) + 2));
flicks.push(await flick(360, Math.ceil(scrollRange / 360) + 2));

await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(500);
await page.evaluate(async () => {
  for (let y = 0; y < document.documentElement.scrollHeight; y += 700) {
    window.scrollTo(0, y);
    await new Promise((resolve) => setTimeout(resolve, 70));
  }
});
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, 'home-1440.png'), fullPage: true });
await context.close();

// Portões do hero estático e movimento reduzido: não pode haver requisição de vídeo.
async function staticGate(name, options) {
  const gateContext = await browser.newContext(options);
  await gateContext.addCookies([CONSENT_REJECTED()]);
  const gatePage = await gateContext.newPage();
  const requests = [];
  gatePage.on('request', (request) => {
    if (/hero-scrub|hero-poster/.test(request.url())) requests.push(request.url());
  });
  await gatePage.goto(BASE_URL, { waitUntil: 'networkidle' });
  const visible = await gatePage.evaluate(() => getComputedStyle(document.querySelector('.hero-static')).display);
  await gateContext.close();
  return { name, staticDisplay: visible, videoRequests: requests.length };
}
const gates = [
  await staticGate('celular 375', { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true }),
  await staticGate('tablet retrato', { viewport: { width: 820, height: 1100 }, hasTouch: true, isMobile: true }),
  await staticGate('celular deitado', { viewport: { width: 812, height: 375 }, hasTouch: true, isMobile: true }),
  await staticGate('movimento reduzido', { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }),
];

// Vídeo bloqueado: a página precisa continuar completa.
const blocked = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await blocked.addCookies([CONSENT_REJECTED()]);
const blockedPage = await blocked.newPage();
await blockedPage.route('**/hero-scrub.mp4', (route) => route.abort());
await blockedPage.goto(BASE_URL, { waitUntil: 'load' });
await blockedPage.waitForTimeout(1500);
const failedState = await blockedPage.evaluate(() => ({
  failedClass: document.querySelector('.hero-stage').classList.contains('video-failed'),
  poster: document.querySelector('.hero-poster').style.backgroundImage,
}));
await blocked.close();

await browser.close();
console.log(JSON.stringify({ report, heroProblems: problems, scrub, flicks, gates, failedState }, null, 1));

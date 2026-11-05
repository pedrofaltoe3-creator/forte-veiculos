// Auditoria de legibilidade do hero: esconde o texto, captura o que fica atrás dele e mede o pior pixel.
// Critério: contraste de pelo menos 3,5:1 em todas as faixas, contra o pior quadro, nunca o médio.
// Uso: node tests/e2e/contrast-audit.mjs
import sharp from 'sharp';
import { BASE_URL, CONSENT_REJECTED, launch } from './lib/browser.mjs';

const linear = (value) => {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const TEXT = luminance(244, 245, 252);

const browser = await launch();
const results = [];

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
  const context = await browser.newContext({ viewport });
  await context.addCookies([CONSENT_REJECTED()]);
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('.hero-stage')?.classList.contains('video-ready'), null, { timeout: 30000 });
  await page.waitForTimeout(1300);
  const range = await page.evaluate(() => document.querySelector('.hero').offsetHeight - innerHeight);
  const bands = await page.evaluate(() => [...document.querySelectorAll('.band')].map((band) => ({ from: Number(band.dataset.from), to: Number(band.dataset.to) })));

  for (const [index, band] of bands.entries()) {
    let worst = Infinity;
    for (const position of [0.15, 0.5, 0.85]) {
      const fraction = band.from + (band.to - band.from) * position;
      await page.evaluate((y) => window.scrollTo(0, y), Math.round(range * fraction));
      await page.waitForTimeout(1000);
      // Mede só a área ocupada pelas palavras, linha a linha, e não a caixa inteira do bloco.
      const rects = await page.evaluate((bandIndex) => {
        const element = document.querySelectorAll('.band')[bandIndex];
        const out = [...element.querySelectorAll('.w')].map((word) => word.getBoundingClientRect());
        for (const sub of element.querySelectorAll('.band-sub')) {
          const range = document.createRange();
          range.selectNodeContents(sub);
          out.push(...range.getClientRects());
        }
        return out.map((rect) => ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }));
      }, index);
      await page.evaluate(() => {
        for (const element of document.querySelectorAll('.band-title, .band-sub, .chip, .hero-actions')) element.style.visibility = 'hidden';
      });
      const shot = await page.screenshot();
      await page.evaluate(() => {
        for (const element of document.querySelectorAll('.band-title, .band-sub, .chip, .hero-actions')) element.style.visibility = '';
      });
      const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
      let brightest = 0;
      for (const rect of rects) {
        for (let y = Math.max(0, Math.floor(rect.y)); y < Math.min(info.height, rect.y + rect.height); y += 1) {
          for (let x = Math.max(0, Math.floor(rect.x)); x < Math.min(info.width, rect.x + rect.width); x += 1) {
            const i = (y * info.width + x) * info.channels;
            brightest = Math.max(brightest, luminance(data[i], data[i + 1], data[i + 2]));
          }
        }
      }
      const ratio = (TEXT + 0.05) / (brightest + 0.05);
      worst = Math.min(worst, ratio);
    }
    results.push({ viewport: `${viewport.width}x${viewport.height}`, faixa: index + 1, contraste: Number(worst.toFixed(2)), ok: worst >= 3.5 });
  }
  await context.close();
}

await browser.close();
console.table(results);
process.exitCode = results.every((item) => item.ok) ? 0 : 1;

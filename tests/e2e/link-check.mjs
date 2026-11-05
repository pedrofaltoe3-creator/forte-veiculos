// Percorre o site a partir da home e procura links internos e imagens quebrados.
// Uso: node tests/e2e/link-check.mjs [url-base]
const base = (process.argv[2] ?? process.env.E2E_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const origin = new URL(base).origin;
const seen = new Map();
const queue = ['/', '/robots.txt', '/sitemap.xml'];
const broken = [];
const external = new Set();

function collect(html, from) {
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const raw = match[1].replace(/&amp;/g, '&');
    if (/^(mailto:|tel:|data:|#|javascript:)/.test(raw)) continue;
    let url;
    try {
      url = new URL(raw, `${base}${from}`);
    } catch {
      broken.push({ from, url: raw, status: 'url inválida' });
      continue;
    }
    if (url.origin !== origin) {
      external.add(url.origin + url.pathname);
      continue;
    }
    if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/_next/')) {
      if (url.pathname.startsWith('/_next/') && !seen.has(url.pathname)) queue.push(url.pathname);
      continue;
    }
    const path = url.pathname + url.search;
    if (!seen.has(path) && !queue.includes(path)) queue.push(path);
  }
}

while (queue.length) {
  const path = queue.shift();
  if (seen.has(path)) continue;
  const response = await fetch(`${base}${path}`, { redirect: 'follow' });
  seen.set(path, response.status);
  if (!response.ok) broken.push({ path, status: response.status });
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('text/html')) collect(await response.text(), path);
  else if (path === '/sitemap.xml') {
    for (const match of (await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const url = new URL(match[1]);
      if (!seen.has(url.pathname)) queue.push(url.pathname);
    }
  } else {
    await response.arrayBuffer();
  }
}

console.log(`${seen.size} endereços internos verificados.`);
console.log(`${broken.length} quebrados.`);
for (const item of broken) console.log(item);
console.log(`${external.size} destinos externos encontrados:`);
for (const url of [...external].sort()) console.log(`  ${url}`);
process.exitCode = broken.length ? 1 : 0;

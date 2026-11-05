// Teste do site publicado, sem login: páginas, formulários, cookies, cabeçalhos, WhatsApp e celular.
// Leads e consentimentos de teste são marcados e apagados no final com a chave de servidor do .env.local.
// Uso: E2E_BASE_URL=https://forteveiculos.vercel.app node tests/e2e/production-public.mjs
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from '../../scripts/lib/env.mjs';
import { BASE_URL, collectProblems, CONSENT_REJECTED, launch } from './lib/browser.mjs';

loadEnv();
requireEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
const service = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const run = randomBytes(3).toString('hex');
const results = [];
const consentIds = [];
async function check(group, name, fn) {
  try {
    await fn();
    results.push({ ok: true });
    console.log(`  ok    [${group}] ${name}`);
  } catch (error) {
    results.push({ ok: false, group, name, error: String(error.message ?? error).split('\n')[0] });
    console.log(`  FALHA [${group}] ${name}: ${String(error.message ?? error).split('\n')[0]}`);
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const get = async (path, headers = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, { headers, redirect: 'manual' });
  return { status: response.status, html: await response.text(), headers: response.headers };
};

const browser = await launch();
const { data: vehicles } = await service.from('vehicles').select('slug, brand, model, price_cents').in('status', ['available', 'reserved']);
const sample = vehicles[0];

console.log('\nPáginas');
for (const path of ['/', '/veiculos', `/veiculos/${sample.slug}`, '/politica-de-privacidade', '/politica-de-cookies', '/robots.txt', '/sitemap.xml']) {
  await check('Páginas', `${path} abre`, async () => {
    const { status } = await get(path);
    assert(status === 200, `status ${status}`);
  });
}
await check('Páginas', 'todos os veículos têm página e foto', async () => {
  for (const vehicle of vehicles) {
    const { status, html } = await get(`/veiculos/${vehicle.slug}`);
    assert(status === 200, `${vehicle.slug}: ${status}`);
    assert(html.includes('/storage/v1/object/public/vehicle-photos/'), `${vehicle.slug}: sem foto`);
  }
});
await check('Páginas', 'catálogo mostra o total do banco', async () => {
  const { html } = await get('/veiculos');
  assert(html.includes(`${vehicles.length} carros encontrados`), `esperado ${vehicles.length}`);
});
await check('Páginas', 'filtro por marca e busca funcionam', async () => {
  const toyota = vehicles.filter((vehicle) => vehicle.brand === 'Toyota').length;
  const brand = await get('/veiculos?marca=Toyota');
  assert(brand.html.includes(`${toyota} carros encontrados`), 'marca');
  const search = await get('/veiculos?q=corolla');
  assert(search.html.includes(`${vehicles.filter((vehicle) => vehicle.model === 'Corolla').length} carros encontrados`), 'busca');
});
await check('Páginas', 'endereços do site antigo redirecionam', async () => {
  const old = await get(`/${sample.slug}`);
  assert(old.status === 308 && old.headers.get('location').endsWith(`/veiculos/${sample.slug}`), `${old.status}`);
});
await check('Páginas', 'página inexistente responde 404', async () => {
  assert((await get('/nao-existe-esta-pagina')).status === 404, 'status');
});

console.log('\nWhatsApp e contatos');
await check('WhatsApp', 'todos os botões usam (28) 99909-7412', async () => {
  for (const path of ['/', '/veiculos', `/veiculos/${sample.slug}`]) {
    const { html } = await get(path);
    const numbers = [...html.matchAll(/wa\.me\/(\d+)/g)].map((match) => match[1]);
    assert(numbers.length > 0 && numbers.every((number) => number === '5528999097412'), `${path}: ${[...new Set(numbers)]}`);
  }
});
await check('WhatsApp', 'mensagem pronta leva o veículo e o endereço publicado', async () => {
  const { html } = await get(`/veiculos/${sample.slug}`);
  const messages = [...html.matchAll(/https:\/\/wa\.me\/5528999097412\?text=([^"]+)/g)].map((match) => decodeURIComponent(match[1].replace(/&amp;/g, '&')));
  const message = messages.find((text) => text.includes(sample.model));
  assert(message, `nenhuma mensagem cita ${sample.model}`);
  assert(message.includes(`${BASE_URL}/veiculos/${sample.slug}`), message);
});
await check('Contatos', 'endereço, horários e redes conferem', async () => {
  // O React separa trechos de texto com comentários no HTML; eles não aparecem para o visitante.
  const html = (await get('/')).html.replace(/<!-- -->/g, '');
  for (const text of ['Avenida Jones dos Santos Neves, 673', 'Otton Marins', 'Cachoeiro de Itapemirim', '08:00 às 18:00', '08:00 às 12:00', 'instagram.com/forteveiculoscachoeiro', 'facebook.com/joserobertovianafilho.roberto']) {
    assert(html.includes(text), `faltou ${text}`);
  }
});

console.log('\nFormulários');
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addCookies([CONSENT_REJECTED()]);
const page = await context.newPage();
const leadName = `TESTE AUTOMATIZADO ${run}`;
const submit = async (selector, fill) => {
  const form = page.locator(`${selector} form.lead-form`);
  await fill(form);
  await form.locator('input[name=consent]').check();
  await page.waitForTimeout(2800);
  await form.locator('button[type=submit]').click();
  await page.locator(`${selector} .form-success`).waitFor({ timeout: 20000 });
};
await check('Formulários', 'erro de validação mantém o que foi digitado', async () => {
  await page.goto(`${BASE_URL}/?t=${run}#contato`);
  const form = page.locator('#contato form.lead-form');
  await form.locator('input[name=name]').fill(leadName);
  await form.locator('input[name=phone]').fill('123');
  await form.locator('button[type=submit]').click();
  await form.locator('.field-error').first().waitFor({ timeout: 20000 });
  assert((await form.locator('input[name=name]').inputValue()) === leadName, 'campo foi limpo');
});
await check('Formulários', 'contato grava no banco real', async () => {
  await page.goto(`${BASE_URL}/?t=${run}a#contato`);
  await submit('#contato', async (form) => {
    await form.locator('input[name=name]').fill(`${leadName} contato`);
    await form.locator('input[name=phone]').fill('28900000000');
    await form.locator('textarea[name=message]').fill('Teste automatizado, pode ignorar.');
  });
  const { data } = await service.from('leads').select('type, phone, ip_hash, consent_version').eq('name', `${leadName} contato`).single();
  assert(data.type === 'contact' && data.ip_hash && data.consent_version, JSON.stringify(data));
});
await check('Formulários', 'avaliação de usado grava no banco real', async () => {
  await page.goto(`${BASE_URL}/?t=${run}b#avaliacao`);
  await submit('#avaliacao', async (form) => {
    await form.locator('input[name=brand]').fill('TESTE');
    await form.locator('input[name=model]').fill('TESTE');
    await form.locator('input[name=year]').fill('2020');
    await form.locator('input[name=mileage_km]').fill('10000');
    await form.locator('input[name=name]').fill(`${leadName} avaliacao`);
    await form.locator('input[name=phone]').fill('28900000000');
  });
  const { data } = await service.from('leads').select('type, evaluation').eq('name', `${leadName} avaliacao`).single();
  assert(data.type === 'evaluation' && data.evaluation.brand === 'TESTE', JSON.stringify(data));
});
await check('Formulários', 'interesse no veículo vincula o carro', async () => {
  await page.goto(`${BASE_URL}/veiculos/${sample.slug}?t=${run}#interesse`);
  await submit('#interesse', async (form) => {
    await form.locator('input[name=name]').fill(`${leadName} interesse`);
    await form.locator('input[name=phone]').fill('28900000000');
  });
  const { data } = await service.from('leads').select('type, vehicle_id, vehicle_label').eq('name', `${leadName} interesse`).single();
  assert(data.type === 'vehicle_interest' && data.vehicle_id && data.vehicle_label.includes(sample.model), JSON.stringify(data));
});
await context.close();

console.log('\nCookies');
async function consentPage() {
  const freshContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const freshPage = await freshContext.newPage();
  const trackers = [];
  freshPage.on('request', (request) => {
    if (/googletagmanager|google-analytics|connect\.facebook|facebook\.com\/tr|instagram\.com|google\.com\/maps/.test(request.url())) trackers.push(request.url());
  });
  return { freshContext, freshPage, trackers };
}
const consentState = async (freshContext) => JSON.parse(decodeURIComponent((await freshContext.cookies()).find((cookie) => cookie.name === 'fv_consent').value));
await check('Cookies', 'primeira visita: banner aberto, nenhum rastreador', async () => {
  const { freshContext, freshPage, trackers } = await consentPage();
  await freshPage.goto(BASE_URL, { waitUntil: 'load' });
  await freshPage.locator('.consent').waitFor();
  await freshPage.waitForTimeout(1000);
  assert(trackers.length === 0, trackers[0] ?? '');
  const names = (await freshContext.cookies()).map((cookie) => cookie.name);
  assert(!names.some((name) => /^_ga|^_fb|auth-token/.test(name)), names.join());
  await freshContext.close();
});
await check('Cookies', 'rejeitar grava a decisão e não carrega nada', async () => {
  const { freshContext, freshPage, trackers } = await consentPage();
  await freshPage.goto(BASE_URL, { waitUntil: 'load' });
  await freshPage.locator('.consent button', { hasText: 'Rejeitar' }).click();
  await freshPage.locator('.consent').waitFor({ state: 'detached' });
  await freshPage.waitForTimeout(1500);
  const state = await consentState(freshContext);
  consentIds.push(state.id);
  const { data } = await service.from('cookie_consents').select('action, analytics, marketing').eq('subject_id', state.id);
  assert(data[0]?.action === 'reject_all' && !data[0].analytics && !data[0].marketing, JSON.stringify(data));
  assert(trackers.length === 0, 'rastreador carregou');
  await freshContext.close();
});
await check('Cookies', 'personalizar: necessários travados, demais desmarcados', async () => {
  const { freshContext, freshPage } = await consentPage();
  await freshPage.goto(BASE_URL, { waitUntil: 'load' });
  await freshPage.locator('.consent button', { hasText: 'Personalizar' }).click();
  const options = freshPage.locator('.consent-option input');
  assert(await options.nth(0).isDisabled(), 'necessários editável');
  assert(!(await options.nth(1).isChecked()) && !(await options.nth(2).isChecked()), 'veio marcado');
  await options.nth(1).check();
  await freshPage.locator('.consent button', { hasText: 'Salvar escolhas' }).click();
  await freshPage.waitForTimeout(1500);
  const state = await consentState(freshContext);
  consentIds.push(state.id);
  assert(state.analytics && !state.marketing, JSON.stringify(state));
  await freshContext.close();
});
await check('Cookies', 'aceitar e revogar pelo rodapé registra a revogação', async () => {
  const { freshContext, freshPage } = await consentPage();
  await freshPage.goto(BASE_URL, { waitUntil: 'load' });
  await freshPage.locator('.consent button', { hasText: 'Aceitar todos' }).click();
  await freshPage.waitForTimeout(1500);
  await freshPage.locator('.site-footer button', { hasText: 'Preferências de cookies' }).click();
  await freshPage.locator('.consent-option input').nth(1).uncheck();
  await freshPage.locator('.consent-option input').nth(2).uncheck();
  await freshPage.locator('.consent button', { hasText: 'Salvar escolhas' }).click();
  await freshPage.waitForLoadState('load');
  await freshPage.waitForTimeout(1500);
  const state = await consentState(freshContext);
  consentIds.push(state.id);
  assert(!state.analytics && !state.marketing, 'continuou aceito');
  const { data } = await service.from('cookie_consents').select('action').eq('subject_id', state.id).order('id');
  assert(data.at(-1)?.action === 'revoke', JSON.stringify(data));
  await freshContext.close();
});
await check('Cookies', 'mapa só carrega depois do clique', async () => {
  const { freshContext, freshPage, trackers } = await consentPage();
  await freshContext.addCookies([CONSENT_REJECTED()]);
  await freshPage.goto(`${BASE_URL}/#localizacao`, { waitUntil: 'load' });
  assert((await freshPage.locator('iframe.map-frame').count()) === 0, 'mapa carregou sozinho');
  assert(trackers.length === 0, 'requisição externa');
  await freshPage.locator('button', { hasText: 'Mostrar mapa' }).click();
  await freshPage.locator('iframe.map-frame').waitFor({ state: 'attached' });
  await freshContext.close();
});

console.log('\nSegurança');
await check('Segurança', 'HTTPS obrigatório, HSTS, CSP com nonce e demais cabeçalhos', async () => {
  const http = await fetch(BASE_URL.replace('https://', 'http://'), { redirect: 'manual' });
  assert(http.status >= 300 && http.status < 400 && http.headers.get('location').startsWith('https://'), `http ${http.status}`);
  const { headers, html } = await get('/');
  const csp = headers.get('content-security-policy');
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  assert(nonce && html.includes(`nonce="${nonce}"`), 'nonce');
  assert(csp.includes("frame-ancestors 'none'") && csp.includes('upgrade-insecure-requests') && !csp.includes('unsafe-eval'), csp);
  assert(headers.get('strict-transport-security')?.includes('max-age=63072000'), 'HSTS');
  assert(headers.get('x-content-type-options') === 'nosniff' && headers.get('x-frame-options') === 'DENY', 'nosniff/frame');
  assert(!headers.get('x-powered-by'), 'x-powered-by');
});
await check('Segurança', 'site de teste fora dos buscadores', async () => {
  const { headers } = await get('/');
  assert(headers.get('x-robots-tag')?.includes('noindex'), 'sem noindex');
  assert((await get('/robots.txt')).html.includes('Disallow: /'), 'robots');
});
for (const path of ['/admin', '/admin/veiculos', '/admin/leads', '/admin/usuarios', '/admin/tecnico', '/admin/historico', '/admin/mfa']) {
  await check('Painel', `sem sessão, ${path} vai para o login`, async () => {
    const { status, headers } = await get(path);
    assert(status === 307 && headers.get('location').includes('/admin/login'), `${status} ${headers.get('location')}`);
  });
}
await check('Painel', 'API de upload recusa quem não está logado e outra origem', async () => {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('x')], { type: 'image/jpeg' }), 'a.jpg');
  const id = '00000000-0000-4000-8000-000000000000';
  const noSession = await fetch(`${BASE_URL}/api/admin/vehicles/${id}/photos`, { method: 'POST', body: form, headers: { Origin: BASE_URL } });
  assert(noSession.status === 401, `sem sessão ${noSession.status}`);
  const evil = await fetch(`${BASE_URL}/api/admin/vehicles/${id}/photos`, { method: 'POST', body: form, headers: { Origin: 'https://site-malicioso.test' } });
  assert(evil.status === 403, `outra origem ${evil.status}`);
  const consent = await fetch(`${BASE_URL}/api/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://site-malicioso.test' }, body: '{}' });
  assert(consent.status === 403, `consent ${consent.status}`);
});
await check('Segurança', 'injeção na busca não altera o resultado', async () => {
  for (const attack of [`' OR '1'='1`, `'; DROP TABLE vehicles; --`, '%', `)(or=status.eq.draft`]) {
    const { status, html } = await get(`/veiculos?q=${encodeURIComponent(attack)}`);
    assert(status === 200 && html.includes('0 carros encontrados'), attack);
  }
});
await check('Segurança', 'nenhuma chave secreta nas páginas nem nos scripts', async () => {
  const secrets = [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.IP_HASH_SECRET, process.env.SUPABASE_ANON_KEY];
  const names = ['SUPABASE_SERVICE_ROLE_KEY', 'IP_HASH_SECRET', 'DATABASE_URL'];
  const pages = await Promise.all(['/', '/veiculos', '/admin/login'].map((path) => get(path)));
  const scripts = new Set();
  for (const { html } of pages) for (const match of html.matchAll(/\/_next\/static\/[^"']+\.js/g)) scripts.add(match[0]);
  const bodies = [...pages.map((item) => item.html), ...(await Promise.all([...scripts].map(async (src) => (await fetch(`${BASE_URL}${src}`)).text())))];
  for (const body of bodies) {
    for (const secret of secrets) assert(!body.includes(secret), 'chave encontrada');
    for (const name of names) assert(!body.includes(name), `nome ${name} encontrado`);
  }
  console.log(`        (${bodies.length} arquivos verificados)`);
});

console.log('\nCelular e erros do navegador');
for (const [name, path] of [['home', '/'], ['catálogo', '/veiculos'], ['veículo', `/veiculos/${sample.slug}`], ['login', '/admin/login']]) {
  await check('Celular', `${name} em 375px sem rolagem lateral e sem erros`, async () => {
    const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
    await mobile.addCookies([CONSENT_REJECTED()]);
    const mobilePage = await mobile.newPage();
    const problems = collectProblems(mobilePage);
    await mobilePage.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' });
    const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await mobile.close();
    assert(overflow <= 0, `${overflow}px`);
    assert(problems.length === 0, problems[0] ?? '');
  });
}
await check('Desktop', 'home sem erros no console e vídeo do hero carrega', async () => {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desktop.addCookies([CONSENT_REJECTED()]);
  const desktopPage = await desktop.newPage();
  const problems = collectProblems(desktopPage);
  await desktopPage.goto(BASE_URL, { waitUntil: 'load' });
  await desktopPage.waitForFunction(() => document.querySelector('.hero-stage')?.classList.contains('video-ready'), null, { timeout: 40000 });
  await desktop.close();
  assert(problems.length === 0, problems[0] ?? '');
});

await browser.close();

console.log('\nLimpeza');
const leads = await service.from('leads').delete({ count: 'exact' }).like('name', `TESTE AUTOMATIZADO ${run}%`);
console.log(`  leads de teste removidos: ${leads.count ?? 0}${leads.error ? ` erro ${leads.error.message}` : ''}`);
for (const id of [...consentIds, '11111111-1111-4111-8111-111111111111']) await service.from('cookie_consents').delete().eq('subject_id', id);
console.log(`  consentimentos de teste removidos: ${consentIds.length}`);

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length} de ${results.length} verificações passaram em ${BASE_URL}.`);
for (const item of failed) console.log(`FALHA [${item.group}] ${item.name}: ${item.error}`);
process.exitCode = failed.length ? 1 : 0;

// Teste contra o Supabase REAL (Auth, RLS, Storage e funções), lendo as chaves de .env.local sem exibi-las.
// Cria duas empresas e usuários de teste e apaga tudo no final. Não escreve nos dados da empresa real.
// Sobram apenas linhas de histórico das empresas de teste, porque audit_logs é imutável; veja docs/TESTES.md.
// Uso: node tests/e2e/real-supabase.mjs
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { loadEnv, requireEnv } from '../../scripts/lib/env.mjs';

loadEnv();
requireEnv('SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY');

const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, clientOptions);
const anon = createClient(URL_, ANON, clientOptions);

const run = randomBytes(3).toString('hex');
const results = [];
async function check(group, name, fn) {
  try {
    await fn();
    results.push({ group, name, ok: true });
    console.log(`  ok    [${group}] ${name}`);
  } catch (error) {
    results.push({ group, name, ok: false, error: String(error.message ?? error) });
    console.log(`  FALHA [${group}] ${name}: ${String(error.message ?? error).split('\n')[0]}`);
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const created = { users: [], companies: [], files: [] };

async function createCompany(label) {
  const { data, error } = await service.from('companies').insert({ slug: `teste-${label}-${run}`, name: `TESTE ${label} ${run}` }).select('id').single();
  if (error) throw new Error(`empresa: ${error.message}`);
  created.companies.push(data.id);
  const settings = await service.from('site_settings').insert({ company_id: data.id, display_name: `TESTE ${label}`, whatsapp: '5500000000000' });
  if (settings.error) throw new Error(`settings: ${settings.error.message}`);
  const technical = await service.from('technical_settings').insert({ company_id: data.id });
  if (technical.error) throw new Error(`technical: ${technical.error.message}`);
  return data.id;
}

async function createUser(label, company, role) {
  const email = `teste-${label}-${run}@example.com`;
  const password = randomBytes(24).toString('base64url');
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Teste ${label}` } });
  if (error) throw new Error(`usuário: ${error.message}`);
  created.users.push(data.user.id);
  const member = await service.from('company_members').insert({ company_id: company, user_id: data.user.id, role });
  if (member.error) throw new Error(`vínculo: ${member.error.message}`);
  return { id: data.user.id, email, password };
}

async function signIn(user) {
  const client = createClient(URL_, ANON, clientOptions);
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`login: ${error.message}`);
  return client;
}

async function elevate(client) {
  const enroll = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: `teste-${randomUUID()}` });
  if (enroll.error) throw new Error(`enroll: ${enroll.error.message}`);
  const verify = await client.auth.mfa.challengeAndVerify({ factorId: enroll.data.id, code: totp(enroll.data.totp.secret) });
  if (verify.error) throw new Error(`verify: ${verify.error.message}`);
  return { factorId: enroll.data.id, secret: enroll.data.totp.secret };
}

const denied = (error) => assert(error, 'operação deveria ter sido negada');
const vehicleRow = (company, slug, status = 'available') => ({ company_id: company, slug, brand: 'TESTE', model: 'TESTE', model_year: 2020, price_cents: 100000, status });

let companyA;
let companyB;
let ownerA;
let masterA;
let ownerB;
let ownerAClient;
let vehicleA;
let draftA;
let vehicleB;
let photoA;

try {
  console.log('\nPreparação');
  await check('Preparação', 'cria empresas e usuários de teste', async () => {
    companyA = await createCompany('a');
    companyB = await createCompany('b');
    ownerA = await createUser('dono-a', companyA, 'owner');
    masterA = await createUser('master-a', companyA, 'master');
    ownerB = await createUser('dono-b', companyB, 'owner');
    const insertA = await service.from('vehicles').insert(vehicleRow(companyA, `carro-a-${run}`)).select('id').single();
    const insertDraft = await service.from('vehicles').insert(vehicleRow(companyA, `rascunho-a-${run}`, 'draft')).select('id').single();
    const insertB = await service.from('vehicles').insert(vehicleRow(companyB, `carro-b-${run}`)).select('id').single();
    vehicleA = insertA.data.id;
    draftA = insertDraft.data.id;
    vehicleB = insertB.data.id;
    const leads = await service.from('leads').insert([
      { company_id: companyA, type: 'contact', name: 'Lead TESTE A', phone: '00000000000', consent_version: 'teste' },
      { company_id: companyB, type: 'contact', name: 'Lead TESTE B', phone: '00000000000', consent_version: 'teste' },
    ]);
    if (leads.error) throw new Error(leads.error.message);
  });

  console.log('\nAuth');
  await check('Auth', 'cadastro público está desligado', async () => {
    const { data, error } = await anon.auth.signUp({ email: `invasor-${run}@example.com`, password: randomBytes(16).toString('hex') });
    assert(error, `cadastro aceito: ${data?.user?.id}`);
  });
  await check('Auth', 'gatilho criou o perfil do usuário', async () => {
    const { data } = await service.from('profiles').select('email, full_name').eq('id', ownerA.id).single();
    assert(data?.email === ownerA.email && data.full_name === 'Teste dono-a', JSON.stringify(data));
  });
  await check('Auth', 'senha errada é recusada', async () => {
    const client = createClient(URL_, ANON, clientOptions);
    const { error } = await client.auth.signInWithPassword({ email: ownerA.email, password: 'senha-errada-123456' });
    denied(error);
  });
  await check('Auth', 'login com senha gera sessão aal1', async () => {
    ownerAClient = await signIn(ownerA);
    const { data } = await ownerAClient.auth.mfa.getAuthenticatorAssuranceLevel();
    assert(data.currentLevel === 'aal1', data.currentLevel);
  });

  console.log('\nMFA obrigatório');
  await check('MFA', 'em aal1 o dono só lê o próprio vínculo', async () => {
    const own = await ownerAClient.from('company_members').select('role').eq('user_id', ownerA.id);
    assert(own.data?.length === 1, 'vínculo não legível');
    const leads = await ownerAClient.from('leads').select('id');
    assert(leads.data?.length === 0, 'leads visíveis em aal1');
    const write = await ownerAClient.from('vehicles').insert(vehicleRow(companyA, `aal1-${run}`));
    denied(write.error);
    const draft = await ownerAClient.from('vehicles').select('id').eq('id', draftA);
    assert(draft.data?.length === 0, 'rascunho visível em aal1');
  });
  await check('MFA', 'código TOTP correto eleva a sessão para aal2', async () => {
    ownerA.mfa = await elevate(ownerAClient);
    const { data } = await ownerAClient.auth.mfa.getAuthenticatorAssuranceLevel();
    assert(data.currentLevel === 'aal2', data.currentLevel);
  });
  await check('MFA', 'código TOTP errado é recusado', async () => {
    const client = await signIn(masterA);
    const enroll = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: `teste-${randomUUID()}` });
    const verify = await client.auth.mfa.challengeAndVerify({ factorId: enroll.data.id, code: '000000' });
    denied(verify.error);
    masterA.client = client;
    masterA.factorId = enroll.data.id;
    masterA.secret = enroll.data.totp.secret;
    const ok = await client.auth.mfa.challengeAndVerify({ factorId: enroll.data.id, code: totp(enroll.data.totp.secret) });
    assert(!ok.error, ok.error?.message);
  });

  console.log('\nVisitante anônimo');
  await check('Anônimo', 'vê publicados e não vê rascunhos', async () => {
    const { data, error } = await anon.from('vehicles').select('slug').eq('company_id', companyA);
    assert(!error, error?.message);
    const slugs = data.map((row) => row.slug);
    assert(slugs.includes(`carro-a-${run}`) && !slugs.includes(`rascunho-a-${run}`), slugs.join());
  });
  await check('Anônimo', 'não lê colunas internas do veículo', async () => {
    const { error } = await anon.from('vehicles').select('created_by').limit(1);
    denied(error);
  });
  for (const table of ['leads', 'audit_logs', 'cookie_consents', 'company_members', 'profiles']) {
    await check('Anônimo', `não lê ${table}`, async () => {
      const { data, error } = await anon.from(table).select('*').limit(1);
      assert(error || data?.length === 0, 'tabela legível');
      assert(error, 'deveria ser negado por permissão, não só filtrado');
    });
  }
  await check('Anônimo', 'não escreve', async () => {
    denied((await anon.from('leads').insert({ company_id: companyA, type: 'contact', name: 'Spam', consent_version: 'x' })).error);
    denied((await anon.from('vehicles').insert(vehicleRow(companyA, `spam-${run}`))).error);
    denied((await anon.from('vehicles').update({ price_cents: 1 }).eq('id', vehicleA)).error);
    denied((await anon.from('vehicles').delete().eq('id', vehicleA)).error);
    denied((await anon.from('site_settings').update({ whatsapp: '5511111111111' }).eq('company_id', companyA)).error);
  });
  await check('Anônimo', 'não chama funções reservadas ao servidor', async () => {
    denied((await anon.rpc('check_rate_limit', { p_key: 'x', p_limit: 1, p_window_seconds: 60 })).error);
    denied((await anon.rpc('revoke_user_sessions', { p_user: ownerA.id })).error);
    denied((await anon.rpc('log_admin_event', { p_company: companyA, p_actor: null, p_actor_email: null, p_action: 'x' })).error);
    denied((await anon.rpc('purge_expired_personal_data')).error);
    denied((await anon.rpc('set_primary_photo', { p_photo_id: randomUUID() })).error);
  });
  await check('Anônimo', 'schema private não é exposto', async () => {
    const client = createClient(URL_, ANON, { ...clientOptions, db: { schema: 'private' } });
    denied((await client.from('rate_limits').select('*')).error);
  });
  await check('Anônimo', 'site público lê dados da empresa', async () => {
    const { data, error } = await anon.rpc('get_public_site', { p_host: 'host-desconhecido.test', p_fallback_slug: `teste-a-${run}` });
    assert(!error && data.company.id === companyA, error?.message ?? JSON.stringify(data));
  });

  console.log('\nProprietário');
  await check('Dono', 'cadastra, altera preço, muda situação e exclui', async () => {
    const insert = await ownerAClient.from('vehicles').insert(vehicleRow(companyA, `novo-${run}`)).select('id, created_by').single();
    assert(!insert.error, insert.error?.message);
    assert(insert.data.created_by === ownerA.id, 'sem autor');
    const update = await ownerAClient.from('vehicles').update({ price_cents: 200000, status: 'sold', is_featured: true }).eq('id', insert.data.id).select('price_cents, status, sold_at, is_featured').single();
    assert(!update.error, update.error?.message);
    assert(update.data.sold_at && !update.data.is_featured && Number(update.data.price_cents) === 200000, JSON.stringify(update.data));
    const remove = await ownerAClient.from('vehicles').delete({ count: 'exact' }).eq('id', insert.data.id);
    assert(remove.count === 1, remove.error?.message ?? `${remove.count}`);
  });
  await check('Dono', 'não muda ajustes técnicos nem usuários', async () => {
    const tech = await ownerAClient.from('technical_settings').update({ ga4_id: 'G-TESTE12345' }, { count: 'exact' }).eq('company_id', companyA);
    assert(tech.count === 0 || tech.error, 'alterou ajustes técnicos');
    denied((await ownerAClient.from('company_members').insert({ company_id: companyA, user_id: ownerB.id, role: 'master' })).error);
    const promote = await ownerAClient.from('company_members').update({ role: 'master' }, { count: 'exact' }).eq('user_id', ownerA.id);
    assert(promote.count === 0 || promote.error, 'promoveu a si mesmo');
    const removeMaster = await ownerAClient.from('company_members').delete({ count: 'exact' }).eq('user_id', masterA.id);
    assert(removeMaster.count === 0 || removeMaster.error, 'removeu o master');
  });
  await check('Dono', 'altera situação do lead, mas não o conteúdo', async () => {
    const status = await ownerAClient.from('leads').update({ status: 'in_progress' }, { count: 'exact' }).eq('company_id', companyA);
    assert(status.count === 1, status.error?.message ?? `${status.count}`);
    denied((await ownerAClient.from('leads').update({ phone: '111' }).eq('company_id', companyA)).error);
    denied((await ownerAClient.from('leads').insert({ company_id: companyA, type: 'contact', name: 'x y', consent_version: 'x' })).error);
  });
  await check('Dono', 'não move veículo para outra empresa', async () => {
    denied((await ownerAClient.from('vehicles').update({ company_id: companyB }).eq('id', vehicleA)).error);
  });

  console.log('\nIsolamento entre empresas');
  await check('Isolamento', 'não lê leads, histórico nem vínculos de outra empresa', async () => {
    assert((await ownerAClient.from('leads').select('id').eq('company_id', companyB)).data?.length === 0, 'leads');
    assert((await ownerAClient.from('audit_logs').select('id').eq('company_id', companyB)).data?.length === 0, 'histórico');
    assert((await ownerAClient.from('company_members').select('user_id').eq('company_id', companyB)).data?.length === 0, 'vínculos');
  });
  await check('Isolamento', 'master não altera nada de outra empresa', async () => {
    const client = masterA.client;
    const attempts = [
      await client.from('vehicles').update({ price_cents: 1 }, { count: 'exact' }).eq('id', vehicleB),
      await client.from('vehicles').delete({ count: 'exact' }).eq('id', vehicleB),
      await client.from('leads').delete({ count: 'exact' }).eq('company_id', companyB),
      await client.from('site_settings').update({ display_name: 'invadido' }, { count: 'exact' }).eq('company_id', companyB),
      await client.from('technical_settings').update({ cnpj: null }, { count: 'exact' }).eq('company_id', companyB),
      await client.from('company_members').delete({ count: 'exact' }).eq('company_id', companyB),
    ];
    for (const [index, attempt] of attempts.entries()) assert(attempt.error || attempt.count === 0, `tentativa ${index} alterou dados`);
    denied((await client.from('vehicles').insert(vehicleRow(companyB, `invasao-${run}`))).error);
    denied((await client.from('company_members').insert({ company_id: companyB, user_id: masterA.id, role: 'master' })).error);
  });
  await check('Isolamento', 'FK composta impede foto em veículo de outra empresa', async () => {
    const path = `${companyA}/${vehicleB}/x.webp`;
    denied((await ownerAClient.from('vehicle_photos').insert({ company_id: companyA, vehicle_id: vehicleB, storage_path: path, thumb_path: path, width: 10, height: 10 })).error);
  });
  await check('Isolamento', 'usuário sem vínculo não acessa nada', async () => {
    const password = randomBytes(24).toString('base64url');
    const { data } = await service.auth.admin.createUser({ email: `teste-solto-${run}@example.com`, password, email_confirm: true });
    created.users.push(data.user.id);
    const loose = await signIn({ email: data.user.email, password });
    await elevate(loose);
    assert((await loose.from('leads').select('id')).data?.length === 0, 'leu leads');
    assert((await loose.from('audit_logs').select('id')).data?.length === 0, 'leu histórico');
    assert((await loose.from('company_members').select('user_id')).data?.length === 0, 'leu vínculos');
    assert((await loose.from('vehicles').select('id').eq('id', draftA)).data?.length === 0, 'leu rascunho');
    const write = await loose.from('vehicles').update({ price_cents: 1 }, { count: 'exact' }).eq('id', vehicleA);
    assert(write.error || write.count === 0, 'alterou veículo');
    denied((await loose.from('vehicles').insert(vehicleRow(companyA, `solto-${run}`))).error);
  });

  console.log('\nStorage');
  const webp = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#0b0f8a' } }).webp().toBuffer();
  const bucket = (client) => client.storage.from('vehicle-photos');
  await check('Storage', 'envia na pasta da própria empresa', async () => {
    const path = `${companyA}/${vehicleA}/${randomUUID()}.webp`;
    const { error } = await bucket(ownerAClient).upload(path, webp, { contentType: 'image/webp' });
    assert(!error, error?.message);
    created.files.push(path);
    const row = await ownerAClient.from('vehicle_photos').insert({ company_id: companyA, vehicle_id: vehicleA, storage_path: path, thumb_path: path, width: 64, height: 48 }).select('id, is_primary').single();
    assert(!row.error, row.error?.message);
    assert(row.data.is_primary, 'primeira foto deveria ser principal');
    photoA = row.data.id;
  });
  await check('Storage', 'foto fica pública pela CDN', async () => {
    const { data } = bucket(anon).getPublicUrl(created.files[0]);
    const response = await fetch(data.publicUrl);
    assert(response.ok && response.headers.get('content-type')?.includes('webp'), `${response.status}`);
  });
  await check('Storage', 'proprietário troca foto do site só na própria empresa', async () => {
    const path = `${companyA}/site/comprar-${randomUUID()}.webp`;
    const upload = await bucket(ownerAClient).upload(path, webp, { contentType: 'image/webp' });
    assert(!upload.error, upload.error?.message);
    created.files.push(path);
    const own = await ownerAClient.from('site_settings').update({ images: { comprar: path } }, { count: 'exact' }).eq('company_id', companyA);
    assert(!own.error && own.count === 1, own.error?.message ?? `${own.count} linhas`);
    const read = await anon.from('site_settings').select('images').eq('company_id', companyA).single();
    assert(read.data?.images?.comprar === path, 'site não leu a foto nova');
    const other = await ownerAClient.from('site_settings').update({ images: { comprar: path } }, { count: 'exact' }).eq('company_id', companyB);
    assert(other.error || other.count === 0, 'alterou outra empresa');
    denied((await anon.from('site_settings').update({ images: {} }).eq('company_id', companyA)).error);
    denied((await bucket(ownerAClient).upload(`${companyB}/site/comprar-${randomUUID()}.webp`, webp, { contentType: 'image/webp' })).error);
    assert(!(await ownerAClient.from('site_settings').update({ images: {} }).eq('company_id', companyA)).error, 'não voltou à original');
  });
  await check('Storage', 'não envia na pasta de outra empresa', async () => {
    denied((await bucket(ownerAClient).upload(`${companyB}/${vehicleB}/${randomUUID()}.webp`, webp, { contentType: 'image/webp' })).error);
  });
  await check('Storage', 'anônimo não envia', async () => {
    denied((await bucket(anon).upload(`${companyA}/${vehicleA}/${randomUUID()}.webp`, webp, { contentType: 'image/webp' })).error);
  });
  await check('Storage', 'bucket recusa formato que não seja WebP', async () => {
    denied((await bucket(ownerAClient).upload(`${companyA}/${vehicleA}/${randomUUID()}.html`, Buffer.from('<script>alert(1)</script>'), { contentType: 'text/html' })).error);
  });
  await check('Storage', 'bucket recusa arquivo acima de 8 MB', async () => {
    denied((await bucket(ownerAClient).upload(`${companyA}/${vehicleA}/${randomUUID()}.webp`, Buffer.alloc(9 * 1024 * 1024, 1), { contentType: 'image/webp' })).error);
  });
  await check('Storage', 'não apaga arquivo de outra empresa', async () => {
    const path = `${companyB}/${vehicleB}/${randomUUID()}.webp`;
    const upload = await bucket(service).upload(path, webp, { contentType: 'image/webp' });
    assert(!upload.error, upload.error?.message);
    created.files.push(path);
    const remove = await bucket(ownerAClient).remove([path]);
    assert((remove.data ?? []).length === 0, 'apagou arquivo alheio');
  });
  await check('Storage', 'define foto principal e não define de outra empresa', async () => {
    const own = await ownerAClient.rpc('set_primary_photo', { p_photo_id: photoA });
    assert(!own.error, own.error?.message);
    const path = `${companyB}/${vehicleB}/${randomUUID()}.webp`;
    const other = await service.from('vehicle_photos').insert({ company_id: companyB, vehicle_id: vehicleB, storage_path: path, thumb_path: path, width: 10, height: 10 }).select('id').single();
    denied((await ownerAClient.rpc('set_primary_photo', { p_photo_id: other.data.id })).error);
  });

  console.log('\nHistórico');
  await check('Histórico', 'registra autor e não guarda dados do lead', async () => {
    const { data } = await ownerAClient.from('audit_logs').select('action, actor_email, after').eq('company_id', companyA);
    assert(data.some((row) => row.action === 'vehicles.insert' && row.actor_email === ownerA.email), 'sem registro do cadastro');
    const lead = data.find((row) => row.action === 'leads.update');
    assert(lead && JSON.stringify(lead.after) === '{"status":"in_progress"}', JSON.stringify(lead));
  });
  await check('Histórico', 'ninguém altera nem apaga', async () => {
    const client = masterA.client;
    denied((await client.from('audit_logs').delete().eq('company_id', companyA)).error);
    denied((await client.from('audit_logs').update({ action: 'x' }).eq('company_id', companyA)).error);
    denied((await client.from('audit_logs').insert({ company_id: companyA, action: 'x', entity: 'x' })).error);
    denied((await service.from('audit_logs').delete().eq('company_id', companyA)).error);
  });

  console.log('\nServidor');
  await check('Servidor', 'limite de tentativas conta e bloqueia', async () => {
    const key = `teste-${run}`;
    const call = () => service.rpc('check_rate_limit', { p_key: key, p_limit: 2, p_window_seconds: 60 });
    assert((await call()).data === true && (await call()).data === true, 'bloqueou cedo');
    assert((await call()).data === false, 'não bloqueou');
  });
  await check('Servidor', 'gera link de recuperação e ele abre sessão uma vez', async () => {
    const link = await service.auth.admin.generateLink({ type: 'recovery', email: masterA.email });
    assert(!link.error, link.error?.message);
    const client = createClient(URL_, ANON, clientOptions);
    const first = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'recovery' });
    assert(!first.error && first.data.session, first.error?.message);
    const second = createClient(URL_, ANON, clientOptions);
    denied((await second.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'recovery' })).error);
  });
  await check('Servidor', 'gera convite para usuário novo', async () => {
    const email = `teste-convite-${run}@example.com`;
    const link = await service.auth.admin.generateLink({ type: 'invite', email, options: { data: { full_name: 'Convite' } } });
    assert(!link.error, link.error?.message);
    created.users.push(link.data.user.id);
    assert(link.data.properties.hashed_token, 'sem token');
  });
  await check('Servidor', 'redefine MFA de um usuário', async () => {
    const list = await service.auth.admin.mfa.listFactors({ userId: masterA.id });
    assert(!list.error && list.data.factors.length === 1, list.error?.message ?? `${list.data.factors.length}`);
    const remove = await service.auth.admin.mfa.deleteFactor({ userId: masterA.id, id: list.data.factors[0].id });
    assert(!remove.error, remove.error?.message);
  });
  await check('Sessões', 'revogar sessões impede renovar o acesso', async () => {
    const client = await signIn(ownerB);
    const before = await client.auth.getSession();
    const revoke = await service.rpc('revoke_user_sessions', { p_user: ownerB.id });
    assert(!revoke.error, revoke.error?.message);
    const refresh = await client.auth.refreshSession({ refresh_token: before.data.session.refresh_token });
    denied(refresh.error);
  });
  await check('Sessões', 'usuário desativado perde o acesso na hora', async () => {
    assert((await ownerAClient.from('leads').select('id')).data?.length === 1, 'dono deveria ver o lead');
    await service.from('profiles').update({ is_active: false }).eq('id', ownerA.id);
    assert((await ownerAClient.from('leads').select('id')).data?.length === 0, 'ainda vê leads');
    await service.from('profiles').update({ is_active: true }).eq('id', ownerA.id);
  });
  await check('Sessões', 'logout global invalida a sessão', async () => {
    const { data } = await ownerAClient.auth.getSession();
    await ownerAClient.auth.signOut({ scope: 'global' });
    const check = createClient(URL_, ANON, clientOptions);
    const user = await check.auth.getUser(data.session.access_token);
    denied(user.error);
  });
} finally {
  console.log('\nLimpeza');
  if (created.files.length) await service.storage.from('vehicle-photos').remove(created.files);
  // A exclusão em cascata remove veículos, fotos e leads de teste. O gatilho impede sobrar empresa sem master só com empresa viva.
  for (const company of created.companies) {
    const remove = await service.from('companies').delete().eq('id', company);
    console.log(`  empresa de teste: ${remove.error ? `erro ${remove.error.message}` : 'removida'}`);
  }
  for (const user of created.users) {
    const remove = await service.auth.admin.deleteUser(user);
    if (remove.error) console.log(`  usuário de teste: erro ${remove.error.message}`);
  }
  console.log(`  usuários de teste removidos: ${created.users.length}`);
}

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length} de ${results.length} verificações passaram no Supabase real.`);
for (const item of failed) console.log(`FALHA [${item.group}] ${item.name}: ${item.error}`);
process.exitCode = failed.length ? 1 : 0;

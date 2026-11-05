// Ambiente de teste local, sem Docker e sem conta na nuvem. Nunca vai para produção.
// Banco: Postgres real (PGlite) com as migrations do projeto, então as políticas RLS são as verdadeiras.
// API: imita o que o app usa do PostgREST, do Auth (senha, MFA TOTP) e do Storage.
// Importante: valida o código do app e as regras do banco, mas não substitui um teste no Supabase de verdade.
// Uso: node tests/e2e/supabase-emulator.mjs [porta]
import { createHmac, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { createDb } from '../rls/harness.mjs';

const PORT = Number(process.argv[2] ?? 54321);
export const ANON_KEY = 'emulador-anon-key';
export const SERVICE_KEY = 'emulador-service-key';
const JWT_SECRET = randomBytes(32);
const STOCK_FILE = join(process.cwd(), '_referencia', 'estoque-site-atual.json');
const CACHE_DIR = join(process.cwd(), '_referencia', 'qa-fotos');
const FILES = new Map();

const db = await createDb();

// Autenticação -----------------------------------------------------------------

const b64 = (value) => Buffer.from(value).toString('base64url');

function signJwt(claims) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(claims));
  const signature = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}

function verifyJwt(token) {
  const [head, body, signature] = String(token ?? '').split('.');
  if (!signature) return null;
  const expected = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  if (expected !== signature) return null;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  return claims.exp > Date.now() / 1000 ? claims : null;
}

const users = new Map();
const refreshTokens = new Map();

export function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const key = base32Decode(secret);
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of text) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function base32Encode(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

const hashPassword = (password, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
const checkPassword = (password, stored) => stored && hashPassword(password, stored.split(':')[0]) === stored;

async function createUser({ email, password, fullName }) {
  const { rows } = await db.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify({ full_name: fullName })],
  );
  const user = { id: rows[0].id, email, password: password ? hashPassword(password) : null, factors: [], recovery: null };
  users.set(user.id, user);
  return user;
}

const publicUser = (user) => ({
  id: user.id,
  aud: 'authenticated',
  role: 'authenticated',
  email: user.email,
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
  factors: user.factors.map((factor) => ({
    id: factor.id,
    factor_type: 'totp',
    friendly_name: factor.name,
    status: factor.status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })),
});

function issueSession(user, aal, amr = 'password') {
  const expiresIn = 3600;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  const refresh = randomUUID();
  refreshTokens.set(refresh, { userId: user.id, aal, amr });
  return {
    access_token: signJwt({
      sub: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      aal,
      amr: [{ method: amr, timestamp: Math.floor(Date.now() / 1000) }],
      session_id: refresh,
      exp: expiresAt,
    }),
    refresh_token: refresh,
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: expiresAt,
    user: publicUser(user),
  };
}

// Consulta: traduz os filtros do PostgREST para SQL parametrizado ----------------

function roleFor(req) {
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (bearer === SERVICE_KEY || (!bearer && req.headers.apikey === SERVICE_KEY)) return { role: 'service_role', claims: { role: 'service_role' } };
  const claims = verifyJwt(bearer);
  if (claims) {
    if (!refreshTokens.has(claims.session_id)) return { role: 'anon', claims: {} };
    return { role: 'authenticated', claims };
  }
  return { role: 'anon', claims: {} };
}

async function withRole({ role, claims }, fn) {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await db.exec(`set local role ${role}`);
    const result = await fn();
    await db.exec('commit');
    return result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

const ident = (name) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw Object.assign(new Error(`coluna inválida ${name}`), { status: 400 });
  return `"${name}"`;
};

function buildWhere(params) {
  const clauses = [];
  const values = [];
  const push = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(key)) continue;
    const match = raw.match(/^(not\.)?(eq|neq|gte|lte|gt|lt|ilike|like|is|in)\.(.*)$/s);
    if (!match) throw Object.assign(new Error(`filtro inválido ${key}`), { status: 400 });
    const [, negate, op, value] = match;
    const column = ident(key);
    let clause;
    if (op === 'in') {
      const items = value.replace(/^\(|\)$/g, '').split(',').map((item) => item.replace(/^"|"$/g, ''));
      clause = `${column}::text = any(${push(items)}::text[])`;
    } else if (op === 'is') {
      clause = `${column} is ${value === 'null' ? 'null' : value === 'true' ? 'true' : 'false'}`;
    } else {
      const sqlOp = { eq: '=', neq: '<>', gte: '>=', lte: '<=', gt: '>', lt: '<', ilike: 'ilike', like: 'like' }[op];
      const left = ['ilike', 'like'].includes(op) ? `${column}::text` : `${column}::text`;
      if (['gte', 'lte', 'gt', 'lt'].includes(op) && /^-?[0-9.]+$/.test(value)) clause = `${column} ${sqlOp} ${push(value)}::numeric`;
      else if (['gte', 'lte', 'gt', 'lt'].includes(op)) clause = `${column}::text ${sqlOp} ${push(value)}`;
      else clause = `${left} ${sqlOp} ${push(value)}`;
    }
    clauses.push(negate ? `not (${clause})` : clause);
  }
  // or=(a.is.null,b.is.null), usado no aviso de anúncios incompletos.
  return { where: clauses.length ? `where ${clauses.join(' and ')}` : '', values };
}

function parseSelect(select) {
  const columns = [];
  const embeds = [];
  let depth = 0;
  let current = '';
  for (const char of (select ?? '*').replace(/\s/g, '')) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      columns.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) columns.push(current);
  const plain = [];
  for (const column of columns) {
    const embed = column.match(/^([a-z_]+)(![a-z]+)?\((.*)\)$/);
    if (embed) embeds.push({ table: embed[1], select: embed[3], inner: Boolean(embed[2]) });
    else plain.push(column);
  }
  return { plain, embeds };
}

const EMBED_LINKS = {
  vehicle_photos: { foreign: 'vehicle_id', local: 'id', many: true },
  profiles: { foreign: 'id', local: 'user_id', many: false },
};

async function selectRows(table, params, context, { countExact, single } = {}) {
  const { plain, embeds } = parseSelect(params.get('select'));
  const { where, values } = buildWhere(params.entries ? [...params.entries()].filter(([key]) => key !== 'or') : params);
  const allValues = [...values];
  const extraOr = params.get('or');
  let finalWhere = where;
  if (extraOr) {
    const parts = extraOr.replace(/^\(|\)$/g, '').split(',').map((part) => {
      const [column, op, value] = part.split('.');
      if (op === 'is' && value === 'null') return `${ident(column)} is null`;
      if (op === 'gte') {
        allValues.push(value);
        return `${ident(column)}::text >= $${allValues.length}`;
      }
      throw Object.assign(new Error('or não suportado'), { status: 400 });
    });
    finalWhere = `${where ? `${where} and` : 'where'} (${parts.join(' or ')})`;
  }
  const order = params.get('order');
  const orderSql = order
    ? `order by ${order.split(',').map((item) => {
        const [column, direction, nulls] = item.split('.');
        return `${ident(column)} ${direction === 'desc' ? 'desc' : 'asc'}${nulls ? ` ${nulls === 'nullslast' ? 'nulls last' : 'nulls first'}` : ''}`;
      }).join(', ')}`
    : '';
  const limit = params.get('limit') ? `limit ${Number(params.get('limit'))}` : '';
  const offset = params.get('offset') ? `offset ${Number(params.get('offset'))}` : '';
  const needsLocal = embeds.map((embed) => EMBED_LINKS[embed.table]?.local).filter(Boolean);
  const selectList = plain.includes('*') ? '*' : [...new Set([...plain.filter(Boolean), ...needsLocal])].map(ident).join(', ');

  return withRole(context, async () => {
    const { rows } = await db.query(`select ${selectList || 'id'} from public.${ident(table)} ${finalWhere} ${orderSql} ${limit} ${offset}`, allValues);
    for (const row of rows) {
      for (const embed of embeds) {
        const link = EMBED_LINKS[embed.table];
        if (!link) throw Object.assign(new Error(`embed ${embed.table}`), { status: 400 });
        const inner = embed.select.split(',').map(ident).join(', ');
        const related = await db.query(`select ${inner} from public.${ident(embed.table)} where ${ident(link.foreign)} = $1`, [row[link.local]]);
        row[embed.table] = link.many ? related.rows : related.rows[0] ?? null;
      }
    }
    let total = null;
    if (countExact) {
      const counted = await db.query(`select count(*)::int as c from public.${ident(table)} ${finalWhere}`, allValues);
      total = counted.rows[0].c;
    }
    return { rows, total };
  });
}

// HTTP ------------------------------------------------------------------------------

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(payload);
}

function pgError(res, error) {
  const code = error.code ?? '';
  const status = error.status ?? (code === '42501' ? 403 : code === '23505' ? 409 : 400);
  send(res, status, { code, message: error.message, details: null, hint: null });
}

async function handleRest(req, res, url, table) {
  const context = roleFor(req);
  const params = url.searchParams;

  if (table === 'rpc') return undefined;

  if (req.method === 'GET' || req.method === 'HEAD') {
    const prefer = req.headers.prefer ?? '';
    const single = (req.headers.accept ?? '').includes('vnd.pgrst.object');
    const { rows, total } = await selectRows(table, params, context, { countExact: prefer.includes('count=exact') });
    const headers = total === null ? {} : { 'Content-Range': `0-${Math.max(rows.length - 1, 0)}/${total}` };
    if (req.method === 'HEAD') return send(res, 200, undefined, headers);
    if (single) {
      if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'não encontrado' });
      return send(res, 200, rows[0], headers);
    }
    return send(res, 200, rows, headers);
  }

  const prefer = req.headers.prefer ?? '';
  const returning = prefer.includes('return=representation');
  const selectParam = params.get('select');
  const returnList = returning ? (selectParam ? selectParam.split(',').map(ident).join(', ') : '*') : '1';
  const { where, values } = buildWhere([...params.entries()]);

  const result = await withRole(context, async () => {
    if (req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString());
      const rows = Array.isArray(body) ? body : [body];
      const output = [];
      for (const row of rows) {
        const keys = Object.keys(row);
        const placeholders = keys.map((_, index) => `$${index + 1}`);
        const inserted = await db.query(
          `insert into public.${ident(table)} (${keys.map(ident).join(', ')}) values (${placeholders.join(', ')}) returning ${returnList}`,
          keys.map((key) => (row[key] !== null && typeof row[key] === 'object' && !Array.isArray(row[key]) ? JSON.stringify(row[key]) : row[key])),
        );
        output.push(...inserted.rows);
      }
      return { rows: output, count: output.length, status: 201 };
    }
    if (req.method === 'PATCH') {
      const body = JSON.parse((await readBody(req)).toString());
      const keys = Object.keys(body);
      const offset = values.length;
      const assignments = keys.map((key, index) => `${ident(key)} = $${offset + index + 1}`);
      const updated = await db.query(
        `update public.${ident(table)} set ${assignments.join(', ')} ${where} returning ${returnList}`,
        [...values, ...keys.map((key) => (body[key] !== null && typeof body[key] === 'object' && !Array.isArray(body[key]) ? JSON.stringify(body[key]) : body[key]))],
      );
      return { rows: updated.rows, count: updated.rows.length, status: 200 };
    }
    if (req.method === 'DELETE') {
      const removed = await db.query(`delete from public.${ident(table)} ${where} returning ${returnList}`, values);
      return { rows: removed.rows, count: removed.rows.length, status: 200 };
    }
    throw Object.assign(new Error('método'), { status: 405 });
  });

  const headers = prefer.includes('count=exact') ? { 'Content-Range': `*/${result.count}` } : {};
  if (returning) {
    const single = (req.headers.accept ?? '').includes('vnd.pgrst.object');
    return send(res, result.status, single ? result.rows[0] : result.rows, headers);
  }
  return send(res, result.status === 201 ? 201 : 204, undefined, headers);
}

async function handleRpc(req, res, name) {
  const context = roleFor(req);
  const body = JSON.parse((await readBody(req)).toString() || '{}');
  const keys = Object.keys(body);
  const args = keys.map((key, index) => `${key} => $${index + 1}`).join(', ');
  const values = keys.map((key) => body[key]);
  const rows = await withRole(context, async () => (await db.query(`select public.${ident(name)}(${args}) as result`, values)).rows);
  // No emulador as sessões ficam em memória, então a revogação precisa alcançá-las também.
  if (name === 'revoke_user_sessions') {
    for (const [token, stored] of refreshTokens) {
      if (stored.userId === body.p_user) refreshTokens.delete(token);
    }
  }
  send(res, 200, JSON.stringify(rows[0]?.result ?? null));
}

async function handleAuth(req, res, url, path) {
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const claims = verifyJwt(bearer);
  const sessionAlive = claims && refreshTokens.has(claims.session_id);
  const sessionUser = sessionAlive ? users.get(claims.sub) : null;

  if (path === 'token') {
    const body = JSON.parse((await readBody(req)).toString());
    if (url.searchParams.get('grant_type') === 'password') {
      const user = [...users.values()].find((item) => item.email === body.email);
      if (!user || !checkPassword(body.password, user.password)) {
        return send(res, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      return send(res, 200, issueSession(user, 'aal1'));
    }
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      const stored = refreshTokens.get(body.refresh_token);
      if (!stored) return send(res, 400, { code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      refreshTokens.delete(body.refresh_token);
      return send(res, 200, issueSession(users.get(stored.userId), stored.aal, stored.amr));
    }
  }

  if (path === 'logout') {
    if (sessionAlive) {
      const scope = url.searchParams.get('scope') ?? 'global';
      for (const [token, stored] of refreshTokens) {
        const isCurrent = token === claims.session_id;
        if (stored.userId !== claims.sub) continue;
        if (scope === 'global' || (scope === 'local' && isCurrent) || (scope === 'others' && !isCurrent)) refreshTokens.delete(token);
      }
    }
    return send(res, 204);
  }

  if (path === 'user') {
    if (!sessionUser) return send(res, 401, { code: 'bad_jwt', error_code: 'bad_jwt', msg: 'invalid JWT' });
    if (req.method === 'PUT') {
      const body = JSON.parse((await readBody(req)).toString());
      const hasVerified = sessionUser.factors.some((factor) => factor.status === 'verified');
      if (hasVerified && claims.aal !== 'aal2') return send(res, 401, { code: 'insufficient_aal', error_code: 'insufficient_aal', msg: 'AAL2 required' });
      if (body.password) {
        if (checkPassword(body.password, sessionUser.password)) return send(res, 422, { code: 'same_password', error_code: 'same_password', msg: 'same password' });
        sessionUser.password = hashPassword(body.password);
      }
    }
    return send(res, 200, publicUser(sessionUser));
  }

  if (path === 'recover') {
    await readBody(req);
    return send(res, 200, {});
  }

  if (path === 'verify') {
    const body = JSON.parse((await readBody(req)).toString());
    const user = [...users.values()].find((item) => item.recovery === body.token_hash);
    if (!user) return send(res, 403, { code: 'otp_expired', error_code: 'otp_expired', msg: 'expired' });
    user.recovery = null;
    return send(res, 200, issueSession(user, 'aal1', 'otp'));
  }

  if (path === 'factors' && req.method === 'POST') {
    if (!sessionUser) return send(res, 401, { msg: 'invalid JWT' });
    const body = JSON.parse((await readBody(req)).toString());
    const secret = base32Encode(randomBytes(20));
    const factor = { id: randomUUID(), name: body.friendly_name, secret, status: 'unverified' };
    sessionUser.factors.push(factor);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#fff"/><text x="10" y="100" font-size="10">QR emulador</text></svg>`;
    return send(res, 200, {
      id: factor.id,
      type: 'totp',
      friendly_name: body.friendly_name,
      totp: { qr_code: svg, secret, uri: `otpauth://totp/x?secret=${secret}` },
    });
  }

  const factorMatch = path.match(/^factors\/([^/]+)(?:\/(challenge|verify))?$/);
  if (factorMatch) {
    if (!sessionUser) return send(res, 401, { msg: 'invalid JWT' });
    const factor = sessionUser.factors.find((item) => item.id === factorMatch[1]);
    if (!factor) return send(res, 404, { code: 'mfa_factor_not_found', msg: 'factor' });
    if (req.method === 'DELETE') {
      sessionUser.factors = sessionUser.factors.filter((item) => item.id !== factor.id);
      return send(res, 200, { id: factor.id });
    }
    if (factorMatch[2] === 'challenge') {
      return send(res, 200, { id: randomUUID(), type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
    }
    if (factorMatch[2] === 'verify') {
      const body = JSON.parse((await readBody(req)).toString());
      if (![totp(factor.secret), totp(factor.secret, Date.now() - 30000)].includes(body.code)) {
        return send(res, 422, { code: 'mfa_verification_failed', error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code' });
      }
      factor.status = 'verified';
      refreshTokens.delete(claims.session_id);
      return send(res, 200, issueSession(sessionUser, 'aal2', 'totp'));
    }
  }

  // API administrativa usada pelo servidor com a chave service_role.
  if (path.startsWith('admin/')) {
    if (bearer !== SERVICE_KEY) return send(res, 403, { code: 'not_admin', msg: 'not admin' });
    if (path === 'admin/generate_link') {
      const body = JSON.parse((await readBody(req)).toString());
      let user = [...users.values()].find((item) => item.email === body.email);
      if (body.type === 'invite') {
        if (user) return send(res, 422, { code: 'email_exists', error_code: 'email_exists', msg: 'exists' });
        user = await createUser({ email: body.email, fullName: body.data?.full_name });
      }
      if (!user) return send(res, 404, { code: 'user_not_found', msg: 'not found' });
      user.recovery = randomBytes(16).toString('hex');
      return send(res, 200, { ...publicUser(user), action_link: 'x', email_otp: '000000', hashed_token: user.recovery, redirect_to: body.redirect_to ?? '', verification_type: body.type });
    }
    const adminFactors = path.match(/^admin\/users\/([^/]+)\/factors(?:\/([^/]+))?$/);
    if (adminFactors) {
      const user = users.get(adminFactors[1]);
      if (!user) return send(res, 404, { msg: 'not found' });
      if (req.method === 'DELETE') {
        user.factors = user.factors.filter((factor) => factor.id !== adminFactors[2]);
        return send(res, 200, { id: adminFactors[2] });
      }
      return send(res, 200, publicUser(user).factors);
    }
  }

  return send(res, 404, { msg: `auth ${path}` });
}

const SIGNED_UPLOADS = new Map();

async function handleStorage(req, res, url) {
  const publicMatch = url.pathname.match(/^\/storage\/v1\/object\/public\/(vehicle-photos|site-videos)\/(.+)$/);
  if (publicMatch && req.method === 'GET') {
    const file = FILES.get(decodeURIComponent(publicMatch[2]));
    if (!file) return send(res, 404, { message: 'not found' });
    return send(res, 200, file, {
      'Content-Type': publicMatch[1] === 'site-videos' ? 'video/mp4' : 'image/webp',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
  }

  const context = roleFor(req);

  // URL assinada de envio de vídeo: o token vale só para aquele caminho.
  const signMatch = url.pathname.match(/^\/storage\/v1\/object\/upload\/sign\/site-videos\/(.+)$/);
  if (signMatch && req.method === 'OPTIONS') {
    return send(res, 200, '', { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': '*' });
  }
  if (signMatch && req.method === 'POST') {
    const name = decodeURIComponent(signMatch[1]);
    await withRole(context, () => db.query(`insert into storage.objects (bucket_id, name) values ('site-videos', $1)`, [name]));
    const token = randomBytes(12).toString('hex');
    SIGNED_UPLOADS.set(token, name);
    return send(res, 200, { url: `/object/upload/sign/site-videos/${signMatch[1]}?token=${token}`, token });
  }
  if (signMatch && req.method === 'PUT') {
    const name = SIGNED_UPLOADS.get(url.searchParams.get('token'));
    if (name !== decodeURIComponent(signMatch[1])) return send(res, 400, { message: 'token' }, { 'Access-Control-Allow-Origin': '*' });
    SIGNED_UPLOADS.delete(url.searchParams.get('token'));
    FILES.set(name, await readBody(req));
    return send(res, 200, { Key: `site-videos/${name}` }, { 'Access-Control-Allow-Origin': '*' });
  }
  if (url.pathname === '/storage/v1/object/site-videos' && req.method === 'DELETE') {
    const { prefixes } = JSON.parse((await readBody(req)).toString());
    const removed = await withRole(context, async () => {
      const out = [];
      for (const name of prefixes) {
        const result = await db.query(`delete from storage.objects where bucket_id = 'site-videos' and name = $1 returning name`, [name]);
        if (result.rows.length) out.push(name);
      }
      return out;
    });
    for (const name of removed) FILES.delete(name);
    return send(res, 200, removed.map((name) => ({ name })));
  }

  const objectMatch = url.pathname.match(/^\/storage\/v1\/object\/vehicle-photos\/(.+)$/);
  if (objectMatch && req.method === 'POST') {
    const name = decodeURIComponent(objectMatch[1]);
    const contentType = req.headers['content-type'] ?? '';
    const raw = await readBody(req);
    if (context.role !== 'service_role') {
      await withRole(context, () => db.query(`insert into storage.objects (bucket_id, name) values ('vehicle-photos', $1)`, [name]));
    }
    let data = raw;
    const boundary = contentType.match(/boundary=(.+)$/)?.[1];
    if (boundary) {
      const text = raw.toString('latin1');
      const start = text.indexOf('\r\n\r\n', text.indexOf('filename=')) + 4;
      const end = text.indexOf(`\r\n--${boundary}`, start);
      data = raw.subarray(start, end);
    }
    FILES.set(name, data);
    return send(res, 200, { Id: randomUUID(), Key: `vehicle-photos/${name}` });
  }

  if (url.pathname === '/storage/v1/object/vehicle-photos' && req.method === 'DELETE') {
    const { prefixes } = JSON.parse((await readBody(req)).toString());
    const removed = await withRole(context, async () => {
      const out = [];
      for (const name of prefixes) {
        const result = await db.query(`delete from storage.objects where bucket_id = 'vehicle-photos' and name = $1 returning name`, [name]);
        if (result.rows.length) out.push(name);
      }
      return out;
    });
    for (const name of removed) FILES.delete(name);
    return send(res, 200, removed.map((name) => ({ name })));
  }

  return send(res, 404, { message: 'storage' });
}

// Imitações dos serviços externos, para os testes não dependerem da internet nem gastarem consultas.
const SENT_EMAILS = [];
const FIPE_MODELS = {
  25: [
    { codigo: 900, nome: 'Civic Sedan EXL 2.0 Flex 16V Aut.' },
    { codigo: 901, nome: 'Civic Sedan LX 1.8 Flex 16V Mec.' },
    { codigo: 902, nome: 'CITY Sedan EX 1.5 Flex 16V Aut.' },
  ],
};

function handleMock(req, res, url) {
  const path = url.pathname.replace(/^\/__mock/, '');
  if (path === '/fipe/carros/marcas') {
    return send(res, 200, [{ codigo: '25', nome: 'Honda' }, { codigo: '23', nome: 'GM - Chevrolet' }, { codigo: '59', nome: 'VW - VolksWagen' }]);
  }
  const models = path.match(/^\/fipe\/carros\/marcas\/([0-9]+)\/modelos$/);
  if (models) return send(res, 200, { modelos: FIPE_MODELS[models[1]] ?? [], anos: [] });
  if (/^\/fipe\/carros\/marcas\/[0-9]+\/modelos\/[0-9]+\/anos$/.test(path)) {
    return send(res, 200, [{ codigo: '2021-5', nome: '2021 Flex' }, { codigo: '32000-5', nome: '32000 Flex' }]);
  }
  if (/^\/fipe\/carros\/marcas\/[0-9]+\/modelos\/[0-9]+\/anos\/[0-9-]+$/.test(path)) {
    return send(res, 200, { Valor: 'R$ 101.234,00', CodigoFipe: '014075-1', MesReferencia: 'novembro de 2026 ', Combustivel: 'Gasolina' });
  }
  const plate = path.match(/^\/placa\/consulta\/([A-Z0-9]+)\/([^/]+)$/);
  if (plate) {
    if (plate[2] !== 'token-de-teste') return send(res, 402, { message: 'Token inválido' });
    if (plate[1] === 'ZZZ9Z99') return send(res, 406, { message: 'Sem resultados' });
    return send(res, 200, {
      MARCA: 'VW',
      MODELO: 'CROSSFOX',
      anoModelo: '2007',
      chassi: '*****10137',
      cor: 'Prata',
      municipio: 'Sao Leopoldo',
      situacao: 'Sem restrição',
      extra: { combustivel: 'Alcool / Gasolina', sub_segmento: 'AU - HATCH PEQUENO' },
      fipe: { dados: [
        { codigo_fipe: '000000-0', score: 50, texto_marca: 'VW - VolksWagen', texto_modelo: 'errado', texto_valor: 'R$ 1,00', mes_referencia: 'maio' },
        { codigo_fipe: '005225-6', score: 101, texto_marca: 'VW - VolksWagen', texto_modelo: 'CROSSFOX 1.6 Mi Total Flex 8V 5p', texto_valor: 'R$ 28.799,00', mes_referencia: 'maio de 2022 ' },
      ] },
    });
  }
  return send(res, 404, { message: 'mock' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === '/__qa/status') return send(res, 200, { ok: true });
    if (url.pathname === '/__qa/emails') return send(res, 200, SENT_EMAILS);
    if (url.pathname === '/__mock/resend/emails' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString());
      if (req.headers.authorization !== 'Bearer chave-de-teste') return send(res, 401, { message: 'chave' });
      if (body.to[0].includes('falha-email')) return send(res, 500, { message: 'falha' });
      SENT_EMAILS.push(body);
      return send(res, 200, { id: randomUUID() });
    }
    if (url.pathname.startsWith('/__mock/')) return handleMock(req, res, url);
    if (url.pathname === '/__qa/user' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString());
      const user = await createUser({ email: body.email, password: body.password, fullName: body.name });
      await db.query(`insert into public.company_members (company_id, user_id, role) values ($1, $2, $3)`, [body.company, user.id, body.role]);
      return send(res, 200, { id: user.id });
    }
    if (url.pathname === '/__qa/sql' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString());
      const result = await db.query(body.sql, body.params ?? []);
      return send(res, 200, result.rows);
    }
    const rest = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (rest) return await handleRpc(req, res, rest[1]);
    const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (table) return await handleRest(req, res, url, table[1]);
    const auth = url.pathname.match(/^\/auth\/v1\/(.+)$/);
    if (auth) return await handleAuth(req, res, url, auth[1]);
    if (url.pathname.startsWith('/storage/v1/')) return await handleStorage(req, res, url);
    return send(res, 404, { message: 'rota' });
  } catch (error) {
    return pgError(res, error);
  }
});

// Carga inicial com o estoque real do site atual --------------------------------------

async function seedStock() {
  const { rows } = await db.query(`select id from public.companies where slug = 'forte-veiculos'`);
  const companyId = rows[0].id;
  if (!existsSync(STOCK_FILE)) return companyId;
  const stock = JSON.parse(readFileSync(STOCK_FILE, 'utf8'));
  const catalog = readCatalog();
  mkdirSync(CACHE_DIR, { recursive: true });

  for (const item of stock) {
    const identity = catalog[item.slug];
    if (!identity) continue;
    const parts = item.details.split('•').map((part) => part.trim()).filter(Boolean);
    const km = parts.find((part) => /km$/i.test(part));
    const color = parts.find((part) => /^[A-ZÀ-Ú ]+$/.test(part));
    const transmission = parts.find((part) => /autom|manual/i.test(part)) ?? '';
    const features = item.list.map((line) => line.replace(/^[•\-\s]+/, '')).filter((line) => line && !/^[A-ZÀ-Ú0-9 .-]+$/.test(line)).slice(0, 12);
    const text = features.join(' ').toLowerCase();
    const inserted = await db.query(
      `insert into public.vehicles (company_id, slug, brand, model, version, category, model_year, mileage_km, transmission, fuel, color, price_cents, features, status, is_featured)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'available', $14) returning id`,
      [
        companyId, item.slug, identity.brand, identity.model, identity.version, identity.category,
        Number(parts[0]), km ? Number(km.replace(/\D/g, '')) : null,
        /autom/i.test(transmission) ? 'automatic' : /manual/i.test(transmission) ? 'manual' : null,
        /diesel/.test(text) ? 'diesel' : /\bflex\b/.test(text) ? 'flex' : null,
        color ? color.charAt(0) + color.slice(1).toLowerCase() : null,
        Math.round(Number(item.price.replace(/\./g, '').replace(',', '.')) * 100),
        features,
        ['ranger-xls-2019', 'ecosport-freestyle-at-1-5-2019', 'city-sedan-exl-2025', 'corolla-xei-2023'].includes(item.slug),
      ],
    );
    const vehicleId = inserted.rows[0].id;
    let position = 0;
    for (const name of item.photos.slice(0, 3)) {
      const cached = join(CACHE_DIR, `${name}.webp`);
      if (!existsSync(cached)) {
        const response = await fetch(`https://www.forteveiculoscachoeiro.com.br/uploads/${encodeURIComponent(name)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) continue;
        const webp = await sharp(Buffer.from(await response.arrayBuffer())).rotate().resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
        mkdirSync(dirname(cached), { recursive: true });
        writeFileSync(cached, webp);
      }
      const bytes = readFileSync(cached);
      const meta = await sharp(bytes).metadata();
      const id = randomUUID();
      const full = `${companyId}/${vehicleId}/${id}.webp`;
      const thumb = `${companyId}/${vehicleId}/${id}-800.webp`;
      FILES.set(full, bytes);
      FILES.set(thumb, bytes);
      await db.query(`insert into storage.objects (bucket_id, name) values ('vehicle-photos', $1), ('vehicle-photos', $2)`, [full, thumb]);
      await db.query(
        `insert into public.vehicle_photos (company_id, vehicle_id, storage_path, thumb_path, width, height, position, alt) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [companyId, vehicleId, full, thumb, meta.width, meta.height, position, `${identity.brand} ${identity.model} ${Number(parts[0])}`],
      );
      position += 1;
    }
  }
  return companyId;
}

function readCatalog() {
  const source = readFileSync(join(process.cwd(), 'scripts', 'import-stock.mjs'), 'utf8');
  const block = source.match(/const CATALOG = (\{[\s\S]*?\n\});/)[1];
  return new Function(`return ${block}`)();
}

const companyId = await seedStock();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Emulador pronto em http://127.0.0.1:${PORT} (empresa ${companyId})`);
});

// Sobe um Postgres real (PGlite) com as mesmas migrations do projeto para testar RLS sem Docker.
// O schema auth/storage abaixo reproduz o contrato que o Supabase oferece às políticas.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text
  );
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1 : cardinality(string_to_array(name, '/')) - 1]
  $$;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.objects to authenticated, service_role;
  grant select on storage.objects to anon;
  grant execute on function storage.foldername(text) to anon, authenticated, service_role;
`;

export async function createDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = join(process.cwd(), 'supabase', 'migrations');
  for (const file of readdirSync(dir).sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'));
  }
  return db;
}

// Executa fn como um papel da API, com as mesmas claims JWT que o PostgREST aplicaria.
export async function as(db, role, claims, fn) {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? {})]);
    await db.exec(`set local role ${role}`);
    const result = await fn(db);
    await db.exec('commit');
    return result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

export const anon = (db, fn) => as(db, 'anon', {}, fn);
export const user = (db, id, aal, fn) => as(db, 'authenticated', { sub: id, aal, role: 'authenticated' }, fn);
export const service = (db, fn) => as(db, 'service_role', { role: 'service_role' }, fn);

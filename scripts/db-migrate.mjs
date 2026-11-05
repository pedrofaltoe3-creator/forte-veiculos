// Aplica as migrations de supabase/migrations em ordem, cada uma em sua transação, sem repetir.
// Uso: npm run db:migrate (requer DATABASE_URL em .env.local)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { loadEnv, requireEnv } from './lib/env.mjs';

loadEnv();
requireEnv('DATABASE_URL');

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1, onnotice: () => {} });

try {
  await sql`create schema if not exists private`;
  await sql`create table if not exists private.schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql`select name from private.schema_migrations`).map((row) => row.name));

  const dir = join(process.cwd(), 'supabase', 'migrations');
  for (const file of readdirSync(dir).sort()) {
    if (applied.has(file)) {
      console.log(`já aplicada: ${file}`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, file), 'utf8'));
      await tx`insert into private.schema_migrations (name) values (${file})`;
    });
    console.log(`aplicada: ${file}`);
  }
} finally {
  await sql.end();
}

// Envia variáveis do .env.local para a Vercel sem mostrar valores: passam só pela entrada padrão do comando.
// Uso: node scripts/vercel-env-sync.mjs [ambiente] NOME1 NOME2 ...
// Exemplo: node scripts/vercel-env-sync.mjs production SUPABASE_URL SUPABASE_ANON_KEY
// DATABASE_URL fica de fora de propósito: serve só para manutenção local.
import { spawnSync } from 'node:child_process';
import { loadEnv } from './lib/env.mjs';

loadEnv();

const [target, ...names] = process.argv.slice(2);
if (!['production', 'preview', 'development'].includes(target) || names.length === 0) {
  console.error('Uso: node scripts/vercel-env-sync.mjs production|preview|development NOME1 NOME2 ...');
  process.exit(1);
}

let failed = false;
for (const name of names) {
  if (!/^[A-Z0-9_]+$/.test(name) || name === 'DATABASE_URL') {
    console.error(`${name}: recusado`);
    failed = true;
    continue;
  }
  const value = process.env[name];
  if (!value) {
    console.error(`${name}: vazio no .env.local, não enviado`);
    failed = true;
    continue;
  }
  const result = spawnSync(`npx --yes vercel@latest env add ${name} ${target} --force --sensitive`, {
    input: value,
    shell: true,
    encoding: 'utf8',
  });
  console.log(`${name}: ${result.status === 0 ? 'enviado' : 'falhou'}`);
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;

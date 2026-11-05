// Carrega .env.local para os scripts de manutenção, sem dependências extras.
import { existsSync, readFileSync } from 'node:fs';

export function loadEnv() {
  if (existsSync('.env.local')) {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

export function requireEnv(...names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`Preencha em .env.local: ${missing.join(', ')}`);
    process.exit(1);
  }
}

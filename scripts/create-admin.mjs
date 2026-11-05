// Cria o primeiro administrador (ou outro usuário) de uma empresa e imprime um link único para criar a senha.
// Uso: npm run admin:create -- --email pessoa@exemplo.com --name "Nome" --role master [--company forte-veiculos]
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './lib/env.mjs';

loadEnv();
requireEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SITE_URL');

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'master' },
    company: { type: 'string', default: process.env.DEFAULT_COMPANY_SLUG ?? 'forte-veiculos' },
  },
});

if (!values.email || !values.name || !['master', 'owner'].includes(values.role)) {
  console.error('Uso: npm run admin:create -- --email pessoa@exemplo.com --name "Nome" --role master|owner [--company slug]');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: company, error: companyError } = await supabase
  .from('companies')
  .select('id, name')
  .eq('slug', values.company)
  .single();
if (companyError) {
  console.error(`Empresa não encontrada: ${values.company}`);
  process.exit(1);
}

const siteUrl = process.env.SITE_URL.replace(/\/$/, '');
const options = { data: { full_name: values.name }, redirectTo: `${siteUrl}/auth/callback?next=/admin/nova-senha` };

let link = await supabase.auth.admin.generateLink({ type: 'invite', email: values.email, options });
if (link.error?.code === 'email_exists') {
  link = await supabase.auth.admin.generateLink({ type: 'recovery', email: values.email, options: { redirectTo: options.redirectTo } });
}
if (link.error) {
  console.error('Não foi possível criar o usuário:', link.error.message);
  process.exit(1);
}

const { error: memberError } = await supabase.from('company_members').upsert({
  company_id: company.id,
  user_id: link.data.user.id,
  role: values.role,
  is_active: true,
});
if (memberError) {
  console.error('Não foi possível vincular o usuário:', memberError.message);
  process.exit(1);
}

const { hashed_token: token, verification_type: type } = link.data.properties;
console.log(`\nUsuário ${values.email} vinculado a ${company.name} como ${values.role}.`);
console.log('Abra este link no navegador para criar a senha (uso único):\n');
console.log(`${siteUrl}/auth/callback?token_hash=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}&next=/admin/nova-senha\n`);

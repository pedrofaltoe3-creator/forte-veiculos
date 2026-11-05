import 'server-only';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

export const isSupabaseConfigured = () =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);

export const env = {
  get supabaseUrl() {
    return required('SUPABASE_URL');
  },
  get supabaseAnonKey() {
    return required('SUPABASE_ANON_KEY');
  },
  get supabaseServiceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },
  get defaultCompanySlug() {
    return process.env.DEFAULT_COMPANY_SLUG ?? 'forte-veiculos';
  },
  get siteUrl() {
    return (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  },
  get ipHashSecret() {
    return required('IP_HASH_SECRET');
  },
  // Serviços opcionais: sem a chave, o painel funciona e avisa o que ficou desligado.
  get plateApiToken() {
    return process.env.PLACA_API_TOKEN ?? null;
  },
  get plateApiBase() {
    return (process.env.PLACA_API_BASE ?? 'https://wdapi2.com.br').replace(/\/$/, '');
  },
  get resendApiKey() {
    return process.env.RESEND_API_KEY ?? null;
  },
  get resendApiBase() {
    return (process.env.RESEND_API_BASE ?? 'https://api.resend.com').replace(/\/$/, '');
  },
  get emailFrom() {
    return process.env.EMAIL_FROM ?? 'nao-responda@forteveiculoscachoeiro.com.br';
  },
  get smtpHost() {
    return process.env.SMTP_HOST ?? 'smtp.gmail.com';
  },
  get smtpPort() {
    return Number(process.env.SMTP_PORT ?? 465);
  },
  get smtpUser() {
    return process.env.SMTP_USER ?? null;
  },
  // A senha de app do Google aparece com espaços, que não fazem parte dela.
  get smtpPassword() {
    return process.env.SMTP_PASSWORD?.replace(/\s+/g, '') || null;
  },
};

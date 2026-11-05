import 'server-only';
import nodemailer from 'nodemailer';
import { env } from '@/lib/env';

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

// Link de uso único que abre em qualquer navegador: o token vai na URL, sem depender de cookie do pedido.
export function accessLink(hashedToken: string, type: string) {
  return `${env.siteUrl}/auth/callback?token_hash=${encodeURIComponent(hashedToken)}&type=${encodeURIComponent(type)}&next=/admin/nova-senha`;
}

type AccessEmail = { kind: 'invite' | 'recovery'; name?: string; storeName: string; link: string };

export function accessEmail({ kind, name, storeName, link }: AccessEmail) {
  const greeting = name ? `Olá, ${name}.` : 'Olá.';
  const intro =
    kind === 'invite'
      ? `Seu acesso ao painel da ${storeName} foi criado. Clique no botão para criar a sua senha.`
      : `Recebemos um pedido para criar uma nova senha no painel da ${storeName}. Clique no botão para continuar.`;
  const action = kind === 'invite' ? 'Criar minha senha' : 'Criar nova senha';
  const note = 'O link funciona uma única vez e expira em breve. Se não reconhece este pedido, ignore este e-mail.';

  return {
    subject: kind === 'invite' ? `Seu acesso ao painel da ${storeName}` : `Nova senha do painel da ${storeName}`,
    text: `${greeting}\n\n${intro}\n\n${link}\n\n${note}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#14173f;max-width:520px">
<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(intro)}</p>
<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#0b0f8a;color:#ffffff;font-weight:bold;text-decoration:none">${action}</a></p>
<p style="font-size:14px;color:#565a82">${escapeHtml(note)}</p>
</div>`,
  };
}

type Message = { to: string; fromName: string; subject: string; text: string; html: string };

// O Resend é o caminho definitivo, com o domínio da loja. Enquanto ele não está ligado,
// o envio sai pelo SMTP configurado, como uma conta do Gmail com senha de app.
export const isEmailConfigured = () => Boolean(env.resendApiKey || (env.smtpUser && env.smtpPassword));

const safeName = (name: string) => name.replace(/[<>"\\]/g, '');

async function sendWithResend({ to, fromName, subject, text, html }: Message) {
  const response = await fetch(`${env.resendApiBase}/emails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${safeName(fromName)} <${env.emailFrom}>`, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) console.error('E-mail recusado pelo Resend', response.status);
  return response.ok;
}

async function sendWithSmtp({ to, fromName, subject, text, html }: Message) {
  const transport = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: { user: env.smtpUser!, pass: env.smtpPassword! },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  // O Gmail só aceita a própria conta como remetente: o nome da loja aparece, o endereço é o da conta.
  await transport.sendMail({ from: { name: safeName(fromName), address: env.smtpUser! }, to, subject, text, html });
  return true;
}

// Com falha ou sem configuração, devolve false e o painel mostra o link para enviar à mão.
export async function sendEmail(message: Message): Promise<boolean> {
  try {
    if (env.resendApiKey) return await sendWithResend(message);
    if (env.smtpUser && env.smtpPassword) return await sendWithSmtp(message);
    return false;
  } catch (error) {
    const code = (error as { code?: string; responseCode?: number }).responseCode ?? (error as { code?: string }).code;
    console.error('Falha ao enviar e-mail', code ?? 'sem código');
    return false;
  }
}

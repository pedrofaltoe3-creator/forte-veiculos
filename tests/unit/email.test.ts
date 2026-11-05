import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const { accessEmail, accessLink, isEmailConfigured, sendEmail } = await import('../../src/lib/email');

const message = { to: 'pessoa@exemplo.test', fromName: 'Forte <Veículos>', subject: 'Assunto', text: 'texto', html: '<p>texto</p>' };
const keys = ['RESEND_API_KEY', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_HOST', 'SMTP_PORT', 'SITE_URL'];

describe('envio de e-mail', () => {
  beforeEach(() => {
    for (const key of keys) delete process.env[key];
    sendMail.mockReset();
    createTransport.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sem configuração não envia nada e o painel mostra o link', async () => {
    expect(isEmailConfigured()).toBe(false);
    expect(await sendEmail(message)).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('com Gmail envia pela conta, com o nome da loja e sem os espaços da senha de app', async () => {
    process.env.SMTP_USER = 'conta@gmail.com';
    process.env.SMTP_PASSWORD = 'abcd efgh ijkl mnop';
    sendMail.mockResolvedValue({ messageId: '1' });
    expect(isEmailConfigured()).toBe(true);
    expect(await sendEmail(message)).toBe(true);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'conta@gmail.com', pass: 'abcdefghijklmnop' },
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: 'Forte Veículos', address: 'conta@gmail.com' }, to: 'pessoa@exemplo.test', subject: 'Assunto',
    }));
  });

  it('falha no SMTP não derruba a ação e não expõe a senha', async () => {
    process.env.SMTP_USER = 'conta@gmail.com';
    process.env.SMTP_PASSWORD = 'segredo-de-teste';
    sendMail.mockRejectedValue(Object.assign(new Error('Invalid login: segredo-de-teste'), { responseCode: 535 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await sendEmail(message)).toBe(false);
    expect(JSON.stringify(log.mock.calls)).not.toContain('segredo-de-teste');
    log.mockRestore();
  });

  it('com Resend ligado, ele tem preferência sobre o SMTP', async () => {
    process.env.RESEND_API_KEY = 'chave-de-teste';
    process.env.SMTP_USER = 'conta@gmail.com';
    process.env.SMTP_PASSWORD = 'x';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendEmail(message)).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('o link abre em qualquer navegador e o HTML escapa o nome', () => {
    process.env.SITE_URL = 'https://loja.test/';
    expect(accessLink('a b', 'recovery')).toBe('https://loja.test/auth/callback?token_hash=a%20b&type=recovery&next=/admin/nova-senha');
    const email = accessEmail({ kind: 'invite', name: '<b>Ana</b>', storeName: 'Forte', link: 'https://loja.test/x?a=1&b=2' });
    expect(email.html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(email.html).toContain('href="https://loja.test/x?a=1&amp;b=2"');
    expect(email.subject).toBe('Seu acesso ao painel da Forte');
  });
});

# Configurar o Supabase

## Estado atual

| Item | Valor |
|---|---|
| Organização | Forte veiculos, plano Free |
| Projeto | Next PG, região `us-west-2` |
| Migrations | todas aplicadas e registradas em `private.schema_migrations` |
| Estoque | 17 veículos e 128 fotos importados do site antigo |
| Cadastro público | desligado |
| MFA TOTP | ligado |
| Site URL | `https://forteveiculos.vercel.app` |
| Redirect URL | `https://forteveiculos.vercel.app/auth/callback**` |
| SMTP próprio | ainda não configurado |

Os passos abaixo valem para refazer o ambiente ou criar outro.

## 1. Criar o projeto

1. Em [supabase.com](https://supabase.com), crie um projeto. Para atender o Brasil, prefira **South America (São Paulo)**: a região não muda depois.
2. Guarde a senha do banco em um gerenciador de senhas.

## 2. Preencher as variáveis

Copie `.env.example` para `.env.local`. Os valores estão em **Project Settings > API Keys** e **Connect**.

| Variável | Onde encontrar | Vai para a Vercel? |
|---|---|---|
| `SUPABASE_URL` | `https://{ref}.supabase.co` | Sim |
| `SUPABASE_ANON_KEY` | Publishable key (`sb_publishable_...`) | Sim |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key (`sb_secret_...`) | Sim, como segredo |
| `IP_HASH_SECRET` | Gere com o comando abaixo | Sim, como segredo |
| `SITE_URL` | Endereço público do site | Sim |
| `DEFAULT_COMPANY_SLUG` | `forte-veiculos` | Sim |
| `SITE_NOINDEX` | `1` em demonstração; remova no site oficial | Sim |
| `RESEND_API_KEY` | Opcional. Resend, API Keys. Envio definitivo, com o domínio da loja | Sim, como segredo |
| `SMTP_USER` | Opcional. Conta que envia enquanto o Resend não está ligado, como `nextpgcomercial@gmail.com` | Sim |
| `SMTP_PASSWORD` | Opcional. Senha de app do Google da conta acima, não a senha normal | Sim, como segredo |
| `EMAIL_FROM` | Opcional. Remetente do e-mail, em domínio verificado | Sim |
| `PLACA_API_TOKEN` | Opcional. apiplacas.com.br. Liga a busca automática paga | Sim, como segredo |
| `DATABASE_URL` | Connect, connection string | **Não** |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

As chaves antigas `anon` e `service_role` serão retiradas pelo Supabase em 2027: use as novas. Nenhuma variável usa o prefixo `NEXT_PUBLIC_`, então nada vai para o navegador.

## 3. Criar as tabelas

```bash
npm run db:migrate
```

Alternativa sem `DATABASE_URL`: cole, em ordem, cada arquivo de `supabase/migrations` no SQL Editor. Nesse caso:

- Ao aparecer o aviso sobre RLS, escolha **Run and enable RLS**.
- O aviso de operação destrutiva vem de comandos `delete` dentro de funções. Eles só rodam quando as funções são chamadas.
- Registre os arquivos em `private.schema_migrations`, para o script não repeti-los.

## 4. Ajustar o Auth

Em **Authentication**:

| Onde | Ajuste |
|---|---|
| Sign In / Providers | **Desligar** "Allow new users to sign up" |
| Multi-Factor | TOTP em **Enabled** |
| URL Configuration > Site URL | Endereço público, sem barra no final |
| URL Configuration > Redirect URLs | `{endereço}/auth/callback**` |
| Rate Limits | Manter os padrões |

Se o cadastro público ficar ligado por engano, a pessoa cria uma conta mas não acessa nada: sem vínculo em `company_members`, todas as regras negam.

## SMTP

O envio embutido do Supabase só atende e-mails da equipe do projeto e tem limite muito baixo. Sem SMTP próprio, o "Esqueci minha senha" não chega para o proprietário: um master gera o link em **Usuários > Link para nova senha**, que abre em qualquer aparelho.

Os e-mails de **Criar acesso**, **Link para nova senha** e **Esqueci minha senha** não passam pelo Supabase: o servidor gera o link e envia. Primeiro tenta o Resend, com `RESEND_API_KEY`. Sem ele, usa o SMTP de `SMTP_USER` e `SMTP_PASSWORD`, como uma conta do Gmail com senha de app, até cerca de 500 e-mails por dia. Sem nenhum dos dois, o painel avisa e mostra o link para enviar à mão, e o "Esqueci minha senha" volta a passar pelo Supabase.

O link enviado assim abre em qualquer aparelho.

O SMTP do próprio Supabase só é usado nesse último caso. Para configurar com o Resend, depois de verificar o domínio ([PUBLICACAO.md](PUBLICACAO.md#6-e-mail)):

1. No Resend, crie uma API key com permissão de envio.
2. No Supabase, em **Authentication > Emails > SMTP Settings**, preencha:

| Campo | Valor |
|---|---|
| Sender email | `nao-responda@forteveiculoscachoeiro.com.br` |
| Sender name | `Forte Veículos` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | a API key do Resend |

3. Em **Authentication > Emails > Templates > Reset password**, troque o link do corpo do e-mail por este, para ele abrir em qualquer aparelho:

```html
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery">Criar nova senha</a>
```

4. Teste com "Esqueci minha senha", pedindo no computador e abrindo o e-mail no celular.
5. Retire de `src/app/admin/recuperar-senha/page.tsx` a frase "Abra o link neste mesmo navegador".

**Por que o passo 3:** o modelo padrão usa um código ligado ao navegador que pediu o link. Sem o ajuste, quem pede no computador e abre no celular cai em "link inválido". O Supabase só libera a edição do modelo depois de ligar o SMTP próprio.

## 5. Criar o primeiro administrador

```bash
npm run admin:create -- --email seu@email.com --name "Seu Nome" --role master
```

O comando imprime um link de uso único, válido por cerca de 1 hora. Abra no navegador, crie a senha e cadastre o MFA. `SITE_URL` precisa apontar para um endereço já publicado.

O acesso do proprietário é criado pelo painel, em **Usuários > Criar acesso**, com a permissão **Proprietário**. O sistema gera um link para enviar à pessoa, que cria a própria senha.

## 6. Importar o estoque

Rode **antes** de apontar o domínio para o site novo, porque dados e fotos vêm do site antigo nesse mesmo domínio.

Para conferir sem tocar no banco:

```bash
npm run stock:import -- --conferir
```

Para importar:

```bash
npm run stock:import
```

Pode rodar de novo: veículos já importados são ignorados. O resultado da importação atual está em [CONFERENCIA-ESTOQUE.md](CONFERENCIA-ESTOQUE.md).

## 7. Completar os dados legais

Em **Ajustes técnicos** (só master), preencha razão social, CNPJ e encarregado de dados. Esses campos aparecem no rodapé e na Política de Privacidade.

## 8. Backups

Veja [SEGURANCA.md](SEGURANCA.md#backups-e-recuperação). O plano gratuito do Supabase não inclui backup automático.

## Manutenção

- **Plano Free:** o projeto pausa depois de 7 dias sem uso. Reative em Project > Restore.
- **Advisors:** veja **Advisors > Security** depois de cada mudança de banco. Na auditoria de 03/11/2026: nenhum erro. O aviso "Leaked Password Protection" só pode ser resolvido no plano Pro: ligue ao assinar. As sugestões sobre `private.rate_limits` e `private.schema_migrations` são esperadas, porque essas tabelas ficam fora da API de propósito.
- **Trocar chave:** gere outra em API Keys, envie com `scripts/vercel-env-sync.mjs`, publique e só então apague a antiga.

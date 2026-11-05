# Hospedagem e publicação

## Estado atual

| Item | Valor |
|---|---|
| Site de demonstração | https://forteveiculos.vercel.app |
| Projeto Vercel | `forte-veiculos`, time Pedro e Viana, plano Hobby |
| Região do servidor | `pdx1` (Oregon), perto do banco |
| Banco | Supabase, projeto Next PG, organização Forte veiculos, `us-west-2` |
| Buscadores | bloqueados com `SITE_NOINDEX=1` |
| Domínio oficial | **não alterado**: `forteveiculoscachoeiro.com.br` continua no site antigo |

Este ambiente serve para apresentar o site à empresa. Para virar o site oficial, siga o [go-live](#go-live-no-domínio-oficial).

## Publicar uma atualização

O projeto publica direto desta pasta, sem GitHub:

```bash
npx vercel@latest deploy --prod
```

O `.vercelignore` impede o envio de `.env*`, testes, documentos e materiais brutos.

Variáveis de ambiente são enviadas sem exibir valores:

```bash
node scripts/vercel-env-sync.mjs production NOME_DA_VARIAVEL
```

`DATABASE_URL` fica só na máquina local: o script recusa enviá-la.

Depois de mudar uma variável, publique de novo para ela valer.

## Mudança de banco

Toda alteração é uma migration nova em `supabase/migrations`. Aplique com `npm run db:migrate` (precisa de `DATABASE_URL`) ou cole no SQL Editor e registre em `private.schema_migrations`.

## Go-live no domínio oficial

### 1. Planos

A Vercel Hobby é restrita a uso pessoal e não comercial, então um site comercial precisa do plano Pro. O Supabase Free pausa o projeto depois de 7 dias sem uso, não tem backup diário e não bloqueia senhas vazadas. Assine Pro nos dois antes de virar o domínio, confira os preços atuais nos sites deles e ligue **Leaked Password Protection** em Authentication.

### 2. Região do banco (decisão)

O banco está nos EUA por escolha do projeto. A região não muda depois de criada: mudar exige projeto novo em `sa-east-1`, migração dos dados e troca de `vercel.json` para `gru1`. Vale avaliar antes do go-live, porque reduz o tempo de resposta e a transferência internacional de dados.

### 3. Antes de virar o DNS

- [ ] Loja conferiu preços, situação e dados em [CONFERENCIA-ESTOQUE.md](CONFERENCIA-ESTOQUE.md)
- [ ] Razão social, CNPJ e encarregado preenchidos em Ajustes técnicos
- [ ] Políticas revisadas por profissional jurídico
- [ ] Master e proprietário com MFA
- [ ] Backup configurado e uma restauração testada
- [ ] Cópia do site antigo guardada: depois da virada ele sai do ar neste domínio

### 4. Variáveis e configurações

1. Na Vercel: `SITE_URL=https://www.forteveiculoscachoeiro.com.br` e remova `SITE_NOINDEX`.
2. Em Ajustes técnicos: endereço oficial `https://www.forteveiculoscachoeiro.com.br`.
3. No Supabase, em Authentication > URL Configuration: Site URL com o endereço oficial, e Redirect URL `https://www.forteveiculoscachoeiro.com.br/auth/callback**`.

### 5. DNS na GoDaddy

O domínio foi registrado pela GoDaddy em nome da Forte, então a conta que controla o DNS é a da loja. Sem a senha dela, o dono pode dar acesso de delegado em Configurações da conta. O DNS está nos servidores `ns57` e `ns58.domaincontrol.com`. Em novembro de 2026 o domínio apontava para `177.206.29.43`, sem registros MX, com um TXT de verificação do Google.

**Não apague o TXT `google-site-verification`.**

Adicione os domínios na Vercel:

```bash
npx vercel@latest domains add www.forteveiculoscachoeiro.com.br forte-veiculos
```

```bash
npx vercel@latest domains add forteveiculoscachoeiro.com.br forte-veiculos
```

A Vercel mostra os valores exatos a usar. Normalmente são:

| Tipo | Nome | Valor |
|---|---|---|
| A | `@` | `76.76.21.21` (substitui `177.206.29.43`) |
| CNAME | `www` | `cname.vercel-dns.com` (substitui o A atual) |

Na Vercel, defina `www` como principal, para o domínio sem `www` redirecionar para ele. O certificado HTTPS é emitido sozinho depois que o DNS propagar.

### 6. E-mail

O domínio já está cadastrado no Resend, região São Paulo, aguardando verificação. Estes registros não afetam o site nem a recepção de e-mails:

| Tipo | Nome | Valor |
|---|---|---|
| TXT | `resend._domainkey` | conforme a tela Domains do Resend |
| CNAME | `rsend` | `rsend-sae1.forge.rmta.net` |
| CNAME | `send` | `send.forge.rmta.net` |

Depois:

1. No Resend, crie uma API key com permissão de envio e coloque em `RESEND_API_KEY`.
2. Envie a variável, sem exibir o valor, e publique de novo:

```bash
node scripts/vercel-env-sync.mjs production RESEND_API_KEY
```

3. Siga a seção de SMTP em [SUPABASE.md](SUPABASE.md#smtp), para o "Esqueci minha senha".

### 7. Depois de publicar

- Rode o teste público contra o domínio oficial (veja [TESTES.md](TESTES.md)).
- **Search Console:** envie `https://www.forteveiculoscachoeiro.com.br/sitemap.xml`.
- **Google Meu Negócio:** confira endereço, horário e link.
- **Analytics e Meta Pixel:** informe os IDs em Ajustes técnicos. Só carregam com o consentimento do visitante.

## Endereços do site antigo

Já estão preservados com redirecionamento permanente, então links externos e o que o Google conhece continuam valendo:

- `/index.php` vai para `/` e `/nos.php` vai para `/#sobre` (`next.config.ts`).
- Veículos em `/{slug}`, como `/corolla-xei-2023`, vão para `/veiculos/corolla-xei-2023` (`src/app/(site)/[...resto]/page.tsx`). Por isso a importação mantém os mesmos slugs.

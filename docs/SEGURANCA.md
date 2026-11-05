# Segurança

Resumo do que está implementado, como foi verificado e o que depende de operação. Veja também [TESTES.md](TESTES.md).

## Camadas

| Risco | Proteção | Onde |
|---|---|---|
| Acesso indevido ao painel | Barreira no proxy, guarda de servidor em cada página e ação, RLS no banco | `src/proxy.ts`, `src/lib/auth/guards.ts`, `supabase/migrations/*_rls.sql` |
| Senhas | Hash feito pelo Supabase Auth; o app nunca grava senha | Supabase Auth |
| Conta roubada | MFA TOTP obrigatório para todos do painel, exigido também pela RLS (`aal2`) | `private.has_mfa_session()` |
| Tentativas excessivas de login | 5 por e-mail e 20 por IP a cada 15 minutos, além dos limites do Auth | `src/app/admin/auth-actions.ts` |
| Enumeração de contas | Mesma mensagem para senha errada, e-mail inexistente e conta sem acesso | `auth-actions.ts` |
| Vazamento entre empresas | `company_id` com RLS, FKs compostas, pastas por empresa no Storage | migrations |
| Escalada de permissão | Papel lido do banco; só master altera vínculos; empresa nunca fica sem master | `company_members`, `guard_last_master` |
| Injeção de SQL | Consultas parametrizadas pelo PostgREST; busca com curingas escapados; filtros validados | `src/lib/vehicles.ts` |
| XSS | React escapa por padrão; JSON-LD escapado; CSP com nonce e `strict-dynamic` | `JsonLd.tsx`, `proxy.ts` |
| CSRF | Server Actions conferem a origem; API exige mesma origem; cookies `SameSite=Lax` | `src/lib/request.ts` |
| Roubo de sessão | Cookies HttpOnly, Secure em produção; expiração por inatividade em 8 horas | `src/lib/supabase/cookies.ts` |
| Upload malicioso | Assinatura real do arquivo, limite de 8 MB e de pixels, reprocessamento para WebP sem metadados | `api/admin/vehicles/[id]/photos` |
| Spam nos formulários | Campo armadilha, tempo mínimo de preenchimento, 5 envios a cada 10 minutos e 20 por dia por IP | `src/app/(site)/actions.ts` |
| Vazamento de chaves | Nenhuma variável `NEXT_PUBLIC_`; `server-only` faz o build falhar se a chave chegar ao navegador | `src/lib/env.ts`, `src/lib/supabase/admin.ts` |
| Redirecionamento aberto | Destinos do callback em lista fixa | `src/app/auth/callback/route.ts` |
| Rastreabilidade | Histórico imutável por gatilhos; ninguém altera nem apaga | `audit_logs` |
| Transporte | HSTS e HTTPS obrigatório em produção | `next.config.ts`, Vercel |

## Sessões

- **Sair** encerra a sessão em todos os aparelhos (`scope: global`).
- **Trocar a senha** encerra as outras sessões.
- **Desativar ou remover um usuário** corta o acesso aos dados na hora, pela RLS, e apaga as sessões.
- Um token de acesso já emitido vale até 1 hora, mas sem vínculo ativo a RLS nega tudo.

## Rate limiting

Os contadores ficam em `private.rate_limits`, para funcionar entre instâncias serverless. Se o banco falhar, o limite nega por segurança. Os identificadores são gravados como HMAC com `IP_HASH_SECRET`.

Em produção vale somar proteção na borda: ative o Attack Challenge ou regras de firewall da Vercel se houver abuso.

## LGPD

- Cookies não essenciais ficam desligados até a escolha, e a revogação apaga os cookies de análise e marketing do domínio.
- O consentimento fica registrado em `cookie_consents`, com versão da política e assinatura do IP.
- Mapa e publicações do Instagram só carregam com consentimento ou clique.
- Fontes hospedadas no próprio site, sem requisição ao Google.
- Leads guardam a versão do texto aceito. O proprietário pode excluir um contato pelo painel para atender pedidos de titulares.
- O histórico de leads não guarda nome, telefone, e-mail nem mensagem.

### Retenção

A função `purge_expired_personal_data` apaga leads com mais de 24 meses e consentimentos com mais de 60. Agende com pg_cron (Database > Extensions > pg_cron) no SQL Editor:

```sql
select cron.schedule('limpeza-lgpd', '0 4 1 * *', $$select public.purge_expired_personal_data()$$);
```

### A revisar com a loja

As políticas são um modelo técnico fiel ao que o sistema faz, e precisam de revisão jurídica. Razão social, CNPJ e encarregado vêm de **Ajustes técnicos**.

## Backups e recuperação

| Plano | Banco | Fotos |
|---|---|---|
| Free | Sem backup automático | Sem backup |
| Pro | Backup diário por 7 dias | Sem backup automático |

**Recomendação para produção:** plano Pro mais o backup externo abaixo.

O workflow `.github/workflows/backup.yml` gera um dump criptografado por semana. Configure no GitHub os segredos `SUPABASE_DB_URL` e `BACKUP_PASSPHRASE`.

### Restaurar

1. Crie um projeto novo no Supabase, em branco.
2. Baixe o artefato do GitHub Actions e descriptografe:

```bash
gpg --decrypt backup.sql.gz.gpg | gunzip > backup.sql
```

3. Restaure:

```bash
psql "$DATABASE_URL_NOVO" -f backup.sql
```

4. Copie as fotos do bucket antigo, se ele ainda existir, e atualize as variáveis na Vercel.

Teste uma restauração antes do go-live e uma vez por semestre: backup sem teste de restauração não é garantia.

## Se uma chave vazar

1. **`service_role`:** gere nova chave no Supabase e atualize a Vercel. Depois revise `audit_logs` e `company_members`.
2. **Senha de um usuário:** em Usuários, encerre as sessões, redefina o MFA e gere um link de nova senha.
3. **`IP_HASH_SECRET`:** troque na Vercel. Os limites de tentativas recomeçam do zero.

Incidente com dados pessoais pode exigir comunicação à ANPD e aos titulares (LGPD, art. 48).

## Onde ficam os dados

No ambiente atual, banco e servidor do site ficam nos Estados Unidos (`us-west-2` e `pdx1`), o que a Política de Privacidade informa. Se o banco mudar de região, atualize esse texto.

## Limites conhecidos

- A chave `service_role` está no servidor. Quem tiver acesso à conta da Vercel consegue lê-la: proteja com MFA.
- Registros criados pelo servidor com `service_role` (leads, consentimentos) não têm autor, o que é esperado.
- Um master pode ser membro de várias empresas. Conceda esse papel só a pessoas da Next PG.
- O projeto ainda não passou por teste de intrusão feito por terceiros.

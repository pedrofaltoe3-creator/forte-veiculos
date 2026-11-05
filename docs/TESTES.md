# Testes

## O que existe

| Comando | O que valida | Banco |
|---|---|---|
| `npm run test` | Regras de validação, leitura do Placa FIPE, oferta e testes de RLS | Postgres real embutido (PGlite), com as migrations do projeto |
| `node tests/e2e/real-supabase.mjs` | Auth, MFA, RLS, isolamento, Storage e sessões | **Supabase real**, com dados de teste apagados no final |
| `E2E_BASE_URL=https://... node tests/e2e/production-public.mjs` | Site publicado: páginas, formulários, cookies, cabeçalhos, WhatsApp e celular | **Supabase real**, com leads de teste apagados no final |
| `node tests/e2e/link-check.mjs https://...` | Links internos e imagens quebrados | O site informado |
| `node tests/e2e/panel.e2e.mjs` | Fluxos completos em Chrome real | Emulador local |
| `node tests/e2e/visual-check.mjs pasta` | Capturas, scrub do hero, teste de flick, portões do hero estático | Emulador local |
| `node tests/e2e/contrast-audit.mjs` | Contraste do pior pixel sob o texto do hero | Emulador local |

## Como rodar os testes de navegador

O emulador (`tests/e2e/supabase-emulator.mjs`) usa Postgres real com as migrations e as políticas RLS verdadeiras, e imita a API do Supabase (PostgREST, Auth com MFA e Storage). Ele também imita a FIPE, a API Placas e o Resend. Serve para testes locais e não entra no build.

1. Terminal 1:

```bash
node tests/e2e/supabase-emulator.mjs 54321
```

2. Terminal 2 (Git Bash ou Linux):

```bash
npm run build
```

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=emulador-anon-key SUPABASE_SERVICE_ROLE_KEY=emulador-service-key SITE_URL=http://localhost:3000 IP_HASH_SECRET=segredo-somente-para-teste-local FIPE_API_BASE=http://127.0.0.1:54321/__mock/fipe PLACA_API_BASE=http://127.0.0.1:54321/__mock/placa PLACA_API_TOKEN=token-de-teste RESEND_API_BASE=http://127.0.0.1:54321/__mock/resend RESEND_API_KEY=chave-de-teste npx next start -p 3000
```

3. Terminal 3:

```bash
node tests/e2e/panel.e2e.mjs
```

Reinicie o emulador antes de cada rodada: o teste do último master presume um banco limpo. Os resultados ficam em `test-results/e2e`.

## Dados de teste

`real-supabase.mjs` cria duas empresas e usuários marcados como TESTE e apaga tudo no final, sem escrever nos dados da empresa real. Como `audit_logs` é imutável, sobram linhas de histórico das empresas removidas. Elas não aparecem no painel e podem ser limpas no SQL Editor:

```sql
alter table public.audit_logs disable trigger audit_logs_append_only;
delete from public.audit_logs where company_id not in (select id from public.companies);
alter table public.audit_logs enable trigger audit_logs_append_only;
```

Os testes de 03/11/2026 deixaram 66 linhas de empresas removidas e 26 no Histórico da Forte, todas de testes. Elas continuam lá: apagar histórico é decisão do responsável pelo projeto. Também ficou 1 registro de consentimento, de 03/11/2026 às 14:24, sem origem confirmada.

O limite de envios vale nos testes: mais de 5 formulários em 10 minutos a partir do mesmo IP são bloqueados. Espere a janela antes de repetir `production-public.mjs`.

## O que o emulador não prova

Ele valida o código do app e as regras do banco, mas é uma imitação da API. Por isso os fluxos de Auth, RLS e Storage também são testados em `real-supabase.mjs`, e os formulários em `production-public.mjs`.

## Resultado em produção (03/11/2026)

Ambiente: https://forteveiculos.vercel.app, com o Supabase real.

| Rodada | Resultado |
|---|---|
| `npm run test` | 81 de 81 |
| `real-supabase.mjs` | 44 de 44, antes da verificação nova de Fotos do site, que ainda não rodou no banco real |
| `production-public.mjs` | 41 de 41 |
| `panel.e2e.mjs` (emulador) | 114 de 114, com venda, financeiro, oferta, placa, leads automáticos, vídeo, e-mail de acesso e de nova senha |
| Identificadores de teste do GA4 e do Pixel | Nada carrega sem decisão nem ao recusar. Ao aceitar, carregam sem erro de CSP. Identificadores removidos depois |
| Advisors do Supabase | Nenhum erro de segurança ou desempenho |
| Fotos do site no ar | Foto de teste no cartão e na abertura aparece no computador e no celular, sem vídeo e sem erro. Envio sem sessão recusado (401) e de outra origem recusado (403). Site devolvido ao original |

Na busca com texto de injeção de SQL, a Cloudflare do Supabase bloqueia a consulta antes do banco. O catálogo responde vazio e a Vercel registra "Falha na busca do catálogo". É o comportamento esperado para esse teste.

Isto não é auditoria externa nem teste de intrusão: nenhum dos dois foi feito.

## Roteiro manual no ambiente publicado

- [x] Login do master com MFA em um aplicativo de verdade
- [x] Criar o acesso do proprietário e entrar com ele: login e MFA registrados no Histórico
- [x] Cadastrar veículo, enviar fotos, definir principal, reordenar, excluir foto
- [x] Alterar preço, reservar, destacar, marcar como vendido e rascunho, conferindo o site
- [x] Excluir o veículo: some do banco, do Storage e do site
- [ ] Entrar pelo © do rodapé, trocar uma foto em Fotos do site e voltar à original
- [x] Ver os leads no painel, mudar a situação, anotar e excluir
- [x] Alterar Informações da loja e Ajustes técnicos, devolvendo os valores
- [x] Histórico registra quem fez cada ação
- [x] Escolher marca, modelo, versão e ano com a tabela FIPE real: Fiat Argo 2023, R$ 76.387
- [x] Confirmar venda, lançar despesa e desfazer, com carro TESTE
- [x] Colocar carro TESTE em oferta e conferir o site
- [x] Abrir lead e responder pelo WhatsApp, conferindo a situação
- [x] Enviar vídeo do Instagram e ver rodando no site, com envio real para o Storage
- [x] Colar os dados do Placa FIPE no painel publicado, com o texto de uma página real, sem salvar
- [ ] Criar acesso e receber o e-mail, depois de verificar o domínio no Resend
- [x] "Esqueci minha senha": o e-mail chega, e o link abre "Criar senha" na conta certa, pedindo o código do MFA
- [x] Link já usado cai em "Este link expirou", sem abrir sessão
- [ ] Salvar a nova senha por esse link, com o código do aplicativo
- [x] Encerrar sessões do master: o painel volta para o login na hora
- [x] Desativar e remover o único master: recusado, com aviso
- [ ] Desativar e remover outro usuário pela tela
- [x] Sair e confirmar que `/admin`, `/admin/veiculos` e `/admin/nova-senha` voltam para o login
- [x] Sessão vinda do link, sem MFA, não abre o painel: vai para a verificação
- [x] Em Advisors do Supabase, nenhum erro de segurança. Resta um aviso que depende do plano Pro

Os itens em aberto passaram no emulador, pela tela. Os de senha e de usuário também passaram no Supabase real, pela API. Em produção eles dependem de digitar uma senha ou de um usuário que possa ser removido: o único além do master é uma pessoa real.

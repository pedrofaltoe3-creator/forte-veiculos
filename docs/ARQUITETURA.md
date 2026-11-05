# Arquitetura

## Visão geral

```
Navegador ── HTTPS ──> Next.js (servidor)
                         ├─ proxy.ts: CSP com nonce e barreira de /admin
                         ├─ Páginas públicas: cliente anônimo (só o que a RLS libera ao público)
                         ├─ Painel: cliente com a sessão do usuário (RLS decide por empresa e papel)
                         └─ Formulários e registros: service_role, depois de validar e limitar
                                     │
                                     └─> Supabase: Postgres (RLS) + Auth (MFA) + Storage
```

O navegador nunca fala direto com o Supabase. Toda chave fica no servidor. As imagens são a exceção: são públicas e vêm da CDN do Storage.

## Por que não é um site estático

A skill "Site de 10K" propõe HTML puro publicado por FTP. O projeto pede login, permissões validadas no servidor, upload e rate limiting, o que exige servidor. Mantivemos da skill o padrão visual e o hero guiado por scroll (`src/components/site/HeroScrub.tsx`), com a mesma engenharia: busca por Blob, seeks travados, faixas ritmadas por distância de scroll e os cinco portões do hero estático.

## Dados

| Tabela | Conteúdo | Leitura pública | Quem altera |
|---|---|---|---|
| `companies`, `company_domains` | Empresas e domínios | Sim, se ativa | Master (nome); domínios só por SQL |
| `profiles` | Espelho de `auth.users` | Não | O próprio (nome) |
| `company_members` | Vínculo usuário e empresa, com papel | Não | Master |
| `vehicles`, `vehicle_photos` | Estoque | Sim, exceto rascunho | Master e proprietário |
| `leads` | Contatos recebidos | Não | Servidor insere; equipe atualiza situação e notas |
| `site_settings` | Dados comerciais | Sim | Master e proprietário |
| `technical_settings` | SEO, medição, dados legais | Sim | Master |
| `instagram_posts` | Publicações exibidas | Sim | Master e proprietário |
| `financial_entries` | Vendas, despesas e outras entradas | Não | Master e proprietário |
| `audit_logs` | Histórico, só por gatilho, lido só pelo master | Não | Ninguém |
| `cookie_consents` | Prova de consentimento | Não | Servidor insere |
| `private.rate_limits` | Contadores | Fora da API | Função restrita |

## Papéis

| Ação | Proprietário | Master |
|---|---|---|
| Estoque, preços, fotos, destaques | Sim | Sim |
| Fotos do site | Sim | Sim |
| Leads | Sim | Sim |
| Informações da loja, Instagram | Sim | Sim |
| Financeiro, confirmar venda | Sim | Sim |
| Histórico | Não | Sim |
| Usuários, sessões, MFA de terceiros | Não | Sim |
| Ajustes técnicos (Analytics, Pixel, dados legais) | Não | Sim |
| Consentimentos registrados | Não | Sim |

Credenciais técnicas não estão em nenhuma tela: vivem só nas variáveis de ambiente.

## Multiempresa

O isolamento vem de três camadas:

1. **`company_id` em toda tabela de dados**, com políticas RLS que conferem o vínculo do usuário.
2. **FKs compostas** (`vehicle_id, company_id`): uma foto ou lead não aponta para veículo de outra empresa, nem por erro de código.
3. **Pastas no Storage** por `company_id`, com políticas que conferem a primeira pasta do caminho.

A empresa é identificada pelo domínio (`src/lib/tenant.ts`, tabela `company_domains`). Domínio desconhecido cai em `DEFAULT_COMPANY_SLUG`.

### Adicionar uma revenda

1. Ajuste e rode `supabase/templates/nova-empresa.sql` no SQL Editor.
2. Adicione o domínio na Vercel e em Redirect URLs no Supabase.
3. Crie o primeiro acesso: `npm run admin:create -- --company slug-da-loja --email x --name "Nome" --role master`.

Hoje logo, cores e textos institucionais do hero são da Forte. Para outras marcas, o próximo passo é levar esses itens para `site_settings` e `public/brand/{slug}`.

Um usuário pode ser membro de várias empresas (o master da Next PG, por exemplo). O painel opera a empresa do domínio acessado.

## Fluxo de autenticação

1. Senha em `/admin/login` (Server Action, com limite de tentativas).
2. `/admin/mfa`: cadastro ou confirmação do TOTP. A sessão sobe para `aal2`.
3. Toda página e ação chama `requireAdminPage` ou `requireAdminAction` (`src/lib/auth/guards.ts`), que validam token, vínculo e `aal2`.
4. A RLS repete a verificação no banco: sem `aal2`, nenhuma operação administrativa passa.

Sessões usam cookies HttpOnly: não existe cliente Supabase no navegador.

## Cache e atualização do site

As páginas públicas são renderizadas a cada acesso, o que permite o nonce de CSP e faz qualquer alteração do painel aparecer de imediato. O servidor precisa ficar na mesma região do banco, porque cada página faz várias consultas: hoje os dois ficam em Oregon, e o visitante no Brasil espera cerca de 0,5 a 0,65 s pelo início da resposta. Se o tráfego crescer, o caminho é cachear as consultas por empresa e invalidar nas ações do painel.

## Fotos

O servidor recebe a foto, confere a assinatura do arquivo, reprocessa com sharp e grava dois WebP sem metadados (2000 px e 800 px). O navegador reduz fotos muito grandes antes de enviar, porque a Vercel limita o corpo da requisição a 4,5 MB.

As fotos das páginas ficam em `site_settings.images`, como `{ espaço: caminho }`. Os espaços estão em `src/lib/site-images.ts`, e cada um tem uma foto original em `public/`, usada enquanto a loja não enviar outra. Os arquivos enviados ficam em `{company_id}/site/` no mesmo bucket dos veículos e passam pela rota `/api/admin/site-images/[slot]`, com as mesmas validações. Trocar a abertura substitui o vídeo do hero pela foto, em qualquer tela. O aviso de imagens geradas por IA no rodapé some quando a loja troca todas as que foram geradas.

## Serviços externos

| Serviço | Para quê | Sem ele |
|---|---|---|
| Tabela FIPE (`parallelum.com.br`) | Marcas, modelos, anos e valor FIPE no cadastro. Grátis, até 500 consultas por dia, com cache de uma semana nas listas e de um dia nos valores | O cadastro aceita digitar à mão |
| Placa FIPE (`placafipe.com`) | Consulta grátis pela placa, na aba da própria pessoa. Ela copia a página e cola no painel | Escolher nas listas |
| API Placas (`wdapi2.com.br`) | Busca automática pela placa, paga por consulta. Só liga com `PLACA_API_TOKEN` | O botão não aparece |
| Resend | E-mail de acesso ao criar usuário. Liga com `RESEND_API_KEY` e o domínio verificado | O painel mostra o link para enviar à mão |

O Placa FIPE não tem API, recusa consultas de servidor (403) e não aceita moldura (`X-Frame-Options`). Por isso a consulta grátis acontece no navegador da pessoa, e o painel só lê o texto colado, em `parsePlacaFipeText`.

## Vendas e oferta

`confirm_vehicle_sale` grava o lançamento e marca o carro como vendido na mesma transação, com as permissões de quem chama. O lançamento guarda o nome do carro e o custo da época, para o resultado não mudar se o veículo for editado ou excluído.

Custo e FIPE ficam em `vehicles`, mas o acesso anônimo não tem permissão nessas colunas. A oferta é pública e o gatilho do veículo a descarta se ficar maior ou igual ao preço, ou quando o carro é vendido.

## Vídeos do Instagram

Vídeo não cabe no limite de 4,5 MB da hospedagem: o servidor valida e devolve uma URL assinada, e o navegador envia direto para o bucket `site-videos`. No site, o vídeo só toca enquanto está na tela e sem som.

Publicação só com link usa o player do Instagram dentro da moldura, recortado por CSS, e só carrega com consentimento de marketing. Esse recorte depende do layout do Instagram e pode precisar de ajuste se ele mudar.

## Convenções

- Texto voltado ao visitante: português simples, sem travessões.
- Toda escrita do painel passa por validação zod (`src/lib/validation.ts`), guarda de servidor e RLS.
- `src/lib/supabase/admin.ts` é o único ponto com a chave `service_role`.
- Mudança de banco é sempre uma migration nova, acompanhada de testes em `tests/rls`.

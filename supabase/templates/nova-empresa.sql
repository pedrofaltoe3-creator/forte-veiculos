-- Modelo para cadastrar uma nova revenda. Ajuste os valores e rode no SQL Editor do Supabase.
-- Depois crie o primeiro acesso: npm run admin:create -- --company nome-da-loja --email x --name "Nome" --role master

with c as (
  insert into public.companies (slug, name)
  values ('nome-da-loja', 'Nome da Loja')
  returning id
), d as (
  insert into public.company_domains (hostname, company_id)
  select h, c.id from c, unnest(array['nomedaloja.com.br', 'www.nomedaloja.com.br']) as h
), s as (
  insert into public.site_settings (
    company_id, display_name, whatsapp, phone_display, address_street, address_district,
    address_city, address_state, address_zip, hours
  )
  select
    c.id, 'Nome da Loja', '5500000000000', '(00) 00000-0000',
    'Rua, número', 'Bairro', 'Cidade', 'UF', '00000-000',
    '[{"days": [1, 2, 3, 4, 5], "open": "08:00", "close": "18:00", "label": "Segunda a sexta"}]'::jsonb
  from c
)
insert into public.technical_settings (company_id, canonical_url)
select c.id, 'https://www.nomedaloja.com.br' from c;

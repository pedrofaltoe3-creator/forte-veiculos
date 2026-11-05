-- Primeira empresa da plataforma Next PG: Forte Veículos (dados informados pela empresa).

with c as (
  insert into public.companies (slug, name)
  values ('forte-veiculos', 'Forte Veículos')
  returning id
), d as (
  insert into public.company_domains (hostname, company_id)
  select h, c.id from c, unnest(array['forteveiculoscachoeiro.com.br', 'www.forteveiculoscachoeiro.com.br']) as h
), s as (
  insert into public.site_settings (
    company_id, display_name, whatsapp, phone_display, address_street, address_district,
    address_city, address_state, address_zip, hours, instagram_url, facebook_url, about_text
  )
  select
    c.id, 'Forte Veículos', '5528999097412', '(28) 99909-7412',
    'Avenida Jones dos Santos Neves, 673', 'Otton Marins', 'Cachoeiro de Itapemirim', 'ES', '29317-022',
    '[
      {"days": [1, 2, 3, 4, 5], "open": "08:00", "close": "18:00", "label": "Segunda a sexta"},
      {"days": [6], "open": "08:00", "close": "12:00", "label": "Sábado"}
    ]'::jsonb,
    'https://www.instagram.com/forteveiculoscachoeiro',
    'https://www.facebook.com/joserobertovianafilho.roberto',
    'A Forte Veículos trabalha com compra, venda e troca de seminovos e usados em Cachoeiro de Itapemirim. Carros selecionados, procedência garantida e atendimento direto, do primeiro contato até a entrega das chaves.'
  from c
)
insert into public.technical_settings (company_id, canonical_url)
select c.id, 'https://www.forteveiculoscachoeiro.com.br' from c;

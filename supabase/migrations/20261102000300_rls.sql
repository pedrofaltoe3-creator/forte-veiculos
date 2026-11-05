-- Row Level Security em todas as tabelas expostas, com permissões mínimas por coluna.

alter table public.companies enable row level security;
alter table public.company_domains enable row level security;
alter table public.profiles enable row level security;
alter table public.company_members enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_photos enable row level security;
alter table public.leads enable row level security;
alter table public.site_settings enable row level security;
alter table public.technical_settings enable row level security;
alter table public.instagram_posts enable row level security;
alter table public.audit_logs enable row level security;
alter table public.cookie_consents enable row level security;

-- Começa sem nenhum privilégio: cada acesso abaixo é uma decisão explícita.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

grant select on public.companies, public.company_domains to anon, authenticated;
grant select on public.site_settings, public.technical_settings to anon, authenticated;
grant select (id, company_id, permalink, position, is_active) on public.instagram_posts to anon;
grant select (
  id, company_id, slug, brand, model, version, category, model_year, mileage_km, transmission, fuel,
  color, price_cents, description, features, status, is_featured, sold_at, search_text, created_at, updated_at
) on public.vehicles to anon;
grant select (
  id, company_id, vehicle_id, storage_path, thumb_path, width, height, position, is_primary, alt
) on public.vehicle_photos to anon;

grant update (name) on public.companies to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant select, delete on public.company_members to authenticated;
grant insert (company_id, user_id, role, is_active) on public.company_members to authenticated;
grant update (role, is_active) on public.company_members to authenticated;
grant select, delete on public.vehicles to authenticated;
grant insert (
  company_id, slug, brand, model, version, category, model_year, mileage_km, transmission, fuel,
  color, price_cents, description, features, status, is_featured
) on public.vehicles to authenticated;
grant update (
  slug, brand, model, version, category, model_year, mileage_km, transmission, fuel,
  color, price_cents, description, features, status, is_featured
) on public.vehicles to authenticated;
grant select, delete on public.vehicle_photos to authenticated;
grant insert (
  company_id, vehicle_id, storage_path, thumb_path, width, height, position, is_primary, alt
) on public.vehicle_photos to authenticated;
grant update (position, is_primary, alt) on public.vehicle_photos to authenticated;
grant select, delete on public.leads to authenticated;
grant update (status, notes) on public.leads to authenticated;
grant update (
  display_name, whatsapp, phone_display, email, address_street, address_district, address_city,
  address_state, address_zip, hours, instagram_url, facebook_url, about_text
) on public.site_settings to authenticated;
grant update (
  canonical_url, ga4_id, meta_pixel_id, legal_name, cnpj, dpo_name, dpo_email
) on public.technical_settings to authenticated;
grant select, delete on public.instagram_posts to authenticated;
grant insert (company_id, permalink, position, is_active) on public.instagram_posts to authenticated;
grant update (position, is_active) on public.instagram_posts to authenticated;
grant select on public.audit_logs, public.cookie_consents to authenticated;

-- Empresas e domínios: leitura pública das ativas.
create policy companies_read on public.companies for select to anon, authenticated
  using (status = 'active' or private.can_manage(id));
create policy companies_master_update on public.companies for update to authenticated
  using (private.is_master(id)) with check (private.is_master(id));

create policy company_domains_read on public.company_domains for select to anon, authenticated
  using (private.company_is_public(company_id));

-- Perfis: cada um vê o próprio; o master vê os da sua empresa.
create policy profiles_read on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.company_members m
      where m.user_id = profiles.id and private.is_master(m.company_id)
    )
  );
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid() and private.has_mfa_session())
  with check (id = auth.uid());

-- Vínculos: só o master administra. O próprio vínculo é legível para validar o acesso.
create policy company_members_read on public.company_members for select to authenticated
  using (user_id = auth.uid() or private.is_master(company_id));
create policy company_members_insert on public.company_members for insert to authenticated
  with check (private.is_master(company_id));
create policy company_members_update on public.company_members for update to authenticated
  using (private.is_master(company_id)) with check (private.is_master(company_id));
create policy company_members_delete on public.company_members for delete to authenticated
  using (private.is_master(company_id));

-- Veículos: rascunhos só para a equipe da empresa.
create policy vehicles_public_read on public.vehicles for select to anon, authenticated
  using ((status <> 'draft' and private.company_is_public(company_id)) or private.can_manage(company_id));
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check (private.can_manage(company_id));
create policy vehicles_update on public.vehicles for update to authenticated
  using (private.can_manage(company_id)) with check (private.can_manage(company_id));
create policy vehicles_delete on public.vehicles for delete to authenticated
  using (private.can_manage(company_id));

create policy vehicle_photos_read on public.vehicle_photos for select to anon, authenticated
  using (
    private.can_manage(company_id)
    or exists (
      select 1 from public.vehicles v
      where v.id = vehicle_photos.vehicle_id
        and v.status <> 'draft'
        and private.company_is_public(v.company_id)
    )
  );
create policy vehicle_photos_insert on public.vehicle_photos for insert to authenticated
  with check (private.can_manage(company_id));
create policy vehicle_photos_update on public.vehicle_photos for update to authenticated
  using (private.can_manage(company_id)) with check (private.can_manage(company_id));
create policy vehicle_photos_delete on public.vehicle_photos for delete to authenticated
  using (private.can_manage(company_id));

-- Leads: ninguém de fora lê nem grava pela API.
create policy leads_read on public.leads for select to authenticated
  using (private.can_manage(company_id));
create policy leads_update on public.leads for update to authenticated
  using (private.can_manage(company_id)) with check (private.can_manage(company_id));
create policy leads_delete on public.leads for delete to authenticated
  using (private.can_manage(company_id));

-- Configurações.
create policy site_settings_read on public.site_settings for select to anon, authenticated
  using (private.company_is_public(company_id) or private.can_manage(company_id));
create policy site_settings_update on public.site_settings for update to authenticated
  using (private.can_manage(company_id)) with check (private.can_manage(company_id));

create policy technical_settings_read on public.technical_settings for select to anon, authenticated
  using (private.company_is_public(company_id) or private.can_manage(company_id));
create policy technical_settings_update on public.technical_settings for update to authenticated
  using (private.is_master(company_id)) with check (private.is_master(company_id));

create policy instagram_posts_read on public.instagram_posts for select to anon, authenticated
  using ((is_active and private.company_is_public(company_id)) or private.can_manage(company_id));
create policy instagram_posts_insert on public.instagram_posts for insert to authenticated
  with check (private.can_manage(company_id));
create policy instagram_posts_update on public.instagram_posts for update to authenticated
  using (private.can_manage(company_id)) with check (private.can_manage(company_id));
create policy instagram_posts_delete on public.instagram_posts for delete to authenticated
  using (private.can_manage(company_id));

-- Histórico e consentimentos: somente leitura.
create policy audit_logs_read on public.audit_logs for select to authenticated
  using (private.can_manage(company_id));
create policy cookie_consents_read on public.cookie_consents for select to authenticated
  using (private.is_master(company_id));

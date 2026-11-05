-- Dados do negócio: veículos, fotos, leads, configurações, histórico e consentimentos.

-- Veículos ------------------------------------------------------------------

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 140),
  brand text not null check (char_length(brand) between 1 and 60),
  model text not null check (char_length(model) between 1 and 80),
  version text check (char_length(version) <= 120),
  category public.vehicle_category not null default 'other',
  model_year smallint not null check (model_year between 1950 and 2100),
  mileage_km integer check (mileage_km between 0 and 3000000),
  transmission public.vehicle_transmission,
  fuel public.vehicle_fuel,
  color text check (char_length(color) <= 40),
  price_cents bigint not null check (price_cents between 0 and 10000000000),
  description text check (char_length(description) <= 6000),
  features text[] not null default '{}' check (cardinality(features) <= 60),
  status public.vehicle_status not null default 'draft',
  is_featured boolean not null default false,
  sold_at timestamptz,
  search_text text generated always as (
    lower(brand || ' ' || model || ' ' || coalesce(version, '') || ' ' || model_year::text)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  unique (company_id, slug),
  unique (id, company_id)
);
create index vehicles_listing_idx on public.vehicles (company_id, status, is_featured, created_at desc);
create index vehicles_brand_idx on public.vehicles (company_id, brand);
create index vehicles_price_idx on public.vehicles (company_id, price_cents);

create or replace function private.vehicle_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  elsif new.company_id <> old.company_id then
    raise exception 'Um veículo não pode mudar de empresa.' using errcode = 'P0001';
  end if;

  if new.status = 'sold' then
    new.sold_at := coalesce(new.sold_at, now());
    new.is_featured := false;
  else
    new.sold_at := null;
  end if;
  return new;
end $$;

create trigger vehicles_before_write before insert or update on public.vehicles
  for each row execute function private.vehicle_before_write();

-- Fotos ---------------------------------------------------------------------
-- A FK composta garante que a foto pertence à mesma empresa do veículo.

create table public.vehicle_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  vehicle_id uuid not null,
  storage_path text not null unique check (char_length(storage_path) <= 300),
  thumb_path text not null check (char_length(thumb_path) <= 300),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  position integer not null default 0,
  is_primary boolean not null default false,
  alt text check (char_length(alt) <= 200),
  created_at timestamptz not null default now(),
  foreign key (vehicle_id, company_id) references public.vehicles (id, company_id) on delete cascade,
  check (storage_path like company_id::text || '/' || vehicle_id::text || '/%'),
  check (thumb_path like company_id::text || '/' || vehicle_id::text || '/%')
);
create index vehicle_photos_vehicle_idx on public.vehicle_photos (vehicle_id, position);
create unique index vehicle_photos_one_primary on public.vehicle_photos (vehicle_id) where is_primary;

-- A primeira foto vira a principal; ao excluir a principal, a próxima assume.
create or replace function private.photo_first_is_primary()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.vehicle_photos p where p.vehicle_id = new.vehicle_id and p.is_primary) then
    new.is_primary := true;
  end if;
  return new;
end $$;

create trigger vehicle_photos_first_primary before insert on public.vehicle_photos
  for each row execute function private.photo_first_is_primary();

create or replace function private.photo_promote_next()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.is_primary then
    update public.vehicle_photos
      set is_primary = true
      where id = (
        select p.id from public.vehicle_photos p
        where p.vehicle_id = old.vehicle_id
        order by p.position, p.created_at
        limit 1
      );
  end if;
  return null;
end $$;

create trigger vehicle_photos_promote_next after delete on public.vehicle_photos
  for each row execute function private.photo_promote_next();

-- SECURITY INVOKER: as duas funções rodam sob as políticas RLS de quem chama.
create or replace function public.set_primary_photo(p_photo_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_vehicle uuid;
begin
  select vehicle_id into v_vehicle from public.vehicle_photos where id = p_photo_id;
  if v_vehicle is null then
    raise exception 'Foto não encontrada.' using errcode = 'P0002';
  end if;
  update public.vehicle_photos set is_primary = false where vehicle_id = v_vehicle and is_primary;
  update public.vehicle_photos set is_primary = true where id = p_photo_id;
  if not found then
    raise exception 'Sem permissão para alterar esta foto.' using errcode = '42501';
  end if;
end $$;

create or replace function public.reorder_vehicle_photos(p_vehicle_id uuid, p_photo_ids uuid[])
returns void language sql security invoker set search_path = '' as $$
  update public.vehicle_photos p
    set position = o.ordinality - 1
    from unnest(p_photo_ids) with ordinality as o (id, ordinality)
    where p.id = o.id and p.vehicle_id = p_vehicle_id;
$$;

-- Leads ---------------------------------------------------------------------
-- Formulários públicos gravam somente pelo servidor (service_role), depois de validar e limitar.

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  type public.lead_type not null,
  status public.lead_status not null default 'new',
  name text not null check (char_length(name) between 2 and 120),
  phone text check (char_length(phone) <= 30),
  email text check (char_length(email) <= 180),
  message text check (char_length(message) <= 2000),
  vehicle_id uuid,
  vehicle_label text check (char_length(vehicle_label) <= 200),
  evaluation jsonb,
  source_path text check (char_length(source_path) <= 300),
  consent_version text not null check (char_length(consent_version) <= 20),
  consent_at timestamptz not null default now(),
  ip_hash text check (char_length(ip_hash) <= 100),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (vehicle_id, company_id) references public.vehicles (id, company_id) on delete set null (vehicle_id)
);
create index leads_company_idx on public.leads (company_id, status, created_at desc);
create trigger leads_updated_at before update on public.leads
  for each row execute function private.set_updated_at();

-- Configurações -------------------------------------------------------------
-- site_settings: dados comerciais, editáveis pelo proprietário.
-- technical_settings: dados técnicos e jurídicos, somente o master altera.
-- Nenhuma das duas guarda segredos: credenciais ficam só nas variáveis de ambiente do servidor.

create table public.site_settings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 120),
  whatsapp text not null check (whatsapp ~ '^[0-9]{10,13}$'),
  phone_display text check (char_length(phone_display) <= 30),
  email text check (char_length(email) <= 180),
  address_street text check (char_length(address_street) <= 160),
  address_district text check (char_length(address_district) <= 80),
  address_city text check (char_length(address_city) <= 80),
  address_state text check (char_length(address_state) <= 2),
  address_zip text check (char_length(address_zip) <= 10),
  hours jsonb not null default '[]'::jsonb,
  instagram_url text check (instagram_url ~ '^https://(www\.)?instagram\.com/'),
  facebook_url text check (facebook_url ~ '^https://(www\.)?facebook\.com/'),
  about_text text check (char_length(about_text) <= 2000),
  updated_at timestamptz not null default now()
);
create trigger site_settings_updated_at before update on public.site_settings
  for each row execute function private.set_updated_at();

create table public.technical_settings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  canonical_url text check (canonical_url ~ '^https?://'),
  ga4_id text check (ga4_id ~ '^G-[A-Z0-9]{4,20}$'),
  meta_pixel_id text check (meta_pixel_id ~ '^[0-9]{6,20}$'),
  legal_name text check (char_length(legal_name) <= 160),
  cnpj text check (cnpj ~ '^[0-9]{2}\.[0-9]{3}\.[0-9]{3}/[0-9]{4}-[0-9]{2}$'),
  dpo_name text check (char_length(dpo_name) <= 120),
  dpo_email text check (char_length(dpo_email) <= 180),
  updated_at timestamptz not null default now()
);
create trigger technical_settings_updated_at before update on public.technical_settings
  for each row execute function private.set_updated_at();

create table public.instagram_posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  permalink text not null check (permalink ~ '^https://www\.instagram\.com/(p|reel)/[A-Za-z0-9_-]+/?$'),
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, permalink)
);

-- Histórico de alterações ---------------------------------------------------
-- Escrito só por gatilhos. Ninguém altera nem apaga, nem o service_role.

create table public.audit_logs (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  actor_id uuid,
  actor_email text,
  action text not null check (char_length(action) <= 80),
  entity text not null check (char_length(entity) <= 60),
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_company_idx on public.audit_logs (company_id, created_at desc);

create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_before jsonb := v_old;
  v_after jsonb := v_new;
  v_key text;
  v_i integer;
begin
  -- Os argumentos do gatilho listam campos que não entram no histórico (dados pessoais e ruído).
  if tg_nargs > 0 then
    for v_i in 0 .. tg_nargs - 1 loop
      v_before := v_before - tg_argv[v_i];
      v_after := v_after - tg_argv[v_i];
    end loop;
  end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_before) loop
      if v_before -> v_key is not distinct from v_after -> v_key then
        v_before := v_before - v_key;
        v_after := v_after - v_key;
      end if;
    end loop;
    if v_after = '{}'::jsonb then
      return new;
    end if;
  end if;

  insert into public.audit_logs (company_id, actor_id, actor_email, action, entity, entity_id, before, after)
  values (
    (v_row ->> 'company_id')::uuid,
    auth.uid(),
    (select p.email from public.profiles p where p.id = auth.uid()),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'company_id'),
    v_before,
    v_after
  );
  return coalesce(new, old);
end $$;

create or replace function private.audit_is_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'O histórico de alterações não pode ser modificado.' using errcode = 'P0001';
end $$;

create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function private.audit_is_append_only();

create trigger vehicles_audit after insert or update or delete on public.vehicles
  for each row execute function private.audit_row('search_text', 'updated_at', 'updated_by', 'created_by');
create trigger vehicle_photos_audit after insert or delete on public.vehicle_photos
  for each row execute function private.audit_row();
create trigger leads_audit after update or delete on public.leads
  for each row execute function private.audit_row(
    'name', 'phone', 'email', 'message', 'evaluation', 'ip_hash', 'notes', 'updated_at', 'source_path'
  );
create trigger site_settings_audit after update on public.site_settings
  for each row execute function private.audit_row('updated_at');
create trigger technical_settings_audit after update on public.technical_settings
  for each row execute function private.audit_row('updated_at');
create trigger company_members_audit after insert or update or delete on public.company_members
  for each row execute function private.audit_row('updated_at');
create trigger instagram_posts_audit after insert or update or delete on public.instagram_posts
  for each row execute function private.audit_row();

-- Consentimento de cookies (registro de prova, LGPD) --------------------------

create table public.cookie_consents (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  subject_id uuid not null,
  action text not null check (action in ('accept_all', 'reject_all', 'custom', 'revoke')),
  analytics boolean not null,
  marketing boolean not null,
  policy_version text not null check (char_length(policy_version) <= 20),
  ip_hash text check (char_length(ip_hash) <= 100),
  created_at timestamptz not null default now()
);
create index cookie_consents_company_idx on public.cookie_consents (company_id, created_at desc);
create index cookie_consents_subject_idx on public.cookie_consents (subject_id);

-- Limite de tentativas ---------------------------------------------------------
-- Tabela no schema private: invisível para a API. A função só pode ser chamada pelo servidor.

create table private.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null
);

create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_hits integer;
begin
  insert into private.rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case
      when r.window_start < now() - make_interval(secs => p_window_seconds) then now()
      else r.window_start
    end,
    hits = case
      when r.window_start < now() - make_interval(secs => p_window_seconds) then 1
      else r.hits + 1
    end
  returning hits into v_hits;

  if random() < 0.01 then
    delete from private.rate_limits where window_start < now() - interval '2 days';
  end if;

  return v_hits <= p_limit;
end $$;

-- Eventos da aplicação no histórico (login, logout, usuários). Só o servidor chama.
create or replace function public.log_admin_event(
  p_company uuid,
  p_actor uuid,
  p_actor_email text,
  p_action text,
  p_entity text default 'auth',
  p_entity_id text default null,
  p_after jsonb default null
)
returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_logs (company_id, actor_id, actor_email, action, entity, entity_id, after)
  values (p_company, p_actor, p_actor_email, p_action, p_entity, p_entity_id, p_after);
$$;

-- Invalida todas as sessões de um usuário. Só o servidor chama, depois de validar o master.
create or replace function public.revoke_user_sessions(p_user uuid)
returns void
language sql security definer set search_path = '' as $$
  delete from auth.sessions where user_id = p_user;
$$;

-- Retenção (LGPD): apaga dados pessoais vencidos. Agendar com pg_cron (ver docs/SEGURANCA.md).
create or replace function public.purge_expired_personal_data(p_lead_months integer default 24, p_consent_months integer default 60)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.leads where created_at < now() - make_interval(months => p_lead_months);
  delete from public.cookie_consents where created_at < now() - make_interval(months => p_consent_months);
end $$;

revoke all on function
  public.check_rate_limit(text, integer, integer),
  public.log_admin_event(uuid, uuid, text, text, text, text, jsonb),
  public.revoke_user_sessions(uuid),
  public.purge_expired_personal_data(integer, integer)
from public, anon, authenticated;
grant execute on function
  public.check_rate_limit(text, integer, integer),
  public.log_admin_event(uuid, uuid, text, text, text, text, jsonb),
  public.revoke_user_sessions(uuid),
  public.purge_expired_personal_data(integer, integer)
to service_role;

revoke all on function public.set_primary_photo(uuid), public.reorder_vehicle_photos(uuid, uuid[])
from public, anon;
grant execute on function public.set_primary_photo(uuid), public.reorder_vehicle_photos(uuid, uuid[])
to authenticated;

-- Dados públicos do site em uma só chamada (RLS continua valendo).
create or replace function public.get_public_site(p_host text, p_fallback_slug text)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with c as (
    select co.id, co.slug, co.name
    from public.companies co
    left join public.company_domains d on d.company_id = co.id and d.hostname = lower(p_host)
    where co.status = 'active' and (d.hostname is not null or co.slug = p_fallback_slug)
    order by (d.hostname is not null) desc
    limit 1
  )
  select jsonb_build_object(
    'company', to_jsonb(c),
    'settings', (select to_jsonb(s) from public.site_settings s where s.company_id = c.id),
    'technical', (select to_jsonb(t) from public.technical_settings t where t.company_id = c.id)
  )
  from c
$$;

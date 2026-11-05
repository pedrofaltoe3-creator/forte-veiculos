-- Núcleo multiempresa: empresas, usuários, permissões e funções de autorização.
-- Cada empresa (tenant) é isolada por company_id em todas as tabelas de dados.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create type public.member_role as enum ('master', 'owner');
create type public.vehicle_status as enum ('draft', 'available', 'reserved', 'sold');
create type public.vehicle_category as enum ('suv', 'sedan', 'hatch', 'pickup', 'premium', 'other');
create type public.vehicle_transmission as enum ('automatic', 'manual', 'cvt', 'automated');
create type public.vehicle_fuel as enum ('flex', 'gasoline', 'ethanol', 'diesel', 'hybrid', 'electric');
create type public.lead_type as enum ('contact', 'vehicle_interest', 'evaluation');
create type public.lead_status as enum ('new', 'in_progress', 'won', 'lost');

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Empresas ------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 120),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger companies_updated_at before update on public.companies
  for each row execute function private.set_updated_at();

create table public.company_domains (
  hostname text primary key check (hostname = lower(hostname) and char_length(hostname) <= 255),
  company_id uuid not null references public.companies (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index company_domains_company_idx on public.company_domains (company_id);

-- Usuários e permissões -----------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text check (char_length(full_name) <= 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create table public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index company_members_user_idx on public.company_members (user_id);
create trigger company_members_updated_at before update on public.company_members
  for each row execute function private.set_updated_at();

-- Espelha auth.users em profiles. Cadastro público fica desativado no Supabase Auth,
-- e um usuário sem vínculo em company_members não tem acesso a nada.
create or replace function private.handle_auth_user_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

create trigger on_auth_user_change
  after insert or update of email on auth.users
  for each row execute function private.handle_auth_user_change();

-- Funções de autorização ----------------------------------------------------
-- SECURITY DEFINER evita recursão de RLS. Ficam no schema private, que o PostgREST não expõe.

create or replace function private.member_role_of(p_company uuid)
returns public.member_role
language sql stable security definer set search_path = '' as $$
  select m.role
  from public.company_members m
  join public.profiles p on p.id = m.user_id
  join public.companies c on c.id = m.company_id
  where m.company_id = p_company
    and m.user_id = auth.uid()
    and m.is_active
    and p.is_active
    and c.status = 'active'
$$;

-- Toda operação administrativa exige sessão com MFA verificado (aal2).
create or replace function private.has_mfa_session()
returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

create or replace function private.can_manage(p_company uuid)
returns boolean
language sql stable set search_path = '' as $$
  select coalesce(private.member_role_of(p_company) is not null and private.has_mfa_session(), false)
$$;

create or replace function private.is_master(p_company uuid)
returns boolean
language sql stable set search_path = '' as $$
  select coalesce(private.member_role_of(p_company) = 'master' and private.has_mfa_session(), false)
$$;

create or replace function private.company_is_public(p_company uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.companies c where c.id = p_company and c.status = 'active')
$$;

create or replace function private.safe_uuid(p_value text)
returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end $$;

revoke all on all functions in schema private from public;
grant execute on function
  private.member_role_of(uuid),
  private.has_mfa_session(),
  private.can_manage(uuid),
  private.is_master(uuid),
  private.company_is_public(uuid),
  private.safe_uuid(text)
to anon, authenticated, service_role;

-- A empresa nunca pode ficar sem um master ativo.
create or replace function private.guard_last_master()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'master' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'master' or not new.is_active)
     and exists (select 1 from public.companies c where c.id = old.company_id)
     and exists (select 1 from public.profiles p where p.id = old.user_id)
     and not exists (
       select 1
       from public.company_members m
       join public.profiles p on p.id = m.user_id
       where m.company_id = old.company_id
         and m.user_id <> old.user_id
         and m.role = 'master'
         and m.is_active
         and p.is_active
     )
  then
    raise exception 'A empresa precisa de ao menos um administrador master ativo.'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger company_members_last_master
  before update or delete on public.company_members
  for each row execute function private.guard_last_master();

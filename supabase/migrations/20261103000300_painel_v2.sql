-- Ofertas, FIPE e custo do veículo, financeiro, atendimento concluído, vídeos do Instagram e histórico só para master.

-- Leads: responder pelo WhatsApp conclui o atendimento.
alter type public.lead_status add value if not exists 'answered' after 'in_progress';

-- Veículos ------------------------------------------------------------------
-- Oferta é pública. Custo e FIPE ficam fora do acesso anônimo: o grant é por coluna.

alter table public.vehicles
  add column offer_price_cents bigint check (offer_price_cents > 0),
  add column offer_until date,
  add column purchase_cost_cents bigint check (purchase_cost_cents between 0 and 10000000000),
  add column fipe_code text check (char_length(fipe_code) <= 20),
  add column fipe_price_cents bigint check (fipe_price_cents between 0 and 10000000000),
  add column fipe_reference text check (char_length(fipe_reference) <= 40);

create index vehicles_offer_idx on public.vehicles (company_id, offer_until) where offer_price_cents is not null;

grant select (offer_price_cents, offer_until) on public.vehicles to anon;
grant insert (offer_price_cents, offer_until, purchase_cost_cents, fipe_code, fipe_price_cents, fipe_reference)
  on public.vehicles to authenticated;
grant update (offer_price_cents, offer_until, purchase_cost_cents, fipe_code, fipe_price_cents, fipe_reference)
  on public.vehicles to authenticated;

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
    new.offer_price_cents := null;
  else
    new.sold_at := null;
  end if;

  -- Oferta só existe abaixo do preço normal, mesmo se o preço baixar depois.
  if new.offer_price_cents is null or new.offer_price_cents >= new.price_cents then
    new.offer_price_cents := null;
    new.offer_until := null;
  end if;
  return new;
end $$;

-- Financeiro ----------------------------------------------------------------
-- Venda guarda o nome do carro e o custo da época: o resultado não muda se o veículo for editado ou excluído.

create type public.financial_kind as enum ('sale', 'income', 'expense');
create type public.payment_method as enum ('pix', 'cash', 'card', 'financing', 'trade_in', 'transfer', 'other');

create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind public.financial_kind not null,
  description text not null check (char_length(description) between 1 and 300),
  amount_cents bigint not null check (amount_cents between 0 and 10000000000),
  occurred_on date not null,
  vehicle_id uuid,
  cost_cents bigint check (cost_cents between 0 and 10000000000),
  payment_method public.payment_method,
  created_at timestamptz not null default now(),
  foreign key (vehicle_id, company_id) references public.vehicles (id, company_id) on delete set null (vehicle_id)
);
create index financial_entries_company_idx on public.financial_entries (company_id, occurred_on desc);
create index financial_entries_vehicle_company_idx on public.financial_entries (vehicle_id, company_id);
create unique index financial_entries_one_sale_idx on public.financial_entries (vehicle_id) where kind = 'sale' and vehicle_id is not null;

alter table public.financial_entries enable row level security;
grant select, delete on public.financial_entries to authenticated;
grant insert (company_id, kind, description, amount_cents, occurred_on, vehicle_id, cost_cents, payment_method)
  on public.financial_entries to authenticated;

create policy financial_entries_read on public.financial_entries for select to authenticated
  using (private.can_manage(company_id));
create policy financial_entries_insert on public.financial_entries for insert to authenticated
  with check (private.can_manage(company_id));
create policy financial_entries_delete on public.financial_entries for delete to authenticated
  using (private.can_manage(company_id));

create trigger financial_entries_audit after insert or delete on public.financial_entries
  for each row execute function private.audit_row();

-- As duas funções rodam com as permissões de quem chama, então a RLS continua decidindo.
create or replace function public.confirm_vehicle_sale(
  p_company uuid, p_vehicle uuid, p_amount_cents bigint, p_sold_on date, p_payment public.payment_method
) returns uuid language plpgsql set search_path = '' as $$
declare
  v_vehicle public.vehicles;
  v_entry uuid;
begin
  select * into v_vehicle from public.vehicles where id = p_vehicle and company_id = p_company for update;
  if not found then
    raise exception 'Veículo não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.financial_entries (company_id, kind, description, amount_cents, occurred_on, vehicle_id, cost_cents, payment_method)
  values (
    p_company, 'sale',
    concat_ws(' ', v_vehicle.brand, v_vehicle.model, v_vehicle.version, v_vehicle.model_year),
    p_amount_cents, p_sold_on, p_vehicle, v_vehicle.purchase_cost_cents, p_payment
  )
  returning id into v_entry;

  update public.vehicles set status = 'sold' where id = p_vehicle and company_id = p_company;
  return v_entry;
end $$;

create or replace function public.undo_vehicle_sale(p_company uuid, p_entry uuid)
returns void language plpgsql set search_path = '' as $$
declare
  v_vehicle uuid;
begin
  delete from public.financial_entries
  where id = p_entry and company_id = p_company and kind = 'sale'
  returning vehicle_id into v_vehicle;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;
  update public.vehicles set status = 'available' where id = v_vehicle and company_id = p_company and status = 'sold';
end $$;

revoke all on function public.confirm_vehicle_sale(uuid, uuid, bigint, date, public.payment_method) from public, anon;
revoke all on function public.undo_vehicle_sale(uuid, uuid) from public, anon;
grant execute on function public.confirm_vehicle_sale(uuid, uuid, bigint, date, public.payment_method) to authenticated;
grant execute on function public.undo_vehicle_sale(uuid, uuid) to authenticated;

-- Instagram -----------------------------------------------------------------
-- Com o arquivo do vídeo no próprio site, ele roda sozinho e sem cookies de terceiros.

alter table public.instagram_posts add column video_path text check (char_length(video_path) <= 300);
grant select (video_path) on public.instagram_posts to anon;
grant insert (video_path) on public.instagram_posts to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-videos', 'site-videos', true, 52428800, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy site_videos_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'site-videos' and private.can_manage(private.safe_uuid((storage.foldername(name))[1])));
create policy site_videos_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'site-videos' and private.can_manage(private.safe_uuid((storage.foldername(name))[1])));
create policy site_videos_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'site-videos' and private.can_manage(private.safe_uuid((storage.foldername(name))[1])));

-- Histórico: só o administrador master lê.
alter policy audit_logs_read on public.audit_logs using (private.is_master(company_id));

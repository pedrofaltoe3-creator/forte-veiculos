-- Ajustes apontados pelo Advisor do Supabase. Não muda dados nem o que cada papel pode fazer:
-- auth.uid() passa a ser avaliado uma vez por consulta, e as chaves estrangeiras ganham índice.

alter policy profiles_read on public.profiles
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.company_members m
      where m.user_id = profiles.id and private.is_master(m.company_id)
    )
  );
alter policy profiles_self_update on public.profiles
  using (id = (select auth.uid()) and private.has_mfa_session())
  with check (id = (select auth.uid()));
alter policy company_members_read on public.company_members
  using (user_id = (select auth.uid()) or private.is_master(company_id));

create index if not exists vehicles_created_by_idx on public.vehicles (created_by);
create index if not exists vehicles_updated_by_idx on public.vehicles (updated_by);
create index if not exists vehicle_photos_vehicle_company_idx on public.vehicle_photos (vehicle_id, company_id);
create index if not exists leads_vehicle_company_idx on public.leads (vehicle_id, company_id);

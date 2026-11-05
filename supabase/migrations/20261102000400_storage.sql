-- Fotos dos veículos. Leitura pública pela CDN; escrita somente pela equipe da empresa dona da pasta.
-- Caminho obrigatório: {company_id}/{vehicle_id}/{arquivo}.webp

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-photos', 'vehicle-photos', true, 8388608, array['image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy vehicle_photos_storage_read on storage.objects for select to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and private.can_manage(private.safe_uuid((storage.foldername(name))[1]))
  );

create policy vehicle_photos_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'vehicle-photos'
    and private.can_manage(private.safe_uuid((storage.foldername(name))[1]))
  );

create policy vehicle_photos_storage_update on storage.objects for update to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and private.can_manage(private.safe_uuid((storage.foldername(name))[1]))
  )
  with check (
    bucket_id = 'vehicle-photos'
    and private.can_manage(private.safe_uuid((storage.foldername(name))[1]))
  );

create policy vehicle_photos_storage_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and private.can_manage(private.safe_uuid((storage.foldername(name))[1]))
  );

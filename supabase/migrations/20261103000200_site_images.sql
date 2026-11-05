-- Fotos do site trocadas pela loja, guardadas como { espaço: caminho no bucket vehicle-photos }.
-- Espaço sem caminho usa a foto original do site. Os arquivos ficam em {company_id}/site/.

alter table public.site_settings
  add column images jsonb not null default '{}'::jsonb check (jsonb_typeof(images) = 'object');

grant update (images) on public.site_settings to authenticated;

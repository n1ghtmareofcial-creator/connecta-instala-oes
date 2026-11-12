-- Service catalog imagery.
-- Images are public assets; write operations remain restricted to active Connecta administrators.
alter table public.services
  add column if not exists image_url text,
  add column if not exists image_path text;

insert into storage.buckets
  (id, name, public, file_size_limit, allowed_mime_types)
values
  ('service-images', 'service-images', true, 4194304,
   array['image/jpeg','image/png','image/webp','image/avif']::text[])
on conflict (id) do update
set name = excluded.name, public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Connecta admins read service images" on storage.objects;
create policy "Connecta admins read service images"
on storage.objects for select to authenticated
using (bucket_id = 'service-images' and public.is_connecta_admin());

drop policy if exists "Connecta admins upload service images" on storage.objects;
create policy "Connecta admins upload service images"
on storage.objects for insert to authenticated
with check (bucket_id = 'service-images' and public.is_connecta_admin());

drop policy if exists "Connecta admins delete service images" on storage.objects;
create policy "Connecta admins delete service images"
on storage.objects for delete to authenticated
using (bucket_id = 'service-images' and public.is_connecta_admin());

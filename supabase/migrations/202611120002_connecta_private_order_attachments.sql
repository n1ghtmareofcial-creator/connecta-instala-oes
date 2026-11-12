insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-attachments', 'order-attachments', false, 5242880,
  array['image/jpeg','image/png','image/webp','application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins baixam anexos de pedidos" on storage.objects;
create policy "Admins baixam anexos de pedidos" on storage.objects
for select to authenticated
using (bucket_id = 'order-attachments' and public.is_connecta_admin());

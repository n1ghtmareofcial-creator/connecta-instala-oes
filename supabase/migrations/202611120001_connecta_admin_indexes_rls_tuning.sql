create index if not exists idx_admin_users_created_by on public.admin_users(created_by);
create index if not exists idx_internal_notes_author on public.internal_notes(author_id);
create index if not exists idx_order_attachments_order on public.order_attachments(order_id);
create index if not exists idx_order_history_actor on public.order_history(actor_id);
create index if not exists idx_order_items_service on public.order_items(service_id);
create index if not exists idx_orders_customer on public.orders(customer_id);

drop policy if exists "Administrador consulta próprio vínculo" on public.admin_users;
create policy "Administrador consulta próprio vínculo" on public.admin_users
for select to authenticated using (user_id = (select auth.uid()));

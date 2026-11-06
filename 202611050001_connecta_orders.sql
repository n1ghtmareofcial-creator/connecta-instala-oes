-- Connecta Instalações: pedidos, administração, histórico e notificações.
-- Execute via `supabase db push` depois de vincular o projeto Supabase.

create extension if not exists pgcrypto;

create type public.order_status as enum (
  'novo',
  'em_analise',
  'aguardando_orcamento',
  'orcamento_enviado',
  'aprovado',
  'em_execucao',
  'concluido',
  'cancelado'
);

create sequence if not exists public.order_number_seq start 1 increment 1;

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique,
  description text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  phone text not null,
  email text not null,
  email_normalized text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  submission_id uuid not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  customer_name text not null,
  customer_company text,
  customer_phone text not null,
  customer_email text not null,
  location_address text not null,
  contact_preference text not null check (contact_preference in ('whatsapp', 'telefone', 'email')),
  description text not null,
  status public.order_status not null default 'novo',
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  service_name text not null,
  created_at timestamptz not null default now(),
  unique(order_id, service_name)
);

create table if not exists public.order_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_number text not null,
  action text not null,
  status_from public.order_status,
  status_to public.order_status,
  note text,
  actor_id uuid references auth.users(id) on delete set null,
  actor_label text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.internal_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  author_label text not null,
  content text not null check (char_length(content) between 1 and 5000),
  created_at timestamptz not null default now()
);

create table if not exists public.order_attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  bucket_name text not null default 'order-attachments',
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  channel text not null check (channel = 'whatsapp'),
  event_type text not null default 'new_order',
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'manual_required')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  provider_message_id text,
  last_error text,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, channel, event_type)
);

create table if not exists public.notification_attempts (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notification_outbox(id) on delete cascade,
  attempt_number integer not null,
  outcome text not null check (outcome in ('sent', 'failed', 'manual_required')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.public_request_limits (
  fingerprint_hash text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_created_at on public.orders(created_at desc);
create index if not exists idx_orders_status_created on public.orders(status, created_at desc);
create index if not exists idx_orders_phone on public.orders(customer_phone);
create index if not exists idx_orders_number on public.orders(order_number);
create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_order_history_order_created on public.order_history(order_id, created_at desc);
create index if not exists idx_internal_notes_order_created on public.internal_notes(order_id, created_at desc);
create index if not exists idx_notifications_status_next on public.notification_outbox(status, next_attempt_at);
create index if not exists idx_notification_attempts_notification on public.notification_attempts(notification_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at before update on public.customers
for each row execute function public.set_updated_at();
drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();
drop trigger if exists notifications_set_updated_at on public.notification_outbox;
create trigger notifications_set_updated_at before update on public.notification_outbox
for each row execute function public.set_updated_at();

create or replace function public.is_connecta_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid() and active = true
  );
$$;

-- Operação transacional: cliente, pedido, itens, histórico inicial e outbox.
create or replace function public.create_public_order(
  p_payload jsonb,
  p_service_names text[],
  p_submission_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_service_count integer;
  v_existing public.orders%rowtype;
begin
  if p_payload is null or p_submission_id is null or coalesce(array_length(p_service_names, 1), 0) < 1 then
    raise exception 'Dados do pedido incompletos';
  end if;

  select * into v_existing from public.orders where submission_id = p_submission_id;
  if found then
    return jsonb_build_object(
      'id', v_existing.id, 'order_number', v_existing.order_number,
      'status', v_existing.status, 'created_at', v_existing.created_at,
      'is_duplicate', true
    );
  end if;

  select count(*) into v_service_count
  from public.services
  where is_active = true and name = any(p_service_names);

  if v_service_count <> cardinality(p_service_names) then
    raise exception 'Um ou mais serviços não estão disponíveis';
  end if;

  insert into public.customers (name, company, phone, email, email_normalized)
  values (
    trim(p_payload->>'name'),
    nullif(trim(coalesce(p_payload->>'company', '')), ''),
    trim(p_payload->>'phone'),
    lower(trim(p_payload->>'email')),
    lower(trim(p_payload->>'email'))
  )
  on conflict (email_normalized) do update set
    name = excluded.name,
    company = excluded.company,
    phone = excluded.phone,
    email = excluded.email
  returning id into v_customer_id;

  v_order_number := 'CON-' || lpad(nextval('public.order_number_seq')::text, 6, '0');

  insert into public.orders (
    order_number, submission_id, customer_id, customer_name, customer_company,
    customer_phone, customer_email, location_address,
    contact_preference, description, status, consent_at
  ) values (
    v_order_number, p_submission_id, v_customer_id, trim(p_payload->>'name'),
    nullif(trim(coalesce(p_payload->>'company', '')), ''),
    trim(p_payload->>'phone'), lower(trim(p_payload->>'email')),
    trim(p_payload->>'address'), p_payload->>'contactPreference',
    trim(p_payload->>'description'), 'novo', now()
  ) on conflict (submission_id) do nothing returning id into v_order_id;

  -- A restrição UNIQUE fecha a janela de concorrência entre o SELECT inicial e o INSERT.
  if v_order_id is null then
    select * into v_existing from public.orders where submission_id = p_submission_id;
    return jsonb_build_object(
      'id', v_existing.id, 'order_number', v_existing.order_number,
      'status', v_existing.status, 'created_at', v_existing.created_at,
      'is_duplicate', true
    );
  end if;

  insert into public.order_items (order_id, service_id, service_name)
  select v_order_id, s.id, s.name
  from public.services s
  where s.is_active = true and s.name = any(p_service_names)
  order by s.sort_order;

  insert into public.order_history (
    order_id, order_number, action, status_from, status_to, actor_label
  ) values (
    v_order_id, v_order_number, 'pedido_criado', null, 'novo', 'Cliente'
  );

  insert into public.notification_outbox (order_id, channel, event_type, status)
  values (v_order_id, 'whatsapp', 'new_order', 'pending');

  return jsonb_build_object(
    'id', v_order_id,
    'order_number', v_order_number,
    'status', 'novo',
    'created_at', now(),
    'is_duplicate', false
  );
end;
$$;

-- Limite atômico por hash do endereço de origem (o IP puro não é armazenado).
create or replace function public.consume_public_request_limit(
  p_fingerprint_hash text,
  p_max_requests integer default 5,
  p_window_minutes integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_fingerprint_hash is null or length(p_fingerprint_hash) < 32 then
    raise exception 'Fingerprint inválido';
  end if;

  insert into public.public_request_limits (fingerprint_hash, window_started_at, request_count)
  values (p_fingerprint_hash, now(), 1)
  on conflict (fingerprint_hash) do update set
    request_count = case
      when public.public_request_limits.window_started_at < now() - make_interval(mins => p_window_minutes) then 1
      else public.public_request_limits.request_count + 1
    end,
    window_started_at = case
      when public.public_request_limits.window_started_at < now() - make_interval(mins => p_window_minutes) then now()
      else public.public_request_limits.window_started_at
    end,
    updated_at = now()
  returning request_count into v_count;

  return v_count <= p_max_requests;
end;
$$;

-- Claim atômico impede duas tentativas simultâneas para a mesma notificação.
create or replace function public.claim_whatsapp_notification(p_notification_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt integer;
begin
  update public.notification_outbox
  set status = 'sending',
      attempt_count = attempt_count + 1,
      next_attempt_at = null,
      last_error = null
  where id = p_notification_id
    and (
      status in ('pending', 'failed', 'manual_required')
      or (status = 'sending' and updated_at < now() - interval '2 minutes')
    )
    and attempt_count < max_attempts
    and (next_attempt_at is null or next_attempt_at <= now())
  returning attempt_count into v_attempt;
  return v_attempt;
end;
$$;

create or replace function public.admin_update_order_status(
  p_order_id uuid,
  p_status public.order_status,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status public.order_status;
  v_order_number text;
  v_actor_label text;
begin
  if not public.is_connecta_admin() then
    raise exception 'Acesso não autorizado';
  end if;
  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'Observação excede 1000 caracteres';
  end if;

  select status, order_number into v_old_status, v_order_number
  from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if v_old_status = p_status then return; end if;

  select display_name into v_actor_label from public.admin_users
  where user_id = auth.uid() and active = true;

  update public.orders set status = p_status where id = p_order_id;
  insert into public.order_history (
    order_id, order_number, action, status_from, status_to, note, actor_id, actor_label
  ) values (
    p_order_id, v_order_number, 'status_alterado', v_old_status, p_status,
    nullif(trim(coalesce(p_note, '')), ''), auth.uid(), coalesce(v_actor_label, 'Administrador')
  );
end;
$$;

create or replace function public.admin_add_order_note(
  p_order_id uuid,
  p_content text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note_id uuid;
  v_order_number text;
  v_actor_label text;
begin
  if not public.is_connecta_admin() then
    raise exception 'Acesso não autorizado';
  end if;
  if p_content is null or char_length(trim(p_content)) < 1 or char_length(p_content) > 5000 then
    raise exception 'Observação inválida';
  end if;
  select order_number into v_order_number from public.orders where id = p_order_id;
  if not found then raise exception 'Pedido não encontrado'; end if;
  select display_name into v_actor_label from public.admin_users
  where user_id = auth.uid() and active = true;

  insert into public.internal_notes (order_id, author_id, author_label, content)
  values (p_order_id, auth.uid(), coalesce(v_actor_label, 'Administrador'), trim(p_content))
  returning id into v_note_id;

  insert into public.order_history (order_id, order_number, action, note, actor_id, actor_label)
  values (p_order_id, v_order_number, 'observacao_interna', 'Observação interna adicionada', auth.uid(), coalesce(v_actor_label, 'Administrador'));
  return v_note_id;
end;
$$;

-- Permissões padrão: tabelas sem acesso público de escrita.
alter table public.services enable row level security;
alter table public.customers enable row level security;
alter table public.admin_users enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_history enable row level security;
alter table public.internal_notes enable row level security;
alter table public.order_attachments enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_attempts enable row level security;
alter table public.public_request_limits enable row level security;

drop policy if exists "Serviços ativos são públicos" on public.services;
create policy "Serviços ativos são públicos" on public.services
for select to anon, authenticated using (is_active = true);
drop policy if exists "Administradores leem clientes" on public.customers;
create policy "Administradores leem clientes" on public.customers
for select to authenticated using (public.is_connecta_admin());
drop policy if exists "Administrador consulta próprio vínculo" on public.admin_users;
create policy "Administrador consulta próprio vínculo" on public.admin_users
for select to authenticated using (user_id = auth.uid());
drop policy if exists "Administradores leem pedidos" on public.orders;
create policy "Administradores leem pedidos" on public.orders
for select to authenticated using (public.is_connecta_admin());
drop policy if exists "Administradores leem itens" on public.order_items;
create policy "Administradores leem itens" on public.order_items
for select to authenticated using (public.is_connecta_admin());
drop policy if exists "Administradores leem histórico" on public.order_history;
create policy "Administradores leem histórico" on public.order_history
for select to authenticated using (public.is_connecta_admin());
drop policy if exists "Administradores leem observações" on public.internal_notes;
create policy "Administradores leem observações" on public.internal_notes
for select to authenticated using (public.is_connecta_admin());
drop policy if exists "Administradores leem anexos" on public.order_attachments;
create policy "Administradores leem anexos" on public.order_attachments
for select to authenticated using (public.is_connecta_admin());
drop policy if exists "Administradores leem notificações" on public.notification_outbox;
create policy "Administradores leem notificações" on public.notification_outbox
for select to authenticated using (public.is_connecta_admin());
drop policy if exists "Administradores leem tentativas" on public.notification_attempts;
create policy "Administradores leem tentativas" on public.notification_attempts
for select to authenticated using (public.is_connecta_admin());

-- O bucket é privado. Somente administradores autenticados podem baixar anexos.
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

-- RPCs privilegiadas: somente o service_role pode criar pedidos e gerenciar rate limit/outbox.
revoke all on function public.create_public_order(jsonb, text[], uuid) from public, anon, authenticated;
grant execute on function public.create_public_order(jsonb, text[], uuid) to service_role;
revoke all on function public.consume_public_request_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_public_request_limit(text, integer, integer) to service_role;
revoke all on function public.claim_whatsapp_notification(uuid) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_notification(uuid) to service_role;
revoke all on function public.admin_update_order_status(uuid, public.order_status, text) from public, anon;
grant execute on function public.admin_update_order_status(uuid, public.order_status, text) to authenticated;
revoke all on function public.admin_add_order_note(uuid, text) from public, anon;
grant execute on function public.admin_add_order_note(uuid, text) to authenticated;
revoke all on function public.is_connecta_admin() from public, anon;
grant execute on function public.is_connecta_admin() to authenticated, service_role;

-- Atualizações em tempo real para o painel.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
      alter publication supabase_realtime add table public.orders;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_history') then
      alter publication supabase_realtime add table public.order_history;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_outbox') then
      alter publication supabase_realtime add table public.notification_outbox;
    end if;
  end if;
end $$;

-- Catálogo alinhado aos serviços já publicados no site institucional.
insert into public.services (slug, name, description, sort_order) values
('instalacoes-manutencoes-eletricas', 'Instalações e Manutenções Elétricas', 'Infraestrutura elétrica, instalações industriais e comerciais, manutenção preventiva e corretiva.', 1),
('montagem-quadros-eletricos', 'Montagem de Quadros Elétricos', 'Quadros elétricos para distribuição, comando, automação e aplicações industriais e comerciais.', 2),
('redes-dados-racks', 'Redes de Dados e Racks', 'Conectividade estruturada, montagem e certificação de redes, racks e cabeamentos.', 3),
('deteccao-incendio', 'Detecção de Incêndio', 'Infraestrutura e instalação de sistemas de detecção e alarme de incêndio.', 4),
('automacao-industrial', 'Automação Industrial', 'Automação de processos, integração de controle e eficiência operacional.', 5),
('outro', 'Outro serviço / avaliação técnica', 'Solicitações fora das categorias anteriores.', 6)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = true;

-- Privilégios SQL complementam RLS. Revogue permissões amplas que um projeto
-- preexistente possa ter concedido por padrão antes de liberar somente o necessário.
grant usage on schema public to anon, authenticated, service_role;
revoke all on table public.services, public.customers, public.admin_users, public.orders,
  public.order_items, public.order_history, public.internal_notes, public.order_attachments,
  public.notification_outbox, public.notification_attempts, public.public_request_limits
  from public, anon, authenticated;

grant select on public.services to anon, authenticated;
grant select on public.admin_users, public.customers, public.orders, public.order_items,
  public.order_history, public.internal_notes, public.order_attachments,
  public.notification_outbox, public.notification_attempts to authenticated;
grant all on public.services, public.customers, public.admin_users, public.orders,
  public.order_items, public.order_history, public.internal_notes, public.order_attachments,
  public.notification_outbox, public.notification_attempts, public.public_request_limits
  to service_role;

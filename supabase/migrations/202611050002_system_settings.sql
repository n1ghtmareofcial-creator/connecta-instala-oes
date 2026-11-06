-- Connecta Instalações: tabela de configurações persistidas do sistema.
-- Execute via `supabase db push` ou no SQL Editor do Supabase.

create table if not exists public.system_settings (
  key   text primary key check (char_length(key) between 1 and 80),
  value text not null default '',
  updated_at timestamptz not null default now()
);

create or replace function public.system_settings_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists system_settings_updated_at on public.system_settings;
create trigger system_settings_updated_at
  before update on public.system_settings
  for each row execute function public.system_settings_set_updated_at();

alter table public.system_settings enable row level security;

-- Apenas administradores autenticados leem e escrevem configurações.
drop policy if exists "Admins leem configurações" on public.system_settings;
create policy "Admins leem configurações" on public.system_settings
  for select to authenticated using (public.is_connecta_admin());

drop policy if exists "Admins escrevem configurações" on public.system_settings;
create policy "Admins escrevem configurações" on public.system_settings
  for all to authenticated using (public.is_connecta_admin()) with check (public.is_connecta_admin());

-- Grants
revoke all on table public.system_settings from public, anon;
grant select, insert, update, delete on public.system_settings to authenticated;
grant all on public.system_settings to service_role;

-- Valores padrão da Connecta (serão sobrescritos pelo painel)
insert into public.system_settings (key, value) values
  ('company_name',  'Connecta Instalações'),
  ('contact_email', ''),
  ('whatsapp_phone', '556186063653'),
  ('phone',          ''),
  ('address',        ''),
  ('cnpj',           ''),
  ('instagram',      ''),
  ('linkedin',       ''),
  ('facebook',       ''),
  ('hours_weekdays', '08:00 – 18:00'),
  ('hours_saturday', '08:00 – 12:00'),
  ('hours_sunday',   'Fechado'),
  ('hours_note',     '')
on conflict (key) do nothing;

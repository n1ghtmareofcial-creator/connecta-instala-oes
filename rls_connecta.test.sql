-- Testes de grants e RLS da Connecta Instalações.
-- Execute com `supabase test db` após aplicar as migrações em um projeto local.
create extension if not exists pgtap with schema extensions;
begin;
select extensions.plan(15);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.orders'::regclass),
  'RLS está ativo em pedidos'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.customers'::regclass),
  'RLS está ativo em clientes'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.orders', 'select'),
  'visitantes não podem consultar pedidos'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.orders', 'insert'),
  'visitantes não podem inserir pedidos diretamente'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.customers', 'select'),
  'visitantes não podem consultar clientes'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.orders', 'insert'),
  'usuários autenticados não podem inserir pedidos diretamente'
);
select extensions.ok(
  has_table_privilege('authenticated', 'public.orders', 'select'),
  'o papel autenticado possui SELECT sujeito à política RLS'
);
select extensions.ok(
  has_table_privilege('authenticated', 'public.admin_users', 'select'),
  'o painel pode verificar o vínculo administrativo sujeito à política RLS'
);
select extensions.ok(
  has_table_privilege('anon', 'public.services', 'select'),
  'o catálogo ativo de serviços pode ser lido publicamente'
);
select extensions.ok(
  has_table_privilege('service_role', 'public.orders', 'insert'),
  'o backend privilegiado pode inserir pedidos'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.create_public_order(jsonb,text[],uuid)', 'EXECUTE'),
  'visitantes não executam a RPC de criação diretamente'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.create_public_order(jsonb,text[],uuid)', 'EXECUTE'),
  'clientes autenticados não executam a RPC privilegiada de criação'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.create_public_order(jsonb,text[],uuid)', 'EXECUTE'),
  'somente o backend executa a RPC privilegiada de criação'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.admin_update_order_status(uuid,public.order_status,text)', 'EXECUTE'),
  'visitantes não executam a RPC de alteração de status'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.admin_update_order_status(uuid,public.order_status,text)', 'EXECUTE'),
  'a RPC de alteração de status valida o administrador dentro da função'
);

select * from extensions.finish();
rollback;

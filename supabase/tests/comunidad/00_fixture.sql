-- Solo en una base desechable; no ejecutar este fixture en un proyecto Supabase.
create role anon;
create role authenticated;
create schema auth;
create schema app_private;
grant usage on schema auth, app_private to authenticated;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.user_id', true), '')::uuid;
$$;
create table public.roles (id uuid primary key, nombre text unique not null);
create table public.usuarios (id uuid primary key, rol_id uuid references public.roles, nombre text not null, activo boolean not null default true, email text);
grant select on public.roles to authenticated;

create function app_private._es_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.usuarios u join public.roles r on r.id = u.rol_id
    where u.id = (select auth.uid()) and u.activo and r.nombre = 'Administrador');
$$;
create table public.audit_fixture (evento text, datos jsonb);
create function public.fn_auditar() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_fixture values (tg_op, to_jsonb(new));
  return null;
end;
$$;

insert into public.roles values
  ('00000000-0000-0000-0000-000000000001', 'Básico'),
  ('00000000-0000-0000-0000-000000000002', 'Vendedor'),
  ('00000000-0000-0000-0000-000000000003', 'Administrador'),
  ('00000000-0000-0000-0000-000000000004', 'Supervisor'),
  ('00000000-0000-0000-0000-000000000005', 'Gerente');
insert into public.usuarios (id, rol_id, nombre, activo) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Cuenta básica', true),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Vendedor A', true),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'Admin', true),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', 'Supervisor A', true),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000005', 'Gerente', true),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000002', 'Vendedor B', true),
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000002', 'Inactivo', false),
  ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000003', 'Admin inactivo', false);

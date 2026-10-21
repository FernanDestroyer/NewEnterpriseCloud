-- =============================================================================
-- ERP EnterpriseCloud · Cuentas y permisos
-- 1. Rol Básico (ver + crear en módulos operativos): es el rol por defecto
--    de toda cuenta nueva (antes era Operador, demasiado amplio).
-- 2. La cuenta 1604251@senati.pe queda como administradora permanente:
--    nadie (ni ella misma por error) puede quitarle el rol ni desactivarla.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

-- 1. Rol Básico: solo consultar y crear en los módulos de operación.
insert into public.roles (nombre, descripcion)
values ('Básico', 'Rol por defecto: solo consultar y crear en ventas, compras, inventario, clientes y proveedores')
on conflict (nombre) do nothing;

insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
  from public.roles r
  join public.permisos p on p.modulo in ('ventas', 'compras', 'inventario', 'clientes', 'proveedores')
                       and p.accion in ('ver', 'crear')
 where r.nombre = 'Básico'
on conflict do nothing;

-- 2. Las cuentas nuevas nacen con rol Básico (ya no Operador).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_primero boolean;
  v_rol     uuid;
begin
  perform pg_advisory_xact_lock(hashtext('erp_enterprisecloud_primer_usuario'));
  select not exists (select 1 from public.usuarios) into v_primero;
  select id into v_rol from public.roles
   where nombre = case when v_primero then 'Administrador' else 'Básico' end;

  insert into public.usuarios (id, nombre, email, rol_id, ultimo_acceso)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''),
             nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Usuario'),
    new.email, v_rol, new.last_sign_in_at)
  on conflict (id) do nothing;
  return new;
end $$;

-- 3. Cuenta administradora permanente.
do $$
declare v_admin uuid;
begin
  select id into v_admin from public.roles where nombre = 'Administrador';
  update public.usuarios
     set rol_id = v_admin, activo = true, updated_at = now()
   where lower(email) = '1604251@senati.pe';
end $$;

create or replace function public.proteger_admin_permanente()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_admin uuid;
begin
  select id into v_admin from public.roles where nombre = 'Administrador';
  if lower(old.email) = '1604251@senati.pe'
     and (new.rol_id is distinct from v_admin or new.activo is distinct from true) then
    raise exception 'La cuenta administradora principal no puede dejar de ser administradora ni desactivarse'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_admin_permanente on public.usuarios;
create trigger trg_admin_permanente before update on public.usuarios
  for each row execute function public.proteger_admin_permanente();

revoke execute on function public.proteger_admin_permanente()
  from public, anon, authenticated;

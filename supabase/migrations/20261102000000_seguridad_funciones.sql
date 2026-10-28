-- Helpers privilegiados fuera del esquema REST. Wrappers invoker conservan compatibilidad.
begin;
create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

create or replace function app_private._es_admin()
returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1 from public.usuarios u join public.roles r on r.id = u.rol_id
    where u.id = (select auth.uid()) and u.activo and r.nombre = 'Administrador'
  );
$function$;

create or replace function app_private._usuario_activo()
returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (select 1 from public.usuarios u where u.id = (select auth.uid()) and u.activo);
$function$;

create or replace function app_private._tiene_permiso(p_modulo text, p_accion text)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1 from public.usuarios u where u.id = (select auth.uid()) and u.activo
      and coalesce(
        (select up.permitido from public.usuario_permisos up join public.permisos p on p.id = up.permiso_id
          where up.usuario_id = u.id and p.modulo = p_modulo and p.accion = p_accion),
        exists (select 1 from public.rol_permisos rp join public.permisos p on p.id = rp.permiso_id
          where rp.rol_id = u.rol_id and p.modulo = p_modulo and p.accion = p_accion)
      )
  );
$function$;
revoke all on function app_private._es_admin(), app_private._usuario_activo(), app_private._tiene_permiso(text, text) from public, anon;
grant execute on function app_private._es_admin(), app_private._usuario_activo(), app_private._tiene_permiso(text, text) to authenticated;

create or replace function public.es_admin()
returns boolean language sql stable security invoker set search_path = ''
as $function$ select app_private._es_admin(); $function$;
create or replace function public.usuario_activo()
returns boolean language sql stable security invoker set search_path = ''
as $function$ select app_private._usuario_activo(); $function$;
create or replace function public.tiene_permiso(p_modulo text, p_accion text)
returns boolean language sql stable security invoker set search_path = ''
as $function$ select app_private._tiene_permiso(p_modulo, p_accion); $function$;
revoke all on function public.es_admin(), public.usuario_activo(), public.tiene_permiso(text, text) from public, anon;
grant execute on function public.es_admin(), public.usuario_activo(), public.tiene_permiso(text, text) to authenticated;

-- Permisos personalizados conservan sus validaciones y ahora quedan bajo RLS.
create or replace function public.guardar_permisos_usuario(p_usuario_id uuid, p_overrides jsonb)
returns void language plpgsql security invoker set search_path = ''
as $function$
declare target_role text; target_role_id uuid;
begin
  if (select auth.uid()) is null or not app_private._es_admin() then
    raise exception 'Solo un administrador puede modificar permisos personalizados.' using errcode = '42501';
  end if;
  if p_usuario_id = (select auth.uid()) then
    raise exception 'No puedes modificar tus propios permisos.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_overrides, '[]'::jsonb)) <> 'array' then
    raise exception 'La lista de permisos no es válida.' using errcode = '22023';
  end if;
  select r.nombre, u.rol_id into target_role, target_role_id
    from public.usuarios u left join public.roles r on r.id = u.rol_id where u.id = p_usuario_id;
  if not found then raise exception 'No existe la cuenta seleccionada.' using errcode = 'P0002'; end if;
  if target_role = 'Administrador' then
    raise exception 'No se pueden personalizar cuentas administradoras.' using errcode = '42501';
  end if;
  delete from public.usuario_permisos where usuario_id = p_usuario_id;
  insert into public.usuario_permisos (usuario_id, permiso_id, permitido, actualizado_por, updated_at)
    select p_usuario_id, x.permiso_id, x.permitido, (select auth.uid()), pg_catalog.now()
    from jsonb_to_recordset(coalesce(p_overrides, '[]'::jsonb)) as x(permiso_id uuid, permitido boolean);
  if exists (
    with effective as (
      select p.modulo, p.accion, coalesce(up.permitido, exists (
        select 1 from public.rol_permisos rp where rp.rol_id = target_role_id and rp.permiso_id = p.id
      )) as permitido from public.permisos p
      left join public.usuario_permisos up on up.usuario_id = p_usuario_id and up.permiso_id = p.id
    )
    select 1 from effective action
    left join effective view_permission on view_permission.modulo = action.modulo and view_permission.accion = 'ver'
    where action.accion <> 'ver' and action.permitido and not coalesce(view_permission.permitido, false)
  ) then
    raise exception 'Para conceder acciones de un módulo, también debe permitirse Consultar.' using errcode = '22023';
  end if;
end;
$function$;
revoke all on function public.guardar_permisos_usuario(uuid, jsonb) from public, anon;
grant execute on function public.guardar_permisos_usuario(uuid, jsonb) to authenticated;

create or replace function public.proteger_usuario()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if (select auth.uid()) is not null and not app_private._es_admin()
     and (new.rol_id is distinct from old.rol_id or new.activo is distinct from old.activo or new.id is distinct from old.id) then
    raise exception 'Solo un administrador puede cambiar el rol o el estado de un usuario' using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function public.proteger_usuario() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $function$
begin new.updated_at := pg_catalog.now(); return new; end;
$function$;
commit;

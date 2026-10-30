-- =============================================================================
-- ERP EnterpriseCloud · Caja asignada a un vendedor (de forma fija)
--
-- Flujo: la persona crea su cuenta -> el administrador le da el rol «Vendedor» -> el administrador
-- le asigna una caja (cajas.responsable_id). La caja pertenece a una sucursal, así que:
--   · las ventas completadas del vendedor suman a su avance en Metas y Objetivos,
--   · y también a la meta de la sucursal donde está esa caja.
-- Este script:
--   1) Un vendedor solo puede tener UNA caja asignada (índice único; se omite si ya hay duplicados).
--   2) Solo un administrador (permiso usuarios/editar) puede cambiar el responsable de una caja, y debe
--      ser una cuenta activa. Los vendedores tienen permiso de editar Finanzas, por eso se protege aquí.
--   3) metas_ubicaciones(): para cada asignación de vendedor, en qué sucursal y caja está y cuál es la
--      asignación de su sucursal en la misma meta (para mostrar «meta de la sucursal»).
-- Requiere: 20261104050000_vendedor_turno_sucursal.sql. Es idempotente.
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- =============================================================================
begin;

do $migration$
begin
  if exists (select 1 from public.cajas where responsable_id is not null group by responsable_id having count(*) > 1) then
    raise notice 'Hay vendedores con más de una caja asignada: se omite el índice único. Déjalos con una sola y vuelve a ejecutar.';
  else
    create unique index if not exists cajas_responsable_uidx on public.cajas (responsable_id) where responsable_id is not null;
  end if;
end
$migration$;

create or replace function app_private._cajas_responsable_guard()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if tg_op = 'INSERT' and new.responsable_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.responsable_id is not distinct from old.responsable_id then return new; end if;
  if not (select app_private._tiene_permiso('usuarios', 'editar')) then
    raise exception 'Solo un administrador puede asignar el vendedor de una caja.' using errcode = '42501';
  end if;
  if new.responsable_id is not null
     and not exists (select 1 from public.usuarios u where u.id = new.responsable_id and u.activo) then
    raise exception 'El responsable de la caja debe ser una cuenta activa.' using errcode = '23514';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_cajas_responsable_guard on public.cajas;
create trigger trg_cajas_responsable_guard before insert or update of responsable_id on public.cajas
  for each row execute function app_private._cajas_responsable_guard();

-- Dónde está cada vendedor de las metas (sucursal, caja) y cuál es la asignación de esa sucursal en la meta.
create or replace function app_private._metas_ubicaciones(p_meta uuid default null)
returns table (asignacion_id uuid, sucursal_id uuid, sucursal text, caja text, sucursal_asignacion_id uuid)
language plpgsql stable security definer set search_path = '' as $function$
#variable_conflict use_column
begin
  if not (select app_private._tiene_permiso('metas', 'ver')) then
    raise exception 'Tu rol no tiene permiso para ver las metas.' using errcode = '42501';
  end if;
  return query
  with res as (select * from app_private._metas_resueltas(p_meta))
  select r.id, c.sucursal_id, s.nombre, c.nombre || ' (' || c.codigo || ')',
    (select a2.id
       from public.metas_asignaciones a2
       join res r2 on r2.id = a2.id and r2.alcance = 'sucursal'
      where a2.meta_id = a.meta_id and r2.ref = c.sucursal_id
      limit 1)
  from res r
  join public.metas_asignaciones a on a.id = r.id
  join public.cajas c on c.responsable_id = r.ref and c.activo
  join public.sucursales s on s.id = c.sucursal_id
  where r.alcance = 'vendedor';
end
$function$;
revoke all on function app_private._metas_ubicaciones(uuid) from public, anon;
grant execute on function app_private._metas_ubicaciones(uuid) to authenticated;

create or replace function public.metas_ubicaciones(p_meta uuid default null)
returns table (asignacion_id uuid, sucursal_id uuid, sucursal text, caja text, sucursal_asignacion_id uuid)
language sql stable security invoker set search_path = '' as $function$
  select * from app_private._metas_ubicaciones(p_meta);
$function$;
revoke all on function public.metas_ubicaciones(uuid) from public, anon;
grant execute on function public.metas_ubicaciones(uuid) to authenticated;

commit;

-- =============================================================================
-- ERP EnterpriseCloud · Metas y Objetivos · avance calculado con las ventas
--
-- Hasta ahora el «logrado» de cada asignación salía solo de cortes escritos a mano. Esta migración
-- permite calcularlo con las VENTAS COMPLETADAS:
--   · vendedor  → ventas registradas por esa persona (ventas.created_by)
--   · sucursal  → ventas hechas en los almacenes de esa sucursal (ventas.almacen_id)
--   · producto  → unidades/importe de ese producto en el detalle de las ventas
-- Solo cuentan las ventas con estado «Completada» dentro de las fechas de la meta (hora de Lima).
--
-- Incluye:
--   1) metas_asignaciones.referencia_id: enlace exacto con el usuario, sucursal o producto.
--      Si queda vacío, la función busca por nombre y enlaza solo cuando hay UNA coincidencia clara.
--   2) metas_logrado(): acumulado por asignación y fecha (lo que antes eran los cortes manuales).
--   3) metas_catalogo(): lista de usuarios, sucursales o productos para elegir al asignar
--      (así quien arma las metas no necesita permiso para ver todos los usuarios).
-- Requiere: 20261103000000_metas_objetivos.sql y las tablas de ventas, almacenes y sucursales.
-- Es idempotente. Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- =============================================================================
begin;

alter table public.metas_asignaciones add column if not exists referencia_id uuid;
create index if not exists metas_asignaciones_referencia_idx on public.metas_asignaciones (referencia_id);

-- Acumulado de ventas completadas por asignación y fecha. Cada asignación enlazada devuelve además
-- una fila en la fecha de inicio de la meta con valor 0: así la aplicación sabe que se calcula sola.
create or replace function app_private._metas_logrado(p_meta uuid default null)
returns table (asignacion_id uuid, fecha date, valor_acumulado numeric)
language plpgsql stable security definer set search_path = '' as $function$
#variable_conflict use_column
begin
  if not (select app_private._tiene_permiso('metas', 'ver')) then
    raise exception 'Tu rol no tiene permiso para ver las metas.' using errcode = '42501';
  end if;

  return query
  with asig as (
    select a.id, a.alcance, a.objetivo, a.referencia_id, m.indicador, m.fecha_inicio, m.fecha_fin
    from public.metas_asignaciones a
    join public.metas m on m.id = a.meta_id
    where a.estado = 'activa' and m.estado <> 'inactiva' and (p_meta is null or a.meta_id = p_meta)
  ),
  resuelta as (
    select a.id, a.alcance, a.indicador, a.fecha_inicio, a.fecha_fin,
      coalesce(a.referencia_id,
        case a.alcance
          when 'vendedor' then (
            select case when count(*) = 1 then (array_agg(u.id))[1] end from public.usuarios u
            where lower(btrim(u.nombre)) = lower(btrim(a.objetivo))
               or lower(btrim(u.nombre)) like lower(btrim(a.objetivo)) || ' %')
          when 'sucursal' then (
            select case when count(*) = 1 then (array_agg(s.id))[1] end from public.sucursales s
            where lower(btrim(s.nombre)) = lower(btrim(a.objetivo)))
          else (
            select case when count(*) = 1 then (array_agg(p.id))[1] end from public.productos p
            where lower(btrim(p.nombre)) = lower(btrim(a.objetivo)) or lower(btrim(p.codigo)) = lower(btrim(a.objetivo)))
        end) as ref
    from asig a
  ),
  movimientos as (
    -- Marca de «enlazada»: valor 0 al inicio de la meta.
    select r.id as asignacion_id, r.fecha_inicio as fecha, 0::numeric as valor
    from resuelta r where r.ref is not null
    union all
    select r.id, (v.created_at at time zone 'America/Lima')::date,
      case when r.indicador = 'importe' then v.monto
           else coalesce((select sum(d.cantidad) from public.detalle_ventas d where d.venta_id = v.id), 0) end::numeric
    from resuelta r
    join public.ventas v on v.created_by = r.ref
    where r.alcance = 'vendedor' and r.ref is not null and v.estado = 'Completada'
      and (v.created_at at time zone 'America/Lima')::date between r.fecha_inicio and r.fecha_fin
    union all
    select r.id, (v.created_at at time zone 'America/Lima')::date,
      case when r.indicador = 'importe' then v.monto
           else coalesce((select sum(d.cantidad) from public.detalle_ventas d where d.venta_id = v.id), 0) end::numeric
    from resuelta r
    join public.almacenes al on al.sucursal_id = r.ref
    join public.ventas v on v.almacen_id = al.id
    where r.alcance = 'sucursal' and r.ref is not null and v.estado = 'Completada'
      and (v.created_at at time zone 'America/Lima')::date between r.fecha_inicio and r.fecha_fin
    union all
    select r.id, (v.created_at at time zone 'America/Lima')::date,
      case when r.indicador = 'importe' then d.subtotal * (1 - v.descuento / 100.0) else d.cantidad::numeric end
    from resuelta r
    join public.detalle_ventas d on d.producto_id = r.ref
    join public.ventas v on v.id = d.venta_id
    where r.alcance = 'producto' and r.ref is not null and v.estado = 'Completada'
      and (v.created_at at time zone 'America/Lima')::date between r.fecha_inicio and r.fecha_fin
  ),
  diario as (
    select mv.asignacion_id, mv.fecha, sum(mv.valor) as valor from movimientos mv group by mv.asignacion_id, mv.fecha
  )
  select d.asignacion_id, d.fecha, round(sum(d.valor) over (partition by d.asignacion_id order by d.fecha), 2)
  from diario d
  order by d.asignacion_id, d.fecha;
end
$function$;
revoke all on function app_private._metas_logrado(uuid) from public, anon;
grant execute on function app_private._metas_logrado(uuid) to authenticated;

create or replace function public.metas_logrado(p_meta uuid default null)
returns table (asignacion_id uuid, fecha date, valor_acumulado numeric)
language sql stable security invoker set search_path = '' as $function$
  select * from app_private._metas_logrado(p_meta);
$function$;
revoke all on function public.metas_logrado(uuid) from public, anon;
grant execute on function public.metas_logrado(uuid) to authenticated;

-- Lista para elegir a quién se asigna la cuota.
create or replace function app_private._metas_catalogo(p_alcance text)
returns table (id uuid, nombre text)
language plpgsql stable security definer set search_path = '' as $function$
#variable_conflict use_column
begin
  if not ((select app_private._tiene_permiso('metas', 'crear')) or (select app_private._tiene_permiso('metas', 'editar'))) then
    raise exception 'Tu rol no tiene permiso para asignar metas.' using errcode = '42501';
  end if;
  if p_alcance = 'vendedor' then
    return query select u.id, u.nombre from public.usuarios u where u.activo order by u.nombre;
  elsif p_alcance = 'sucursal' then
    return query select s.id, s.nombre from public.sucursales s where s.estado = 'Activo' order by s.nombre;
  elsif p_alcance = 'producto' then
    return query select p.id, p.nombre from public.productos p order by p.nombre limit 1000;
  else
    raise exception 'Alcance no válido.' using errcode = '22023';
  end if;
end
$function$;
revoke all on function app_private._metas_catalogo(text) from public, anon;
grant execute on function app_private._metas_catalogo(text) to authenticated;

create or replace function public.metas_catalogo(p_alcance text)
returns table (id uuid, nombre text)
language sql stable security invoker set search_path = '' as $function$
  select * from app_private._metas_catalogo(p_alcance);
$function$;
revoke all on function public.metas_catalogo(text) from public, anon;
grant execute on function public.metas_catalogo(text) to authenticated;

commit;

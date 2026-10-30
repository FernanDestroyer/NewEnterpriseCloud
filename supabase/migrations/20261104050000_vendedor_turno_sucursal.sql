-- =============================================================================
-- ERP EnterpriseCloud · Vendedor en el turno de caja + metas por sucursal
--
-- 1) caja_turnos.vendedor_id: al abrir un turno se elige qué cuenta de rol «Vendedor» atiende esa caja.
-- 2) La sucursal de cada venta completada se decide así (en este orden):
--      a) la caja del turno que tenía abierto el vendedor en el momento de la venta,
--      b) la caja de la que el vendedor es responsable (cajas.responsable_id),
--      c) la sucursal del almacén de la venta.
--    Con eso la meta de una SUCURSAL suma las ventas completadas de TODOS sus vendedores, y cada
--    vendedor sigue viendo lo suyo (las ventas que él registra, ventas.created_by).
-- 3) metas_aportes(): cuánto aportó cada vendedor a la meta de una sucursal.
-- 4) caja_vendedores(): lista de cuentas con rol Vendedor para elegir al abrir el turno.
-- Reemplaza la función metas_logrado de 20261104040000_metas_ventas_automaticas.sql: ejecútala DESPUÉS.
-- Es idempotente. Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- =============================================================================
begin;

alter table public.caja_turnos
  add column if not exists vendedor_id uuid references public.usuarios(id) on delete set null;
create index if not exists caja_turnos_vendedor_idx on public.caja_turnos (vendedor_id, abierto_en desc);

-- Cuentas con rol Vendedor (para elegir en el turno).
create or replace function app_private._caja_vendedores()
returns table (id uuid, nombre text, email text)
language plpgsql stable security definer set search_path = '' as $function$
#variable_conflict use_column
begin
  if not (select app_private._tiene_permiso('finanzas', 'ver')) then
    raise exception 'Tu rol no tiene permiso para ver Caja.' using errcode = '42501';
  end if;
  return query
    select u.id, u.nombre, u.email
    from public.usuarios u join public.roles r on r.id = u.rol_id
    where u.activo and r.nombre = 'Vendedor'
    order by u.nombre;
end
$function$;
revoke all on function app_private._caja_vendedores() from public, anon;
grant execute on function app_private._caja_vendedores() to authenticated;

create or replace function public.caja_vendedores()
returns table (id uuid, nombre text, email text)
language sql stable security invoker set search_path = '' as $function$
  select * from app_private._caja_vendedores();
$function$;
revoke all on function public.caja_vendedores() from public, anon;
grant execute on function public.caja_vendedores() to authenticated;

-- Sucursal de una venta según el turno / caja del vendedor (ver cabecera).
create or replace function app_private._sucursal_de_venta(p_vendedor uuid, p_momento timestamptz, p_almacen uuid)
returns uuid
language sql stable security definer set search_path = '' as $function$
  select coalesce(
    (select c.sucursal_id
       from public.caja_turnos t join public.cajas c on c.id = t.caja_id
      where t.vendedor_id = p_vendedor and t.abierto_en <= p_momento
        and (t.cerrado_en is null or t.cerrado_en >= p_momento)
      order by t.abierto_en desc limit 1),
    (select c.sucursal_id from public.cajas c where c.responsable_id = p_vendedor and c.activo order by c.codigo limit 1),
    (select al.sucursal_id from public.almacenes al where al.id = p_almacen));
$function$;
revoke all on function app_private._sucursal_de_venta(uuid, timestamptz, uuid) from public, anon;
grant execute on function app_private._sucursal_de_venta(uuid, timestamptz, uuid) to authenticated;

-- Asignaciones activas con su usuario / sucursal / producto resuelto (por enlace o, si no hay, por nombre único).
create or replace function app_private._metas_resueltas(p_meta uuid default null)
returns table (id uuid, alcance text, indicador text, fecha_inicio date, fecha_fin date, ref uuid)
language sql stable security definer set search_path = '' as $function$
  select a.id, a.alcance, m.indicador, m.fecha_inicio, m.fecha_fin,
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
      end)
  from public.metas_asignaciones a
  join public.metas m on m.id = a.meta_id
  where a.estado = 'activa' and m.estado <> 'inactiva' and (p_meta is null or a.meta_id = p_meta);
$function$;
revoke all on function app_private._metas_resueltas(uuid) from public, anon;
grant execute on function app_private._metas_resueltas(uuid) to authenticated;

-- Acumulado de ventas completadas por asignación y fecha (reemplaza la versión anterior).
create or replace function app_private._metas_logrado(p_meta uuid default null)
returns table (asignacion_id uuid, fecha date, valor_acumulado numeric)
language plpgsql stable security definer set search_path = '' as $function$
#variable_conflict use_column
begin
  if not (select app_private._tiene_permiso('metas', 'ver')) then
    raise exception 'Tu rol no tiene permiso para ver las metas.' using errcode = '42501';
  end if;

  return query
  with resuelta as (select * from app_private._metas_resueltas(p_meta)),
  vc as (
    select v.id, v.created_by, v.monto, v.descuento,
           (v.created_at at time zone 'America/Lima')::date as dia,
           app_private._sucursal_de_venta(v.created_by, v.created_at, v.almacen_id) as sucursal_id
    from public.ventas v where v.estado = 'Completada'
  ),
  movimientos as (
    -- Marca de «enlazada»: valor 0 al inicio de la meta.
    select r.id as asignacion_id, r.fecha_inicio as dia, 0::numeric as valor
    from resuelta r where r.ref is not null
    union all
    select r.id, vc.dia,
      case when r.indicador = 'importe' then vc.monto
           else coalesce((select sum(d.cantidad) from public.detalle_ventas d where d.venta_id = vc.id), 0) end::numeric
    from resuelta r join vc on vc.created_by = r.ref
    where r.alcance = 'vendedor' and r.ref is not null and vc.dia between r.fecha_inicio and r.fecha_fin
    union all
    select r.id, vc.dia,
      case when r.indicador = 'importe' then vc.monto
           else coalesce((select sum(d.cantidad) from public.detalle_ventas d where d.venta_id = vc.id), 0) end::numeric
    from resuelta r join vc on vc.sucursal_id = r.ref
    where r.alcance = 'sucursal' and r.ref is not null and vc.dia between r.fecha_inicio and r.fecha_fin
    union all
    select r.id, vc.dia,
      case when r.indicador = 'importe' then d.subtotal * (1 - vc.descuento / 100.0) else d.cantidad::numeric end
    from resuelta r
    join public.detalle_ventas d on d.producto_id = r.ref
    join vc on vc.id = d.venta_id
    where r.alcance = 'producto' and r.ref is not null and vc.dia between r.fecha_inicio and r.fecha_fin
  ),
  diario as (
    select mv.asignacion_id, mv.dia, sum(mv.valor) as valor from movimientos mv group by mv.asignacion_id, mv.dia
  )
  select d.asignacion_id, d.dia, round(sum(d.valor) over (partition by d.asignacion_id order by d.dia), 2)
  from diario d
  order by d.asignacion_id, d.dia;
end
$function$;

-- Aporte de cada vendedor a la meta de una sucursal.
create or replace function app_private._metas_aportes(p_meta uuid default null)
returns table (asignacion_id uuid, vendedor_id uuid, vendedor text, valor numeric)
language plpgsql stable security definer set search_path = '' as $function$
#variable_conflict use_column
begin
  if not (select app_private._tiene_permiso('metas', 'ver')) then
    raise exception 'Tu rol no tiene permiso para ver las metas.' using errcode = '42501';
  end if;

  return query
  with resuelta as (select * from app_private._metas_resueltas(p_meta) x where x.alcance = 'sucursal' and x.ref is not null),
  vc as (
    select v.id, v.created_by, v.monto,
           (v.created_at at time zone 'America/Lima')::date as dia,
           app_private._sucursal_de_venta(v.created_by, v.created_at, v.almacen_id) as sucursal_id
    from public.ventas v where v.estado = 'Completada'
  )
  select r.id, vc.created_by, coalesce(u.nombre, 'Sin vendedor'),
         round(sum(case when r.indicador = 'importe' then vc.monto
                        else coalesce((select sum(d.cantidad) from public.detalle_ventas d where d.venta_id = vc.id), 0) end), 2)
  from resuelta r
  join vc on vc.sucursal_id = r.ref and vc.dia between r.fecha_inicio and r.fecha_fin
  left join public.usuarios u on u.id = vc.created_by
  group by r.id, vc.created_by, u.nombre
  order by r.id, 4 desc;
end
$function$;
revoke all on function app_private._metas_aportes(uuid) from public, anon;
grant execute on function app_private._metas_aportes(uuid) to authenticated;

create or replace function public.metas_aportes(p_meta uuid default null)
returns table (asignacion_id uuid, vendedor_id uuid, vendedor text, valor numeric)
language sql stable security invoker set search_path = '' as $function$
  select * from app_private._metas_aportes(p_meta);
$function$;
revoke all on function public.metas_aportes(uuid) from public, anon;
grant execute on function public.metas_aportes(uuid) to authenticated;

commit;

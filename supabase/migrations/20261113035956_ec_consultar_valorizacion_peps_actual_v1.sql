-- Exposes one current PEPS snapshot per positive-stock product/warehouse.
-- The caller must be allowed to view inventory; RLS remains enforced because
-- this function runs with invoker privileges.
create or replace function public.ec_consultar_valorizacion_peps_actual_v1()
returns table (
  producto_id uuid,
  almacen_id uuid,
  stock_fisico integer,
  saldo_unidades integer,
  saldo_peps numeric,
  problema text
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $function$
begin
  if auth.uid() is null or not public.tiene_permiso('inventario', 'ver') then
    raise exception 'Sin permiso para consultar valorización de inventario.'
      using errcode = '42501';
  end if;

  return query
  with current_stock as (
    select i.producto_id, i.almacen_id, sum(i.cantidad)::integer as stock_fisico
    from public.inventarios i
    group by i.producto_id, i.almacen_id
    having sum(i.cantidad) > 0
  ), latest_times as (
    select k.producto_id, k.almacen_id, max(k.creado_en) as creado_en
    from public.ec_kardex_valorizado k
    join current_stock s using (producto_id, almacen_id)
    group by k.producto_id, k.almacen_id
  ), latest_snapshots as (
    select k.producto_id,
      k.almacen_id,
      count(*)::integer as movimientos_ultimo_instante,
      max(k.saldo_unidades)::integer as saldo_unidades,
      max(k.saldo_peps) as saldo_peps
    from public.ec_kardex_valorizado k
    join latest_times t
      on t.producto_id = k.producto_id
      and t.almacen_id = k.almacen_id
      and t.creado_en = k.creado_en
    group by k.producto_id, k.almacen_id
  )
  select s.producto_id,
    s.almacen_id,
    s.stock_fisico,
    l.saldo_unidades,
    case when l.movimientos_ultimo_instante = 1 then l.saldo_peps else null end,
    case
      when l.producto_id is null then 'sin-kardex'
      when l.movimientos_ultimo_instante > 1 then 'fechas-empatadas'
      when l.saldo_unidades is distinct from s.stock_fisico then 'stock-no-coincide'
      when l.saldo_peps is null then 'sin-costo'
      else null
    end
  from current_stock s
  left join latest_snapshots l using (producto_id, almacen_id)
  order by s.almacen_id, s.producto_id;
end
$function$;

comment on function public.ec_consultar_valorizacion_peps_actual_v1() is
  'Devuelve saldos PEPS por almacén solo cuando puede identificar el último movimiento y conciliarlo con el stock físico; no genera costo para ubicaciones incompletas.';

revoke all on function public.ec_consultar_valorizacion_peps_actual_v1() from public, anon;
grant execute on function public.ec_consultar_valorizacion_peps_actual_v1() to authenticated;

-- 20261119000011_peps_apertura_y_metas_netas.sql
-- 1. Valoriza la capa inicial pendiente de PRD-019 usando su costo unitario de recepción (S/ 9.90).
-- 2. Actualiza ec_consultar_valorizacion_peps_actual_v1 para incluir capas de apertura sin movimientos posteriores.
-- 3. Actualiza app_private._metas_logrado y _metas_aportes para descontar unidades de notas de crédito
--    y respetar la reasignación de vendedor en public.ventas_vendedor.

DO $$
DECLARE
  v_prd_id uuid;
  v_costo numeric;
BEGIN
  SELECT p.id INTO v_prd_id
  FROM public.productos p
  WHERE p.codigo = 'PRD-019'
  LIMIT 1;

  IF v_prd_id IS NOT NULL THEN
    SELECT COALESCE((
      SELECT ROUND(
        AVG(
          dr.costo_unitario * CASE
            WHEN c.moneda = 'USD' THEN COALESCE(NULLIF(c.exchange_rate, 0), 1)
            ELSE 1
          END
        ),
        2
      )
      FROM public.detalle_recepciones_compra dr
      JOIN public.recepciones_compra r ON r.id = dr.recepcion_id
      JOIN public.compras c ON c.id = r.compra_id
      WHERE dr.producto_id = v_prd_id
        AND dr.costo_unitario IS NOT NULL
    ), 9.90) INTO v_costo;

    UPDATE public.ec_capas_peps cp
    SET costo_unitario = v_costo
    WHERE cp.producto_id = v_prd_id
      AND cp.movimiento_entrada_id IS NULL
      AND cp.costo_unitario IS NULL;

    UPDATE public.ec_valoracion_estado ve
    SET valor_promedio = ROUND(ve.unidades * v_costo, 2)
    WHERE ve.producto_id = v_prd_id
      AND ve.valor_promedio IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.ec_kardex_valorizado k
        WHERE k.producto_id = ve.producto_id
          AND k.almacen_id = ve.almacen_id
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.ec_consultar_valorizacion_peps_actual_v1()
 RETURNS TABLE(producto_id uuid, almacen_id uuid, stock_fisico integer, saldo_unidades integer, saldo_peps numeric, problema text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  ), opening_layers as (
    select c.producto_id,
      c.almacen_id,
      sum(c.cantidad_restante)::integer as saldo_unidades,
      bool_or(c.costo_unitario is null) as missing_cost,
      round(sum(c.cantidad_restante * c.costo_unitario), 2) as saldo_peps
    from public.ec_capas_peps c
    join current_stock s using (producto_id, almacen_id)
    where c.cantidad_restante > 0
    group by c.producto_id, c.almacen_id
  )
  select s.producto_id,
    s.almacen_id,
    s.stock_fisico,
    coalesce(l.saldo_unidades, o.saldo_unidades),
    case
      when l.producto_id is not null and l.movimientos_ultimo_instante = 1 then l.saldo_peps
      when l.producto_id is null and o.producto_id is not null and not o.missing_cost then o.saldo_peps
      else null
    end,
    case
      when l.producto_id is not null then
        case
          when l.movimientos_ultimo_instante > 1 then 'fechas-empatadas'
          when l.saldo_unidades is distinct from s.stock_fisico then 'stock-no-coincide'
          when l.saldo_peps is null then 'sin-costo'
          else null
        end
      when o.producto_id is null then 'sin-kardex'
      when o.saldo_unidades is distinct from s.stock_fisico then 'stock-no-coincide'
      when o.missing_cost then 'sin-costo'
      else null
    end
  from current_stock s
  left join latest_snapshots l using (producto_id, almacen_id)
  left join opening_layers o using (producto_id, almacen_id)
  order by s.almacen_id, s.producto_id;
end
$function$;

CREATE OR REPLACE FUNCTION app_private._metas_logrado(p_meta uuid DEFAULT NULL::uuid)
 RETURNS TABLE(asignacion_id uuid, fecha date, valor_acumulado numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  if not (select app_private._tiene_permiso('metas', 'ver')) then
    raise exception 'Tu rol no tiene permiso para ver las metas.' using errcode = '42501';
  end if;

  return query
  with resuelta as (select * from app_private._metas_resueltas(p_meta)),
  vc as (
    select v.id,
           coalesce(
             (select vd.usuario_id
              from public.ventas_vendedor vv
              join public.vendedores vd on vd.id = vv.vendedor_id
              where vv.venta_id = v.id
              limit 1),
             v.created_by
           ) as vendedor_usuario_id,
           v.descuento,
           app_private._venta_neta_pen(v.id, v.monto, v.moneda, v.tipo_cambio) as monto,
           case when coalesce(v.monto, 0) > 0
                then app_private._venta_neta_pen(v.id, v.monto, v.moneda, v.tipo_cambio) / v.monto
                else 0 end as factor_pen,
           greatest(
             0::numeric,
             coalesce((select sum(d.cantidad)::numeric from public.detalle_ventas d where d.venta_id = v.id), 0)
             - coalesce((
                 select sum((x->>'cantidad')::numeric)
                 from public.ec_notas_credito nc
                 cross join lateral jsonb_array_elements(nc.lineas) x
                 where nc.venta_id = v.id
                   and coalesce(x->>'cantidad', '') ~ '^\d+(\.\d+)?$'
               ), 0)
           ) as unidades_netas,
           (v.created_at at time zone 'America/Lima')::date as dia,
           app_private._sucursal_de_venta(v.created_by, v.created_at, v.almacen_id) as sucursal_id
    from public.ventas v where v.estado = 'Completada'
  ),
  movimientos as (
    select r.id as asignacion_id, r.fecha_inicio as dia, 0::numeric as valor
    from resuelta r where r.ref is not null
    union all
    select r.id, vc.dia,
      case when r.indicador = 'importe' then vc.monto else vc.unidades_netas end::numeric
    from resuelta r join vc on vc.vendedor_usuario_id = r.ref
    where r.alcance = 'vendedor' and r.ref is not null and vc.dia between r.fecha_inicio and r.fecha_fin
    union all
    select r.id, vc.dia,
      case when r.indicador = 'importe' then vc.monto else vc.unidades_netas end::numeric
    from resuelta r join vc on vc.sucursal_id = r.ref
    where r.alcance = 'sucursal' and r.ref is not null and vc.dia between r.fecha_inicio and r.fecha_fin
    union all
    select r.id, vc.dia,
      case
        when r.indicador = 'importe' then
          coalesce(sum(d.subtotal), 0) * (1 - vc.descuento / 100.0) * vc.factor_pen
        else
          greatest(
            0::numeric,
            coalesce(sum(d.cantidad), 0)::numeric
            - coalesce((
                select sum((x->>'cantidad')::numeric)
                from public.ec_notas_credito nc
                cross join lateral jsonb_array_elements(nc.lineas) x
                where nc.venta_id = vc.id
                  and (x->>'producto_id') ~* '^[0-9a-f-]{36}$'
                  and (x->>'producto_id')::uuid = r.ref
                  and coalesce(x->>'cantidad', '') ~ '^\d+(\.\d+)?$'
              ), 0)
          )
      end
    from resuelta r
    join public.detalle_ventas d on d.producto_id = r.ref
    join vc on vc.id = d.venta_id
    where r.alcance = 'producto' and r.ref is not null and vc.dia between r.fecha_inicio and r.fecha_fin
    group by r.id, r.indicador, r.ref, vc.id, vc.dia, vc.descuento, vc.factor_pen
  ),
  diario as (
    select mv.asignacion_id, mv.dia, sum(mv.valor) as valor from movimientos mv group by mv.asignacion_id, mv.dia
  )
  select d.asignacion_id, d.dia, round(sum(d.valor) over (partition by d.asignacion_id order by d.dia), 2)
  from diario d
  order by d.asignacion_id, d.dia;
end
$function$;

CREATE OR REPLACE FUNCTION app_private._metas_aportes(p_meta uuid DEFAULT NULL::uuid)
 RETURNS TABLE(asignacion_id uuid, vendedor_id uuid, vendedor text, valor numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  if not (select app_private._tiene_permiso('metas', 'ver')) then
    raise exception 'Tu rol no tiene permiso para ver las metas.' using errcode = '42501';
  end if;

  return query
  with resuelta as (select * from app_private._metas_resueltas(p_meta) x where x.alcance = 'sucursal' and x.ref is not null),
  vc as (
    select v.id,
           coalesce(
             (select vd.usuario_id
              from public.ventas_vendedor vv
              join public.vendedores vd on vd.id = vv.vendedor_id
              where vv.venta_id = v.id
              limit 1),
             v.created_by
           ) as vendedor_usuario_id,
           app_private._venta_neta_pen(v.id, v.monto, v.moneda, v.tipo_cambio) as monto,
           greatest(
             0::numeric,
             coalesce((select sum(d.cantidad)::numeric from public.detalle_ventas d where d.venta_id = v.id), 0)
             - coalesce((
                 select sum((x->>'cantidad')::numeric)
                 from public.ec_notas_credito nc
                 cross join lateral jsonb_array_elements(nc.lineas) x
                 where nc.venta_id = v.id
                   and coalesce(x->>'cantidad', '') ~ '^\d+(\.\d+)?$'
               ), 0)
           ) as unidades_netas,
           (v.created_at at time zone 'America/Lima')::date as dia,
           app_private._sucursal_de_venta(v.created_by, v.created_at, v.almacen_id) as sucursal_id
    from public.ventas v where v.estado = 'Completada'
  )
  select r.id, vc.vendedor_usuario_id, coalesce(u.nombre, 'Sin vendedor'),
         round(sum(case when r.indicador = 'importe' then vc.monto else vc.unidades_netas end), 2)
  from resuelta r
  join vc on vc.sucursal_id = r.ref and vc.dia between r.fecha_inicio and r.fecha_fin
  left join public.usuarios u on u.id = vc.vendedor_usuario_id
  group by r.id, vc.vendedor_usuario_id, u.nombre
  order by r.id, 4 desc;
end
$function$;

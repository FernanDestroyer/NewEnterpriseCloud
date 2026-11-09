-- Integration fixes: security hardening of trigger functions and net PEN amounts
-- (USD converted with the sale exchange rate, credit notes deducted) for
-- commissions and sales goals.
--
-- Amounts in public.ventas and public.ec_notas_credito are stored in the sale
-- currency (ventas.moneda). Commission and goal targets are expressed in PEN.

-- 1. Trigger functions must not be callable as RPC endpoints.
revoke all on function public.ec_proteger_reservas() from public, anon, authenticated;
revoke all on function public.ec_serializar_stock_producto() from public, anon, authenticated;

-- 2. Net sale amount in PEN: (monto - credit notes) * exchange rate.
create or replace function app_private._venta_neta_pen(p_venta_id uuid, p_monto numeric, p_moneda text, p_tipo_cambio numeric)
returns numeric
language sql
stable
security definer
set search_path to ''
as $function$
  select greatest(0, coalesce(p_monto, 0) - coalesce((
           select sum(nc.total) from public.ec_notas_credito nc where nc.venta_id = p_venta_id
         ), 0))
         * case when upper(coalesce(p_moneda, 'PEN')) = 'USD' then coalesce(nullif(p_tipo_cambio, 0), 1) else 1 end;
$function$;

revoke all on function app_private._venta_neta_pen(uuid, numeric, text, numeric) from public, anon, authenticated;

-- 3. Commissions: same logic as before, summing net PEN amounts.
create or replace function public.calcular_comisiones(p_desde date, p_hasta date)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_regla public.reglas_comision%rowtype;
  v_count integer := 0;
  v_row record;
  v_rate numeric(7,4);
  v_amount numeric(14,2);
begin
  if (select auth.uid()) is null
     or not (select public.tiene_permiso('ventas','editar')) then
    raise exception 'Se requiere permiso de edición de Ventas para calcular comisiones.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'El período de cálculo no es válido.' using errcode = '22023';
  end if;
  select * into v_regla from public.reglas_comision
  where activa and vigente_desde <= p_hasta
    and (vigente_hasta is null or vigente_hasta >= p_desde)
  order by vigente_desde desc limit 1;
  if not found then
    raise exception 'Crea y activa una regla de comisión vigente antes de calcular.' using errcode = '23514';
  end if;

  -- Recálculo: retira las liquidaciones 'calculada' que ya no aplican al período.
  delete from public.liquidaciones_comision as l
  where l.estado = 'calculada'
    and l.periodo_desde = p_desde and l.periodo_hasta = p_hasta
    and not exists (
      select 1
      from public.ventas_vendedor vv
      join public.ventas v on v.id = vv.venta_id
      where vv.vendedor_id = l.vendedor_id
        and v.estado = 'Completada'
        and timezone('America/Lima', v.created_at)::date between p_desde and p_hasta
    );

  for v_row in
    select vv.vendedor_id,
           coalesce(sum(app_private._venta_neta_pen(v.id, v.monto, v.moneda, v.tipo_cambio)), 0)::numeric(14,2) as ventas
    from public.ventas_vendedor vv
    join public.ventas v on v.id = vv.venta_id
    where v.estado = 'Completada'
      and timezone('America/Lima', v.created_at)::date between p_desde and p_hasta
    group by vv.vendedor_id
  loop
    v_rate := null;
    select e.porcentaje into v_rate from public.excepciones_comision e
    where e.vendedor_id = v_row.vendedor_id and e.activa
      and e.vigente_desde <= p_hasta
      and (e.vigente_hasta is null or e.vigente_hasta >= p_desde)
    order by e.vigente_desde desc limit 1;
    if v_rate is null then
      select s.porcentaje into v_rate from public.escalas_comision s
      where s.regla_id = v_regla.id
        and v_row.ventas >= s.desde_ventas
        and (s.hasta_ventas is null or v_row.ventas < s.hasta_ventas)
      order by s.desde_ventas desc limit 1;
    end if;
    v_rate := coalesce(v_rate, v_regla.porcentaje);
    v_amount := round(v_row.ventas * v_rate / 100, 2);
    insert into public.liquidaciones_comision
      (vendedor_id, periodo_desde, periodo_hasta, ventas_netas, comision_calculada, estado, created_by)
    values
      (v_row.vendedor_id, p_desde, p_hasta, v_row.ventas, v_amount, 'calculada', (select auth.uid()))
    on conflict (vendedor_id, periodo_desde, periodo_hasta) do update
      set ventas_netas = excluded.ventas_netas,
          comision_calculada = excluded.comision_calculada,
          updated_at = now()
      where public.liquidaciones_comision.estado = 'calculada';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

-- 4. Goals progress: amounts in net PEN.
create or replace function app_private._metas_logrado(p_meta uuid default null::uuid)
returns table(asignacion_id uuid, fecha date, valor_acumulado numeric)
language plpgsql
stable security definer
set search_path to ''
as $function$
#variable_conflict use_column
begin
  if not (select app_private._tiene_permiso('metas', 'ver')) then
    raise exception 'Tu rol no tiene permiso para ver las metas.' using errcode = '42501';
  end if;

  return query
  with resuelta as (select * from app_private._metas_resueltas(p_meta)),
  vc as (
    select v.id, v.created_by, v.descuento,
           app_private._venta_neta_pen(v.id, v.monto, v.moneda, v.tipo_cambio) as monto,
           case when coalesce(v.monto, 0) > 0
                then app_private._venta_neta_pen(v.id, v.monto, v.moneda, v.tipo_cambio) / v.monto
                else 0 end as factor_pen,
           (v.created_at at time zone 'America/Lima')::date as dia,
           app_private._sucursal_de_venta(v.created_by, v.created_at, v.almacen_id) as sucursal_id
    from public.ventas v where v.estado = 'Completada'
  ),
  movimientos as (
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
      case when r.indicador = 'importe' then d.subtotal * (1 - vc.descuento / 100.0) * vc.factor_pen else d.cantidad::numeric end
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

-- 5. Goals contribution per seller: amounts in net PEN.
create or replace function app_private._metas_aportes(p_meta uuid default null::uuid)
returns table(asignacion_id uuid, vendedor_id uuid, vendedor text, valor numeric)
language plpgsql
stable security definer
set search_path to ''
as $function$
#variable_conflict use_column
begin
  if not (select app_private._tiene_permiso('metas', 'ver')) then
    raise exception 'Tu rol no tiene permiso para ver las metas.' using errcode = '42501';
  end if;

  return query
  with resuelta as (select * from app_private._metas_resueltas(p_meta) x where x.alcance = 'sucursal' and x.ref is not null),
  vc as (
    select v.id, v.created_by,
           app_private._venta_neta_pen(v.id, v.monto, v.moneda, v.tipo_cambio) as monto,
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

-- 6. Synchronize public.ventas.estado on full credit note (ec_nota_credito).
create or replace function public.ec_nota_credito(p_pedido_id uuid, p_lineas jsonb, p_motivo text, p_devolver_stock boolean, p_key text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order public.ec_pedidos%rowtype;
  v_old public.ec_notas_credito%rowtype;
  v_line jsonb;
  v_original jsonb;
  v_qty integer;
  v_prior integer;
  v_delivered integer;
  v_total numeric := 0;
  v_paid numeric;
  v_account public.pagos%rowtype;
  v_id uuid;
  v_hash text;
begin
  if auth.uid() is null or not public.tiene_permiso('ventas','editar') or not public.tiene_permiso('finanzas','editar') then
    raise exception 'Se requieren permisos de Ventas y Finanzas.' using errcode = '42501';
  end if;
  if p_devolver_stock and not (public.tiene_permiso('inventario','crear') or public.tiene_permiso('inventario','editar')) then
    raise exception 'Se requiere permiso de inventario.' using errcode = '42501';
  end if;
  if nullif(trim(p_key),'') is null or length(trim(coalesce(p_motivo,''))) < 5 or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Motivo, líneas y clave obligatorios.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_lineas) x group by x->>'producto_id' having count(*) > 1) then
    raise exception 'Producto duplicado.';
  end if;
  v_hash := md5(jsonb_build_object('pedido',p_pedido_id,'lineas',p_lineas,'motivo',trim(p_motivo),'stock',p_devolver_stock)::text);
  perform pg_advisory_xact_lock(hashtextextended('ec:credit:'||p_key,0));
  select * into v_old from public.ec_notas_credito where idempotency_key = p_key;
  if found then
    if v_old.payload_hash <> v_hash then raise exception 'Clave reutilizada.' using errcode = '23505'; end if;
    return v_old.id;
  end if;
  select * into v_order from public.ec_pedidos where id = p_pedido_id for update;
  if not found or v_order.venta_id is null or v_order.estado <> 'despachado' then
    raise exception 'La nota requiere pedido facturado y despachado; no se acreditan reservas pendientes de envío.';
  end if;
  if p_devolver_stock and v_order.estado <> 'despachado' then
    raise exception 'No se devuelve stock sin salida oficial por guía.';
  end if;
  select * into v_account from public.pagos where venta_id = v_order.venta_id and tipo = 'cobrar' for update;
  if not found then raise exception 'CxC no encontrada.'; end if;
  for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'producto_id' loop
    v_qty := (v_line->>'cantidad')::integer;
    select value into v_original from jsonb_array_elements(v_order.lineas) where value->>'producto_id' = v_line->>'producto_id';
    if v_original is null or v_qty is null or v_qty <= 0 then raise exception 'Línea o cantidad inválida.'; end if;
    select coalesce(sum((x->>'cantidad')::integer),0) into v_prior
    from public.ec_notas_credito n cross join lateral jsonb_array_elements(n.lineas) x
    where n.pedido_id = p_pedido_id and x->>'producto_id' = v_line->>'producto_id';
    if v_prior + v_qty > (v_original->>'cantidad')::integer then raise exception 'Nota de crédito supera lo vendido.'; end if;
    if p_devolver_stock then
      select entregado into v_delivered from public.ec_reservas where pedido_id = p_pedido_id and producto_id = (v_line->>'producto_id')::uuid;
      if v_prior + v_qty > v_delivered then raise exception 'Devolución supera lo despachado.'; end if;
      perform pg_advisory_xact_lock(hashtextextended('ec:stock:'||v_order.almacen_id::text||':'||(v_line->>'producto_id'),0));
    end if;
    v_total := v_total + case
      when v_prior + v_qty = (v_original->>'cantidad')::integer then
        (v_original->>'total')::numeric - coalesce((
          select sum(round((x->>'cantidad')::integer * (v_original->>'precio')::numeric, 2))
          from public.ec_notas_credito n cross join lateral jsonb_array_elements(n.lineas) x
          where n.pedido_id = p_pedido_id and x->>'producto_id' = v_line->>'producto_id'
        ), 0)
      else round(v_qty * (v_original->>'precio')::numeric, 2)
    end;
  end loop;
  select coalesce(sum(a.monto),0) into v_paid
  from public.aplicaciones_pago a
  join public.movimientos_tesoreria m on m.id = a.movimiento_id
  where a.cuenta_id = v_account.id and m.anulado_en is null;
  if v_total <= 0 or v_total > v_account.monto - v_paid then
    raise exception 'La nota excede la CxC no cobrada. Registra primero el reembolso de los cobros existentes.';
  end if;
  insert into public.ec_notas_credito(pedido_id,venta_id,motivo,lineas,total,idempotency_key,payload_hash)
  values(p_pedido_id,v_order.venta_id,trim(p_motivo),p_lineas,v_total,p_key,v_hash)
  returning id into v_id;
  update public.pagos
  set monto = monto - v_total,
      estado = case when monto - v_total = v_paid then 'Completada' else 'Pendiente' end,
      estado_cobro = case when monto - v_total = v_paid then 'completa' when v_paid > 0 then 'parcial' else 'pendiente' end
  where id = v_account.id;
  -- If the entire receivable was credited without prior cash collections, mark the sale as Cancelada.
  if v_account.monto - v_total <= 0 and v_paid = 0 then
    update public.ventas set estado = 'Cancelada' where id = v_order.venta_id;
  elsif v_account.monto - v_total = v_paid and v_paid > 0 then
    update public.ventas set estado = 'Completada' where id = v_order.venta_id;
  end if;
  if p_devolver_stock then
    for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'producto_id' loop
      perform public.registrar_movimiento_inventario((v_line->>'producto_id')::uuid,v_order.almacen_id,'entrada',(v_line->>'cantidad')::integer,'Devolución NC '||v_id::text,'ec:nc:'||v_id::text||':'||(v_line->>'producto_id'),'nota_credito',v_id,trim(p_motivo));
    end loop;
  end if;
  return v_id;
end
$function$;

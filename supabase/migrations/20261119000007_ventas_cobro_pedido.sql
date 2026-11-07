-- Cobro de ventas desde el módulo de Ventas.
-- La facturación de pedidos crea la CxC; esta RPC registra el abono en Tesorería
-- reutilizando registrar_pago_parcial_en_turno (idempotencia, turno de caja y
-- actualización de saldos). Tarjeta conserva la semántica heredada: consume la
-- línea de crédito y deja la CxC pendiente, sin movimiento de efectivo.

create or replace function public.ec_registrar_cobro_venta(
  p_venta_id uuid,
  p_medio_pago text,
  p_caja_turno_id uuid,
  p_key text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_sale public.ventas%rowtype;
  v_account public.pagos%rowtype;
  v_method text := nullif(trim(p_medio_pago),'');
  v_paid numeric(14,2);
  v_pending numeric(14,2);
begin
  if auth.uid() is null or not public.tiene_permiso('finanzas','crear') then
    raise exception 'Se requiere permiso de Finanzas para registrar el cobro.' using errcode='42501';
  end if;
  if p_venta_id is null or v_method is null or nullif(trim(p_key),'') is null then
    raise exception 'Venta, medio de pago y clave son obligatorios.' using errcode='22023';
  end if;
  select * into v_sale from public.ventas where id=p_venta_id for update;
  if not found then raise exception 'La venta no existe.' using errcode='23503'; end if;
  select * into v_account from public.pagos
    where venta_id=p_venta_id and tipo='cobrar'
    order by id limit 1 for update;
  if not found then raise exception 'La venta no tiene cuenta por cobrar.' using errcode='23503'; end if;

  -- Tarjeta: el documento queda completado y la CxC permanece como crédito.
  if lower(v_method)='tarjeta' then
    update public.ventas set medio_pago=v_method, estado='Completada' where id=p_venta_id;
    update public.pagos set medio_pago=v_method where id=v_account.id;
    return p_venta_id;
  end if;

  select coalesce(sum(a.monto),0)::numeric(14,2) into v_paid
    from public.aplicaciones_pago a
    join public.movimientos_tesoreria m on m.id=a.movimiento_id
   where a.cuenta_id=v_account.id and m.anulado_en is null;
  v_pending := round(v_account.monto - v_paid, 2);

  -- Si ya estaba cobrada, no se crea otro movimiento; se sincroniza el estado.
  if v_pending <= 0 then
    update public.ventas set medio_pago=v_method,
      estado=case when v_account.estado='Completada' then 'Completada' else 'Pendiente' end
     where id=p_venta_id;
    update public.pagos set medio_pago=v_method where id=v_account.id;
    return p_venta_id;
  end if;

  perform public.registrar_pago_parcial_en_turno(
    'cobro', v_pending, v_method,
    'Venta '||v_sale.codigo||' · '||v_sale.moneda||' '||v_sale.monto,
    jsonb_build_array(jsonb_build_object('cuenta_id',v_account.id,'monto',v_pending)),
    p_key, 'Cobro de venta desde Ventas', p_caja_turno_id
  );

  update public.pagos set medio_pago=v_method where id=v_account.id;
  update public.ventas set medio_pago=v_method,
    estado=case when exists(select 1 from public.pagos where id=v_account.id and estado='Completada') then 'Completada' else 'Pendiente' end
   where id=p_venta_id;
  return p_venta_id;
end $$;

revoke all on function public.ec_registrar_cobro_venta(uuid,text,uuid,text) from public,anon;
grant execute on function public.ec_registrar_cobro_venta(uuid,text,uuid,text) to authenticated;

-- Facturar y cobrar en una sola transacción. Si el cobro falla (por ejemplo,
-- efectivo sin turno abierto), la factura también se revierte y el pedido sigue
-- reservado, evitando comprobantes con cobros a medias.
create or replace function public.ec_facturar_pedido_pago(
  p_pedido_id uuid,
  p_tipo text,
  p_serie text,
  p_numero integer,
  p_medio_pago text,
  p_caja_turno_id uuid,
  p_key text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_sale uuid;
  v_method text := nullif(trim(p_medio_pago),'');
begin
  v_sale := public.ec_facturar_pedido(p_pedido_id,p_tipo,p_serie,p_numero,p_key);
  if v_method is not null then
    perform public.ec_registrar_cobro_venta(v_sale,v_method,p_caja_turno_id,'ec:'||p_key||':cobro');
  end if;
  return v_sale;
end $$;

revoke all on function public.ec_facturar_pedido_pago(uuid,text,text,integer,text,uuid,text) from public,anon;
grant execute on function public.ec_facturar_pedido_pago(uuid,text,text,integer,text,uuid,text) to authenticated;

notify pgrst, 'reload schema';

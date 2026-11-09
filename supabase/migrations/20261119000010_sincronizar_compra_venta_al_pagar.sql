-- Sincronizar estado de compras y ventas al completar su pago/cobro en Tesoreria

create or replace function public.registrar_pago_parcial(
  p_tipo text,
  p_monto numeric,
  p_medio_pago text,
  p_referencia text,
  p_aplicaciones jsonb,
  p_idempotency_key text,
  p_nota text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_hash text;
  v_mov uuid;
  v_old public.movimientos_tesoreria%rowtype;
  v_line jsonb;
  v_cuenta uuid;
  v_aplicar numeric(14,2);
  v_tipo_cuenta text;
  v_obligacion numeric(14,2);
  v_total_aplicado numeric(14,2);
  v_total numeric(14,2) := 0;
  v_compra_id uuid;
  v_venta_id uuid;
begin
  if v_uid is null or not (select public.tiene_permiso('finanzas','crear')) then
    raise exception 'Se requiere permiso para registrar cobros y pagos.' using errcode = '42501';
  end if;
  if p_tipo not in ('cobro','pago') or p_monto is null or p_monto <= 0 or jsonb_typeof(p_aplicaciones) <> 'array' or jsonb_array_length(p_aplicaciones) = 0 then
    raise exception 'El movimiento o sus aplicaciones no son válidos.' using errcode = '22023';
  end if;
  if nullif(trim(p_idempotency_key),'') is null then
    raise exception 'Falta la clave de idempotencia.' using errcode = '22023';
  end if;
  if (select count(*) from (select value->>'cuenta_id' from jsonb_array_elements(p_aplicaciones) group by value->>'cuenta_id') x) <> jsonb_array_length(p_aplicaciones) then
    raise exception 'Cada cuenta solo puede aparecer una vez por movimiento.' using errcode = '22023';
  end if;

  v_hash := md5(concat_ws('|', p_tipo, p_monto, coalesce(p_medio_pago,''), coalesce(p_referencia,''), p_aplicaciones::text, coalesce(p_nota,'')));
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
  select * into v_old from public.movimientos_tesoreria where idempotency_key = p_idempotency_key;
  if found then
    if v_old.payload_hash <> v_hash then
      raise exception 'La clave ya pertenece a otro movimiento.' using errcode = '23505';
    end if;
    return v_old.id;
  end if;

  for v_line in select value from jsonb_array_elements(p_aplicaciones) order by value->>'cuenta_id' loop
    v_cuenta := (v_line->>'cuenta_id')::uuid;
    v_aplicar := round((v_line->>'monto')::numeric, 2);
    if v_aplicar is null or v_aplicar <= 0 then
      raise exception 'Cada aplicación debe ser mayor que cero.' using errcode = '22023';
    end if;
    select tipo, monto into v_tipo_cuenta, v_obligacion from public.pagos where id = v_cuenta for update;
    if not found then
      raise exception 'La cuenta no existe.' using errcode = '23503';
    end if;
    if (p_tipo = 'cobro' and v_tipo_cuenta <> 'cobrar') or (p_tipo = 'pago' and v_tipo_cuenta <> 'pagar') then
      raise exception 'El movimiento no coincide con el tipo de cuenta.' using errcode = '23514';
    end if;
    select coalesce(sum(a.monto), 0)::numeric(14,2) into v_total_aplicado
    from public.aplicaciones_pago a
    join public.movimientos_tesoreria m on m.id = a.movimiento_id
    where a.cuenta_id = v_cuenta and m.anulado_en is null;
    if v_aplicar > v_obligacion - v_total_aplicado then
      raise exception 'La aplicación excede el saldo pendiente.' using errcode = '23514';
    end if;
    v_total := v_total + v_aplicar;
  end loop;

  if round(v_total, 2) <> round(p_monto, 2) then
    raise exception 'Las aplicaciones deben sumar el importe del movimiento.' using errcode = '23514';
  end if;

  insert into public.movimientos_tesoreria(codigo, tipo, monto, medio_pago, referencia, nota, idempotency_key, payload_hash, created_by)
  values('', p_tipo, round(p_monto, 2), nullif(trim(p_medio_pago),''), nullif(trim(p_referencia),''), nullif(trim(p_nota),''), p_idempotency_key, v_hash, v_uid)
  returning id into v_mov;

  for v_line in select value from jsonb_array_elements(p_aplicaciones) order by value->>'cuenta_id' loop
    v_cuenta := (v_line->>'cuenta_id')::uuid;
    v_aplicar := round((v_line->>'monto')::numeric, 2);
    insert into public.aplicaciones_pago(movimiento_id, cuenta_id, monto) values(v_mov, v_cuenta, v_aplicar);
    select monto, compra_id, venta_id into v_obligacion, v_compra_id, v_venta_id from public.pagos where id = v_cuenta;
    select coalesce(sum(a.monto), 0)::numeric(14,2) into v_total_aplicado
    from public.aplicaciones_pago a
    join public.movimientos_tesoreria m on m.id = a.movimiento_id
    where a.cuenta_id = v_cuenta and m.anulado_en is null;

    update public.pagos
    set estado_cobro = case when v_total_aplicado >= v_obligacion then 'completa' when v_total_aplicado > 0 then 'parcial' else 'pendiente' end,
        estado = case when v_total_aplicado >= v_obligacion then 'Completada' else 'Pendiente' end
    where id = v_cuenta;

    -- Sincronizar estado de compra si la obligación quedó totalmente pagada y la mercadería está recibida
    if v_total_aplicado >= v_obligacion and v_compra_id is not null then
      update public.compras
      set estado = 'Pagada'
      where id = v_compra_id
        and (estado_recepcion = 'completa' or requiere_recepcion = false)
        and estado::text not in ('Cancelada', 'Rechazada', 'Pagada');
    end if;

    -- Sincronizar estado de venta si la obligación quedó totalmente cobrada
    if v_total_aplicado >= v_obligacion and v_venta_id is not null then
      update public.ventas
      set estado = 'Completada'
      where id = v_venta_id
        and estado::text not in ('Cancelada', 'Rechazada', 'Completada');
    end if;
  end loop;

  return v_mov;
end
$function$;

-- Actualizar recepciones de compra para que si se completan y ya estaban pagadas, pasen a 'Pagada'
create or replace function app_private._registrar_recepcion_compra_v2(
  p_compra_id uuid,
  p_almacen_id uuid,
  p_lineas jsonb,
  p_idempotency_key text,
  p_comprobante_tipo text default null::text,
  p_comprobante_numero text default null::text,
  p_referencia text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_hash text;
  v_recepcion uuid;
  v_old public.recepciones_compra%rowtype;
  v_line jsonb;
  v_dc public.detalle_compras%rowtype;
  v_detalle_id uuid;
  v_producto uuid;
  v_cantidad integer;
  v_costo_unitario numeric(18,6);
  v_movimiento_id uuid;
  v_recibido integer;
  v_pendiente boolean;
  v_compra public.compras%rowtype;
  v_pago_id uuid;
  v_monto_recibido numeric(14,2);
  v_monto_aplicado numeric(14,2);
begin
  if v_uid is null or not (select public.tiene_permiso('compras','editar')) then
    raise exception 'Se requiere permiso para editar compras.' using errcode = '42501';
  end if;
  if not ((select public.tiene_permiso('inventario','crear')) or (select public.tiene_permiso('inventario','editar'))) then
    raise exception 'Se requiere permiso de ingreso a inventario.' using errcode = '42501';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 or nullif(trim(p_idempotency_key),'') is null then
    raise exception 'La recepción requiere líneas y clave de idempotencia.' using errcode = '22023';
  end if;
  if (select count(*) from (select value->>'detalle_compra_id' from jsonb_array_elements(p_lineas) group by value->>'detalle_compra_id') x) <> jsonb_array_length(p_lineas) then
    raise exception 'Cada línea de compra solo puede aparecer una vez por recepción.' using errcode = '22023';
  end if;
  v_hash := md5(concat_ws('|',p_compra_id,p_almacen_id,p_lineas::text,coalesce(p_comprobante_tipo,''),coalesce(p_comprobante_numero,''),coalesce(p_referencia,'')));
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
  select * into v_old from public.recepciones_compra where idempotency_key = p_idempotency_key;
  if found then
    if v_old.payload_hash <> v_hash then raise exception 'La clave ya pertenece a otra recepción.' using errcode = '23505'; end if;
    return v_old.id;
  end if;
  select * into v_compra from public.compras where id = p_compra_id for update;
  if not found then raise exception 'La compra no existe.' using errcode = '23503'; end if;
  if v_compra.estado::text not in ('Pendiente','En curso','Orden','Recepción','Factura','Pagada','Confirmada','Confirmado') then
    raise exception 'La orden no está activa o confirmada y no admite recepción.' using errcode = '23514';
  end if;
  if not exists(select 1 from public.almacenes where id = p_almacen_id and activo) then
    raise exception 'Selecciona un almacén activo.' using errcode = '23503';
  end if;
  insert into public.recepciones_compra(codigo,compra_id,almacen_id,comprobante_tipo,comprobante_numero,referencia,idempotency_key,payload_hash,recibido_por)
  values('',p_compra_id,p_almacen_id,nullif(trim(p_comprobante_tipo),''),nullif(trim(p_comprobante_numero),''),nullif(trim(p_referencia),''),p_idempotency_key,v_hash,v_uid)
  returning id into v_recepcion;
  for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'detalle_compra_id' loop
    v_detalle_id := (v_line->>'detalle_compra_id')::uuid;
    v_cantidad := (v_line->>'cantidad')::integer;
    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'La cantidad recibida debe ser mayor que cero.' using errcode = '22023';
    end if;
    select * into v_dc from public.detalle_compras where id = v_detalle_id and compra_id = p_compra_id for update;
    if not found then raise exception 'Una línea no pertenece a esta orden.' using errcode = '23503'; end if;
    select coalesce(sum(dr.cantidad),0)::integer into v_recibido
    from public.detalle_recepciones_compra dr
    join public.recepciones_compra r on r.id = dr.recepcion_id
    where dr.detalle_compra_id = v_dc.id and r.id <> v_recepcion;
    if nullif(v_line->>'devolucion_detalle_id','') is not null then
      perform app_private._validar_reposicion_devolucion_compra_v1(p_compra_id,v_dc.id,(v_line->>'devolucion_detalle_id')::uuid,v_cantidad);
    elsif v_recibido + v_cantidad > v_dc.cantidad then
      raise exception 'La recepción excede la cantidad ordenada.' using errcode = '23514';
    end if;
    select producto_id into v_producto from public.proveedor_productos where id = v_dc.proveedor_producto_id;
    if v_producto is null then
      raise exception 'Vincula primero el artículo del proveedor con un producto maestro.' using errcode = '23514';
    end if;
    v_costo_unitario := v_dc.costo_unitario;
    if current_setting('app.ec_import_nationalize_rpc',true) = 'on' then
      if nullif(v_line->>'costo_unitario_real','') is null then
        raise exception 'Falta costo real de importación en la línea recibida.' using errcode = '22023';
      end if;
      v_costo_unitario := (v_line->>'costo_unitario_real')::numeric;
      if v_costo_unitario < 0 or v_costo_unitario::text in ('NaN','Infinity','-Infinity') then
        raise exception 'Costo real de importación inválido.' using errcode = '22023';
      end if;
    end if;
    insert into public.detalle_recepciones_compra(recepcion_id,detalle_compra_id,producto_id,cantidad,costo_unitario,reposicion_devolucion_detalle_id)
    values(v_recepcion,v_dc.id,v_producto,v_cantidad,v_costo_unitario,nullif(v_line->>'devolucion_detalle_id','')::uuid);
    v_movimiento_id := public.registrar_movimiento_inventario(v_producto,p_almacen_id,'entrada',v_cantidad,'Recepción '||v_recepcion::text,p_idempotency_key||':'||v_dc.id::text,'recepcion_compra',v_recepcion,'Recepción de compra nacional');
    if current_setting('app.ec_import_nationalize_rpc',true) = 'on' then
      update public.movimientos_inventario set costo_unitario = v_costo_unitario where id = v_movimiento_id;
    end if;
  end loop;
  select exists(
    select 1 from public.detalle_compras dc
    where dc.compra_id = p_compra_id
      and (select coalesce(sum(dr.cantidad),0) from public.detalle_recepciones_compra dr where dr.detalle_compra_id = dc.id) < dc.cantidad
  ) into v_pendiente;
  update public.compras set estado_recepcion = case when v_pendiente then 'parcial' else 'completa' end where id = p_compra_id;

  -- Si la recepción se completó y la orden ya estaba totalmente pagada, actualizar a 'Pagada'
  if not v_pendiente and exists (
    select 1 from public.pagos p
    where p.compra_id = p_compra_id
      and p.tipo = 'pagar'
      and p.estado_cobro = 'completa'
  ) then
    update public.compras
    set estado = 'Pagada'
    where id = p_compra_id
      and estado::text not in ('Cancelada', 'Rechazada', 'Pagada');
  end if;

  if p_comprobante_tipo is not null or p_comprobante_numero is not null then
    update public.compras
    set comprobante_tipo = coalesce(nullif(trim(p_comprobante_tipo),''),comprobante_tipo),
        comprobante_numero = coalesce(nullif(trim(p_comprobante_numero),''),comprobante_numero)
    where id = p_compra_id;
  end if;

  -- La obligación financiera se reconoce por lo recibido (acumulado, parciales incluidos).
  select round(coalesce(sum(dr.cantidad * dr.costo_unitario),0) * 1.18, 2) into v_monto_recibido
  from public.detalle_recepciones_compra dr
  join public.recepciones_compra r on r.id = dr.recepcion_id
  where r.compra_id = p_compra_id;
  select id into v_pago_id from public.pagos where compra_id = p_compra_id and tipo = 'pagar' order by created_at, id limit 1 for update;
  if v_pago_id is null then
    insert into public.pagos(contraparte,detalle,monto,estado,tipo,compra_id,fecha_vencimiento,estado_cobro,created_by,moneda,exchange_rate)
    values(v_compra.proveedor_nombre,'Cuenta por pagar · '||v_compra.codigo,v_monto_recibido,'Pendiente','pagar',p_compra_id,v_compra.fecha_limite,'pendiente',v_uid,coalesce(v_compra.moneda,'PEN'),coalesce(v_compra.exchange_rate,1));
  else
    select coalesce(sum(ap.monto),0) into v_monto_aplicado from public.aplicaciones_pago ap where ap.cuenta_id = v_pago_id;
    update public.pagos set monto = greatest(v_monto_recibido,v_monto_aplicado), updated_at = now() where id = v_pago_id;
  end if;
  return v_recepcion;
end
$function$;

-- Backfill de órdenes de compra recibidas y pagadas en Tesorería
update public.compras c
set estado = 'Pagada'
where c.estado = 'Pendiente'
  and (c.estado_recepcion = 'completa' or c.requiere_recepcion = false)
  and exists (
    select 1 from public.pagos p
    where p.compra_id = c.id
      and p.tipo = 'pagar'
      and p.estado_cobro = 'completa'
  );

-- Backfill de ventas cobradas totalmente en Tesorería
update public.ventas v
set estado = 'Completada'
where v.estado = 'Pendiente'
  and exists (
    select 1 from public.pagos p
    where p.venta_id = v.id
      and p.tipo = 'cobrar'
      and p.estado_cobro = 'completa'
  );

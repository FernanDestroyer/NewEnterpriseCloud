-- Venta transaccional: documento, líneas, salida de almacén, CxC y cobro
-- inmediato se confirman juntos. La caja queda enlazada a su turno abierto.
alter table public.ventas add column if not exists idempotency_key text;
alter table public.ventas add column if not exists payload_hash text;
create unique index if not exists ventas_idempotency_uidx on public.ventas(idempotency_key) where idempotency_key is not null;
alter table public.movimientos_tesoreria add column if not exists caja_turno_id uuid references public.caja_turnos(id) on delete restrict;
create index if not exists movimientos_tesoreria_turno_idx on public.movimientos_tesoreria(caja_turno_id,created_at desc);

create or replace function public.registrar_pago_parcial_en_turno(
  p_tipo text,p_monto numeric,p_medio_pago text,p_referencia text,
  p_aplicaciones jsonb,p_idempotency_key text,p_nota text default null,p_caja_turno_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_mov uuid; v_old_turno uuid;
begin
  select id,caja_turno_id into v_mov,v_old_turno from public.movimientos_tesoreria where idempotency_key=p_idempotency_key;
  if found then
    v_mov:=public.registrar_pago_parcial(p_tipo,p_monto,p_medio_pago,p_referencia,p_aplicaciones,p_idempotency_key,p_nota);
    if v_old_turno is distinct from p_caja_turno_id then raise exception 'La clave ya se registró en otro turno de caja.' using errcode='23505'; end if;
    return v_mov;
  end if;
  if lower(trim(coalesce(p_medio_pago,'')))='efectivo' then
    if p_caja_turno_id is null or not exists(select 1 from public.caja_turnos where id=p_caja_turno_id and estado='Abierto') then
      raise exception 'Abre un turno de caja para registrar efectivo.' using errcode='23514';
    end if;
  elsif p_caja_turno_id is not null and not exists(select 1 from public.caja_turnos where id=p_caja_turno_id and estado='Abierto') then
    raise exception 'El turno de caja no existe o ya está cerrado.' using errcode='23514';
  end if;
  v_mov:=public.registrar_pago_parcial(p_tipo,p_monto,p_medio_pago,p_referencia,p_aplicaciones,p_idempotency_key,p_nota);
  update public.movimientos_tesoreria set caja_turno_id=p_caja_turno_id where id=v_mov;
  return v_mov;
end $$;

create or replace function public.registrar_venta_operativa(
  p_cliente_id uuid,p_cliente_nombre text,p_detalle text,p_estado text,p_monto_manual numeric,
  p_descuento numeric,p_medio_pago text,p_almacen_id uuid,p_lineas jsonb,
  p_idempotency_key text,p_caja_turno_id uuid default null,p_cotizacion_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_key text:=nullif(trim(p_idempotency_key),'');
  v_hash text; v_old public.ventas%rowtype; v_sale uuid; v_codigo text; v_pago uuid;
  v_line jsonb; v_producto uuid; v_cantidad integer; v_precio numeric(14,2);
  v_subtotal numeric(14,2):=0; v_total numeric(14,2); v_descuento numeric(5,2);
  v_nombre text:=trim(coalesce(p_cliente_nombre,'')); v_detalle text:=trim(coalesce(p_detalle,''));
  v_estado text:=coalesce(p_estado,'Pendiente'); v_medio text:=nullif(trim(p_medio_pago),'');
  v_cliente uuid:=p_cliente_id; v_almacen uuid:=p_almacen_id; v_lineas jsonb:=coalesce(p_lineas,'[]'::jsonb);
  v_quote public.cotizaciones%rowtype; v_quote_code text;
begin
  if v_uid is null or not (select public.tiene_permiso('ventas','crear')) then raise exception 'Se requiere permiso para crear ventas.' using errcode='42501'; end if;
  if not (select public.tiene_permiso('finanzas','crear')) then raise exception 'Se requiere permiso para crear la cuenta financiera.' using errcode='42501'; end if;
  if p_cotizacion_id is not null then
    if not (select public.tiene_permiso('cotizaciones','editar')) then raise exception 'Se requiere permiso para actualizar cotizaciones.' using errcode='42501'; end if;
    select * into v_quote from public.cotizaciones where id=p_cotizacion_id for update;
    if not found then raise exception 'La cotización no existe.' using errcode='23503'; end if;
    v_quote_code:=v_quote.codigo;
    v_cliente:=v_quote.cliente_id; v_nombre:=v_quote.cliente_nombre;
    v_detalle:='Convertida de '||v_quote.codigo||case when nullif(v_quote.detalle,'') is null then '' else ' · '||v_quote.detalle end;
    v_estado:='Pendiente'; v_medio:=null; v_descuento:=0;
    select coalesce(jsonb_agg(jsonb_build_object('producto_id',dc.producto_id,'cantidad',dc.cantidad,'precio',dc.precio_unitario) order by dc.id),'[]'::jsonb)
      into v_lineas from public.detalle_cotizaciones dc where dc.cotizacion_id=p_cotizacion_id;
  else
    v_descuento:=least(100,greatest(0,coalesce(p_descuento,0)));
    v_descuento:=round(v_descuento,2);
  end if;
  if v_key is null then raise exception 'Falta la clave de idempotencia de la venta.' using errcode='22023'; end if;
  if v_estado not in ('Pendiente','En curso','Completada') then raise exception 'El estado inicial de la venta no es válido.' using errcode='22023'; end if;
  if v_nombre='' then raise exception 'Selecciona o escribe el cliente.' using errcode='22023'; end if;
  if jsonb_typeof(v_lineas)<>'array' then raise exception 'Las líneas de venta deben ser una lista.' using errcode='22023'; end if;
  if (select count(*) from (select value->>'producto_id' from jsonb_array_elements(v_lineas) group by value->>'producto_id') x)<>jsonb_array_length(v_lineas) then
    raise exception 'Un producto solo puede aparecer una vez; consolida sus cantidades.' using errcode='22023';
  end if;
  for v_line in select value from jsonb_array_elements(v_lineas) loop
    v_cantidad:=(v_line->>'cantidad')::integer; v_precio:=round((v_line->>'precio')::numeric,2);
    if v_cantidad is null or v_cantidad<=0 or v_precio is null or v_precio<0 then raise exception 'Una línea tiene cantidad o precio no válido.' using errcode='22023'; end if;
    v_subtotal:=v_subtotal+v_cantidad*v_precio;
  end loop;
  if jsonb_array_length(v_lineas)>0 then
    if v_uid is null or not ((select public.tiene_permiso('inventario','crear')) or (select public.tiene_permiso('inventario','editar'))) then raise exception 'Se requiere permiso de inventario para vender productos.' using errcode='42501'; end if;
    if v_almacen is null or not exists(select 1 from public.almacenes where id=v_almacen and activo) then raise exception 'Selecciona un almacén activo.' using errcode='23503'; end if;
    v_total:=round(v_subtotal*(1-v_descuento/100),2);
  else
    v_total:=round(greatest(0,coalesce(p_monto_manual,0)),2);
  end if;
  v_hash:=md5(concat_ws('|',coalesce(v_cliente::text,''),v_nombre,v_detalle,v_estado,v_total,v_descuento,coalesce(v_medio,''),coalesce(v_almacen::text,''),v_lineas::text,coalesce(p_cotizacion_id::text,'')));
  perform pg_advisory_xact_lock(hashtextextended(v_key,0));
  select * into v_old from public.ventas where idempotency_key=v_key for update;
  if found then
    if v_old.payload_hash<>v_hash then raise exception 'La clave ya pertenece a otra venta.' using errcode='23505'; end if;
    return v_old.id;
  end if;
  if p_cotizacion_id is not null and v_quote.estado in ('Completada','Rechazada','Vencida') then raise exception 'La cotización ya no puede convertirse.' using errcode='23514'; end if;
  if v_cliente is not null and not exists(select 1 from public.clientes where id=v_cliente) then raise exception 'El cliente no existe.' using errcode='23503'; end if;
  insert into public.ventas(cliente_id,cliente_nombre,detalle,monto,estado,descuento,medio_pago,almacen_id,idempotency_key,payload_hash)
    values(v_cliente,v_nombre,v_detalle,v_total,v_estado,v_descuento,v_medio,case when jsonb_array_length(v_lineas)>0 then v_almacen else null end,v_key,v_hash)
    returning id,codigo into v_sale,v_codigo;
  for v_line in select value from jsonb_array_elements(v_lineas) order by value->>'producto_id' loop
    v_producto:=(v_line->>'producto_id')::uuid; v_cantidad:=(v_line->>'cantidad')::integer; v_precio:=round((v_line->>'precio')::numeric,2);
    if not exists(select 1 from public.productos where id=v_producto) then raise exception 'Un producto de la venta ya no existe.' using errcode='23503'; end if;
    insert into public.detalle_ventas(venta_id,producto_id,cantidad,precio_unitario) values(v_sale,v_producto,v_cantidad,v_precio);
    perform public.registrar_movimiento_inventario(v_producto,v_almacen,'salida',v_cantidad,'Venta '||v_codigo,v_key||':stock:'||v_producto::text,'venta',v_sale,'Salida por venta');
  end loop;
  insert into public.pagos(contraparte,detalle,monto,estado,tipo,venta_id,medio_pago)
    values(v_nombre,'Cuenta por cobrar · '||v_codigo,v_total,'Pendiente','cobrar',v_sale,v_medio) returning id into v_pago;
  if v_estado='Completada' and lower(coalesce(v_medio,''))<>'tarjeta' and v_total>0 then
    perform public.registrar_pago_parcial_en_turno('cobro',v_total,v_medio,'Venta '||v_codigo,
      jsonb_build_array(jsonb_build_object('cuenta_id',v_pago,'monto',v_total)),v_key||':cobro','Cobro inicial al registrar venta',p_caja_turno_id);
  end if;
  if p_cotizacion_id is not null then update public.cotizaciones set estado='Completada' where id=p_cotizacion_id; end if;
  return v_sale;
end $$;

revoke all on function public.registrar_pago_parcial_en_turno(text,numeric,text,text,jsonb,text,text,uuid) from public,anon;
grant execute on function public.registrar_pago_parcial_en_turno(text,numeric,text,text,jsonb,text,text,uuid) to authenticated;
revoke all on function public.registrar_venta_operativa(uuid,text,text,text,numeric,numeric,text,uuid,jsonb,text,uuid,uuid) from public,anon;
grant execute on function public.registrar_venta_operativa(uuid,text,text,text,numeric,numeric,text,uuid,jsonb,text,uuid,uuid) to authenticated;

-- D03: las órdenes no originan CxP; la obligación se reconoce con la recepción.
-- Las cuentas históricas no se borran ni recalculan automáticamente.
begin;

create or replace function app_private._crear_orden_compra_operativa_v2(
  p_proveedor_id uuid, p_detalle text, p_fecha_limite date,
  p_monto_manual numeric, p_lineas jsonb, p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(trim(p_idempotency_key),'');
  v_hash text;
  v_compra_id uuid;
  v_payload_hash text;
  v_proveedor_nombre text;
  v_line jsonb;
  v_catalogo_id uuid;
  v_producto_id uuid;
  v_cantidad integer;
  v_costo numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_requiere_recepcion boolean;
begin
  if v_uid is null or not (select public.tiene_permiso('compras','crear')) then
    raise exception 'Se requiere permiso para crear compras.' using errcode='42501';
  end if;
  if v_key is null or p_proveedor_id is null then
    raise exception 'Falta la clave de idempotencia o el proveedor.' using errcode='22023';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas)<>'array' then
    raise exception 'Las líneas de compra deben enviarse como una lista.' using errcode='22023';
  end if;
  v_requiere_recepcion := jsonb_array_length(p_lineas)>0;
  if v_requiere_recepcion and (select count(*) from (select value->>'producto_id' from jsonb_array_elements(p_lineas) group by value->>'producto_id') x)<>jsonb_array_length(p_lineas) then
    raise exception 'Un artículo solo puede aparecer una vez en la orden.' using errcode='22023';
  end if;
  v_hash:=md5(concat_ws('|',p_proveedor_id::text,coalesce(trim(p_detalle),''),coalesce(p_fecha_limite::text,''),coalesce(p_monto_manual::text,''),p_lineas::text));
  perform pg_advisory_xact_lock(hashtextextended(v_key,0));
  select id,payload_hash into v_compra_id,v_payload_hash from public.compras where idempotency_key=v_key for update;
  if found then
    if v_payload_hash is distinct from v_hash then raise exception 'La clave de solicitud ya fue usada para otra orden.' using errcode='23505'; end if;
    return v_compra_id;
  end if;
  select razon_social into v_proveedor_nombre from public.proveedores where id=p_proveedor_id for share;
  if not found then raise exception 'El proveedor ya no existe. Recarga y vuelve a seleccionarlo.' using errcode='23503'; end if;
  if v_requiere_recepcion then
    for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'producto_id' loop
      v_catalogo_id:=nullif(v_line->>'producto_id','')::uuid;
      v_cantidad:=nullif(v_line->>'cantidad','')::integer;
      v_costo:=nullif(v_line->>'precio','')::numeric;
      if v_catalogo_id is null or v_cantidad is null or v_cantidad<=0 or v_costo is null or v_costo<0 or v_costo::text in ('NaN','Infinity','-Infinity') then
        raise exception 'Una línea tiene artículo, cantidad o costo no válido.' using errcode='22023';
      end if;
      select producto_id into v_producto_id from public.proveedor_productos where id=v_catalogo_id and proveedor_id=p_proveedor_id for share;
      if not found then raise exception 'Un artículo no pertenece al proveedor seleccionado.' using errcode='23503'; end if;
      if v_producto_id is null then raise exception 'Vincula el artículo del proveedor con un producto maestro antes de comprarlo.' using errcode='23514'; end if;
      v_subtotal:=v_subtotal+v_cantidad*v_costo;
    end loop;
  else
    if p_monto_manual is null or p_monto_manual<=0 or p_monto_manual::text in ('NaN','Infinity','-Infinity') then
      raise exception 'Indica un importe mayor que cero para el servicio o gasto.' using errcode='22023';
    end if;
    v_subtotal:=round(p_monto_manual,2);
  end if;
  if v_subtotal<=0 then raise exception 'El total de la orden debe ser mayor que cero.' using errcode='22023'; end if;
  insert into public.compras(proveedor_id,proveedor_nombre,detalle,monto,estado,fecha_limite,estado_recepcion,requiere_recepcion,idempotency_key,payload_hash,created_by)
  values(p_proveedor_id,v_proveedor_nombre,coalesce(trim(p_detalle),''),round(v_subtotal,2),'Pendiente',p_fecha_limite,
    case when v_requiere_recepcion then 'pendiente' else 'completa' end,v_requiere_recepcion,v_key,v_hash,v_uid)
  returning id into v_compra_id;
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    insert into public.detalle_compras(compra_id,proveedor_producto_id,cantidad,costo_unitario)
    values(v_compra_id,(v_line->>'producto_id')::uuid,(v_line->>'cantidad')::integer,round((v_line->>'precio')::numeric,2));
  end loop;
  -- Intencionalmente no crea pagos/CxP. La obligación nace en recepción.
  return v_compra_id;
end
$function$;

revoke all on function app_private._crear_orden_compra_operativa_v2(uuid,text,date,numeric,jsonb,text) from public,anon;
grant execute on function app_private._crear_orden_compra_operativa_v2(uuid,text,date,numeric,jsonb,text) to authenticated;

create or replace function public.crear_orden_compra_operativa_v2(
  p_proveedor_id uuid,p_detalle text,p_fecha_limite date,p_monto_manual numeric,p_lineas jsonb,p_idempotency_key text
)
returns uuid language sql security invoker set search_path = '' as $wrapper$
  select app_private._crear_orden_compra_operativa_v2($1,$2,$3,$4,$5,$6)
$wrapper$;
revoke all on function public.crear_orden_compra_operativa_v2(uuid,text,date,numeric,jsonb,text) from public,anon;
grant execute on function public.crear_orden_compra_operativa_v2(uuid,text,date,numeric,jsonb,text) to authenticated;

-- Conserva la firma anterior para clientes no actualizados, pero redirige al flujo sin CxP.
create or replace function public.crear_orden_compra_operativa(
  p_proveedor_id uuid,p_detalle text,p_fecha_limite date,p_monto_manual numeric,p_lineas jsonb,p_idempotency_key text
)
returns uuid language sql security invoker set search_path = '' as $wrapper$
  select public.crear_orden_compra_operativa_v2($1,$2,$3,$4,$5,$6)
$wrapper$;
revoke all on function public.crear_orden_compra_operativa(uuid,text,date,numeric,jsonb,text) from public,anon;
grant execute on function public.crear_orden_compra_operativa(uuid,text,date,numeric,jsonb,text) to authenticated;
-- El cuerpo legado sigue almacenado para permitir auditoría, pero ya no se invoca por API.
revoke all on function app_private._crear_orden_compra_operativa(uuid,text,date,numeric,jsonb,text) from public,anon,authenticated;

create or replace function app_private._registrar_recepcion_compra_v2(
  p_compra_id uuid,p_almacen_id uuid,p_lineas jsonb,p_idempotency_key text,
  p_comprobante_tipo text default null,p_comprobante_numero text default null,p_referencia text default null
)
returns uuid language plpgsql security definer set search_path = '' as $function$
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
  v_recibido integer;
  v_pendiente boolean;
  v_compra public.compras%rowtype;
  v_pago_id uuid;
  v_monto_recibido numeric(14,2);
  v_monto_aplicado numeric(14,2);
begin
  if v_uid is null or not (select public.tiene_permiso('compras','editar')) then raise exception 'Se requiere permiso para editar compras.' using errcode='42501'; end if;
  if not ((select public.tiene_permiso('inventario','crear')) or (select public.tiene_permiso('inventario','editar'))) then raise exception 'Se requiere permiso de ingreso a inventario.' using errcode='42501'; end if;
  if p_lineas is null or jsonb_typeof(p_lineas)<>'array' or jsonb_array_length(p_lineas)=0 or nullif(trim(p_idempotency_key),'') is null then
    raise exception 'La recepción requiere líneas y clave de idempotencia.' using errcode='22023';
  end if;
  if (select count(*) from (select value->>'detalle_compra_id' from jsonb_array_elements(p_lineas) group by value->>'detalle_compra_id') x)<>jsonb_array_length(p_lineas) then
    raise exception 'Cada línea de compra solo puede aparecer una vez por recepción.' using errcode='22023';
  end if;
  v_hash:=md5(concat_ws('|',p_compra_id,p_almacen_id,p_lineas::text,coalesce(p_comprobante_tipo,''),coalesce(p_comprobante_numero,''),coalesce(p_referencia,'')));
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
  select * into v_old from public.recepciones_compra where idempotency_key=p_idempotency_key;
  if found then
    if v_old.payload_hash<>v_hash then raise exception 'La clave ya pertenece a otra recepción.' using errcode='23505'; end if;
    return v_old.id;
  end if;
  select * into v_compra from public.compras where id=p_compra_id for update;
  if not found then raise exception 'La compra no existe.' using errcode='23503'; end if;
  if v_compra.estado::text in ('Cancelada','Rechazada') then raise exception 'No se puede recibir una orden cancelada o rechazada.' using errcode='23514'; end if;
  if not exists(select 1 from public.almacenes where id=p_almacen_id and activo) then raise exception 'Selecciona un almacén activo.' using errcode='23503'; end if;
  insert into public.recepciones_compra(codigo,compra_id,almacen_id,comprobante_tipo,comprobante_numero,referencia,idempotency_key,payload_hash,recibido_por)
  values('',p_compra_id,p_almacen_id,nullif(trim(p_comprobante_tipo),''),nullif(trim(p_comprobante_numero),''),nullif(trim(p_referencia),''),p_idempotency_key,v_hash,v_uid)
  returning id into v_recepcion;
  for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'detalle_compra_id' loop
    v_detalle_id:=(v_line->>'detalle_compra_id')::uuid;
    v_cantidad:=(v_line->>'cantidad')::integer;
    if v_cantidad is null or v_cantidad<=0 then raise exception 'La cantidad recibida debe ser mayor que cero.' using errcode='22023'; end if;
    select * into v_dc from public.detalle_compras where id=v_detalle_id and compra_id=p_compra_id for update;
    if not found then raise exception 'Una línea no pertenece a esta orden.' using errcode='23503'; end if;
    select coalesce(sum(dr.cantidad),0)::integer into v_recibido from public.detalle_recepciones_compra dr join public.recepciones_compra r on r.id=dr.recepcion_id where dr.detalle_compra_id=v_dc.id and r.id<>v_recepcion;
    if v_recibido+v_cantidad>v_dc.cantidad then raise exception 'La recepción excede la cantidad ordenada.' using errcode='23514'; end if;
    select producto_id into v_producto from public.proveedor_productos where id=v_dc.proveedor_producto_id;
    if v_producto is null then raise exception 'Vincula primero el artículo del proveedor con un producto maestro.' using errcode='23514'; end if;
    insert into public.detalle_recepciones_compra(recepcion_id,detalle_compra_id,producto_id,cantidad,costo_unitario) values(v_recepcion,v_dc.id,v_producto,v_cantidad,v_dc.costo_unitario);
    perform public.registrar_movimiento_inventario(v_producto,p_almacen_id,'entrada',v_cantidad,'Recepción '||v_recepcion::text,p_idempotency_key||':'||v_dc.id::text,'recepcion_compra',v_recepcion,'Recepción de compra nacional');
  end loop;
  select exists(select 1 from public.detalle_compras dc where dc.compra_id=p_compra_id and (select coalesce(sum(dr.cantidad),0) from public.detalle_recepciones_compra dr where dr.detalle_compra_id=dc.id)<dc.cantidad) into v_pendiente;
  update public.compras set estado_recepcion=case when v_pendiente then 'parcial' else 'completa' end where id=p_compra_id;
  if p_comprobante_tipo is not null or p_comprobante_numero is not null then
    update public.compras set comprobante_tipo=coalesce(nullif(trim(p_comprobante_tipo),''),comprobante_tipo),comprobante_numero=coalesce(nullif(trim(p_comprobante_numero),''),comprobante_numero) where id=p_compra_id;
  end if;

  -- La obligación financiera se reconoce por lo recibido (acumulado, parciales incluidos).
  select round(coalesce(sum(dr.cantidad*dr.costo_unitario),0)*1.18,2) into v_monto_recibido
  from public.detalle_recepciones_compra dr join public.recepciones_compra r on r.id=dr.recepcion_id where r.compra_id=p_compra_id;
  select id into v_pago_id from public.pagos where compra_id=p_compra_id and tipo='pagar' order by created_at,id limit 1 for update;
  if v_pago_id is null then
    insert into public.pagos(contraparte,detalle,monto,estado,tipo,compra_id,fecha_vencimiento,estado_cobro,created_by)
    values(v_compra.proveedor_nombre,'Cuenta por pagar · '||v_compra.codigo,v_monto_recibido,'Pendiente','pagar',p_compra_id,v_compra.fecha_limite,'pendiente',v_uid);
  else
    select coalesce(sum(ap.monto),0) into v_monto_aplicado from public.aplicaciones_pago ap where ap.cuenta_id=v_pago_id;
    update public.pagos set monto=greatest(v_monto_recibido,v_monto_aplicado),updated_at=now() where id=v_pago_id;
  end if;
  return v_recepcion;
end
$function$;

revoke all on function app_private._registrar_recepcion_compra_v2(uuid,uuid,jsonb,text,text,text,text) from public,anon;
grant execute on function app_private._registrar_recepcion_compra_v2(uuid,uuid,jsonb,text,text,text,text) to authenticated;

create or replace function public.registrar_recepcion_compra(
  p_compra_id uuid,p_almacen_id uuid,p_lineas jsonb,p_idempotency_key text,
  p_comprobante_tipo text default null,p_comprobante_numero text default null,p_referencia text default null
)
returns uuid language sql security invoker set search_path = '' as $wrapper$
  select app_private._registrar_recepcion_compra_v2($1,$2,$3,$4,$5,$6,$7)
$wrapper$;
revoke all on function public.registrar_recepcion_compra(uuid,uuid,jsonb,text,text,text,text) from public,anon;
grant execute on function public.registrar_recepcion_compra(uuid,uuid,jsonb,text,text,text,text) to authenticated;

create or replace function public.registrar_recepcion_compra_v2(
  p_compra_id uuid,p_almacen_id uuid,p_lineas jsonb,p_idempotency_key text,
  p_comprobante_tipo text default null,p_comprobante_numero text default null,p_referencia text default null
)
returns uuid language sql security invoker set search_path = '' as $wrapper$
  select app_private._registrar_recepcion_compra_v2($1,$2,$3,$4,$5,$6,$7)
$wrapper$;
revoke all on function public.registrar_recepcion_compra_v2(uuid,uuid,jsonb,text,text,text,text) from public,anon;
grant execute on function public.registrar_recepcion_compra_v2(uuid,uuid,jsonb,text,text,text,text) to authenticated;

commit;

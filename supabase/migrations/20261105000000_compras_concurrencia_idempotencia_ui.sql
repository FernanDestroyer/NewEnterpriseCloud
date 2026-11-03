-- B14-B18: idempotencia de transiciones, exclusión por producto y bloqueo legacy.
begin;

create table if not exists app_private.purchase_transition_idempotency (
  idempotency_key text primary key,
  operation text not null check (operation in ('abrir_solicitud','seleccionar_oferta')),
  payload_hash text not null,
  result_id uuid not null,
  created_at timestamptz not null default now()
);
revoke all on app_private.purchase_transition_idempotency from public,anon,authenticated;

create or replace function public.abrir_solicitud_compra_v2(
  p_solicitud_id uuid,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_hash text;
  v_saved app_private.purchase_transition_idempotency%rowtype;
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'No tienes permiso para abrir solicitudes.' using errcode='42501';
  end if;
  if p_solicitud_id is null or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key)>128 then
    raise exception 'Solicitud y clave de idempotencia son obligatorias.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('solicitud_id',p_solicitud_id)::text);
  perform pg_advisory_xact_lock(hashtextextended('purchase-transition:'||p_idempotency_key,0));
  select * into v_saved from app_private.purchase_transition_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'abrir_solicitud' or v_saved.payload_hash<>v_hash then
      raise exception 'La clave de idempotencia ya fue usada con otra operación o contenido.' using errcode='23505';
    end if;
    return v_saved.result_id;
  end if;
  perform 1 from public.solicitudes_compra where id=p_solicitud_id for update;
  if not found then raise exception 'La solicitud no existe.' using errcode='23503'; end if;
  update public.solicitudes_compra s set estado='Abierta',updated_at=now()
    where s.id=p_solicitud_id and s.estado='Borrador'
      and exists(select 1 from public.solicitud_compra_lineas l where l.solicitud_id=s.id);
  if not found then raise exception 'La solicitud no tiene líneas o ya cambió de estado.' using errcode='23514'; end if;
  insert into app_private.purchase_transition_idempotency(idempotency_key,operation,payload_hash,result_id)
    values(p_idempotency_key,'abrir_solicitud',v_hash,p_solicitud_id);
  return p_solicitud_id;
end
$function$;

create or replace function public.seleccionar_oferta_compra_v2(
  p_solicitud_id uuid,p_oferta_id uuid,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_hash text;
  v_saved app_private.purchase_transition_idempotency%rowtype;
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'No tienes permiso para seleccionar una oferta.' using errcode='42501';
  end if;
  if p_solicitud_id is null or p_oferta_id is null or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key)>128 then
    raise exception 'Solicitud, oferta y clave de idempotencia son obligatorias.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('solicitud_id',p_solicitud_id,'oferta_id',p_oferta_id)::text);
  perform pg_advisory_xact_lock(hashtextextended('purchase-transition:'||p_idempotency_key,0));
  select * into v_saved from app_private.purchase_transition_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'seleccionar_oferta' or v_saved.payload_hash<>v_hash then
      raise exception 'La clave de idempotencia ya fue usada con otra operación o contenido.' using errcode='23505';
    end if;
    return v_saved.result_id;
  end if;
  perform 1 from public.solicitudes_compra where id=p_solicitud_id for update;
  if not found then raise exception 'La solicitud no existe.' using errcode='23503'; end if;
  if not exists(select 1 from public.ofertas_compra where id=p_oferta_id and solicitud_id=p_solicitud_id and estado='Vigente') then
    raise exception 'La oferta no corresponde a esta solicitud o ya no está vigente.' using errcode='23514';
  end if;
  update public.solicitudes_compra set seleccion_oferta_id=p_oferta_id,estado='Cerrada',updated_at=now()
    where id=p_solicitud_id and estado='Abierta';
  if not found then raise exception 'La solicitud ya no está abierta.' using errcode='23514'; end if;
  insert into app_private.purchase_transition_idempotency(idempotency_key,operation,payload_hash,result_id)
    values(p_idempotency_key,'seleccionar_oferta',v_hash,p_solicitud_id);
  return p_solicitud_id;
end
$function$;
revoke all on function public.abrir_solicitud_compra_v2(uuid,text) from public,anon;
revoke all on function public.seleccionar_oferta_compra_v2(uuid,uuid,text) from public,anon;
grant execute on function public.abrir_solicitud_compra_v2(uuid,text) to authenticated;
grant execute on function public.seleccionar_oferta_compra_v2(uuid,uuid,text) to authenticated;
-- Fuerza a clientes nuevos a usar las versiones con clave; evita el bypass legacy.
revoke all on function public.abrir_solicitud_compra(uuid) from public,anon,authenticated;
revoke all on function public.seleccionar_oferta_compra(uuid,uuid) from public,anon,authenticated;

-- La marca legacy se caracteriza por estado histórico + recepción completa.
-- El trigger no depende del cliente y aborta la transacción antes de crear Kardex/CxP.
create or replace function app_private.rechazar_recepcion_legacy_compra()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_compra public.compras%rowtype;
begin
  select * into v_compra from public.compras where id=new.compra_id for update;
  if found and v_compra.estado_recepcion='completa'
     and lower(trim(v_compra.estado::text)) in ('factura','recibida','recepción','pagada') then
    raise exception 'Orden histórica marcada como recepción legacy; no se permite volver a ingresar su stock.' using errcode='23514';
  end if;
  return new;
end
$function$;
drop trigger if exists trg_rechazar_recepcion_legacy_compra on public.recepciones_compra;
create trigger trg_rechazar_recepcion_legacy_compra before insert on public.recepciones_compra
for each row execute function app_private.rechazar_recepcion_legacy_compra();
revoke all on function app_private.rechazar_recepcion_legacy_compra() from public,anon,authenticated;

-- Extiende el bloqueo de saldo (producto, almacén) con bloqueo global por producto.
-- Serializa la actualización del agregado productos.stock entre almacenes distintos.
create or replace function app_private.registrar_movimiento_inventario(
  p_producto_id uuid,p_almacen_id uuid,p_tipo text,p_cantidad integer,p_referencia text,
  p_idempotency_key text,p_origen_tipo text default null,p_origen_id uuid default null,p_motivo text default null
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid := (select auth.uid()); v_anterior integer; v_nuevo integer;
  v_mov public.movimientos_inventario%rowtype; v_hash text;
begin
  if v_uid is null then raise exception 'Se requiere una sesión activa.' using errcode='42501'; end if;
  if not ((select public.tiene_permiso('inventario','crear')) or (select public.tiene_permiso('inventario','editar'))) then
    raise exception 'No tienes permiso para registrar movimientos de inventario.' using errcode='42501';
  end if;
  if p_tipo not in ('entrada','salida') or p_cantidad is null or p_cantidad<=0 then raise exception 'El tipo y la cantidad no son válidos.' using errcode='22023'; end if;
  if nullif(trim(p_idempotency_key),'') is null then raise exception 'Falta la clave de idempotencia.' using errcode='22023'; end if;
  v_hash:=md5(concat_ws('|',p_producto_id,p_almacen_id,p_tipo,p_cantidad,coalesce(p_referencia,''),coalesce(p_origen_tipo,''),p_origen_id,coalesce(p_motivo,'')));
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
  select * into v_mov from public.movimientos_inventario where idempotency_key=p_idempotency_key;
  if found then
    if md5(concat_ws('|',v_mov.producto_id,v_mov.almacen_id,v_mov.tipo,v_mov.cantidad,coalesce(v_mov.referencia,''),coalesce(v_mov.origen_tipo,''),v_mov.origen_id,coalesce(v_mov.motivo,'')))<>v_hash then
      raise exception 'La clave de idempotencia ya fue usada con otros datos.' using errcode='23505';
    end if;
    return v_mov.id;
  end if;
  if not exists(select 1 from public.productos where id=p_producto_id) then raise exception 'El producto no existe.' using errcode='23503'; end if;
  if not exists(select 1 from public.almacenes where id=p_almacen_id and activo) then raise exception 'Selecciona un almacén activo.' using errcode='23503'; end if;
  perform pg_advisory_xact_lock(hashtextextended('inventory-product:'||p_producto_id::text,0));
  insert into public.inventarios(producto_id,almacen_id,cantidad) values(p_producto_id,p_almacen_id,0)
    on conflict(producto_id,almacen_id) do nothing;
  select cantidad into v_anterior from public.inventarios where producto_id=p_producto_id and almacen_id=p_almacen_id for update;
  if p_tipo='salida' and v_anterior<p_cantidad then raise exception 'Stock insuficiente en el almacén. Disponible: %, solicitado: %.',v_anterior,p_cantidad using errcode='23514'; end if;
  v_nuevo:=case when p_tipo='entrada' then v_anterior+p_cantidad else v_anterior-p_cantidad end;
  update public.inventarios set cantidad=v_nuevo,updated_at=now() where producto_id=p_producto_id and almacen_id=p_almacen_id;
  insert into public.movimientos_inventario(producto_id,almacen_id,tipo,cantidad,stock_anterior,stock_nuevo,referencia,usuario_id,idempotency_key,origen_tipo,origen_id,motivo)
    values(p_producto_id,p_almacen_id,p_tipo,p_cantidad,v_anterior,v_nuevo,nullif(trim(p_referencia),''),v_uid,p_idempotency_key,p_origen_tipo,p_origen_id,nullif(trim(p_motivo),'')) returning * into v_mov;
  perform set_config('app.ec_inventory_rpc','on',true);
  update public.productos p set stock=(select coalesce(sum(i.cantidad),0)::integer from public.inventarios i where i.producto_id=p.id) where p.id=p_producto_id;
  return v_mov.id;
end
$function$;
revoke all on function app_private.registrar_movimiento_inventario(uuid,uuid,text,integer,text,text,text,uuid,text) from public,anon;
grant execute on function app_private.registrar_movimiento_inventario(uuid,uuid,text,integer,text,text,text,uuid,text) to authenticated;

commit;

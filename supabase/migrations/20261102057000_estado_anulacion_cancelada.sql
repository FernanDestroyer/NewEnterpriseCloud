-- Migración: estado_anulacion_cancelada_funciones
-- Descripción: Funciones que operan con el estado 'Cancelada' en el modelo de compras
-- Aplicada: 29-10-2026 contra proyecto auxqjoxnsasnmtnakgmg
-- Referencia remota: 20261030032206_estado_anulacion_cancelada_funciones

-- ============================================================
-- Funciones app_private (permisos y transiciones de compra)
-- ============================================================

-- Anula/setea el estado de una requisición de compra a 'Cancelada'
create or replace function app_private._anular_requisicion_compra(
  p_requisicion_id uuid,
  p_motivo text,
  p_idempotency_key text
) returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_motivo_text text := nullif(btrim(p_motivo), '');
  v_req public.requisiciones_compra%rowtype;
  v_saved app_private.purchase_transition_idempotency%rowtype;
  v_hash text;
begin
  if v_uid is null
     or not (select app_private._tiene_permiso('compras', 'eliminar')) then
    raise exception 'Se requiere permiso de eliminación para anular solicitudes.'
      using errcode = '42501';
  end if;
  if p_requisicion_id is null or v_motivo_text is null
     or length(v_motivo_text) not between 3 and 1000
     or v_key is null or length(v_key) not between 8 and 128 then
    raise exception 'Indica la solicitud, un motivo y una clave de idempotencia.'
      using errcode = '22023';
  end if;

  v_hash := md5(concat_ws('|', p_requisicion_id::text, v_motivo_text));
  perform pg_advisory_xact_lock(hashtextextended('requisicion:' || v_key, 0));

  select * into v_saved from app_private.purchase_transition_idempotency where idempotency_key = v_key;
  if found then
    if v_saved.operation <> 'anular_requisicion' or v_saved.payload_hash <> v_hash then
      raise exception 'La clave de la anulación ya fue usada con otra operación o contenido.'
        using errcode = '23505';
    end if;
    return;
  end if;

  select * into v_req from public.requisiciones_compra where id = p_requisicion_id for update;
  if not found then
    raise exception 'La solicitud ya no existe. Recarga la página.' using errcode = '23503';
  end if;
  if v_req.compra_id is not null or v_req.estado = 'Completada' then
    raise exception 'La solicitud ya generó una orden de compra: no se puede anular.'
      using errcode = '22023';
  end if;
  if v_req.estado = 'Cancelada' then
    raise exception 'La solicitud ya está anulada. Recarga la página.' using errcode = '22023';
  end if;

  update public.requisiciones_compra set estado = 'Cancelada', updated_by = v_uid
  where id = p_requisicion_id;

  insert into public.requisiciones_compra_historial
    (requisicion_id, evento, version_anterior, version_nueva, actor_id, motivo, datos_antes, datos_despues, idempotency_key)
  values
    (p_requisicion_id, 'anulacion', v_req.version, v_req.version, v_uid, v_motivo_text,
     jsonb_build_object('estado', v_req.estado, 'version', v_req.version),
     jsonb_build_object('estado', 'Cancelada'), v_key);

  insert into app_private.purchase_transition_idempotency
    (idempotency_key, operation, payload_hash, result_id, result_version)
  values (v_key, 'anular_requisicion', v_hash, p_requisicion_id, v_req.version);
end;
$$;

-- Protege la cancelación de órdenes de contrato vinculadas
create or replace function app_private._proteger_cancelacion_orden_contrato_v1() returns trigger
language plpgsql stable security definer set search_path = '' as $$
begin
  if old.estado::text is distinct from new.estado::text and new.estado::text='Cancelada'
     and exists(select 1 from public.liberaciones_contrato_compra l where l.compra_id=old.id)
     and coalesce(current_setting('app.ec_contract_order_rpc',true),'off')<>'on' then
    raise exception 'Cancela una orden vinculado a contrato mediante cancelar_orden_compra_v1 para restitucion del cupo de forma atómica.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ============================================================
-- Funciones public (wrappers para el API)
-- ============================================================

-- Cancela una orden de compra completa (incluye liberación de contrato)
create or replace function public.cancelar_orden_compra_v1(
  p_compra_id uuid,
  p_motivo text,
  p_idempotency_key text
) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid:=(select auth.uid());
  v_order public.compras%rowtype;
  v_release public.liberaciones_contrato_compra%rowtype;
  v_saved app_private.purchase_contract_order_idempotency%rowtype;
  v_hash text;
  v_history_key text;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'Se requiere permiso para cancelar ordenes de compra.' using errcode='42501';
  end if;
  if p_compra_id is null or length(trim(coalesce(p_motivo,''))) not between 5 and 500
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key)>128 then
    raise exception 'La cancelacion requiere orden, motivo y clave idempotente validos.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('compra_id',p_compra_id,'motivo',trim(p_motivo))::text);
  perform pg_advisory_xact_lock(hashtextextended('contract-purchase:'||p_idempotency_key,0));
  select * into v_saved from app_private.purchase_contract_order_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'cancelar' or v_saved.payload_hash<>v_hash then raise exception 'La clave ya se uso con otros datos.' using errcode='23505'; end if;
    return v_saved.compra_id;
  end if;
  select * into v_order from public.compras where id=p_compra_id for update;
  if not found then raise exception 'La orden no existe.' using errcode='23503'; end if;
  if v_order.estado::text in ('Cancelada','Rechazada','Pagada') then raise exception 'La orden ya esta cerrada y no se puede cancelar.' using errcode='23514'; end if;
  if exists(select 1 from public.recepciones_compra where compra_id=p_compra_id) then
    raise exception 'No se puede cancelar ni restituir cupo de una orden que ya tuvo recepcion.' using errcode='23514';
  end if;
  select * into v_release from public.liberaciones_contrato_compra where compra_id=p_compra_id for update;
  if not found then raise exception 'La orden no esta vinculada a una liberacion de contrato.' using errcode='23514'; end if;
  if v_release.estado<>'Comprometida' then raise exception 'El cupo de la orden ya fue restituido.' using errcode='23514'; end if;
  perform set_config('app.ec_contract_order_rpc','on',true);
  update public.compras set estado='Cancelada',updated_at=clock_timestamp() where id=p_compra_id;
  if not found then raise exception 'No se pudo cambiar el estado de la orden.' using errcode='23514'; end if;
  perform 1 from public.contratos_compra where id=v_release.contrato_id for update;
  update public.liberaciones_contrato_compra set estado='Restituida',restituida_por=v_uid,
    restituta_en=clock_timestamp(),motivo_restitucion=trim(p_motivo)
    where id=v_release.id and estado='Comprometida';
  if not found then raise exception 'La liberacion ya no esta comprometida; no se puede restituir dos veces.' using errcode='23514'; end if;
  v_history_key:=p_idempotency_key||':restitucion';
  insert into public.liberaciones_contrato_compra_historial(liberacion_id,evento,actor_id,motivo,monto,idempotency_key)
    values(v_release.id,'Cupo restituido',v_uid,trim(p_motivo),v_release.monto_comprometido,v_history_key);
  insert into app_private.purchase_contract_order_idempotency(idempotency_key,operation,payload_hash,compra_id,liberacion_id)
    values(p_idempotency_key,'cancelar',v_hash,p_compra_id,v_release.id);
  return p_compra_id;
end;
$$;

-- Cancela una solicitud de compra (Borrador o Abierta, sin orden asociada)
create or replace function public.cancelar_solicitud_compra_v1(
  p_solicitud_id uuid,
  p_motivo text,
  p_idempotency_key text
) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid:=(select auth.uid());
  v_request public.solicitudes_compra%rowtype;
  v_hash text; v_saved app_private.purchase_transition_idempotency%rowtype; v_snapshot jsonb;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'No tienes permiso para cancelar solicitudes.' using errcode='42501';
  end if;
  if p_solicitud_id is null or length(trim(coalesce(p_motivo,''))) not between 5 and 500
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'La cancelacion requiere un motivo (5-500 caracteres) y una clave valida.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('solicitud_id',p_solicitud_id,'motivo',trim(p_motivo))::text);
  perform pg_advisory_xact_lock(hashtextextended('purchase-transition:'||p_idempotency_key,0));
  select * into v_saved from app_private.purchase_transition_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'cancelar_solicitud' or v_saved.payload_hash<>v_hash then
      raise exception 'La clave ya fue usada con otra operacion o contenido.' using errcode='23505';
    end if;
    return v_saved.result_id;
  end if;
  select * into v_request from public.solicitudes_compra where id=p_solicitud_id for update;
  if not found then raise exception 'La solicitud no existe.' using errcode='23503'; end if;
  if v_request.estado not in ('Borrador','Abierta') or v_request.seleccion_oferta_id is not null
     or exists(select 1 from public.compras where solicitud_compra_id=p_solicitud_id) then
    raise exception 'No se puede cancelar una solicitud cerrada, seleccionada o convertida en orden.' using errcode='23514';
  end if;
  v_snapshot:=jsonb_build_object('detalle',v_request.detalle,'fecha_necesidad',v_request.fecha_necesidad,
    'estado',v_request.estado,'version',v_request.version,
    'lineas',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]'::jsonb) from public.solicitud_compra_lineas l where l.solicitud_id=p_solicitud_id));
  update public.ofertas_compra set estado='Retirada',es_version_actual=false,updated_at=clock_timestamp()
    where solicitud_id=p_solicitud_id and es_version_actual and estado='Vigente';
  update public.solicitudes_compra set estado='Cancelada',cancelacion_motivo=trim(p_motivo),
    cancelado_por=v_uid,cancelado_en=clock_timestamp(),updated_by=v_uid,updated_at=clock_timestamp()
    where id=p_solicitud_id;
  insert into public.solicitudes_compra_historial(solicitud_id,evento,version_anterior,version_nueva,actor_id,motivo,datos_antes,datos_despues,idempotency_key)
    values(p_solicitud_id,'cancelacion',v_request.version,v_request.version,v_uid,trim(p_motivo),v_snapshot,
      v_snapshot||jsonb_build_object('estado','Cancelada','motivo',trim(p_motivo),'actor_id',v_uid),p_idempotency_key);
  insert into app_private.purchase_transition_idempotency(idempotency_key,operation,payload_hash,result_id,result_version)
    values(p_idempotency_key,'cancelar_solicitud',v_hash,p_solicitud_id,v_request.version);
  return p_solicitud_id;
end;
$$;

-- Lista solicitudes de compra con paginación y filtros por estado (incluye Cancelada)
create or replace function public.listar_solicitudes_compra_paginado_v1(
  p_estado text default null::text,
  p_desde date default null::date,
  p_hasta date default null::date,
  p_referencia text default null::text,
  p_limit integer default 20,
  p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_items jsonb; v_total bigint; v_limit integer:=least(greatest(coalesce(p_limit,20),1),100); v_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','ver')) then raise exception 'No tienes permiso para consultar solicitudes.' using errcode='42501'; end if;
  if p_estado is not null and p_estado not in ('Borrador','Abierta','Cerrada','Cancelada') then raise exception 'Estado invalido.' using errcode='22023'; end if;
  if p_desde is not null and p_hasta is not null and p_desde>p_hasta then raise exception 'Rango de fechas invalido.' using errcode='22023'; end if;
  with filtered as (
    select s.* from public.solicitudes_compra s
    where (p_estado is null or s.estado=p_estado)
      and (p_desde is null or s.fecha_necesidad>=p_desde)
      and (p_hasta is null or s.fecha_necesidad<=p_hasta)
      and (nullif(trim(p_referencia),'') is null or s.codigo ilike '%'||trim(p_referencia)||'%'
        or s.detalle ilike '%'||trim(p_referencia)||'%'
        or exists(select 1 from public.ofertas_compra o join public.proveedores p on p.id=o.proveedor_id
          where o.solicitud_id=s.id and (p.razon_social ilike '%'||trim(p_referencia)||'%' or p.codigo ilike '%'||trim(p_referencia)||'%')))
  )
  select count(*) into v_total from filtered;
  with page as (
    select s.* from public.solicitudes_compra s
    where (p_estado is null or s.estado=p_estado)
      and (p_desde is null or s.fecha_necesidad>=p_desde)
      and (p_hasta is null or s.fecha_necesidad<=p_hasta)
      and (nullif(trim(p_referencia),'') is null or s.codigo ilike '%'||trim(p_referencia)||'%'
        or s.detalle ilike '%'||trim(p_referencia)||'%'
        or exists(select 1 from public.ofertas_compra o join public.proveedores p on p.id=o.proveedor_id
          where o.solicitud_id=s.id and (p.razon_social ilike '%'||trim(p_referencia)||'%' or p.codigo ilike '%'||trim(p_referencia)||'%')))
    order by s.created_at desc,s.id desc limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'codigo',p.codigo,'estado',p.estado,'version',p.version,
    'fecha_necesidad',p.fecha_necesidad,'detalle',p.detalle,'created_at',p.created_at,
    'seleccion_oferta_id',p.seleccion_oferta_id,'seleccion_motivo',p.seleccion_motivo,
    'cancelacion_motivo',p.cancelacion_motivo,'orden_compra_id',c.id,'orden_codigo',c.codigo,
    'line_count',(select count(*) from public.solicitud_compra_lineas l where l.solicitud_id=p.id),
    'offer_count',(select count(*) from public.ofertas_compra o where o.solicitud_id=p.id)) order by p.created_at desc,p.id desc),'[]'::jsonb)
  into v_items from page p left join public.compras c on c.solicitud_compra_id=p.id;
  return jsonb_build_object('items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset);
end;
$$;

-- Registra una devolución de compra (puede involucrar estado Cancelado indirectamente)
create or replace function public.registrar_devolucion_compra(
  p_compra_id uuid,
  p_motivo text,
  p_lineas jsonb,
  p_idempotency_key text
) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid:=(select auth.uid()); v_hash text; v_id uuid; v_old public.devoluciones_compra%rowtype; v_line jsonb; v_detalle uuid; v_cantidad integer; v_recibido integer; v_devuelto integer; v_stock integer; v_producto uuid; v_almacen uuid; v_costo numeric(14,2); v_compra_estado text;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar'))
     or not ((select app_private._tiene_permiso('inventario','crear')) or (select app_private._tiene_permiso('inventario','editar'))) then
    raise exception 'Se requiere edicion de Compras y de Inventario.' using errcode='42501';
  end if;
  if p_compra_id is null or nullif(trim(p_motivo),'') is null or length(trim(p_motivo)) not between 3 and 1000
     or p_lineas is null or jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas)=0
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key)>180 then
    raise exception 'La devolucion requiere orden, motivo, lineas y clave idempotente validos.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_lineas) e where jsonb_typeof(e.value) is distinct from 'object'
      or nullif(e.value->>'detalle_recepcion_id','') is null
      or coalesce(e.value->>'cantidad','') !~ '^[0-9]+$') then
    raise exception 'Cada linea requiere origen de recepcion y cantidad entera positiva.' using errcode='22023';
  end if;
  if (select count(distinct value->>'detalle_recepcion_id') from jsonb_array_elements(p_lineas))<>jsonb_array_length(p_lineas) then
    raise exception 'Una linea de recepcion solo puede aparecer una vez por devolucion.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('compra_id',p_compra_id,'motivo',trim(p_motivo),'lineas',p_lineas)::text);
  perform pg_advisory_xact_lock(hashtextextended('devolucion-compra:'||p_idempotency_key,0));
  select * into v_old from public.devoluciones_compra where idempotency_key=p_idempotency_key;
  if found then
    if v_old.payload_hash<>v_hash then raise exception 'La clave ya fue usada con otros datos.' using errcode='23505'; end if;
    return v_old.id;
  end if;
  select estado::text into v_compra_estado from public.compras where id=p_compra_id for update;
  if not found then raise exception 'La orden de compra no existe.' using errcode='23503'; end if;
  if v_compra_estado in ('Cancelada','Rechazada','Solicitud','Borrador') then raise exception 'No se puede devolver contra una orden no confirmada o cancelada.' using errcode='23514'; end if;
  insert into public.devoluciones_compra(compra_id,motivo,idempotency_key,payload_hash,created_by)
    values(p_compra_id,trim(p_motivo),p_idempotency_key,v_hash,v_uid) returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'detalle_recepcion_id' loop
    v_detalle:=(v_line->>'detalle_recepcion_id')::uuid; v_cantidad:=(v_line->>'cantidad')::integer;
    if v_cantidad is null or v_cantidad<=0 then raise exception 'La cantidad devuelta debe ser mayor que cero.' using errcode='22023'; end if;
    select dr.producto_id,r.almacen_id,dr.costo_unitario,dr.cantidad into v_producto,v_almacen,v_costo,v_recibido from public.detalle_recepciones_compra dr join public.recepciones_compra r on r.id=dr.recepcion_id where dr.id=v_detalle and r.compra_id=p_compra_id for update of dr;
    if not found then raise exception 'La linea no pertenece a una recepcion de esta orden.' using errcode='23503'; end if;
    select greatest(coalesce(sum(d.cantidad),0)-coalesce((select sum(x.cantidad) from public.detalle_reversiones_devolucion_compra x where x.detalle_devolucion_id in (select d2.id from public.detalle_devoluciones_compra d2 where d2.detalle_recepcion_id=v_detalle)),0),0)::integer into v_devuelto
    from public.detalle_devoluciones_compra d join public.devoluciones_compra h on h.id=d.devolucion_id
    where d.detalle_recepcion_id=v_detalle;
    if v_devuelto+v_cantidad>v_recibido then raise exception 'La devolucion supera el neto recibido de esta linea (% unidades disponibles).',greatest(v_recibido-v_devuelto,0) using errcode='23514'; end if;
    select coalesce(i.cantidad,0) into v_stock from public.inventarios i where i.producto_id=v_producto and i.almacen_id=v_almacen for update;
    if not found then v_stock:=0; end if;
    if v_cantidad>v_stock then raise exception 'Stock fisico insuficiente en el almacén (% disponibles).',v_stock using errcode='23514'; end if;
    insert into public.detalle_devoluciones_compra(devolucion_id,detalle_recepcion_id,producto_id,almacen_id,cantidad,costo_unitario) values(v_id,v_detalle,v_producto,v_almacen,v_cantidad,v_costo);
    perform public.registrar_movimiento_inventario(v_producto,v_almacen,'salida',v_cantidad,
      'Devolución a proveedor '||v_id::text,p_idempotency_key||':'||v_detalle::text,
      'devolucion_compra',v_id,trim(p_motivo));
  end loop;
  return v_id;
end;
$$;

-- ============================================================
-- Fin de migración estado_anulacion_cancelada_funciones
-- ============================================================

-- Nota: Las funciones above usan tablas yconstraints propias del modelo B de compras:
-- - public.requisiciones_compra, public.solicitudes_compra, public.compras
-- - public.ofertas_compra, public.recepciones_compra, public.detalle_recepciones_compra
-- - public.liberaciones_contrato_compra, public.contratos_compra
-- - app_private.purchase_transition_idempotency, app_private.purchase_contract_order_idempotency
-- - public.requisiciones_compra_historial, public.solicitudes_compra_historial
-- - public.liberaciones_contrato_compra_historial
-- Todas ellas con RLS y policies asociadas. No ejecutar contra esquema legacy (Modelo A).
-- Fase E01-E05: elegibilidad de recepción, netos por línea, saldo físico y
-- consultas paginadas de recepciones/devoluciones. Preparada para aplicación manual.
-- D11: registrar una devolución nunca altera pagos/CxP; Tesorería concilia la NC.
begin;

-- Las órdenes en borrador/solicitud/canceladas/rechazadas no pueden ingresar a
-- almacén. Solo fases comerciales confirmadas/operativas continúan recepcionables.
do $replace_receipt_eligibility$
declare
  v_definition text;
  v_old text := 'if v_compra.estado::text in (''Cancelada'',''Rechazada'') then raise exception ''No se puede recibir una orden cancelada o rechazada.'' using errcode=''23514''; end if;';
  v_new text := 'if v_compra.estado::text not in (''Orden'',''Recepción'',''Factura'',''Pagada'',''Confirmada'',''Confirmado'') then raise exception ''La orden no está comercialmente confirmada y no admite recepción.'' using errcode=''23514''; end if;';
begin
  select pg_get_functiondef('app_private._registrar_recepcion_compra_v2(uuid,uuid,jsonb,text,text,text,text)'::regprocedure)
    into v_definition;
  if position(v_new in v_definition)>0 then return; end if;
  if position(v_old in v_definition)=0 then
    raise exception 'No se pudo reconocer el control de elegibilidad actual del RPC de recepción; migración abortada.';
  end if;
  v_definition:=replace(v_definition,v_old,v_new);
  execute v_definition;
end
$replace_receipt_eligibility$;

create index if not exists detalle_recepciones_compra_recepcion_idx
  on public.detalle_recepciones_compra(recepcion_id,id);
create index if not exists detalle_devoluciones_compra_documento_idx
  on public.detalle_devoluciones_compra(devolucion_id,id);
create index if not exists movimientos_inventario_origen_devolucion_idx
  on public.movimientos_inventario(origen_id,created_at desc)
  where origen_tipo='devolucion_compra';

-- Recibido bruto nunca se reduce por devolución. Netos siempre se derivan de
-- eventos de recepción y documentos de devolución, nunca de saldos de stock.
create or replace function public.obtener_resumen_recepcion_compra_v1(p_compra_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_result jsonb;
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','ver')) then
    raise exception 'No tienes permiso para consultar recepciones.' using errcode='42501';
  end if;
  if not exists(select 1 from public.compras where id=p_compra_id) then raise exception 'La orden no existe.' using errcode='23503'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'detalle_compra_id',dc.id,'descripcion',coalesce(pp.nombre,dc.descripcion),
    'cantidad_ordenada',dc.cantidad,
    'recibido_bruto',coalesce(rq.recibido_bruto,0),
    'devuelto',coalesce(rq.devuelto,0),
    'neto_recibido',coalesce(rq.recibido_bruto,0)-coalesce(rq.devuelto,0)
  ) order by dc.id),'[]'::jsonb)
  into v_result
  from public.detalle_compras dc
  left join public.proveedor_productos pp on pp.id=dc.proveedor_producto_id
  left join lateral (
    select sum(dr.cantidad)::integer as recibido_bruto,
      (select coalesce(sum(dd.cantidad),0)::integer
       from public.detalle_devoluciones_compra dd
       join public.detalle_recepciones_compra dr2 on dr2.id=dd.detalle_recepcion_id
       join public.recepciones_compra r2 on r2.id=dr2.recepcion_id
       where dr2.detalle_compra_id=dc.id and r2.compra_id=p_compra_id) as devuelto
    from public.detalle_recepciones_compra dr
    join public.recepciones_compra r on r.id=dr.recepcion_id
    where dr.detalle_compra_id=dc.id and r.compra_id=p_compra_id
  ) rq on true
  where dc.compra_id=p_compra_id;
  return v_result;
end
$function$;

-- Historial paginado de recepciones, con almacén, actor y líneas por evento.
create or replace function public.listar_historial_recepciones_compra_v1(
  p_compra_id uuid,p_limit integer default 20,p_offset integer default 0
)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_items jsonb; v_total bigint; v_limit integer:=least(greatest(coalesce(p_limit,20),1),100); v_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','ver')) then raise exception 'No tienes permiso para consultar recepciones.' using errcode='42501'; end if;
  if not exists(select 1 from public.compras where id=p_compra_id) then raise exception 'La orden no existe.' using errcode='23503'; end if;
  select count(*) into v_total from public.recepciones_compra where compra_id=p_compra_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'codigo',q.codigo,'compra_id',q.compra_id,'almacen_id',q.almacen_id,
    'almacen',q.almacen,'actor_id',q.recibido_por,'actor',q.actor,'recibido_en',q.recibido_en,
    'comprobante_tipo',q.comprobante_tipo,'comprobante_numero',q.comprobante_numero,'referencia',q.referencia,
    'lineas',q.lineas) order by q.recibido_en desc,q.id desc),'[]'::jsonb)
  into v_items from (
    select r.id,r.codigo,r.compra_id,r.almacen_id,a.nombre as almacen,r.recibido_por,u.nombre as actor,
      r.recibido_en,r.comprobante_tipo,r.comprobante_numero,r.referencia,
      (select coalesce(jsonb_agg(jsonb_build_object('detalle_recepcion_id',dr.id,
        'detalle_compra_id',dr.detalle_compra_id,'producto_id',dr.producto_id,
        'descripcion',coalesce(pp.nombre,dc.descripcion),'cantidad',dr.cantidad,'costo_unitario',dr.costo_unitario) order by dr.id),'[]'::jsonb)
       from public.detalle_recepciones_compra dr
       join public.detalle_compras dc on dc.id=dr.detalle_compra_id
       left join public.proveedor_productos pp on pp.id=dc.proveedor_producto_id
       where dr.recepcion_id=r.id) as lineas
    from public.recepciones_compra r
    join public.almacenes a on a.id=r.almacen_id
    left join public.usuarios u on u.id=r.recibido_por
    where r.compra_id=p_compra_id order by r.recibido_en desc,r.id desc limit v_limit offset v_offset
  ) q;
  return jsonb_build_object('items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset);
end
$function$;

-- Historial paginado de notas de crédito/devoluciones con evento Kardex enlazado.
create or replace function public.listar_historial_devoluciones_compra_v1(
  p_compra_id uuid,p_limit integer default 20,p_offset integer default 0
)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_items jsonb; v_total bigint; v_limit integer:=least(greatest(coalesce(p_limit,20),1),100); v_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','ver')) then raise exception 'No tienes permiso para consultar devoluciones.' using errcode='42501'; end if;
  if not exists(select 1 from public.compras where id=p_compra_id) then raise exception 'La orden no existe.' using errcode='23503'; end if;
  select count(*) into v_total from public.devoluciones_compra where compra_id=p_compra_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'codigo',q.codigo,'motivo',q.motivo,'actor_id',q.created_by,'actor',q.actor,'created_at',q.created_at,
    'lineas',q.lineas) order by q.created_at desc,q.id desc),'[]'::jsonb)
  into v_items from (
    select h.id,h.codigo,h.motivo,h.created_by,u.nombre as actor,h.created_at,
      (select coalesce(jsonb_agg(jsonb_build_object(
        'detalle_devolucion_id',d.id,'detalle_recepcion_id',d.detalle_recepcion_id,
        'recepcion_codigo',r.codigo,'producto_id',d.producto_id,
        'descripcion',coalesce(pp.nombre,dc.descripcion),'almacen_id',d.almacen_id,'almacen',a.nombre,
        'cantidad',d.cantidad,'costo_unitario',d.costo_unitario,
        'movimiento_kardex_id',m.id,'movimiento_kardex_fecha',m.created_at,'movimiento_kardex_tipo',m.tipo)
        order by d.id),'[]'::jsonb)
       from public.detalle_devoluciones_compra d
       join public.detalle_recepciones_compra dr on dr.id=d.detalle_recepcion_id
       join public.recepciones_compra r on r.id=dr.recepcion_id
       join public.detalle_compras dc on dc.id=dr.detalle_compra_id
       left join public.proveedor_productos pp on pp.id=dc.proveedor_producto_id
       join public.almacenes a on a.id=d.almacen_id
       left join lateral (select mi.id,mi.created_at,mi.tipo from public.movimientos_inventario mi
         where mi.origen_tipo='devolucion_compra' and mi.origen_id=h.id
           and mi.idempotency_key like '%'||dr.id::text order by mi.created_at desc,mi.id desc limit 1) m on true
       where d.devolucion_id=h.id) as lineas
    from public.devoluciones_compra h left join public.usuarios u on u.id=h.created_by
    where h.compra_id=p_compra_id order by h.created_at desc,h.id desc limit v_limit offset v_offset
  ) q;
  return jsonb_build_object('items',v_items,'total',v_total,'limit',v_limit,'offset',v_offset);
end
$function$;

-- El servidor expone bruto, devuelto, neto y saldo físico del almacén. El RPC
-- de confirmación vuelve a bloquear y validar neto/stock bajo transacción.
create or replace function public.listar_lineas_devolucion_compra_v1(p_compra_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_items jsonb;
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','ver')) then raise exception 'No tienes permiso para consultar devoluciones.' using errcode='42501'; end if;
  if not exists(select 1 from public.compras where id=p_compra_id) then raise exception 'La orden no existe.' using errcode='23503'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',dr.id,'detalle_compra_id',dr.detalle_compra_id,'cantidad',dr.cantidad,'recibido_en_evento',dr.cantidad,
    'producto_id',dr.producto_id,'costo_unitario',dr.costo_unitario,
    'descripcion',coalesce(pp.nombre,dc.descripcion),'recibido_bruto',gross.total,
    'devuelto',returned.total,'neto_recibido',gross.total-returned.total,
    'stock_disponible',greatest(coalesce(inv.cantidad,0),0),
    'maximo_retornable',least(greatest(dr.cantidad-event_returned.total,0),greatest(coalesce(inv.cantidad,0),0)),
    'recepcion_id',r.id,'recepcion_codigo',r.codigo,'almacen_id',r.almacen_id,'almacen',a.nombre,
    'recibido_en',r.recibido_en) order by r.recibido_en desc,dr.id),'[]'::jsonb)
  into v_items
  from public.detalle_recepciones_compra dr
  join public.recepciones_compra r on r.id=dr.recepcion_id
  join public.detalle_compras dc on dc.id=dr.detalle_compra_id
  left join public.proveedor_productos pp on pp.id=dc.proveedor_producto_id
  join public.almacenes a on a.id=r.almacen_id
  left join public.inventarios inv on inv.producto_id=dr.producto_id and inv.almacen_id=r.almacen_id
  cross join lateral (select coalesce(sum(dr0.cantidad),0)::integer as total
    from public.detalle_recepciones_compra dr0 where dr0.detalle_compra_id=dr.detalle_compra_id) gross
  cross join lateral (select coalesce(sum(dd0.cantidad),0)::integer as total
    from public.detalle_recepciones_compra dr0 join public.detalle_devoluciones_compra dd0 on dd0.detalle_recepcion_id=dr0.id
    where dr0.detalle_compra_id=dr.detalle_compra_id) returned
  cross join lateral (select coalesce(sum(dd.cantidad),0)::integer as total
    from public.detalle_devoluciones_compra dd where dd.detalle_recepcion_id=dr.id) event_returned
  where r.compra_id=p_compra_id;
  return v_items;
end
$function$;

revoke all on function public.obtener_resumen_recepcion_compra_v1(uuid) from public,anon;
revoke all on function public.listar_historial_recepciones_compra_v1(uuid,integer,integer) from public,anon;
revoke all on function public.listar_historial_devoluciones_compra_v1(uuid,integer,integer) from public,anon;
revoke all on function public.listar_lineas_devolucion_compra_v1(uuid) from public,anon;
grant execute on function public.obtener_resumen_recepcion_compra_v1(uuid) to authenticated;
grant execute on function public.listar_historial_recepciones_compra_v1(uuid,integer,integer) to authenticated;
grant execute on function public.listar_historial_devoluciones_compra_v1(uuid,integer,integer) to authenticated;
grant execute on function public.listar_lineas_devolucion_compra_v1(uuid) to authenticated;

-- Reemplaza el RPC manteniendo el contrato público y D11. El detalle recibido
-- se bloquea antes de validar acumulado devuelto, y Kardex valida de nuevo stock.
create or replace function public.registrar_devolucion_compra(
  p_compra_id uuid,p_motivo text,p_lineas jsonb,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_hash text; v_id uuid; v_old public.devoluciones_compra%rowtype;
  v_line jsonb; v_detalle uuid; v_cantidad integer; v_recibido integer; v_devuelto integer;
  v_stock integer; v_producto uuid; v_almacen uuid; v_costo numeric(14,2); v_compra_estado text;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar'))
     or not ((select app_private._tiene_permiso('inventario','crear')) or (select app_private._tiene_permiso('inventario','editar'))) then
    raise exception 'Se requiere permiso de edición de Compras y de Inventario.' using errcode='42501';
  end if;
  if p_compra_id is null or nullif(trim(p_motivo),'') is null or length(trim(p_motivo)) not between 3 and 1000
     or p_lineas is null or jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas)=0
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key)>180 then
    raise exception 'La devolución requiere orden, motivo, líneas y clave idempotente válidos.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_lineas) e where jsonb_typeof(e.value) is distinct from 'object'
      or nullif(e.value->>'detalle_recepcion_id','') is null
      or coalesce(e.value->>'cantidad','') !~ '^[0-9]+$') then
    raise exception 'Cada línea requiere origen de recepción y cantidad entera positiva.' using errcode='22023';
  end if;
  if (select count(distinct value->>'detalle_recepcion_id') from jsonb_array_elements(p_lineas))<>jsonb_array_length(p_lineas) then
    raise exception 'Una línea de recepción solo puede aparecer una vez por devolución.' using errcode='22023';
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
    v_detalle:=(v_line->>'detalle_recepcion_id')::uuid;
    v_cantidad:=(v_line->>'cantidad')::integer;
    if v_cantidad is null or v_cantidad<=0 then raise exception 'La cantidad devuelta debe ser mayor que cero.' using errcode='22023'; end if;
    select dr.producto_id,r.almacen_id,dr.costo_unitario,dr.cantidad
      into v_producto,v_almacen,v_costo,v_recibido
    from public.detalle_recepciones_compra dr join public.recepciones_compra r on r.id=dr.recepcion_id
    where dr.id=v_detalle and r.compra_id=p_compra_id for update of dr;
    if not found then raise exception 'La línea no pertenece a una recepción de esta orden.' using errcode='23503'; end if;
    select coalesce(sum(d.cantidad),0)::integer into v_devuelto
    from public.detalle_devoluciones_compra d join public.devoluciones_compra h on h.id=d.devolucion_id
    where d.detalle_recepcion_id=v_detalle;
    if v_devuelto+v_cantidad>v_recibido then
      raise exception 'La devolución supera el neto recibido de esta línea (% unidades disponibles).',greatest(v_recibido-v_devuelto,0) using errcode='23514';
    end if;
    select coalesce(i.cantidad,0) into v_stock from public.inventarios i where i.producto_id=v_producto and i.almacen_id=v_almacen for update;
    if not found then v_stock:=0; end if;
    if v_cantidad>v_stock then raise exception 'Stock físico insuficiente en el almacén (% disponibles).',v_stock using errcode='23514'; end if;
    insert into public.detalle_devoluciones_compra(devolucion_id,detalle_recepcion_id,producto_id,almacen_id,cantidad,costo_unitario)
      values(v_id,v_detalle,v_producto,v_almacen,v_cantidad,v_costo);
    perform public.registrar_movimiento_inventario(v_producto,v_almacen,'salida',v_cantidad,
      'Devolución a proveedor '||v_id::text,p_idempotency_key||':'||v_detalle::text,
      'devolucion_compra',v_id,trim(p_motivo));
  end loop;
  -- D11: no escribir ni recalcular pagos, aplicaciones_pago ni CxP aquí.
  return v_id;
end
$function$;

revoke all on function public.registrar_devolucion_compra(uuid,text,jsonb,text) from public,anon;
grant execute on function public.registrar_devolucion_compra(uuid,text,jsonb,text) to authenticated;

commit;

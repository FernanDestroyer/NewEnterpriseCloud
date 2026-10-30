-- Fase G06-G09: tracking, gastos multi-moneda y nacionalización atómica.
-- Requiere 20261115000000_importaciones_carpetas_gastos_prorrateo.sql.
begin;

-- G06-G07: tracking de estado con auditoría explícita. Nacionalizado se asigna
-- exclusivamente al final del RPC de nacionalización, nunca como estado vacío.
alter table public.carpetas_importacion
  drop constraint if exists carpetas_importacion_estado_check;
alter table public.carpetas_importacion
  add constraint carpetas_importacion_estado_check
  check(estado in ('Abierta','En Tránsito','En Aduanas','Nacionalizado','Cerrada'));
alter table public.carpetas_importacion
  add column if not exists estado_actualizado_por uuid references public.usuarios(id) on delete restrict,
  add column if not exists estado_actualizado_en timestamptz,
  add column if not exists estado_motivo text;
alter table public.carpetas_importacion
  drop constraint if exists carpetas_importacion_estado_auditoria_check;
alter table public.carpetas_importacion
  add constraint carpetas_importacion_estado_auditoria_check
  check((estado_actualizado_por is null and estado_actualizado_en is null and estado_motivo is null)
     or (estado_actualizado_por is not null and estado_actualizado_en is not null
       and estado_motivo is not null and length(trim(estado_motivo)) between 5 and 500));

alter table public.carpetas_importacion_historial
  drop constraint if exists carpetas_importacion_historial_evento_check;
alter table public.carpetas_importacion_historial
  add constraint carpetas_importacion_historial_evento_check
  check(evento in ('Creada','Orden vinculada','Orden desvinculada','Gasto registrado','Estado actualizado','Nacionalizada'));

-- G09: guardar siempre el importe original y el tipo de cambio snapshot (PEN
-- por USD). Los montos normalizados se calculan en USD con precisión de centavo.
alter table public.gastos_importacion
  drop constraint if exists gastos_importacion_moneda_check;
alter table public.gastos_importacion
  add column if not exists tipo_cambio numeric(18,6);
alter table public.gastos_importacion
  add constraint gastos_importacion_moneda_check check(moneda in ('PEN','USD'));
alter table public.gastos_importacion
  add constraint gastos_importacion_tipo_cambio_check
  check((moneda='USD' and coalesce(tipo_cambio,1)=1)
     or (moneda='PEN' and tipo_cambio is not null and tipo_cambio>0
       and tipo_cambio::text not in ('NaN','Infinity','-Infinity')));

alter table public.detalle_recepciones_compra
  alter column costo_unitario type numeric(18,6) using costo_unitario::numeric(18,6);
alter table public.movimientos_inventario
  add column if not exists costo_unitario numeric(18,6);
alter table public.movimientos_inventario
  drop constraint if exists movimientos_inventario_costo_unitario_check;
alter table public.movimientos_inventario
  add constraint movimientos_inventario_costo_unitario_check
  check(costo_unitario is null or (costo_unitario>=0 and costo_unitario::text not in ('NaN','Infinity','-Infinity')));

alter table app_private.import_purchase_idempotency
  drop constraint if exists import_purchase_idempotency_operation_check;
alter table app_private.import_purchase_idempotency
  add constraint import_purchase_idempotency_operation_check
  check(operation in ('crear_carpeta','vincular_orden','desvincular_orden','registrar_gasto','cambiar_estado','nacionalizar'));

-- Actualiza el RPC de gastos preservando su clave de idempotencia. Conversión
-- PEN -> USD: importe PEN / tipo_cambio snapshot (PEN por USD).
drop function if exists public.registrar_gasto_importacion_v1(uuid,text,text,numeric,text,text);
create or replace function public.registrar_gasto_importacion_v1(
  p_carpeta_id uuid,p_tipo text,p_descripcion text,p_monto numeric,p_moneda text,
  p_tipo_cambio numeric,p_referencia text,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_folder public.carpetas_importacion%rowtype;
  v_id uuid; v_hash text; v_saved app_private.import_purchase_idempotency%rowtype;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','crear')) then
    raise exception 'Se requiere permiso de Compras para registrar gastos de importación.' using errcode='42501';
  end if;
  if p_carpeta_id is null or p_tipo not in ('Flete','Seguro','Arancel/Advalorem','Agente de Aduanas','Otros')
     or length(trim(coalesce(p_descripcion,''))) not between 1 and 500
     or p_monto is null or p_monto<=0 or p_monto::text in ('NaN','Infinity','-Infinity')
     or p_monto<>round(p_monto,2)
     or p_moneda not in ('USD','PEN')
     or (p_moneda='USD' and coalesce(p_tipo_cambio,1)<>1)
     or (p_moneda='PEN' and (p_tipo_cambio is null or p_tipo_cambio<=0 or p_tipo_cambio::text in ('NaN','Infinity','-Infinity')))
     or length(coalesce(p_referencia,''))>300
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Tipo, descripción, monto, moneda, tipo de cambio o clave idempotente inválidos.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('carpeta_id',p_carpeta_id,'tipo',p_tipo,'descripcion',trim(p_descripcion),
    'monto',p_monto,'moneda',p_moneda,'tipo_cambio',case when p_moneda='USD' then 1 else p_tipo_cambio end,
    'referencia',trim(coalesce(p_referencia,'')))::text);
  perform pg_advisory_xact_lock(hashtextextended('import-purchase:'||p_idempotency_key,0));
  select * into v_saved from app_private.import_purchase_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'registrar_gasto' or v_saved.payload_hash<>v_hash then raise exception 'La clave idempotente ya se usó con otros datos.' using errcode='23505'; end if;
    return v_saved.result_id;
  end if;
  select * into v_folder from public.carpetas_importacion where id=p_carpeta_id for update;
  if not found or v_folder.estado not in ('Abierta','En Tránsito','En Aduanas') then
    raise exception 'La carpeta no existe o ya no admite gastos.' using errcode='23514';
  end if;
  insert into public.gastos_importacion(carpeta_id,tipo,descripcion,monto,moneda,tipo_cambio,referencia,idempotency_key,creado_por)
    values(p_carpeta_id,p_tipo,trim(p_descripcion),p_monto,p_moneda,
      case when p_moneda='USD' then 1 else p_tipo_cambio end,trim(coalesce(p_referencia,'')),p_idempotency_key,v_uid)
    returning id into v_id;
  insert into public.carpetas_importacion_historial(carpeta_id,evento,actor_id,gasto_id,datos,idempotency_key)
    values(p_carpeta_id,'Gasto registrado',v_uid,v_id,
      jsonb_build_object('tipo',p_tipo,'monto',p_monto,'moneda',p_moneda,'tipo_cambio',case when p_moneda='USD' then 1 else p_tipo_cambio end),
      p_idempotency_key||':hist');
  insert into app_private.import_purchase_idempotency(idempotency_key,operation,payload_hash,carpeta_id,result_id,actor_id)
    values(p_idempotency_key,'registrar_gasto',v_hash,p_carpeta_id,v_id,v_uid);
  return v_id;
end
$function$;

-- Registra avance secuencial con actor/fecha/motivo. El paso final se reserva
-- para nacionalizar_carpeta_importacion_v1, que además recibe stock y crea CxP.
create or replace function public.actualizar_estado_carpeta_importacion_v1(
  p_carpeta_id uuid,p_estado text,p_motivo text,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_folder public.carpetas_importacion%rowtype;
  v_hash text; v_saved app_private.import_purchase_idempotency%rowtype;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'Se requiere permiso de edición de Compras para avanzar una carpeta.' using errcode='42501';
  end if;
  if p_carpeta_id is null or p_estado not in ('En Tránsito','En Aduanas')
     or length(trim(coalesce(p_motivo,''))) not between 5 and 500
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Estado intermedio, motivo y clave idempotente inválidos. Nacionalizado requiere el RPC de nacionalización.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('carpeta_id',p_carpeta_id,'estado',p_estado,'motivo',trim(p_motivo))::text);
  perform pg_advisory_xact_lock(hashtextextended('import-purchase:'||p_idempotency_key,0));
  select * into v_saved from app_private.import_purchase_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'cambiar_estado' or v_saved.payload_hash<>v_hash then raise exception 'La clave idempotente ya se usó con otros datos.' using errcode='23505'; end if;
    return v_saved.carpeta_id;
  end if;
  select * into v_folder from public.carpetas_importacion where id=p_carpeta_id for update;
  if not found then raise exception 'La carpeta no existe.' using errcode='23503'; end if;
  if not ((v_folder.estado='Abierta' and p_estado='En Tránsito') or (v_folder.estado='En Tránsito' and p_estado='En Aduanas')) then
    raise exception 'Transición inválida: se requiere avanzar Abierta → En Tránsito → En Aduanas.' using errcode='23514';
  end if;
  update public.carpetas_importacion set estado=p_estado,estado_actualizado_por=v_uid,
    estado_actualizado_en=clock_timestamp(),estado_motivo=trim(p_motivo),updated_at=clock_timestamp()
    where id=p_carpeta_id;
  insert into public.carpetas_importacion_historial(carpeta_id,evento,actor_id,motivo,datos,idempotency_key)
    values(p_carpeta_id,'Estado actualizado',v_uid,trim(p_motivo),jsonb_build_object('estado_anterior',v_folder.estado,'estado_nuevo',p_estado),p_idempotency_key);
  insert into app_private.import_purchase_idempotency(idempotency_key,operation,payload_hash,carpeta_id,result_id,actor_id)
    values(p_idempotency_key,'cambiar_estado',v_hash,p_carpeta_id,p_carpeta_id,v_uid);
  return p_carpeta_id;
end
$function$;

-- Parchea atómicamente la implementación privada de recepción vigente, no un
-- wrapper duplicado: landed cost se guarda en la línea recibida y Kardex; CxP
-- conserva el total contractual/original de la orden (no capitaliza gastos).
do $patch_import_receipt_cost$
declare
  v_definition text;
  v_marker text;
  v_start integer;
  v_end integer;
  v_stmt text;
  v_new_stmt text;
begin
  select pg_get_functiondef('app_private._registrar_recepcion_compra_v2(uuid,uuid,jsonb,text,text,text,text)'::regprocedure)
    into v_definition;
  if position('v_movimiento_id:=public.registrar_movimiento_inventario' in v_definition)>0
     and position('costo_unitario_real' in v_definition)>0
     and position('app.ec_import_nationalize_rpc' in v_definition)>0 then return; end if;
  if position('v_cantidad integer;' in v_definition)=0 then
    raise exception 'El RPC privado de recepción no contiene la declaración esperada de cantidad; no se modificó.';
  end if;
  v_definition:=replace(v_definition,'v_cantidad integer;',E'v_cantidad integer;\n  v_costo_unitario numeric(18,6);\n  v_movimiento_id uuid;');

  -- Obtiene la sentencia completa por sus límites, tolerando diferencias de
  -- espacios/deparseo y conservando el enlace a devolución cuando existe.
  v_marker:='insert into public.detalle_recepciones_compra';
  v_start:=strpos(v_definition,v_marker);
  if v_start=0 then raise exception 'No se encontró la inserción de la línea de recepción; no se modificó.'; end if;
  v_end:=strpos(substr(v_definition,v_start),';');
  if v_end=0 then raise exception 'La inserción de recepción no está completa; no se modificó.'; end if;
  v_stmt:=substr(v_definition,v_start,v_end);
  if position('v_dc.costo_unitario' in v_stmt)=0 or position('v_recepcion' in v_stmt)=0
     or position('v_dc.id' in v_stmt)=0 or position('v_producto' in v_stmt)=0 then
    raise exception 'La sentencia de recepción no coincide con el esquema esperado; no se modificó.';
  end if;
  if position('reposicion_devolucion_detalle_id' in v_stmt)>0 then
    v_new_stmt:=E'v_costo_unitario:=v_dc.costo_unitario;\n    if current_setting(''app.ec_import_nationalize_rpc'',true)=''on'' then\n      if nullif(v_line->>''costo_unitario_real'','''') is null then raise exception ''Falta costo real de importación en la línea recibida.'' using errcode=''22023''; end if;\n      v_costo_unitario:=(v_line->>''costo_unitario_real'')::numeric;\n      if v_costo_unitario<0 or v_costo_unitario::text in (''NaN'',''Infinity'',''-Infinity'') then raise exception ''Costo real de importación inválido.'' using errcode=''22023''; end if;\n    end if;\n    insert into public.detalle_recepciones_compra(recepcion_id,detalle_compra_id,producto_id,cantidad,costo_unitario,reposicion_devolucion_detalle_id) values(v_recepcion,v_dc.id,v_producto,v_cantidad,v_costo_unitario,nullif(v_line->>''devolucion_detalle_id'',''''));';
  else
    v_new_stmt:=E'v_costo_unitario:=v_dc.costo_unitario;\n    if current_setting(''app.ec_import_nationalize_rpc'',true)=''on'' then\n      if nullif(v_line->>''costo_unitario_real'','''') is null then raise exception ''Falta costo real de importación en la línea recibida.'' using errcode=''22023''; end if;\n      v_costo_unitario:=(v_line->>''costo_unitario_real'')::numeric;\n      if v_costo_unitario<0 or v_costo_unitario::text in (''NaN'',''Infinity'',''-Infinity'') then raise exception ''Costo real de importación inválido.'' using errcode=''22023''; end if;\n    end if;\n    insert into public.detalle_recepciones_compra(recepcion_id,detalle_compra_id,producto_id,cantidad,costo_unitario) values(v_recepcion,v_dc.id,v_producto,v_cantidad,v_costo_unitario);';
  end if;
  v_definition:=replace(v_definition,v_stmt,v_new_stmt);

  v_marker:='perform public.registrar_movimiento_inventario(';
  v_start:=strpos(v_definition,v_marker);
  if v_start=0 then raise exception 'No se encontró la llamada al RPC de Kardex; no se modificó.'; end if;
  v_end:=strpos(substr(v_definition,v_start),';');
  if v_end=0 then raise exception 'La llamada al RPC de Kardex no está completa; no se modificó.'; end if;
  v_stmt:=substr(v_definition,v_start,v_end);
  v_new_stmt:=replace(v_stmt,'perform public.registrar_movimiento_inventario(','v_movimiento_id:=public.registrar_movimiento_inventario(')
    ||E'\n    if current_setting(''app.ec_import_nationalize_rpc'',true)=''on'' then update public.movimientos_inventario set costo_unitario=v_costo_unitario where id=v_movimiento_id; end if;';
  v_definition:=replace(v_definition,v_stmt,v_new_stmt);
  execute v_definition;
end
$patch_import_receipt_cost$;

-- El preview calcula costos a USD antes de distribuirlos; redondea cada gasto
-- PEN al centavo USD antes de sumarlo y conserva el residuo determinístico.
create or replace function public.calcular_prorrateo_importacion_v1(p_carpeta_id uuid)
returns table(
  carpeta_id uuid,compra_id uuid,codigo_orden text,detalle_compra_id uuid,producto_id uuid,descripcion text,
  cantidad numeric,valor_linea_usd numeric,peso_valor numeric,gasto_asignado_usd numeric,
  costo_real_linea_usd numeric,costo_unitario_real_usd numeric
)
language plpgsql stable security definer set search_path = '' as $function$
declare v_folder public.carpetas_importacion%rowtype; v_expenses numeric(14,2); v_base numeric;
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','ver')) then
    raise exception 'Se requiere permiso de lectura de Compras para calcular el prorrateo.' using errcode='42501';
  end if;
  select * into v_folder from public.carpetas_importacion where id=p_carpeta_id;
  if not found then raise exception 'La carpeta no existe.' using errcode='23503'; end if;
  select coalesce(sum(case when g.moneda='USD' then g.monto else round(g.monto/nullif(g.tipo_cambio,0),2) end),0)::numeric(14,2)
    into v_expenses from public.gastos_importacion g where g.carpeta_id=p_carpeta_id;
   if exists(select 1 from public.ordenes_importacion oi join public.detalle_compras d on d.compra_id=oi.compra_id
       join public.proveedor_productos pp on pp.id=d.proveedor_producto_id
       where oi.carpeta_id=p_carpeta_id and pp.producto_id is not null
        and (d.total_linea is null or d.cantidad<=0 or d.total_linea<0)) then
    raise exception 'Todas las líneas de producto deben tener cantidad positiva y total de línea registrado.' using errcode='23514';
  end if;
   select coalesce(sum(d.total_linea),0) into v_base
     from public.ordenes_importacion oi join public.detalle_compras d on d.compra_id=oi.compra_id
     join public.proveedor_productos pp on pp.id=d.proveedor_producto_id
     where oi.carpeta_id=p_carpeta_id and pp.producto_id is not null;
  if v_base<=0 then raise exception 'No hay valor positivo de líneas de productos para prorratear los gastos.' using errcode='23514'; end if;
  return query
  with base as (
     select oi.compra_id,oi.codigo_orden,d.id as line_id,pp.producto_id,coalesce(d.descripcion,'')::text as line_description,
       d.cantidad::numeric as qty,d.total_linea::numeric(14,2) as line_value
     from public.ordenes_importacion oi join public.detalle_compras d on d.compra_id=oi.compra_id
     join public.proveedor_productos pp on pp.id=d.proveedor_producto_id
     where oi.carpeta_id=p_carpeta_id and pp.producto_id is not null
  ), ranked as (
    select b.*,sum(b.line_value) over() as denominator,row_number() over(order by b.compra_id,b.line_id) as rn,count(*) over() as n
    from base b
  ), rounded as (
    select r.*,round(v_expenses*r.line_value/nullif(r.denominator,0),2)::numeric(14,2) as rounded_allocation from ranked r
  ), allocated as (
    select r.*,case when r.rn=r.n then
      (v_expenses-coalesce(sum(r.rounded_allocation) over(order by r.compra_id,r.line_id rows between unbounded preceding and 1 preceding),0))::numeric(14,2)
      else r.rounded_allocation end as allocation from rounded r
  )
  select p_carpeta_id,a.compra_id,a.codigo_orden,a.line_id,a.producto_id,a.line_description,a.qty,
    a.line_value,round(a.line_value/a.denominator,10),a.allocation,(a.line_value+a.allocation)::numeric(14,2),
    round((a.line_value+a.allocation)/nullif(a.qty,0),6)
  from allocated a order by a.compra_id,a.line_id;
end
$function$;

create or replace function public.nacionalizar_carpeta_importacion_v1(
  p_carpeta_id uuid,p_almacen_id uuid,p_motivo text,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_folder public.carpetas_importacion%rowtype;
  v_saved app_private.import_purchase_idempotency%rowtype; v_hash text; v_order record;
  v_lines jsonb; v_receipt_id uuid; v_count integer:=0; v_cxp_id uuid;
  v_original_total numeric(14,2); v_applied numeric(14,2);
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar'))
     or not (select app_private._tiene_permiso('compras','ver'))
     or not ((select app_private._tiene_permiso('inventario','crear')) or (select app_private._tiene_permiso('inventario','editar'))) then
    raise exception 'Se requiere edición de Compras y permiso de ingreso a Inventario.' using errcode='42501';
  end if;
  if p_carpeta_id is null or p_almacen_id is null or length(trim(coalesce(p_motivo,''))) not between 5 and 500
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Carpeta, almacén, motivo y clave idempotente son obligatorios.' using errcode='22023';
  end if;
  if not exists(select 1 from public.almacenes where id=p_almacen_id and activo) then raise exception 'El almacén no existe o está inactivo.' using errcode='23503'; end if;
  v_hash:=md5(jsonb_build_object('carpeta_id',p_carpeta_id,'almacen_id',p_almacen_id,'motivo',trim(p_motivo))::text);
  perform pg_advisory_xact_lock(hashtextextended('import-purchase:'||p_idempotency_key,0));
  select * into v_saved from app_private.import_purchase_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'nacionalizar' or v_saved.payload_hash<>v_hash then raise exception 'La clave idempotente ya se usó con otros datos.' using errcode='23505'; end if;
    return v_saved.result_id;
  end if;
  select * into v_folder from public.carpetas_importacion where id=p_carpeta_id for update;
  if not found or v_folder.estado<>'En Aduanas' then raise exception 'La carpeta debe estar En Aduanas para nacionalizarse.' using errcode='23514'; end if;
  if not exists(select 1 from public.ordenes_importacion where carpeta_id=p_carpeta_id) then raise exception 'La carpeta no contiene órdenes vinculadas.' using errcode='23514'; end if;
  if exists(select 1 from public.ordenes_importacion oi join public.recepciones_compra r on r.compra_id=oi.compra_id where oi.carpeta_id=p_carpeta_id) then
    raise exception 'La carpeta contiene órdenes con recepciones previas; no se puede mezclar costo FOB y costo de importación.' using errcode='23514';
  end if;
  if exists(select 1 from public.ordenes_importacion oi join public.compras c on c.id=oi.compra_id
      where oi.carpeta_id=p_carpeta_id and (c.estado::text not in ('Confirmada','Confirmado') or c.moneda::text<>'USD'
        or c.exchange_rate is null or not c.requiere_recepcion)) then
    raise exception 'Todas las órdenes deben seguir confirmadas, USD y recepcionables.' using errcode='23514';
  end if;
   if exists(select 1 from public.ordenes_importacion oi join public.detalle_compras d on d.compra_id=oi.compra_id
       left join public.proveedor_productos pp on pp.id=d.proveedor_producto_id
       where oi.carpeta_id=p_carpeta_id and pp.producto_id is null) then
    raise exception 'Todas las líneas de una orden de importación deben corresponder a productos de inventario.' using errcode='23514';
  end if;

  perform set_config('app.ec_import_nationalize_rpc','on',true);
  for v_order in select oi.compra_id,oi.codigo_orden from public.ordenes_importacion oi where oi.carpeta_id=p_carpeta_id order by oi.compra_id loop
    select coalesce(jsonb_agg(jsonb_build_object(
      'detalle_compra_id',preview.detalle_compra_id,'cantidad',preview.cantidad,
      'costo_unitario_real',preview.costo_unitario_real_usd) order by preview.detalle_compra_id),'[]'::jsonb)
      into v_lines from public.calcular_prorrateo_importacion_v1(p_carpeta_id) preview where preview.compra_id=v_order.compra_id;
    if jsonb_array_length(v_lines)=0 then raise exception 'La orden % no tiene líneas de producto prorrateables.',v_order.codigo_orden using errcode='23514'; end if;
    v_receipt_id:=app_private._registrar_recepcion_compra_v2(
      v_order.compra_id,p_almacen_id,v_lines,
      'import-nationalize:'||substr(p_idempotency_key,1,70)||':'||v_order.compra_id::text,
      'Importación',null,trim(p_motivo));
    -- La recepción interna puede recalcular la CxP desde sus líneas recibidas.
    -- Reconciliamos aquí al total fiscal de la orden FOB; gastos logísticos no
    -- son una segunda deuda al proveedor de mercancía.
    select coalesce(sum(dc.total_linea),0)::numeric(14,2) into v_original_total
      from public.detalle_compras dc where dc.compra_id=v_order.compra_id;
    select p.id into v_cxp_id from public.pagos p
      where p.compra_id=v_order.compra_id and p.tipo='pagar' order by p.created_at,p.id limit 1 for update;
    if v_cxp_id is null then raise exception 'La recepción no creó la CxP esperada para la orden %.',v_order.codigo_orden using errcode='23514'; end if;
    select coalesce(sum(ap.monto),0)::numeric(14,2) into v_applied from public.aplicaciones_pago ap where ap.cuenta_id=v_cxp_id;
    update public.pagos set monto=greatest(v_original_total,v_applied),updated_at=clock_timestamp() where id=v_cxp_id;
    v_count:=v_count+1;
  end loop;

  update public.carpetas_importacion set estado='Nacionalizado',estado_actualizado_por=v_uid,
    estado_actualizado_en=clock_timestamp(),estado_motivo=trim(p_motivo),updated_at=clock_timestamp()
    where id=p_carpeta_id and estado='En Aduanas';
  if not found then raise exception 'La carpeta cambió de estado durante la nacionalización.' using errcode='40001'; end if;
  insert into public.carpetas_importacion_historial(carpeta_id,evento,actor_id,motivo,datos,idempotency_key)
    values(p_carpeta_id,'Nacionalizada',v_uid,trim(p_motivo),jsonb_build_object('ordenes_recibidas',v_count,'almacen_id',p_almacen_id),p_idempotency_key);
  insert into app_private.import_purchase_idempotency(idempotency_key,operation,payload_hash,carpeta_id,result_id,actor_id)
    values(p_idempotency_key,'nacionalizar',v_hash,p_carpeta_id,p_carpeta_id,v_uid);
  return p_carpeta_id;
end
$function$;

revoke all on function public.registrar_gasto_importacion_v1(uuid,text,text,numeric,text,numeric,text,text) from public,anon;
revoke all on function public.actualizar_estado_carpeta_importacion_v1(uuid,text,text,text) from public,anon;
revoke all on function public.nacionalizar_carpeta_importacion_v1(uuid,uuid,text,text) from public,anon;
grant execute on function public.registrar_gasto_importacion_v1(uuid,text,text,numeric,text,numeric,text,text) to authenticated;
grant execute on function public.actualizar_estado_carpeta_importacion_v1(uuid,text,text,text) to authenticated;
grant execute on function public.nacionalizar_carpeta_importacion_v1(uuid,uuid,text,text) to authenticated;

comment on column public.gastos_importacion.tipo_cambio is 'Para PEN, snapshot de PEN por USD; monto_usd = monto / tipo_cambio redondeado a 2 decimales. USD requiere tipo_cambio 1.';
comment on column public.movimientos_inventario.costo_unitario is 'Costo unitario snapshot de movimiento; las recepciones de importación registran landed cost.';

commit;

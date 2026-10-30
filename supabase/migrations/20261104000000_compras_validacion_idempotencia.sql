-- B10-B13: validación estricta de JSON, precisión de líneas e idempotencia.
begin;

alter table public.solicitudes_compra
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text;
alter table public.ofertas_compra
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text;
create unique index if not exists solicitudes_compra_idempotency_uidx
  on public.solicitudes_compra(idempotency_key) where idempotency_key is not null;
create unique index if not exists ofertas_compra_idempotency_uidx
  on public.ofertas_compra(idempotency_key) where idempotency_key is not null;

-- Las órdenes usan cantidad entera y costo numeric(14,2). Se valida el JSON
-- original antes de que casts a integer/numeric puedan redondear silenciosamente.
create or replace function app_private._validar_lineas_compra_v1(p_lineas jsonb,p_permitir_vacio boolean default false)
returns numeric
language plpgsql immutable set search_path = '' as $function$
declare
  v_line jsonb;
  v_qty numeric;
  v_cost numeric;
  v_total numeric := 0;
begin
  if p_lineas is null or jsonb_typeof(p_lineas)<>'array' then
    raise exception 'Las líneas deben enviarse como una lista JSON.' using errcode='22023';
  end if;
  if jsonb_array_length(p_lineas)>100 or (not p_permitir_vacio and jsonb_array_length(p_lineas)=0) then
    raise exception 'La lista de líneas está vacía o supera el máximo de 100.' using errcode='22023';
  end if;
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    if jsonb_typeof(v_line) is distinct from 'object'
       or jsonb_typeof(v_line->'cantidad') is distinct from 'number'
       or jsonb_typeof(v_line->'precio') is distinct from 'number' then
      raise exception 'Cada línea debe ser un objeto con cantidad y precio numéricos.' using errcode='22023';
    end if;
    v_qty := (v_line->>'cantidad')::numeric;
    v_cost := (v_line->>'precio')::numeric;
    if v_qty::text in ('NaN','Infinity','-Infinity') or v_cost::text in ('NaN','Infinity','-Infinity')
       or v_qty<=0 or v_qty<>trunc(v_qty) or v_qty>2147483647
       or v_cost<0 or v_cost>999999999999.99 or v_cost<>round(v_cost,2) then
      raise exception 'Cantidad debe ser entera positiva y costo finito con máximo 2 decimales y límites válidos.' using errcode='22023';
    end if;
    v_total := v_total + v_qty*v_cost;
    if v_total>999999999999.99 then raise exception 'El subtotal supera el máximo permitido.' using errcode='22003'; end if;
  end loop;
  return round(v_total,2);
end
$function$;
revoke all on function app_private._validar_lineas_compra_v1(jsonb,boolean) from public,anon;
grant execute on function app_private._validar_lineas_compra_v1(jsonb,boolean) to authenticated;

-- Prevalidación en las fachadas públicas para cubrir el flujo antes de cualquier INSERT.
create or replace function public.crear_orden_compra_operativa_v2(
  p_proveedor_id uuid,p_detalle text,p_fecha_limite date,p_monto_manual numeric,p_lineas jsonb,p_idempotency_key text
)
returns uuid language plpgsql security invoker set search_path = '' as $wrapper$
begin
  perform app_private._validar_lineas_compra_v1(p_lineas,true);
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 8 and 128 then
    raise exception 'La clave de idempotencia de la orden no es válida.' using errcode='22023';
  end if;
  return app_private._crear_orden_compra_operativa_v2(p_proveedor_id,p_detalle,p_fecha_limite,p_monto_manual,p_lineas,p_idempotency_key);
end
$wrapper$;
revoke all on function public.crear_orden_compra_operativa_v2(uuid,text,date,numeric,jsonb,text) from public,anon;
grant execute on function public.crear_orden_compra_operativa_v2(uuid,text,date,numeric,jsonb,text) to authenticated;

create or replace function public.editar_orden_compra_operativa_v1(
  p_compra_id uuid,p_expected_updated_at timestamptz,p_proveedor_id uuid,p_detalle text,
  p_fecha_limite date,p_comprobante_tipo text,p_comprobante_numero text,p_lineas jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $wrapper$
begin
  perform app_private._validar_lineas_compra_v1(p_lineas,true);
  return app_private._editar_orden_compra_operativa_v1(
    p_compra_id,p_expected_updated_at,p_proveedor_id,p_detalle,p_fecha_limite,p_comprobante_tipo,p_comprobante_numero,p_lineas
  );
end
$wrapper$;
revoke all on function public.editar_orden_compra_operativa_v1(uuid,timestamptz,uuid,text,date,text,text,jsonb) from public,anon;
grant execute on function public.editar_orden_compra_operativa_v1(uuid,timestamptz,uuid,text,date,text,text,jsonb) to authenticated;

-- Versión idempotente de creación de solicitud.
create or replace function public.crear_solicitud_compra_v2(
  p_detalle text,p_fecha_necesidad date,p_lineas jsonb,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(trim(p_idempotency_key),'');
  v_hash text;
  v_id uuid;
  v_old_hash text;
  v_line jsonb;
  v_qty numeric;
  v_producto uuid;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','crear')) then
    raise exception 'No tienes permiso para crear solicitudes de compra.' using errcode='42501';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas)<>'array' or jsonb_array_length(p_lineas)=0 or jsonb_array_length(p_lineas)>100 then
    raise exception 'La solicitud debe incluir entre 1 y 100 líneas JSON.' using errcode='22023';
  end if;
  if v_key is null or length(v_key) not between 8 and 128 then raise exception 'Falta una clave de idempotencia válida.' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_lineas) as e(value) where jsonb_typeof(e.value) is distinct from 'object') then
    raise exception 'Cada línea de solicitud debe ser un objeto JSON.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('detalle',coalesce(trim(p_detalle),''),'fecha_necesidad',p_fecha_necesidad,'lineas',p_lineas)::text);
  perform pg_advisory_xact_lock(hashtextextended('solicitud-compra:'||v_key,0));
  select id,payload_hash into v_id,v_old_hash from public.solicitudes_compra where idempotency_key=v_key for update;
  if found then
    if v_old_hash is distinct from v_hash then raise exception 'La clave de idempotencia ya se usó con otro contenido.' using errcode='23505'; end if;
    return v_id;
  end if;

  -- Validación completa previa al INSERT; cantidades numeric(14,3), no se redondean.
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    if jsonb_typeof(v_line->'cantidad') is distinct from 'number' or jsonb_typeof(v_line->'descripcion') is distinct from 'string' or jsonb_typeof(v_line->'unidad') is distinct from 'string' then
      raise exception 'Cada línea requiere descripción, unidad y cantidad numérica.' using errcode='22023';
    end if;
    v_qty:=(v_line->>'cantidad')::numeric;
    if v_qty::text in ('NaN','Infinity','-Infinity') or v_qty<=0 or v_qty>99999999999.999 or v_qty<>round(v_qty,3)
       or length(trim(v_line->>'descripcion')) not between 2 and 240 or length(trim(v_line->>'unidad')) not between 1 and 40 then
      raise exception 'Descripción, unidad o cantidad de solicitud inválida (máximo 3 decimales).' using errcode='22023';
    end if;
    v_producto:=nullif(v_line->>'producto_id','')::uuid;
    if v_producto is not null and not exists(select 1 from public.productos where id=v_producto) then
      raise exception 'El producto de una línea no existe.' using errcode='23503';
    end if;
  end loop;

  insert into public.solicitudes_compra(solicitante_id,created_by,estado,fecha_necesidad,detalle,idempotency_key,payload_hash)
  values(v_uid,v_uid,'Borrador',p_fecha_necesidad,trim(coalesce(p_detalle,'')),v_key,v_hash) returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    insert into public.solicitud_compra_lineas(solicitud_id,producto_id,descripcion,cantidad,unidad)
    values(v_id,nullif(v_line->>'producto_id','')::uuid,trim(v_line->>'descripcion'),(v_line->>'cantidad')::numeric,trim(v_line->>'unidad'));
  end loop;
  return v_id;
end
$function$;
revoke all on function public.crear_solicitud_compra_v2(text,date,jsonb,text) from public,anon;
grant execute on function public.crear_solicitud_compra_v2(text,date,jsonb,text) to authenticated;
revoke all on function public.crear_solicitud_compra(text,date,jsonb) from public,anon,authenticated;

-- Versión idempotente de registro de oferta, con precio numeric(14,4).
create or replace function public.registrar_oferta_compra_v2(
  p_solicitud_id uuid,p_proveedor_id uuid,p_vigencia_hasta date,
  p_plazo_entrega_dias integer,p_condiciones text,p_precios jsonb,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(trim(p_idempotency_key),'');
  v_hash text;
  v_oferta uuid;
  v_old_hash text;
  v_expected integer;
  v_actual integer;
  v_price record;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','crear')) then
    raise exception 'No tienes permiso para registrar ofertas.' using errcode='42501';
  end if;
  if p_precios is null or jsonb_typeof(p_precios)<>'array' or jsonb_array_length(p_precios)=0 or jsonb_array_length(p_precios)>100 then
    raise exception 'La oferta requiere una lista JSON no vacía de precios.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_precios) as e(value) where jsonb_typeof(e.value) is distinct from 'object') then
    raise exception 'Cada precio de oferta debe ser un objeto JSON.' using errcode='22023';
  end if;
  if v_key is null or length(v_key) not between 8 and 128 then raise exception 'Falta una clave de idempotencia válida.' using errcode='22023'; end if;
  v_hash:=md5(jsonb_build_object('solicitud_id',p_solicitud_id,'proveedor_id',p_proveedor_id,'vigencia_hasta',p_vigencia_hasta,
    'plazo_entrega_dias',p_plazo_entrega_dias,'condiciones',coalesce(trim(p_condiciones),''),'precios',p_precios)::text);
  perform pg_advisory_xact_lock(hashtextextended('oferta-compra:'||v_key,0));
  select id,payload_hash into v_oferta,v_old_hash from public.ofertas_compra where idempotency_key=v_key for update;
  if found then
    if v_old_hash is distinct from v_hash then raise exception 'La clave de idempotencia ya se usó con otro contenido.' using errcode='23505'; end if;
    return v_oferta;
  end if;
  if p_solicitud_id is null or p_proveedor_id is null then raise exception 'Selecciona solicitud y proveedor.' using errcode='22023'; end if;
  perform 1 from public.solicitudes_compra s where s.id=p_solicitud_id and s.estado='Abierta' for update;
  if not found then raise exception 'La solicitud no está abierta.' using errcode='23514'; end if;
  select count(*) into v_expected from public.solicitud_compra_lineas where solicitud_id=p_solicitud_id;
  select count(*) into v_actual from jsonb_array_elements(p_precios);
  if v_expected=0 or v_actual<>v_expected then raise exception 'Debe cotizarse cada línea de la solicitud.' using errcode='22023'; end if;
  for v_price in select * from jsonb_to_recordset(p_precios) as x(linea_id uuid,precio_unitario numeric) loop
    if v_price.linea_id is null or v_price.precio_unitario is null or v_price.precio_unitario::text in ('NaN','Infinity','-Infinity')
       or v_price.precio_unitario<0 or v_price.precio_unitario>9999999999.9999 or v_price.precio_unitario<>round(v_price.precio_unitario,4)
       or not exists(select 1 from public.solicitud_compra_lineas where id=v_price.linea_id and solicitud_id=p_solicitud_id) then
      raise exception 'Hay precios inválidos o líneas que no pertenecen a la solicitud.' using errcode='22023';
    end if;
  end loop;
  if (select count(distinct x.linea_id) from jsonb_to_recordset(p_precios) as x(linea_id uuid,precio_unitario numeric))<>v_expected then
    raise exception 'Cada línea debe aparecer una sola vez en la oferta.' using errcode='22023';
  end if;
  if exists(select 1 from public.ofertas_compra where solicitud_id=p_solicitud_id and proveedor_id=p_proveedor_id) then
    raise exception 'Este proveedor ya tiene una oferta registrada para la solicitud.' using errcode='23505';
  end if;
  insert into public.ofertas_compra(solicitud_id,proveedor_id,vigencia_hasta,plazo_entrega_dias,condiciones,created_by,idempotency_key,payload_hash)
  values(p_solicitud_id,p_proveedor_id,p_vigencia_hasta,p_plazo_entrega_dias,trim(coalesce(p_condiciones,'')),v_uid,v_key,v_hash) returning id into v_oferta;
  insert into public.detalle_ofertas_compra(oferta_id,solicitud_linea_id,precio_unitario)
  select v_oferta,x.linea_id,x.precio_unitario from jsonb_to_recordset(p_precios) as x(linea_id uuid,precio_unitario numeric);
  return v_oferta;
end
$function$;
revoke all on function public.registrar_oferta_compra_v2(uuid,uuid,date,integer,text,jsonb,text) from public,anon;
grant execute on function public.registrar_oferta_compra_v2(uuid,uuid,date,integer,text,jsonb,text) to authenticated;
revoke all on function public.registrar_oferta_compra(uuid,uuid,date,integer,text,jsonb) from public,anon,authenticated;

commit;

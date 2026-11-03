-- Modelo B (canónico): capa de RPCs alineada al modelo extendido.
--   1. Líneas con unidad maestra y cantidad fraccionaria (numeric(14,3)).
--   2. Multi-moneda en la oferta del proveedor (PEN/USD + exchange_rate).
--   3. Historial de la requisición en cada evento del ciclo de vida.
--   4. Edición con bloqueo optimista (p_expected_version) y anulación con motivo.
--   5. Lectura paginada y detalle consolidado.
--   6. Unifica el ajuste de inventario: _registrar_ajuste_inventario deja de ser solo
--      delta y pasa a registrar el asiento formal en ajustes_inventario; se retira
--      public.ec_registrar_ajuste_inventario (implementación paralela con valor absoluto).
begin;

-- 0) Nuevos estados y transiciones idempotentes reconocidas.
alter table public.requisiciones_compra drop constraint if exists requisiciones_compra_estado_check;
alter table public.requisiciones_compra
  add constraint requisiciones_compra_estado_check
  check (estado in ('Pendiente', 'Aprobada', 'Rechazada', 'Completada', 'Anulada'));

alter table app_private.purchase_transition_idempotency
  drop constraint if exists purchase_transition_idempotency_operation_fase_d_ck;
alter table app_private.purchase_transition_idempotency
  add constraint purchase_transition_idempotency_operation_fase_d_ck
  check (operation in (
    'abrir_solicitud', 'seleccionar_oferta', 'seleccionar_oferta_con_motivo',
    'editar_solicitud', 'cancelar_solicitud',
    'editar_requisicion', 'anular_requisicion'
  ));

-- 1) Normalización compartida de líneas de requisición.
create or replace function app_private._normalizar_lineas_requisicion(p_lineas jsonb)
returns table (producto_id uuid, descripcion text, cantidad numeric, unidad text, unidad_medida_id uuid)
language plpgsql security definer set search_path = ''
as $function$
declare
  v_line jsonb; v_prod uuid; v_unidad uuid; v_simbolo text; v_cant numeric; v_desc text;
begin
  if p_lineas is null or jsonb_typeof(p_lineas) is distinct from 'array'
     or jsonb_array_length(p_lineas) = 0 or jsonb_array_length(p_lineas) > 100 then
    raise exception 'La lista de líneas necesita entre 1 y 100 objetos.' using errcode = '22023';
  end if;
  if (select count(*) from (
        select 1 from jsonb_array_elements(p_lineas)
        where nullif(btrim(coalesce(value ->> 'producto_id', '')), '') is not null
        group by value ->> 'producto_id' having count(*) > 1
      ) repetidos) > 0 then
    raise exception 'Un producto solo puede aparecer una vez en la solicitud.' using errcode = '22023';
  end if;

  for v_line in select value from jsonb_array_elements(p_lineas) loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'Cada línea debe ser un objeto JSON.' using errcode = '22023';
    end if;
    v_prod := nullif(btrim(coalesce(v_line ->> 'producto_id', '')), '')::uuid;
    v_unidad := nullif(btrim(coalesce(v_line ->> 'unidad_medida_id', '')), '')::uuid;
    v_cant := nullif(v_line ->> 'cantidad', '')::numeric;
    v_desc := coalesce(btrim(v_line ->> 'descripcion'), '');

    if v_cant is null or v_cant::text in ('NaN', 'Infinity', '-Infinity') or v_cant <= 0
       or v_cant <> round(v_cant, 3) or v_cant > 99999999999.999 then
      raise exception 'La cantidad de cada línea debe ser mayor que cero con hasta 3 decimales.' using errcode = '22023';
    end if;
    if length(v_desc) > 240 then
      raise exception 'La descripción de cada línea admite hasta 240 caracteres.' using errcode = '22023';
    end if;

    if v_prod is not null then
      if not exists (select 1 from public.productos p where p.id = v_prod) then
        raise exception 'El producto de una línea ya no existe. Recarga la página.' using errcode = '23503';
      end if;
      if v_unidad is not null and v_unidad is distinct from
           (select p.unidad_medida_id from public.productos p where p.id = v_prod) then
        raise exception 'El producto usa otra unidad maestra; alinea la línea antes de continuar.' using errcode = '22023';
      end if;
      v_unidad := (select p.unidad_medida_id from public.productos p where p.id = v_prod);
    else
      if length(v_desc) < 2 then
        raise exception 'Cada línea necesita un producto del catálogo o una descripción del artículo.' using errcode = '22023';
      end if;
      if v_unidad is not null and not exists (
        select 1 from public.unidades_medida u where u.id = v_unidad and u.activo
      ) then
        raise exception 'La unidad maestra indicada no existe o está inactiva.' using errcode = '23503';
      end if;
    end if;

    v_simbolo := coalesce(
      (select u.simbolo from public.unidades_medida u where u.id = v_unidad), 'unidad');

    producto_id := v_prod; descripcion := v_desc; cantidad := v_cant;
    unidad := v_simbolo; unidad_medida_id := v_unidad;
    return next;
  end loop;
end;
$function$;

-- 2) Crear requisición: unidades fraccionarias + registro de nacimiento en historial.
create or replace function app_private._crear_requisicion_compra(
  p_detalle text, p_fecha_necesaria date, p_lineas jsonb, p_idempotency_key text)
returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_hash text; v_req_id uuid; v_payload_hash text;
begin
  if v_uid is null
     or not (select app_private._tiene_permiso('compras', 'crear')) then
    raise exception 'Se requiere permiso para registrar solicitudes de compra.'
      using errcode = '42501';
  end if;
  if v_key is null or length(v_key) not between 8 and 128 then
    raise exception 'Falta la clave de idempotencia de la solicitud.' using errcode = '22023';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array'
     or jsonb_array_length(p_lineas) = 0 or jsonb_array_length(p_lineas) > 100 then
    raise exception 'La solicitud necesita entre 1 y 100 líneas.' using errcode = '22023';
  end if;

  v_hash := md5(concat_ws('|', coalesce(btrim(p_detalle), ''),
    coalesce(p_fecha_necesaria::text, ''), p_lineas::text));
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  select id, payload_hash into v_req_id, v_payload_hash
  from public.requisiciones_compra where idempotency_key = v_key for update;
  if found then
    if v_payload_hash is not distinct from v_hash then
      return v_req_id;
    end if;
    raise exception 'La clave de solicitud ya fue usada con otro contenido.' using errcode = '23505';
  end if;

  insert into public.requisiciones_compra
    (detalle, fecha_necesaria, version, idempotency_key, payload_hash, created_by)
  values
    (coalesce(btrim(p_detalle), ''), p_fecha_necesaria, 1, v_key, v_hash, v_uid)
  returning id into v_req_id;

  insert into public.detalle_requisiciones_compra
    (requisicion_id, producto_id, descripcion, cantidad, unidad, unidad_medida_id)
  select v_req_id, x.producto_id, x.descripcion, x.cantidad, x.unidad, x.unidad_medida_id
  from app_private._normalizar_lineas_requisicion(p_lineas) as x;

  insert into public.requisiciones_compra_historial
    (requisicion_id, evento, version_anterior, version_nueva, actor_id, datos_despues, idempotency_key)
  values
    (v_req_id, 'creacion', null, 1, v_uid,
     jsonb_build_object(
       'detalle', coalesce(btrim(p_detalle), ''), 'fecha_necesaria', p_fecha_necesaria,
       'estado', 'Pendiente', 'version', 1,
       'lineas', (select coalesce(jsonb_agg(to_jsonb(d) - 'requisicion_id' order by d.id), '[]'::jsonb)
                  from public.detalle_requisiciones_compra d where d.requisicion_id = v_req_id)),
     v_key);

  return v_req_id;
end;
$function$;

-- 3) Editar con bloqueo optimista + historial.
create or replace function app_private._editar_requisicion_compra(
  p_requisicion_id uuid, p_expected_version integer, p_detalle text,
  p_fecha_necesaria date, p_lineas jsonb, p_idempotency_key text)
returns integer
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_hash text; v_saved app_private.purchase_transition_idempotency%rowtype;
  v_req public.requisiciones_compra%rowtype;
  v_antes jsonb; v_despues jsonb; v_nueva integer; v_version_guardada integer;
begin
  if v_uid is null
     or not (select app_private._tiene_permiso('compras', 'editar')) then
    raise exception 'Se requiere permiso de edición para editar solicitudes.'
      using errcode = '42501';
  end if;
  if p_requisicion_id is null or p_expected_version is null or p_expected_version < 1
     or p_lineas is null or jsonb_typeof(p_lineas) is distinct from 'array'
     or jsonb_array_length(p_lineas) = 0 or jsonb_array_length(p_lineas) > 100
     or v_key is null or length(v_key) not between 8 and 128 then
    raise exception 'Datos de edición o clave de idempotencia inválidos.' using errcode = '22023';
  end if;

  v_hash := md5(jsonb_build_object(
    'requisicion_id', p_requisicion_id, 'version', p_expected_version,
    'detalle', coalesce(btrim(p_detalle), ''), 'fecha_necesaria', p_fecha_necesaria,
    'lineas', p_lineas)::text);
  perform pg_advisory_xact_lock(hashtextextended('requisicion:' || v_key, 0));

  select * into v_saved from app_private.purchase_transition_idempotency
  where idempotency_key = v_key;
  if found then
    if v_saved.operation <> 'editar_requisicion' or v_saved.payload_hash <> v_hash then
      raise exception 'La clave de esta edición ya fue usada con otra operación o contenido.'
        using errcode = '23505';
    end if;
    return coalesce(v_saved.result_version, p_expected_version + 1);
  end if;

  select * into v_req from public.requisiciones_compra where id = p_requisicion_id for update;
  if not found then
    raise exception 'La solicitud no existe.' using errcode = '23503';
  end if;
  if v_req.estado <> 'Pendiente' or v_req.version is distinct from p_expected_version
     or v_req.compra_id is not null
     or exists (select 1 from public.ofertas_proveedor o where o.requisicion_id = p_requisicion_id) then
    raise exception 'Solo se edita la solicitud pendiente vigente sin ofertas ni orden; recarga la página.'
      using errcode = '40001';
  end if;

  v_antes := jsonb_build_object(
    'detalle', v_req.detalle, 'fecha_necesaria', v_req.fecha_necesaria,
    'estado', v_req.estado, 'version', v_req.version,
    'lineas', (select coalesce(jsonb_agg(to_jsonb(d) - 'requisicion_id' order by d.id), '[]'::jsonb)
               from public.detalle_requisiciones_compra d where d.requisicion_id = p_requisicion_id));

  delete from public.detalle_requisiciones_compra where requisicion_id = p_requisicion_id;
  insert into public.detalle_requisiciones_compra
    (requisicion_id, producto_id, descripcion, cantidad, unidad, unidad_medida_id)
  select p_requisicion_id, x.producto_id, x.descripcion, x.cantidad, x.unidad, x.unidad_medida_id
  from app_private._normalizar_lineas_requisicion(p_lineas) as x;

  v_nueva := v_req.version + 1;
  update public.requisiciones_compra
  set detalle = coalesce(btrim(p_detalle), ''), fecha_necesaria = p_fecha_necesaria,
      version = v_nueva, updated_by = v_uid, updated_at = clock_timestamp()
  where id = p_requisicion_id;

  v_despues := jsonb_build_object(
    'detalle', coalesce(btrim(p_detalle), ''), 'fecha_necesaria', p_fecha_necesaria,
    'estado', 'Pendiente', 'version', v_nueva,
    'lineas', (select coalesce(jsonb_agg(to_jsonb(d) - 'requisicion_id' order by d.id), '[]'::jsonb)
               from public.detalle_requisiciones_compra d where d.requisicion_id = p_requisicion_id));

  insert into public.requisiciones_compra_historial
    (requisicion_id, evento, version_anterior, version_nueva, actor_id, datos_antes, datos_despues, idempotency_key)
  values
    (p_requisicion_id, 'edicion', v_req.version, v_nueva, v_uid, v_antes, v_despues, v_key);

  insert into app_private.purchase_transition_idempotency
    (idempotency_key, operation, payload_hash, result_id, result_version)
  values (v_key, 'editar_requisicion', v_hash, p_requisicion_id, v_nueva);

  return v_nueva;
end;
$function$;

-- 4) Listado paginado y detalle consolidado.
create or replace function app_private._listar_requisiciones_paginado(
  p_estado text, p_desde date, p_hasta date, p_referencia text,
  p_limit integer, p_offset integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_estado text := nullif(btrim(coalesce(p_estado, '')), '');
  v_ref text := nullif(btrim(coalesce(p_referencia, '')), '');
  v_total bigint; v_filas jsonb;
begin
  if (select auth.uid()) is null
     or not (select app_private._tiene_permiso('compras', 'ver')) then
    raise exception 'Se requiere permiso para consultar solicitudes de compra.'
      using errcode = '42501';
  end if;
  if v_estado is not null and v_estado not in
     ('Pendiente', 'Aprobada', 'Rechazada', 'Completada', 'Anulada') then
    raise exception 'El estado del filtro no es válido.' using errcode = '22023';
  end if;
  if v_ref is not null and length(v_ref) < 2 then
    raise exception 'La referencia del filtro debe tener al menos 2 caracteres.' using errcode = '22023';
  end if;

  select count(*) into v_total
  from public.requisiciones_compra r
  where (v_estado is null or r.estado = v_estado)
    and (p_desde is null or r.created_at::date >= p_desde)
    and (p_hasta is null or r.created_at::date <= p_hasta)
    and (v_ref is null or r.codigo ilike '%' || v_ref || '%' or r.detalle ilike '%' || v_ref || '%');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'codigo', s.codigo, 'detalle', s.detalle, 'estado', s.estado,
    'fecha_necesaria', s.fecha_necesaria, 'compra_id', s.compra_id, 'version', s.version,
    'creado_en', s.created_at, 'creado_por', s.created_by) order by s.created_at desc), '[]'::jsonb)
  into v_filas
  from (
    select r.*
    from public.requisiciones_compra r
    where (v_estado is null or r.estado = v_estado)
      and (p_desde is null or r.created_at::date >= p_desde)
      and (p_hasta is null or r.created_at::date <= p_hasta)
      and (v_ref is null or r.codigo ilike '%' || v_ref || '%' or r.detalle ilike '%' || v_ref || '%')
    order by r.created_at desc
    limit v_limit offset v_offset
  ) s;

  return jsonb_build_object(
    'total', v_total, 'limit', v_limit, 'offset', v_offset, 'filas', v_filas);
end;
$function$;

create or replace function app_private._obtener_detalle_requisicion(p_requisicion_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_req public.requisiciones_compra%rowtype;
  v_lineas jsonb; v_ofertas jsonb; v_historial jsonb;
begin
  if (select auth.uid()) is null
     or not (select app_private._tiene_permiso('compras', 'ver')) then
    raise exception 'Se requiere permiso para consultar la solicitud.' using errcode = '42501';
  end if;
  if p_requisicion_id is null then
    raise exception 'Selecciona la solicitud.' using errcode = '22023';
  end if;

  select * into v_req from public.requisiciones_compra where id = p_requisicion_id;
  if not found then
    raise exception 'La solicitud no existe.' using errcode = '23503';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'producto_id', d.producto_id, 'descripcion', d.descripcion,
    'cantidad', d.cantidad, 'unidad', d.unidad, 'unidad_medida_id', d.unidad_medida_id
  ) order by d.id), '[]'::jsonb)
  into v_lineas
  from public.detalle_requisiciones_compra d where d.requisicion_id = v_req.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'proveedor_id', o.proveedor_id, 'vigencia_hasta', o.vigencia_hasta,
    'moneda', o.moneda, 'exchange_rate', o.exchange_rate, 'ganadora', o.ganadora,
    'observacion', o.observacion, 'creado_en', o.created_at,
    'lineas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'linea_requisicion_id', l.linea_requisicion_id, 'cantidad', l.cantidad,
        'precio_unitario', l.precio_unitario, 'tratamiento_fiscal', l.tratamiento_fiscal,
        'tasa_igv', l.tasa_igv, 'subtotal', l.subtotal) order by l.id)
      from public.detalle_ofertas_proveedor l where l.oferta_id = o.id), '[]'::jsonb)
  ) order by o.created_at), '[]'::jsonb)
  into v_ofertas
  from public.ofertas_proveedor o where o.requisicion_id = v_req.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'evento', h.evento, 'version_anterior', h.version_anterior, 'version_nueva', h.version_nueva,
    'motivo', h.motivo, 'creado_en', h.created_at
  ) order by h.created_at), '[]'::jsonb)
  into v_historial
  from public.requisiciones_compra_historial h where h.requisicion_id = v_req.id
  and h.evento <> 'creacion';

  return jsonb_build_object(
    'cabecera', jsonb_build_object(
      'id', v_req.id, 'codigo', v_req.codigo, 'detalle', v_req.detalle,
      'estado', v_req.estado, 'fecha_necesaria', v_req.fecha_necesaria,
      'version', v_req.version, 'compra_id', v_req.compra_id,
      'motivo_rechazo', v_req.motivo_rechazo, 'creado_en', v_req.created_at,
      'creado_por', v_req.created_by, 'actualizado_en', v_req.updated_at),
    'lineas', v_lineas, 'ofertas', v_ofertas, 'historial', v_historial);
end;
$function$;

-- 5) Anular con motivo, conservando la solicitud en el historial.
drop function if exists app_private._anular_requisicion_compra(uuid);
drop function if exists public.anular_requisicion_compra(uuid);
create or replace function app_private._anular_requisicion_compra(
  p_requisicion_id uuid, p_motivo text, p_idempotency_key text)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_motivo text := nullif(btrim(p_motivo), '');
  v_req public.requisiciones_compra%rowtype; v_saved app_private.purchase_transition_idempotency%rowtype;
  v_hash text;
begin
  if v_uid is null
     or not (select app_private._tiene_permiso('compras', 'eliminar')) then
    raise exception 'Se requiere permiso de eliminación para anular solicitudes.'
      using errcode = '42501';
  end if;
  if p_requisicion_id is null or v_motivo is null
     or length(v_motivo) not between 3 and 1000
     or v_key is null or length(v_key) not between 8 and 128 then
    raise exception 'Indica la solicitud, un motivo y una clave de idempotencia.'
      using errcode = '22023';
  end if;

  v_hash := md5(concat_ws('|', p_requisicion_id::text, v_motivo));
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
    raise exception 'La solicitud ya generó una orden de compra: no se puede anular.' using errcode = '22023';
  end if;
  if v_req.estado = 'Anulada' then
    raise exception 'La solicitud ya está anulada. Recarga la página.' using errcode = '22023';
  end if;

  update public.requisiciones_compra set estado = 'Anulada', updated_by = v_uid
  where id = p_requisicion_id;

  insert into public.requisiciones_compra_historial
    (requisicion_id, evento, version_anterior, version_nueva, actor_id, motivo, datos_antes, datos_despues, idempotency_key)
  values
    (p_requisicion_id, 'anulacion', v_req.version, v_req.version, v_uid, v_motivo,
     jsonb_build_object('estado', v_req.estado, 'version', v_req.version),
     jsonb_build_object('estado', 'Anulada'), v_key);

  insert into app_private.purchase_transition_idempotency
    (idempotency_key, operation, payload_hash, result_id, result_version)
  values (v_key, 'anular_requisicion', v_hash, p_requisicion_id, v_req.version);
end;
$function$;

-- 6) Aprobar / rechazar deja huella en el historial.
create or replace function app_private._decidir_requisicion_compra(
  p_requisicion_id uuid, p_aprobar boolean, p_motivo text)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_estado_anterior public.estado_registro;
  v_nuevo_estado public.estado_registro;
begin
  if v_uid is null
     or not (select app_private._tiene_permiso('compras', 'editar')) then
    raise exception 'Se requiere permiso de edición para aprobar solicitudes.'
      using errcode = '42501';
  end if;
  if p_requisicion_id is null then
    raise exception 'Selecciona la solicitud a revisar.' using errcode = '22023';
  end if;
  select estado into v_estado_anterior
  from public.requisiciones_compra where id = p_requisicion_id for update;
  if not found then
    raise exception 'La solicitud ya no existe. Recarga la página.' using errcode = '23503';
  end if;
  if v_estado_anterior <> 'Pendiente' then
    raise exception 'La solicitud ya fue revisada (estado actual: %).', v_estado_anterior
      using errcode = '22023';
  end if;

  if p_aprobar then
    v_nuevo_estado := 'Aprobada';
    update public.requisiciones_compra
    set estado = 'Aprobada', aprobado_por = v_uid, aprobado_at = now(), motivo_rechazo = null
    where id = p_requisicion_id;
  else
    if v_motivo is null then
      raise exception 'Indica el motivo del rechazo.' using errcode = '22023';
    end if;
    v_nuevo_estado := 'Rechazada';
    update public.requisiciones_compra
    set estado = 'Rechazada', motivo_rechazo = v_motivo
    where id = p_requisicion_id;
  end if;

  insert into public.requisiciones_compra_historial
    (requisicion_id, evento, version_anterior, version_nueva, actor_id, motivo, datos_antes, datos_despues)
  values
    (p_requisicion_id,
     case when p_aprobar then 'aprobacion' else 'rechazo' end,
     (select version from public.requisiciones_compra where id = p_requisicion_id),
     (select version from public.requisiciones_compra where id = p_requisicion_id),
     v_uid, v_motivo,
     jsonb_build_object('estado', v_estado_anterior),
     jsonb_build_object('estado', v_nuevo_estado));
end;
$function$;

-- 7) Selección de oferta ganadora deja huella en el historial.
create or replace function app_private._seleccionar_oferta_proveedor(p_oferta_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_requisicion_id uuid; v_vigencia date; v_estado public.estado_registro;
  v_anterior_id uuid; v_cobertura integer; v_lineas_solicitadas integer; v_version integer;
begin
  if v_uid is null
     or not (select app_private._tiene_permiso('compras', 'editar')) then
    raise exception 'Se requiere permiso de edición para elegir la oferta ganadora.'
      using errcode = '42501';
  end if;
  if p_oferta_id is null then
    raise exception 'Selecciona la oferta ganadora.' using errcode = '22023';
  end if;

  select o.requisicion_id, o.vigencia_hasta, r.estado, r.version
  into v_requisicion_id, v_vigencia, v_estado, v_version
  from public.ofertas_proveedor o
  join public.requisiciones_compra r on r.id = o.requisicion_id
  where o.id = p_oferta_id
  for update of o;
  if not found then
    raise exception 'La oferta ya no existe. Recarga la página.' using errcode = '23503';
  end if;
  if v_estado <> 'Aprobada' then
    raise exception 'El comparativo ya se resolvió (estado de la solicitud: %).', v_estado
      using errcode = '22023';
  end if;
  if v_vigencia is not null and v_vigencia < current_date then
    raise exception 'La oferta está vencida: pide al proveedor una oferta vigente.' using errcode = '22023';
  end if;
  select count(*) into v_lineas_solicitadas
  from public.detalle_requisiciones_compra where requisicion_id = v_requisicion_id;
  select count(distinct linea_requisicion_id) into v_cobertura
  from public.detalle_ofertas_proveedor where oferta_id = p_oferta_id;
  if v_cobertura <> v_lineas_solicitadas then
    raise exception 'La oferta no cubre todas las líneas de la solicitud.' using errcode = '22023';
  end if;

  select id into v_anterior_id from public.ofertas_proveedor
  where requisicion_id = v_requisicion_id and ganadora;

  update public.ofertas_proveedor
  set ganadora = false, ganadora_por = null, ganadora_at = null
  where requisicion_id = v_requisicion_id;
  update public.ofertas_proveedor
  set ganadora = true, ganadora_por = v_uid, ganadora_at = now()
  where id = p_oferta_id;

  insert into public.requisiciones_compra_historial
    (requisicion_id, evento, version_anterior, version_nueva, actor_id, datos_antes, datos_despues)
  values
    (v_requisicion_id, 'seleccion_oferta', v_version, v_version, v_uid,
     jsonb_build_object('ganadora_anterior_id', v_anterior_id),
     jsonb_build_object('ganadora_nueva_id', p_oferta_id));
end;
$function$;

-- 8) Generar la orden deja huella en el historial; la oferta cotiza la fracción exacta.
create or replace function app_private._generar_orden_desde_oferta(
  p_oferta_id uuid, p_fecha_limite date, p_idempotency_key text)
returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(trim(p_idempotency_key), '');
  v_oferta_id uuid; v_requisicion_id uuid; v_proveedor_id uuid;
  v_estado public.estado_registro; v_compra_id uuid;
  v_req_codigo text; v_req_detalle text; v_version integer; v_lineas_orden jsonb;
begin
  if v_uid is null
     or not (select app_private._tiene_permiso('compras', 'crear')) then
    raise exception 'Se requiere permiso para crear compras.' using errcode = '42501';
  end if;
  if v_key is null then
    raise exception 'Falta la clave de idempotencia de la generación.' using errcode = '22023';
  end if;
  if p_oferta_id is null then
    raise exception 'Selecciona la oferta ganadora.' using errcode = '22023';
  end if;

  select o.id, o.requisicion_id, o.proveedor_id, r.estado, r.version
  into v_oferta_id, v_requisicion_id, v_proveedor_id, v_estado, v_version
  from public.ofertas_proveedor o
  join public.requisiciones_compra r on r.id = o.requisicion_id
  where o.id = p_oferta_id
  for update of o;
  if not found then
    raise exception 'La oferta ya no existe. Recarga la página.' using errcode = '23503';
  end if;
  if not (select ganadora from public.ofertas_proveedor where id = v_oferta_id) then
    raise exception 'Solo la oferta ganadora puede generar la orden de compra.' using errcode = '22023';
  end if;
  if v_estado <> 'Aprobada' then
    raise exception 'La solicitud ya no está en comparativo (estado actual: %).', v_estado
      using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object(
    'producto_id', pp.id,
    'cantidad', ol.cantidad,
    'precio', ol.precio_unitario,
    'tratamiento_fiscal', ol.tratamiento_fiscal,
    'tasa_igv', ol.tasa_igv
  ))
  into v_lineas_orden
  from public.detalle_ofertas_proveedor ol
  join public.detalle_requisiciones_compra rl on rl.id = ol.linea_requisicion_id
  left join public.proveedor_productos pp
    on pp.proveedor_id = v_proveedor_id and pp.producto_id = rl.producto_id
  where ol.oferta_id = v_oferta_id;

  if v_lineas_orden is null
     or (select count(*) from jsonb_array_elements(v_lineas_orden))
         <> (select count(*) from public.detalle_ofertas_proveedor where oferta_id = v_oferta_id) then
    raise exception 'El proveedor ganador no tiene catalogados todos los productos solicitados. Vincula su catálogo antes de generar la orden.'
      using errcode = '23503';
  end if;

  select codigo, detalle into v_req_codigo, v_req_detalle
  from public.requisiciones_compra where id = v_requisicion_id for update;

  v_compra_id := app_private._crear_orden_compra_operativa(
    v_proveedor_id,
    'Solicitud ' || v_req_codigo || coalesce(nullif(' · ' || coalesce(v_req_detalle, ''), ' · '), ''),
    p_fecha_limite,
    0,
    v_lineas_orden,
    v_key
  );

  update public.requisiciones_compra
  set estado = 'Completada', compra_id = v_compra_id
  where id = v_requisicion_id;

  insert into public.requisiciones_compra_historial
    (requisicion_id, evento, version_anterior, version_nueva, actor_id, datos_despues)
  values
    (v_requisicion_id, 'orden_generada', v_version, v_version, v_uid,
     jsonb_build_object('compra_id', v_compra_id, 'oferta_id', v_oferta_id));

  return v_compra_id;
end;
$function$;

-- 9) Oferta del proveedor con moneda y tipo de cambio.
drop function if exists app_private._registrar_oferta_proveedor(uuid, uuid, date, text, jsonb, text);
drop function if exists public.registrar_oferta_proveedor(uuid, uuid, date, text, jsonb, text);
create or replace function app_private._registrar_oferta_proveedor(
  p_requisicion_id uuid, p_proveedor_id uuid, p_vigencia_hasta date, p_observacion text,
  p_lineas jsonb, p_idempotency_key text,
  p_moneda text default 'PEN', p_exchange_rate numeric default null)
returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(trim(p_idempotency_key), '');
  v_hash text; v_oferta_id uuid; v_payload_hash text;
  v_estado public.estado_registro; v_proveedor_nombre text;
  v_line jsonb; v_linea_req uuid; v_cantidad numeric; v_precio numeric;
  v_tratamiento text; v_tasa numeric(5,2); v_cobertura integer; v_lineas_solicitadas integer;
  v_moneda text := coalesce(btrim(coalesce(p_moneda, 'PEN')), 'PEN');
  v_rate numeric(14,6);
begin
  if v_uid is null
     or not (select app_private._tiene_permiso('compras', 'crear')) then
    raise exception 'Se requiere permiso para registrar ofertas de proveedores.'
      using errcode = '42501';
  end if;
  if v_key is null then
    raise exception 'Falta la clave de idempotencia de la oferta.' using errcode = '22023';
  end if;
  if p_proveedor_id is null then
    raise exception 'Selecciona el proveedor que hace la oferta.' using errcode = '22023';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La oferta necesita al menos una línea.' using errcode = '22023';
  end if;
  if p_vigencia_hasta is not null and p_vigencia_hasta < current_date then
    raise exception 'La vigencia de la oferta no puede ser anterior a hoy.' using errcode = '22023';
  end if;
  if v_moneda not in ('PEN', 'USD') then
    raise exception 'La moneda de la oferta solo admite PEN o USD.' using errcode = '22023';
  end if;
  if v_moneda = 'USD' then
    if p_exchange_rate is null or p_exchange_rate <= 0
       or p_exchange_rate::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'Indica el tipo de cambio aplicable a la oferta en USD.' using errcode = '22023';
    end if;
    v_rate := round(p_exchange_rate, 6);
  else
    v_rate := 1;
  end if;

  select estado into v_estado
  from public.requisiciones_compra where id = p_requisicion_id for share;
  if not found then
    raise exception 'La solicitud ya no existe. Recarga la página.' using errcode = '23503';
  end if;
  if v_estado <> 'Aprobada' then
    raise exception 'Solo se pueden registrar ofertas sobre solicitudes aprobadas (estado actual: %).',
      v_estado using errcode = '22023';
  end if;

  select razon_social into v_proveedor_nombre
  from public.proveedores where id = p_proveedor_id for share;
  if not found then
    raise exception 'El proveedor ya no existe. Recarga y vuelve a seleccionarlo.' using errcode = '23503';
  end if;

  v_hash := md5(concat_ws('|', p_requisicion_id::text, p_proveedor_id::text,
    coalesce(p_vigencia_hasta::text, ''), coalesce(trim(p_observacion), ''), p_lineas::text,
    v_moneda, coalesce(v_rate::text, '')));
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  select id, payload_hash into v_oferta_id, v_payload_hash
  from public.ofertas_proveedor where idempotency_key = v_key for update;
  if found then
    if v_payload_hash is not distinct from v_hash then
      return v_oferta_id;
    end if;
    raise exception 'La clave de oferta ya fue usada con otro contenido.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.ofertas_proveedor
    where requisicion_id = p_requisicion_id and proveedor_id = p_proveedor_id
  ) then
    raise exception 'Ese proveedor ya registró una oferta para esta solicitud.' using errcode = '23505';
  end if;

  for v_line in select value from jsonb_array_elements(p_lineas) loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'Cada línea de la oferta debe ser un objeto JSON.' using errcode = '22023';
    end if;
    v_linea_req := nullif(btrim(coalesce(v_line->>'linea_requisicion_id', '')), '')::uuid;
    v_cantidad := nullif(v_line->>'cantidad', '')::numeric;
    v_precio := nullif(v_line->>'precio', '')::numeric;
    if v_linea_req is null then
      raise exception 'Cada línea de la oferta debe señalar la línea de la solicitud que cotiza.'
        using errcode = '22023';
    end if;
    if v_cantidad is null or v_cantidad <= 0 or v_cantidad <> round(v_cantidad, 3)
       or v_precio is null or v_precio < 0
       or v_precio::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'Una línea de la oferta tiene cantidad o precio no válido.' using errcode = '22023';
    end if;
    v_tratamiento := coalesce(nullif(btrim(v_line->>'tratamiento_fiscal'), ''), 'gravado');
    if v_tratamiento not in ('gravado', 'exonerado', 'inafecto') then
      raise exception 'El tratamiento fiscal de una línea no es válido.' using errcode = '22023';
    end if;
    if v_tratamiento in ('exonerado', 'inafecto') then
      v_tasa := 0;
    else
      begin
        v_tasa := nullif(btrim(coalesce(v_line->>'tasa_igv', '')), '')::numeric;
      exception
        when invalid_text_representation then
          raise exception 'La tasa de IGV de una línea no es un número entre 0 y 100.'
            using errcode = '22023';
      end;
      if v_tasa is null then
        v_tasa := 18;
      end if;
      if v_tasa::text in ('NaN', 'Infinity', '-Infinity') or v_tasa < 0 or v_tasa > 100 then
        raise exception 'La tasa de IGV debe estar entre 0 y 100.' using errcode = '22023';
      end if;
    end if;

    if not exists (
      select 1 from public.detalle_requisiciones_compra
      where id = v_linea_req and requisicion_id = p_requisicion_id
        and cantidad = v_cantidad
    ) then
      raise exception 'Cada línea de la oferta debe cotizar la cantidad exacta solicitada.'
        using errcode = '22023';
    end if;
  end loop;

  select count(*) into v_lineas_solicitadas
  from public.detalle_requisiciones_compra where requisicion_id = p_requisicion_id;
  select count(*) into v_cobertura
  from (
    select distinct value->>'linea_requisicion_id'
    from jsonb_array_elements(p_lineas)
  ) as lineas_ofertadas;
  if v_cobertura <> v_lineas_solicitadas or jsonb_array_length(p_lineas) <> v_lineas_solicitadas then
    raise exception 'La oferta debe cubrir todas las líneas de la solicitud, sin repetir ninguna.'
      using errcode = '22023';
  end if;

  insert into public.ofertas_proveedor
    (requisicion_id, proveedor_id, vigencia_hasta, moneda, exchange_rate,
     observacion, idempotency_key, payload_hash, created_by)
  values
    (p_requisicion_id, p_proveedor_id, p_vigencia_hasta, v_moneda, v_rate,
     coalesce(trim(p_observacion), ''), v_key, v_hash, v_uid)
  returning id into v_oferta_id;

  for v_line in select value from jsonb_array_elements(p_lineas) loop
    v_tratamiento := coalesce(nullif(btrim(v_line->>'tratamiento_fiscal'), ''), 'gravado');
    if v_tratamiento in ('exonerado', 'inafecto') then
      v_tasa := 0;
    else
      begin
        v_tasa := nullif(btrim(coalesce(v_line->>'tasa_igv', '')), '')::numeric;
      exception
        when invalid_text_representation then
          raise exception 'La tasa de IGV de una línea no es un número entre 0 y 100.'
            using errcode = '22023';
      end;
      if v_tasa is null then
        v_tasa := 18;
      end if;
      if v_tasa::text in ('NaN', 'Infinity', '-Infinity') or v_tasa < 0 or v_tasa > 100 then
        raise exception 'La tasa de IGV debe estar entre 0 y 100.' using errcode = '22023';
      end if;
    end if;
    insert into public.detalle_ofertas_proveedor
      (oferta_id, linea_requisicion_id, cantidad, precio_unitario, tratamiento_fiscal, tasa_igv)
    values
      (v_oferta_id,
       nullif(btrim(v_line->>'linea_requisicion_id', ''), '')::uuid,
       round((v_line->>'cantidad')::numeric, 3),
       round((v_line->>'precio')::numeric, 2),
       v_tratamiento,
       round(v_tasa, 2));
  end loop;

  insert into public.requisiciones_compra_historial
    (requisicion_id, evento, version_anterior, version_nueva, actor_id, datos_despues, idempotency_key)
  values
    (p_requisicion_id, 'oferta_registrada',
     (select version from public.requisiciones_compra where id = p_requisicion_id),
     (select version from public.requisiciones_compra where id = p_requisicion_id),
     v_uid,
     jsonb_build_object('oferta_id', v_oferta_id, 'proveedor_id', p_proveedor_id,
                        'moneda', v_moneda, 'exchange_rate', v_rate),
     v_key);

  return v_oferta_id;
end;
$function$;

-- 10) Ajuste de inventario unificado: delta + asiento formal en ajustes_inventario.
-- Cambia el tipo de retorno (void -> uuid): se retira la firma previa primero.
drop function if exists app_private._registrar_ajuste_inventario(uuid, uuid, integer, text, text);
create or replace function app_private._registrar_ajuste_inventario(
  p_producto_id uuid, p_almacen_id uuid, p_cantidad integer, p_motivo text, p_idempotency_key text)
returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_motivo text := nullif(btrim(p_motivo), '');
  v_antes integer; v_nuevo integer; v_global integer; v_hash text; v_existing_hash text; v_id uuid;
begin
  if v_uid is null or not (
    (select app_private._tiene_permiso('inventario', 'crear'))
    or (select app_private._tiene_permiso('inventario', 'editar'))
  ) then
    raise exception 'No tienes permiso para ajustar inventario.' using errcode = '42501';
  end if;

  if p_producto_id is null or p_almacen_id is null or p_cantidad is null or p_cantidad = 0
     or v_motivo is null or v_key is null then
    raise exception 'Indica producto, almacén, cantidad distinta de cero, motivo y clave de solicitud.'
      using errcode = '22023';
  end if;

  v_hash := md5(concat_ws('|', p_producto_id, p_almacen_id, p_cantidad, v_motivo));
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  select payload_hash into v_existing_hash from public.movimientos_inventario
  where idempotency_key = v_key;
  if found then
    if v_existing_hash is not distinct from v_hash then
      return v_id;
    end if;
    raise exception 'La clave ya se utilizó para otro ajuste.' using errcode = '23505';
  end if;

  if not exists (select 1 from public.productos where id = p_producto_id) then
    raise exception 'El producto no existe.' using errcode = '23503';
  end if;
  if not exists (select 1 from public.almacenes where id = p_almacen_id and activo) then
    raise exception 'El almacén debe estar activo.' using errcode = '23503';
  end if;

  insert into public.inventarios (producto_id, almacen_id, cantidad)
  values (p_producto_id, p_almacen_id, 0)
  on conflict (producto_id, almacen_id) do nothing;

  select cantidad into v_antes from public.inventarios
  where producto_id = p_producto_id and almacen_id = p_almacen_id for update;
  v_nuevo := coalesce(v_antes, 0) + p_cantidad;
  if v_nuevo < 0 then
    raise exception 'El ajuste dejaría el stock del almacén en negativo.' using errcode = '23514';
  end if;

  select stock into v_global from public.productos where id = p_producto_id for update;
  if not found or coalesce(v_global, 0) + p_cantidad < 0 then
    raise exception 'El ajuste no puede dejar el stock global en negativo.' using errcode = '23514';
  end if;

  insert into public.ajustes_inventario
    (producto_id, almacen_id, stock_anterior, stock_nuevo, motivo, idempotency_key, payload_hash, created_by)
  values
    (p_producto_id, p_almacen_id, coalesce(v_antes, 0), v_nuevo, v_motivo, v_key, v_hash, v_uid)
  returning id into v_id;

  -- La bandera evita que trg_kardex duplique el movimiento.
  perform set_config('app.ec_inventory_rpc', 'on', true);

  update public.inventarios set cantidad = v_nuevo, updated_at = now()
  where producto_id = p_producto_id and almacen_id = p_almacen_id;

  update public.productos set stock = coalesce(v_global, 0) + p_cantidad, updated_at = now()
  where id = p_producto_id;

  insert into public.movimientos_inventario
    (producto_id, almacen_id, tipo, cantidad, stock_anterior, stock_nuevo,
     referencia, usuario_id, idempotency_key, payload_hash, origen_tipo, origen_id, motivo)
  values
    (p_producto_id, p_almacen_id, 'ajuste', p_cantidad, coalesce(v_antes, 0), v_nuevo,
     'Ajuste ' || v_id::text, v_uid, v_key, v_hash, 'ajuste_inventario', v_id, v_motivo);

  return v_id;
end;
$function$;

-- Wrapper invoker también cambia de retorno (void -> uuid): se retira y se vuelve a crear.
drop function if exists public.registrar_ajuste_inventario(uuid, uuid, integer, text, text);
create or replace function public.registrar_ajuste_inventario(
  p_producto_id uuid, p_almacen_id uuid, p_cantidad integer, p_motivo text, p_idempotency_key text)
returns uuid
language sql set search_path = ''
as $function$ select app_private._registrar_ajuste_inventario(
  p_producto_id, p_almacen_id, p_cantidad, p_motivo, p_idempotency_key) $function$;

drop function if exists public.ec_registrar_ajuste_inventario(uuid, uuid, integer, text, text);

-- 11) Wrappers públicos delgados (la validación ocurre dentro del impl PRIVADO).
create or replace function public.anular_requisicion_compra(
  p_requisicion_id uuid, p_motivo text, p_idempotency_key text)
returns void
language sql set search_path = ''
as $function$ select app_private._anular_requisicion_compra(p_requisicion_id, p_motivo, p_idempotency_key) $function$;

create or replace function public.editar_requisicion_compra(
  p_requisicion_id uuid, p_expected_version integer, p_detalle text,
  p_fecha_necesaria date, p_lineas jsonb, p_idempotency_key text)
returns integer
language sql set search_path = ''
as $function$ select app_private._editar_requisicion_compra(
  p_requisicion_id, p_expected_version, p_detalle, p_fecha_necesaria, p_lineas, p_idempotency_key) $function$;

create or replace function public.listar_requisiciones_paginado(
  p_estado text default null, p_desde date default null, p_hasta date default null,
  p_referencia text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language sql set search_path = ''
as $function$ select app_private._listar_requisiciones_paginado(
  p_estado, p_desde, p_hasta, p_referencia, p_limit, p_offset) $function$;

create or replace function public.obtener_detalle_requisicion(p_requisicion_id uuid)
returns jsonb
language sql set search_path = ''
as $function$ select app_private._obtener_detalle_requisicion(p_requisicion_id) $function$;

create or replace function public.registrar_oferta_proveedor(
  p_requisicion_id uuid, p_proveedor_id uuid, p_vigencia_hasta date, p_observacion text,
  p_lineas jsonb, p_idempotency_key text, p_moneda text default 'PEN', p_exchange_rate numeric default null)
returns uuid
language sql set search_path = ''
as $function$ select app_private._registrar_oferta_proveedor(
  p_requisicion_id, p_proveedor_id, p_vigencia_hasta, p_observacion, p_lineas, p_idempotency_key,
  p_moneda, p_exchange_rate) $function$;

-- 12) Superficie de API: ni público anónimo ni esquemas externos ejecutan la capa privada.
revoke all on function app_private._normalizar_lineas_requisicion(jsonb) from public, anon;
grant execute on function app_private._normalizar_lineas_requisicion(jsonb) to authenticated;
revoke all on function app_private._crear_requisicion_compra(text, date, jsonb, text) from public, anon;
grant execute on function app_private._crear_requisicion_compra(text, date, jsonb, text) to authenticated;
revoke all on function app_private._editar_requisicion_compra(uuid, integer, text, date, jsonb, text) from public, anon;
grant execute on function app_private._editar_requisicion_compra(uuid, integer, text, date, jsonb, text) to authenticated;
revoke all on function app_private._listar_requisiciones_paginado(text, date, date, text, integer, integer) from public, anon;
grant execute on function app_private._listar_requisiciones_paginado(text, date, date, text, integer, integer) to authenticated;
revoke all on function app_private._obtener_detalle_requisicion(uuid) from public, anon;
grant execute on function app_private._obtener_detalle_requisicion(uuid) to authenticated;
revoke all on function app_private._anular_requisicion_compra(uuid, text, text) from public, anon;
grant execute on function app_private._anular_requisicion_compra(uuid, text, text) to authenticated;
revoke all on function app_private._decidir_requisicion_compra(uuid, boolean, text) from public, anon;
grant execute on function app_private._decidir_requisicion_compra(uuid, boolean, text) to authenticated;
revoke all on function app_private._seleccionar_oferta_proveedor(uuid) from public, anon;
grant execute on function app_private._seleccionar_oferta_proveedor(uuid) to authenticated;
revoke all on function app_private._generar_orden_desde_oferta(uuid, date, text) from public, anon;
grant execute on function app_private._generar_orden_desde_oferta(uuid, date, text) to authenticated;
revoke all on function app_private._registrar_oferta_proveedor(uuid, uuid, date, text, jsonb, text, text, numeric) from public, anon;
grant execute on function app_private._registrar_oferta_proveedor(uuid, uuid, date, text, jsonb, text, text, numeric) to authenticated;
revoke all on function app_private._registrar_ajuste_inventario(uuid, uuid, integer, text, text) from public, anon;
grant execute on function app_private._registrar_ajuste_inventario(uuid, uuid, integer, text, text) to authenticated;

revoke all on function public.anular_requisicion_compra(uuid, text, text) from public, anon;
grant execute on function public.anular_requisicion_compra(uuid, text, text) to authenticated;
revoke all on function public.editar_requisicion_compra(uuid, integer, text, date, jsonb, text) from public, anon;
grant execute on function public.editar_requisicion_compra(uuid, integer, text, date, jsonb, text) to authenticated;
revoke all on function public.listar_requisiciones_paginado(text, date, date, text, integer, integer) from public, anon;
grant execute on function public.listar_requisiciones_paginado(text, date, date, text, integer, integer) to authenticated;
revoke all on function public.obtener_detalle_requisicion(uuid) from public, anon;
grant execute on function public.obtener_detalle_requisicion(uuid) to authenticated;
revoke all on function public.registrar_oferta_proveedor(uuid, uuid, date, text, jsonb, text, text, numeric) from public, anon;
grant execute on function public.registrar_oferta_proveedor(uuid, uuid, date, text, jsonb, text, text, numeric) to authenticated;
revoke all on function public.registrar_ajuste_inventario(uuid, uuid, integer, text, text) from public, anon;
grant execute on function public.registrar_ajuste_inventario(uuid, uuid, integer, text, text) to authenticated;

commit;

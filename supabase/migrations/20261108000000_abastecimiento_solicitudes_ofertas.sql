-- Fase D101-D106: edición/cancelación de solicitudes y ofertas versionadas.
-- Preparada para aplicación manual; no ejecutar desde el cliente.
begin;

-- Snapshots maestros, manteniendo unidad como texto histórico de presentación.
alter table public.solicitud_compra_lineas
  add column if not exists unidad_medida_id uuid references public.unidades_medida(id) on delete restrict;
alter table public.solicitudes_compra
  add column if not exists version integer not null default 1,
  add column if not exists updated_by uuid references public.usuarios(id) on delete set null,
  add column if not exists seleccion_motivo text,
  add column if not exists seleccionado_por uuid references public.usuarios(id) on delete set null,
  add column if not exists seleccionado_en timestamptz,
  add column if not exists cancelacion_motivo text,
  add column if not exists cancelado_por uuid references public.usuarios(id) on delete set null,
  add column if not exists cancelado_en timestamptz;
alter table public.compras
  add column if not exists solicitud_compra_id uuid references public.solicitudes_compra(id) on delete restrict;
create index if not exists compras_solicitud_compra_idx on public.compras(solicitud_compra_id) where solicitud_compra_id is not null;

alter table public.ofertas_compra
  add column if not exists version integer not null default 1,
  add column if not exists version_anterior_id uuid references public.ofertas_compra(id) on delete restrict,
  add column if not exists es_version_actual boolean not null default true,
  add column if not exists seleccionado_por uuid references public.usuarios(id) on delete set null,
  add column if not exists seleccionado_en timestamptz;

alter table public.ofertas_compra drop constraint if exists ofertas_compra_solicitud_id_proveedor_id_key;
alter table public.ofertas_compra drop constraint if exists ofertas_compra_estado_check;
alter table public.ofertas_compra drop constraint if exists ofertas_compra_estado_fase_d_ck;
alter table public.ofertas_compra add constraint ofertas_compra_estado_fase_d_ck
  check (estado in ('Vigente','Retirada','Sustituida','Seleccionada'));
alter table public.ofertas_compra drop constraint if exists ofertas_compra_version_ck;
alter table public.ofertas_compra add constraint ofertas_compra_version_ck check(version>0);
create unique index if not exists ofertas_compra_version_unica_idx on public.ofertas_compra(solicitud_id,proveedor_id,version);
create unique index if not exists ofertas_compra_version_actual_unica_idx
  on public.ofertas_compra(solicitud_id,proveedor_id) where es_version_actual;
create index if not exists ofertas_compra_version_historial_idx
  on public.ofertas_compra(solicitud_id,proveedor_id,version desc);

create table if not exists public.solicitudes_compra_historial (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.solicitudes_compra(id) on delete restrict,
  evento text not null check(evento in ('edicion_borrador','cancelacion')),
  version_anterior integer not null,
  version_nueva integer not null,
  actor_id uuid not null references public.usuarios(id) on delete restrict,
  motivo text,
  datos_antes jsonb not null,
  datos_despues jsonb not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists solicitudes_compra_historial_solicitud_idx
  on public.solicitudes_compra_historial(solicitud_id,created_at desc);
alter table public.solicitudes_compra_historial enable row level security;
revoke all on public.solicitudes_compra_historial from public,anon,authenticated;
grant select on public.solicitudes_compra_historial to authenticated;
drop policy if exists solicitudes_compra_historial_select on public.solicitudes_compra_historial;
create policy solicitudes_compra_historial_select on public.solicitudes_compra_historial
  for select to authenticated using((select app_private._tiene_permiso('compras','ver')));

alter table app_private.purchase_transition_idempotency
  add column if not exists result_version integer;
alter table app_private.purchase_transition_idempotency
  drop constraint if exists purchase_transition_idempotency_operation_check;
alter table app_private.purchase_transition_idempotency
  drop constraint if exists purchase_transition_idempotency_operation_fase_d_ck;
alter table app_private.purchase_transition_idempotency
  add constraint purchase_transition_idempotency_operation_fase_d_ck
  check(operation in ('abrir_solicitud','seleccionar_oferta','seleccionar_oferta_con_motivo','editar_solicitud','cancelar_solicitud'));

-- La versión actual existente se conserva como versión 1 y no se reescribe.
update public.ofertas_compra set version=1,es_version_actual=true where version is null;

create or replace function public.crear_solicitud_compra_v3(
  p_detalle text,p_fecha_necesidad date,p_lineas jsonb,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_hash text; v_id uuid; v_old_hash text;
  v_line jsonb; v_qty numeric; v_producto uuid; v_unidad uuid; v_simbolo text;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','crear')) then
    raise exception 'No tienes permiso para crear solicitudes.' using errcode='42501';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) is distinct from 'array'
     or jsonb_array_length(p_lineas)=0 or jsonb_array_length(p_lineas)>100
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'La solicitud requiere entre 1 y 100 líneas y una clave de idempotencia válida.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_lineas) e(value) where jsonb_typeof(e.value) is distinct from 'object') then
    raise exception 'Cada línea debe ser un objeto JSON.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('detalle',coalesce(trim(p_detalle),''),'fecha_necesidad',p_fecha_necesidad,'lineas',p_lineas)::text);
  perform pg_advisory_xact_lock(hashtextextended('solicitud-compra:'||p_idempotency_key,0));
  select id,payload_hash into v_id,v_old_hash from public.solicitudes_compra where idempotency_key=p_idempotency_key for update;
  if found then
    if v_old_hash is distinct from v_hash then raise exception 'La clave ya fue usada con otro contenido.' using errcode='23505'; end if;
    return v_id;
  end if;
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    if jsonb_typeof(v_line->'descripcion') is distinct from 'string'
       or jsonb_typeof(v_line->'cantidad') is distinct from 'number'
       or jsonb_typeof(v_line->'unidad_medida_id') is distinct from 'string' then
      raise exception 'Cada línea requiere descripción, cantidad y unidad maestra.' using errcode='22023';
    end if;
    v_qty:=(v_line->>'cantidad')::numeric;
    v_unidad:=nullif(v_line->>'unidad_medida_id','')::uuid;
    v_producto:=nullif(v_line->>'producto_id','')::uuid;
    if v_qty::text in ('NaN','Infinity','-Infinity') or v_qty<=0 or v_qty>99999999999.999 or v_qty<>round(v_qty,3)
       or length(trim(v_line->>'descripcion')) not between 2 and 240 or v_unidad is null then
      raise exception 'Descripción, cantidad o unidad maestra no válida.' using errcode='22023';
    end if;
    select simbolo into v_simbolo from public.unidades_medida where id=v_unidad and activo;
    if not found then raise exception 'La unidad no existe o está inactiva.' using errcode='23503'; end if;
    if v_producto is not null and not exists(
      select 1 from public.productos p where p.id=v_producto and p.unidad_medida_id=v_unidad
    ) then raise exception 'El producto no existe o no está asociado a la unidad maestra seleccionada.' using errcode='23514'; end if;
  end loop;
  insert into public.solicitudes_compra(solicitante_id,created_by,updated_by,estado,fecha_necesidad,detalle,idempotency_key,payload_hash,version)
    values(v_uid,v_uid,v_uid,'Borrador',p_fecha_necesidad,trim(coalesce(p_detalle,'')),p_idempotency_key,v_hash,1)
    returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    select simbolo into v_simbolo from public.unidades_medida where id=(v_line->>'unidad_medida_id')::uuid;
    insert into public.solicitud_compra_lineas(solicitud_id,producto_id,unidad_medida_id,descripcion,cantidad,unidad)
      values(v_id,nullif(v_line->>'producto_id','')::uuid,(v_line->>'unidad_medida_id')::uuid,
        trim(v_line->>'descripcion'),(v_line->>'cantidad')::numeric,v_simbolo);
  end loop;
  return v_id;
end
$function$;

create or replace function public.editar_solicitud_compra_v1(
  p_solicitud_id uuid,p_expected_version integer,p_detalle text,p_fecha_necesidad date,
  p_lineas jsonb,p_idempotency_key text
)
returns integer language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_request public.solicitudes_compra%rowtype;
  v_line jsonb; v_qty numeric; v_producto uuid; v_unidad uuid; v_simbolo text;
  v_hash text; v_saved app_private.purchase_transition_idempotency%rowtype;
  v_before jsonb; v_after jsonb; v_new_version integer;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'No tienes permiso para editar solicitudes.' using errcode='42501';
  end if;
  if p_solicitud_id is null or p_expected_version is null or p_expected_version<1
     or p_lineas is null or jsonb_typeof(p_lineas) is distinct from 'array'
     or jsonb_array_length(p_lineas)=0 or jsonb_array_length(p_lineas)>100
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Datos de edición o clave de idempotencia inválidos.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('solicitud_id',p_solicitud_id,'version',p_expected_version,
    'detalle',coalesce(trim(p_detalle),''),'fecha_necesidad',p_fecha_necesidad,'lineas',p_lineas)::text);
  perform pg_advisory_xact_lock(hashtextextended('purchase-transition:'||p_idempotency_key,0));
  select * into v_saved from app_private.purchase_transition_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'editar_solicitud' or v_saved.payload_hash<>v_hash then
      raise exception 'La clave ya fue usada con otra operación o contenido.' using errcode='23505';
    end if;
    return coalesce(v_saved.result_version,p_expected_version+1);
  end if;
  select * into v_request from public.solicitudes_compra where id=p_solicitud_id for update;
  if not found then raise exception 'La solicitud no existe.' using errcode='23503'; end if;
  if v_request.estado<>'Borrador' or v_request.version<>p_expected_version
     or v_request.seleccion_oferta_id is not null
     or exists(select 1 from public.ofertas_compra where solicitud_id=p_solicitud_id)
     or exists(select 1 from public.compras where solicitud_compra_id=p_solicitud_id) then
    raise exception 'Solo se edita el borrador vigente sin ofertas ni orden asociada; recarga la solicitud.' using errcode='40001';
  end if;
  if exists(select 1 from jsonb_array_elements(p_lineas) e(value) where jsonb_typeof(e.value) is distinct from 'object') then
    raise exception 'Cada línea debe ser un objeto JSON.' using errcode='22023';
  end if;
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    v_qty:=(v_line->>'cantidad')::numeric;
    v_unidad:=nullif(v_line->>'unidad_medida_id','')::uuid;
    v_producto:=nullif(v_line->>'producto_id','')::uuid;
    if v_qty::text in ('NaN','Infinity','-Infinity') or v_qty<=0 or v_qty>99999999999.999 or v_qty<>round(v_qty,3)
       or length(trim(coalesce(v_line->>'descripcion',''))) not between 2 and 240 or v_unidad is null then
      raise exception 'Descripción, cantidad o unidad maestra no válida.' using errcode='22023';
    end if;
    select simbolo into v_simbolo from public.unidades_medida where id=v_unidad and activo;
    if not found then raise exception 'La unidad no existe o está inactiva.' using errcode='23503'; end if;
    if v_producto is not null and not exists(select 1 from public.productos p where p.id=v_producto and p.unidad_medida_id=v_unidad) then
      raise exception 'El producto no está asociado a la unidad maestra seleccionada.' using errcode='23514';
    end if;
  end loop;
  v_before:=jsonb_build_object('detalle',v_request.detalle,'fecha_necesidad',v_request.fecha_necesidad,
    'estado',v_request.estado,'lineas',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]'::jsonb) from public.solicitud_compra_lineas l where l.solicitud_id=p_solicitud_id));
  delete from public.solicitud_compra_lineas where solicitud_id=p_solicitud_id;
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    select simbolo into v_simbolo from public.unidades_medida where id=(v_line->>'unidad_medida_id')::uuid;
    insert into public.solicitud_compra_lineas(solicitud_id,producto_id,unidad_medida_id,descripcion,cantidad,unidad)
      values(p_solicitud_id,nullif(v_line->>'producto_id','')::uuid,(v_line->>'unidad_medida_id')::uuid,
        trim(v_line->>'descripcion'),(v_line->>'cantidad')::numeric,v_simbolo);
  end loop;
  v_new_version:=v_request.version+1;
  update public.solicitudes_compra set detalle=trim(coalesce(p_detalle,'')),fecha_necesidad=p_fecha_necesidad,
    version=v_new_version,updated_by=v_uid,updated_at=clock_timestamp()
  where id=p_solicitud_id;
  v_after:=jsonb_build_object('detalle',trim(coalesce(p_detalle,'')),'fecha_necesidad',p_fecha_necesidad,
    'estado','Borrador','version',v_new_version,
    'lineas',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]'::jsonb) from public.solicitud_compra_lineas l where l.solicitud_id=p_solicitud_id));
  insert into public.solicitudes_compra_historial(solicitud_id,evento,version_anterior,version_nueva,actor_id,datos_antes,datos_despues,idempotency_key)
    values(p_solicitud_id,'edicion_borrador',v_request.version,v_new_version,v_uid,v_before,v_after,p_idempotency_key);
  insert into app_private.purchase_transition_idempotency(idempotency_key,operation,payload_hash,result_id,result_version)
    values(p_idempotency_key,'editar_solicitud',v_hash,p_solicitud_id,v_new_version);
  return v_new_version;
end
$function$;

create or replace function public.cancelar_solicitud_compra_v1(
  p_solicitud_id uuid,p_motivo text,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_request public.solicitudes_compra%rowtype;
  v_hash text; v_saved app_private.purchase_transition_idempotency%rowtype; v_snapshot jsonb;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'No tienes permiso para cancelar solicitudes.' using errcode='42501';
  end if;
  if p_solicitud_id is null or length(trim(coalesce(p_motivo,''))) not between 5 and 500
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'La cancelación requiere un motivo (5–500 caracteres) y una clave válida.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('solicitud_id',p_solicitud_id,'motivo',trim(p_motivo))::text);
  perform pg_advisory_xact_lock(hashtextextended('purchase-transition:'||p_idempotency_key,0));
  select * into v_saved from app_private.purchase_transition_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'cancelar_solicitud' or v_saved.payload_hash<>v_hash then
      raise exception 'La clave ya fue usada con otra operación o contenido.' using errcode='23505';
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
end
$function$;

create or replace function public.registrar_oferta_compra_v3(
  p_solicitud_id uuid,p_proveedor_id uuid,p_vigencia_hasta date,
  p_plazo_entrega_dias integer,p_condiciones text,p_precios jsonb,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_hash text; v_oferta uuid; v_old_hash text;
  v_expected integer; v_actual integer; v_price record; v_previous uuid; v_version integer;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','crear')) then
    raise exception 'No tienes permiso para registrar ofertas.' using errcode='42501';
  end if;
  if p_solicitud_id is null or p_proveedor_id is null or nullif(trim(p_idempotency_key),'') is null
     or length(p_idempotency_key) not between 8 and 128 or p_precios is null
     or jsonb_typeof(p_precios) is distinct from 'array' or jsonb_array_length(p_precios)=0 or jsonb_array_length(p_precios)>100 then
    raise exception 'Solicitud, proveedor, precios y clave son obligatorios.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_precios) e(value) where jsonb_typeof(e.value) is distinct from 'object') then
    raise exception 'Cada precio debe ser un objeto JSON.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('solicitud_id',p_solicitud_id,'proveedor_id',p_proveedor_id,
    'vigencia_hasta',p_vigencia_hasta,'plazo_entrega_dias',p_plazo_entrega_dias,
    'condiciones',coalesce(trim(p_condiciones),''),'precios',p_precios)::text);
  perform pg_advisory_xact_lock(hashtextextended('oferta-compra:'||p_idempotency_key,0));
  select id,payload_hash into v_oferta,v_old_hash from public.ofertas_compra where idempotency_key=p_idempotency_key for update;
  if found then
    if v_old_hash is distinct from v_hash then raise exception 'La clave ya se usó con otro contenido.' using errcode='23505'; end if;
    return v_oferta;
  end if;
  perform 1 from public.solicitudes_compra where id=p_solicitud_id and estado='Abierta' for update;
  if not found then raise exception 'La solicitud no está abierta.' using errcode='23514'; end if;
  if p_plazo_entrega_dias is not null and p_plazo_entrega_dias<0 then raise exception 'El plazo de entrega no puede ser negativo.' using errcode='22023'; end if;
  select count(*) into v_expected from public.solicitud_compra_lineas where solicitud_id=p_solicitud_id;
  select count(*) into v_actual from jsonb_array_elements(p_precios);
  if v_expected=0 or v_actual<>v_expected then raise exception 'Debe cotizarse cada línea.' using errcode='22023'; end if;
  for v_price in select * from jsonb_to_recordset(p_precios) as x(linea_id uuid,precio_unitario numeric) loop
    if v_price.linea_id is null or v_price.precio_unitario is null
       or v_price.precio_unitario::text in ('NaN','Infinity','-Infinity') or v_price.precio_unitario<0
       or v_price.precio_unitario>9999999999.9999 or v_price.precio_unitario<>round(v_price.precio_unitario,4)
       or not exists(select 1 from public.solicitud_compra_lineas where id=v_price.linea_id and solicitud_id=p_solicitud_id) then
      raise exception 'Hay precios inválidos o líneas ajenas a la solicitud.' using errcode='22023';
    end if;
  end loop;
  if (select count(distinct x.linea_id) from jsonb_to_recordset(p_precios) as x(linea_id uuid,precio_unitario numeric))<>v_expected then
    raise exception 'Cada línea debe aparecer una sola vez en la oferta.' using errcode='22023';
  end if;
  select id,version into v_previous,v_version from public.ofertas_compra
    where solicitud_id=p_solicitud_id and proveedor_id=p_proveedor_id and es_version_actual for update;
  if found then
    update public.ofertas_compra set estado='Sustituida',es_version_actual=false,updated_at=clock_timestamp() where id=v_previous;
    v_version:=v_version+1;
  else
    select coalesce(max(version),0)+1 into v_version from public.ofertas_compra
      where solicitud_id=p_solicitud_id and proveedor_id=p_proveedor_id;
  end if;
  insert into public.ofertas_compra(solicitud_id,proveedor_id,vigencia_hasta,plazo_entrega_dias,condiciones,
    estado,created_by,version,version_anterior_id,es_version_actual,idempotency_key,payload_hash)
    values(p_solicitud_id,p_proveedor_id,p_vigencia_hasta,p_plazo_entrega_dias,trim(coalesce(p_condiciones,'')),
      'Vigente',v_uid,v_version,v_previous,true,p_idempotency_key,v_hash) returning id into v_oferta;
  insert into public.detalle_ofertas_compra(oferta_id,solicitud_linea_id,precio_unitario)
    select v_oferta,x.linea_id,x.precio_unitario from jsonb_to_recordset(p_precios) as x(linea_id uuid,precio_unitario numeric);
  return v_oferta;
end
$function$;

create or replace function public.seleccionar_oferta_compra_v3(
  p_solicitud_id uuid,p_oferta_id uuid,p_motivo text,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_hash text; v_saved app_private.purchase_transition_idempotency%rowtype;
  v_request public.solicitudes_compra%rowtype; v_offer public.ofertas_compra%rowtype;
  v_chosen numeric; v_lowest numeric;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'No tienes permiso para seleccionar ofertas.' using errcode='42501';
  end if;
  if p_solicitud_id is null or p_oferta_id is null or length(trim(coalesce(p_motivo,''))) not between 4 and 500
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'La selección requiere solicitud, oferta, motivo (4–500 caracteres) y clave válida.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('solicitud_id',p_solicitud_id,'oferta_id',p_oferta_id,'motivo',trim(p_motivo))::text);
  perform pg_advisory_xact_lock(hashtextextended('purchase-transition:'||p_idempotency_key,0));
  select * into v_saved from app_private.purchase_transition_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'seleccionar_oferta_con_motivo' or v_saved.payload_hash<>v_hash then
      raise exception 'La clave ya fue usada con otra operación o contenido.' using errcode='23505';
    end if;
    return v_saved.result_id;
  end if;
  select * into v_request from public.solicitudes_compra where id=p_solicitud_id for update;
  if not found or v_request.estado<>'Abierta' then raise exception 'La solicitud no está abierta.' using errcode='23514'; end if;
  select * into v_offer from public.ofertas_compra where id=p_oferta_id and solicitud_id=p_solicitud_id
    and estado='Vigente' and es_version_actual for update;
  if not found then raise exception 'La oferta no corresponde a la solicitud o ya no es la versión vigente.' using errcode='23514'; end if;
  if v_offer.vigencia_hasta is not null and v_offer.vigencia_hasta<current_date then
    raise exception 'No se puede seleccionar una oferta vencida.' using errcode='23514';
  end if;
  select round(sum(d.precio_unitario*l.cantidad),4) into v_chosen
    from public.detalle_ofertas_compra d join public.solicitud_compra_lineas l on l.id=d.solicitud_linea_id
    where d.oferta_id=p_oferta_id and l.solicitud_id=p_solicitud_id;
  if (select count(*) from public.detalle_ofertas_compra where oferta_id=p_oferta_id)<>
     (select count(*) from public.solicitud_compra_lineas where solicitud_id=p_solicitud_id) then
    raise exception 'La oferta está incompleta y no puede seleccionarse.' using errcode='23514';
  end if;
  select min(t.total) into v_lowest from (
    select o.id,round(sum(d.precio_unitario*l.cantidad),4) as total
    from public.ofertas_compra o
    join public.detalle_ofertas_compra d on d.oferta_id=o.id
    join public.solicitud_compra_lineas l on l.id=d.solicitud_linea_id and l.solicitud_id=p_solicitud_id
    where o.solicitud_id=p_solicitud_id and o.estado='Vigente' and o.es_version_actual
      and (o.vigencia_hasta is null or o.vigencia_hasta>=current_date)
    group by o.id
    having count(*)=(select count(*) from public.solicitud_compra_lineas where solicitud_id=p_solicitud_id)
  ) t;
  if v_chosen>v_lowest and length(trim(p_motivo))<12 then
    raise exception 'La oferta elegida no es la menor vigente; registra un motivo detallado (mínimo 12 caracteres).' using errcode='22023';
  end if;
  update public.ofertas_compra set estado='Seleccionada',seleccionado_por=v_uid,seleccionado_en=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_oferta_id;
  update public.solicitudes_compra set seleccion_oferta_id=p_oferta_id,estado='Cerrada',
    seleccion_motivo=trim(p_motivo),seleccionado_por=v_uid,seleccionado_en=clock_timestamp(),
    updated_by=v_uid,updated_at=clock_timestamp() where id=p_solicitud_id;
  insert into app_private.purchase_transition_idempotency(idempotency_key,operation,payload_hash,result_id,result_version)
    values(p_idempotency_key,'seleccionar_oferta_con_motivo',v_hash,p_solicitud_id,v_request.version);
  return p_solicitud_id;
end
$function$;

revoke all on function public.crear_solicitud_compra_v3(text,date,jsonb,text) from public,anon;
revoke all on function public.editar_solicitud_compra_v1(uuid,integer,text,date,jsonb,text) from public,anon;
revoke all on function public.cancelar_solicitud_compra_v1(uuid,text,text) from public,anon;
revoke all on function public.registrar_oferta_compra_v3(uuid,uuid,date,integer,text,jsonb,text) from public,anon;
revoke all on function public.seleccionar_oferta_compra_v3(uuid,uuid,text,text) from public,anon;
grant execute on function public.crear_solicitud_compra_v3(text,date,jsonb,text) to authenticated;
grant execute on function public.editar_solicitud_compra_v1(uuid,integer,text,date,jsonb,text) to authenticated;
grant execute on function public.cancelar_solicitud_compra_v1(uuid,text,text) to authenticated;
grant execute on function public.registrar_oferta_compra_v3(uuid,uuid,date,integer,text,jsonb,text) to authenticated;
grant execute on function public.seleccionar_oferta_compra_v3(uuid,uuid,text,text) to authenticated;

-- Cierra contratos que permitirían omitir versionado, unidad o motivo/expiry.
-- Se usa to_regprocedure para no fallar con 42883 si la Fase B13 no está aplicada.
do $close_v2$
begin
  if to_regprocedure('public.crear_solicitud_compra_v2(text,date,jsonb,text)') is not null then
    execute 'revoke all on function public.crear_solicitud_compra_v2(text,date,jsonb,text) from public,anon,authenticated';
  end if;
  if to_regprocedure('public.registrar_oferta_compra_v2(uuid,uuid,date,integer,text,jsonb,text)') is not null then
    execute 'revoke all on function public.registrar_oferta_compra_v2(uuid,uuid,date,integer,text,jsonb,text) from public,anon,authenticated';
  end if;
  if to_regprocedure('public.seleccionar_oferta_compra_v2(uuid,uuid,text)') is not null then
    execute 'revoke all on function public.seleccionar_oferta_compra_v2(uuid,uuid,text) from public,anon,authenticated';
  end if;
end
$close_v2$;

-- La relación permite a cancelación rechazar solicitudes ya convertidas; la
-- futura RPC de conversión asignará esta FK en su propia transacción.
do $audit$
begin
  if to_regprocedure('public.fn_auditar()') is not null then
    if not exists(select 1 from pg_trigger where tgrelid='public.solicitudes_compra_historial'::regclass and tgname='trg_auditoria_solicitudes_compra_historial') then
      create trigger trg_auditoria_solicitudes_compra_historial after insert on public.solicitudes_compra_historial
        for each row execute function public.fn_auditar();
    end if;
  end if;
end
$audit$;

commit;

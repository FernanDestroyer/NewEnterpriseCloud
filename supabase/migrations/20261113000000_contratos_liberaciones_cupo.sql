-- Fase F06-F09: liberaciones de contrato enlazadas a órdenes; consumo de topes
-- monetarios/cantidad atómico y restitución idempotente por cancelación previa
-- a recepción. Aplicación manual; no ejecuta UI ni integra formularios.
begin;

-- Cancelada es necesario como estado persistido de la orden para que el servidor
-- pueda completar la restitución en la misma transacción.
do $purchase_cancelled_domain$
declare v_constraint name;
begin
  select conname into v_constraint from pg_constraint
  where contypid='public.estado_registro'::regtype and contype='c' limit 1;
  if v_constraint is not null then execute format('alter domain public.estado_registro drop constraint %I',v_constraint); end if;
  alter domain public.estado_registro add constraint estado_registro_check check(value in (
    'Activo','Bajo stock','Completada','Crítico','En curso','En tránsito','Estable','Pendiente','Vigente',
    'Aprobada','Rechazada','Vencida','Solicitud','Orden','Recibida','Recepción','Factura','Pagada','Cancelada'));
end
$purchase_cancelled_domain$;

-- Un renglón de liberación debe apuntar a una línea inmutable del mismo contrato/version.
do $line_unique$
begin
  if not exists(select 1 from pg_constraint where conname='lineas_contrato_id_contrato_version_unq'
    and conrelid='public.lineas_contrato_compra'::regclass) then
    alter table public.lineas_contrato_compra add constraint lineas_contrato_id_contrato_version_unq
      unique(id,contrato_id,version_id);
  end if;
end
$line_unique$;

do $version_pair_unique$
begin
  if not exists(select 1 from pg_constraint where conname='versiones_contrato_id_contrato_unq'
    and conrelid='public.versiones_contrato_compra'::regclass) then
    alter table public.versiones_contrato_compra add constraint versiones_contrato_id_contrato_unq
      unique(id,contrato_id);
  end if;
end
$version_pair_unique$;

create table if not exists public.liberaciones_contrato_compra (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('LBC-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  contrato_id uuid not null,
  version_id uuid not null,
  compra_id uuid not null unique references public.compras(id) on delete restrict,
  estado text not null default 'Comprometida' check(estado in ('Comprometida','Restituida')),
  moneda char(3) not null check(moneda in ('PEN','USD')),
  monto_comprometido numeric(14,2) not null check(monto_comprometido>0),
  liberada_por uuid not null references public.usuarios(id) on delete restrict,
  liberada_en timestamptz not null default now(),
  restituida_por uuid references public.usuarios(id) on delete restrict,
  restituida_en timestamptz,
  motivo_restitucion text,
  idempotency_key text not null unique,
  payload_hash text not null,
  foreign key(version_id,contrato_id) references public.versiones_contrato_compra(id,contrato_id) on delete restrict,
  check((estado='Comprometida' and restituida_por is null and restituida_en is null and motivo_restitucion is null)
     or (estado='Restituida' and restituida_por is not null and restituida_en is not null and motivo_restitucion is not null))
);

create table if not exists public.lineas_liberacion_contrato_compra (
  id uuid primary key default gen_random_uuid(),
  liberacion_id uuid not null references public.liberaciones_contrato_compra(id) on delete restrict,
  contrato_id uuid not null,
  version_id uuid not null,
  linea_contrato_id uuid not null,
  detalle_compra_id uuid not null unique references public.detalle_compras(id) on delete restrict,
  cantidad numeric(14,4) not null check(cantidad>0),
  monto_bruto numeric(14,2) not null check(monto_bruto>=0),
  created_at timestamptz not null default now(),
  foreign key(linea_contrato_id,contrato_id,version_id)
    references public.lineas_contrato_compra(id,contrato_id,version_id) on delete restrict,
  unique(liberacion_id,linea_contrato_id)
);

create table if not exists public.liberaciones_contrato_compra_historial (
  id uuid primary key default gen_random_uuid(),
  liberacion_id uuid not null references public.liberaciones_contrato_compra(id) on delete restrict,
  evento text not null check(evento in ('Liberada','Cupo restituido')),
  actor_id uuid not null references public.usuarios(id) on delete restrict,
  motivo text,
  monto numeric(14,2) not null check(monto>0),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists app_private.purchase_contract_order_idempotency (
  idempotency_key text primary key,
  operation text not null check(operation in ('liberar','cancelar')),
  payload_hash text not null,
  compra_id uuid not null references public.compras(id) on delete restrict,
  liberacion_id uuid references public.liberaciones_contrato_compra(id) on delete restrict,
  created_at timestamptz not null default now()
);
revoke all on app_private.purchase_contract_order_idempotency from public,anon,authenticated;

create index if not exists liberaciones_contrato_compra_contrato_estado_idx
  on public.liberaciones_contrato_compra(contrato_id,estado,liberada_en);
create index if not exists lineas_liberacion_contrato_version_idx
  on public.lineas_liberacion_contrato_compra(contrato_id,version_id,linea_contrato_id);
create index if not exists liberaciones_contrato_historial_idx
  on public.liberaciones_contrato_compra_historial(liberacion_id,created_at desc,id desc);

alter table public.liberaciones_contrato_compra enable row level security;
alter table public.lineas_liberacion_contrato_compra enable row level security;
alter table public.liberaciones_contrato_compra_historial enable row level security;
revoke all on public.liberaciones_contrato_compra,public.lineas_liberacion_contrato_compra,public.liberaciones_contrato_compra_historial from public,anon,authenticated;
grant select on public.liberaciones_contrato_compra,public.lineas_liberacion_contrato_compra,public.liberaciones_contrato_compra_historial to authenticated;
drop policy if exists liberaciones_contrato_compra_select on public.liberaciones_contrato_compra;
create policy liberaciones_contrato_compra_select on public.liberaciones_contrato_compra for select to authenticated
  using((select app_private._tiene_permiso('compras','ver')));
drop policy if exists lineas_liberacion_contrato_compra_select on public.lineas_liberacion_contrato_compra;
create policy lineas_liberacion_contrato_compra_select on public.lineas_liberacion_contrato_compra for select to authenticated
  using((select app_private._tiene_permiso('compras','ver')));
drop policy if exists liberaciones_contrato_historial_select on public.liberaciones_contrato_compra_historial;
create policy liberaciones_contrato_historial_select on public.liberaciones_contrato_compra_historial for select to authenticated
  using((select app_private._tiene_permiso('compras','ver')));

create or replace function app_private._proteger_liberacion_contrato_compra_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op='DELETE' then raise exception 'Las liberaciones forman parte del historial de cupo y no se eliminan.' using errcode='23514'; end if;
  if row(new.id,new.codigo,new.contrato_id,new.version_id,new.compra_id,new.moneda,new.monto_comprometido,
      new.liberada_por,new.liberada_en,new.idempotency_key,new.payload_hash)
     is distinct from row(old.id,old.codigo,old.contrato_id,old.version_id,old.compra_id,old.moneda,old.monto_comprometido,
      old.liberada_por,old.liberada_en,old.idempotency_key,old.payload_hash)
     or old.estado<>'Comprometida' or new.estado<>'Restituida'
     or new.restituida_por is null or new.restituida_en is null or new.motivo_restitucion is null then
    raise exception 'La liberación es inmutable; solo puede restituirse una vez mediante la RPC de cancelación.' using errcode='23514';
  end if;
  return new;
end
$function$;
drop trigger if exists trg_inmutable_liberacion_contrato_compra on public.liberaciones_contrato_compra;
create trigger trg_inmutable_liberacion_contrato_compra before update or delete on public.liberaciones_contrato_compra
  for each row execute function app_private._proteger_liberacion_contrato_compra_v1();
revoke all on function app_private._proteger_liberacion_contrato_compra_v1() from public,anon,authenticated;

create or replace function app_private._proteger_linea_liberacion_contrato_compra_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin raise exception 'El detalle de liberación es histórico y no se puede modificar o eliminar.' using errcode='23514'; end
$function$;
drop trigger if exists trg_inmutable_linea_liberacion_contrato_compra on public.lineas_liberacion_contrato_compra;
create trigger trg_inmutable_linea_liberacion_contrato_compra before update or delete on public.lineas_liberacion_contrato_compra
  for each row execute function app_private._proteger_linea_liberacion_contrato_compra_v1();
revoke all on function app_private._proteger_linea_liberacion_contrato_compra_v1() from public,anon,authenticated;

-- Evita que una actualización directa del estado eluda la restitución del cupo.
create or replace function app_private._proteger_cancelacion_orden_contrato_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if old.estado::text is distinct from new.estado::text and new.estado::text='Cancelada'
     and exists(select 1 from public.liberaciones_contrato_compra l where l.compra_id=old.id)
     and coalesce(current_setting('app.ec_contract_order_rpc',true),'off')<>'on' then
    raise exception 'Cancela una orden vinculada a contrato mediante cancelar_orden_compra_v1 para restituir el cupo de forma atómica.' using errcode='23514';
  end if;
  return new;
end
$function$;
drop trigger if exists trg_proteger_cancelacion_orden_contrato on public.compras;
create trigger trg_proteger_cancelacion_orden_contrato before update of estado on public.compras
  for each row execute function app_private._proteger_cancelacion_orden_contrato_v1();
revoke all on function app_private._proteger_cancelacion_orden_contrato_v1() from public,anon,authenticated;

-- Crear una orden enlazada crea cabecera, líneas, CxP base y liberación en una
-- sola transacción. FOR UPDATE sobre contrato serializa el consumo entre sesiones.
create or replace function public.crear_orden_compra_desde_contrato_v1(
  p_contrato_id uuid,p_version_id uuid,p_detalle text,p_fecha_limite date,
  p_lineas jsonb,p_idempotency_key text,p_exchange_rate numeric default null
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_contract public.contratos_compra%rowtype;
  v_version public.versiones_contrato_compra%rowtype; v_saved app_private.purchase_contract_order_idempotency%rowtype;
  v_hash text; v_order uuid; v_release uuid; v_count integer; v_active_amount numeric(14,2);
  v_order_total numeric(14,2):=0; v_line jsonb; v_catalog_id uuid; v_contract_line_id uuid;
  v_contract_line public.lineas_contrato_compra%rowtype;
  v_qty numeric; v_price numeric; v_treatment text; v_rate numeric; v_tax record;
  v_line_total numeric(14,2); v_used_qty numeric(14,4); v_currency text;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','crear')) then
    raise exception 'Se requiere permiso para crear órdenes desde contrato.' using errcode='42501';
  end if;
  if p_contrato_id is null or p_version_id is null or p_lineas is null or jsonb_typeof(p_lineas) is distinct from 'array'
     or jsonb_array_length(p_lineas)=0 or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key)>128 then
    raise exception 'Contrato, versión, líneas y clave idempotente son obligatorios.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('contrato_id',p_contrato_id,'version_id',p_version_id,'detalle',coalesce(trim(p_detalle),''),
    'fecha_limite',p_fecha_limite,'lineas',p_lineas,'exchange_rate',p_exchange_rate)::text);
  perform pg_advisory_xact_lock(hashtextextended('contract-purchase:'||p_idempotency_key,0));
  select * into v_saved from app_private.purchase_contract_order_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'liberar' or v_saved.payload_hash<>v_hash then raise exception 'La clave ya fue usada con otros datos.' using errcode='23505'; end if;
    return v_saved.compra_id;
  end if;

  select * into v_contract from public.contratos_compra where id=p_contrato_id for update;
  if not found or v_contract.estado<>'Activo' or v_contract.version_actual_id<>p_version_id then
    raise exception 'El contrato no está activo con la versión solicitada; está suspendido, vencido o fue versionado.' using errcode='23514';
  end if;
  select * into v_version from public.versiones_contrato_compra where id=p_version_id and contrato_id=p_contrato_id for share;
  if not found or v_version.estado<>'Activa' or current_date not between v_version.fecha_inicio and v_version.fecha_fin then
    raise exception 'La versión contractual no está vigente.' using errcode='23514';
  end if;
  if not exists(select 1 from public.proveedores where id=v_contract.proveedor_id and estado::text='Activo') then
    raise exception 'El proveedor del contrato está inactivo.' using errcode='23514';
  end if;
  v_currency:=v_version.moneda::text;
  if p_exchange_rate is not null and (p_exchange_rate::text in ('NaN','Infinity','-Infinity') or p_exchange_rate<=0) then
    raise exception 'El tipo de cambio debe ser positivo y finito.' using errcode='22023';
  end if;
  if v_currency='PEN' and coalesce(p_exchange_rate,1)<>1 then raise exception 'Un contrato PEN requiere tipo de cambio 1.' using errcode='22023'; end if;

  if exists(select 1 from jsonb_array_elements(p_lineas) x where jsonb_typeof(x.value) is distinct from 'object'
      or jsonb_typeof(x.value->'producto_id') is distinct from 'string'
      or jsonb_typeof(x.value->'cantidad') is distinct from 'number'
      or jsonb_typeof(x.value->'precio') is distinct from 'number')
     or (select count(distinct value->>'producto_id') from jsonb_array_elements(p_lineas))<>jsonb_array_length(p_lineas) then
    raise exception 'Las líneas de liberación deben ser válidas y no repetir artículos.' using errcode='22023';
  end if;

  select coalesce(sum(monto_comprometido),0) into v_active_amount
    from public.liberaciones_contrato_compra where contrato_id=p_contrato_id and estado='Comprometida';

  for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'producto_id' loop
    v_catalog_id:=(v_line->>'producto_id')::uuid;
    v_qty:=(v_line->>'cantidad')::numeric;
    v_price:=(v_line->>'precio')::numeric;
    v_treatment:=coalesce(nullif(v_line->>'tratamiento_tributario',''),'Gravado');
    v_rate:=coalesce(nullif(v_line->>'tasa_tributaria','')::numeric,case when v_treatment='Gravado' then 18 else 0 end);
    if v_qty<=0 or v_qty<>trunc(v_qty) or v_qty::text in ('NaN','Infinity','-Infinity')
       or v_price<0 or v_price<>round(v_price,2) or v_price::text in ('NaN','Infinity','-Infinity') then
      raise exception 'Cantidad o precio inválido en una línea.' using errcode='22023';
    end if;
    select * into v_contract_line from public.lineas_contrato_compra
      where version_id=p_version_id and proveedor_producto_id=v_catalog_id for update;
    if not found then raise exception 'El artículo no pertenece a la versión activa del contrato.' using errcode='23503'; end if;
    if not exists(select 1 from public.proveedor_productos where id=v_catalog_id and proveedor_id=v_contract.proveedor_id and producto_id is not null) then
      raise exception 'El artículo contractual ya no pertenece al proveedor o no está vinculado a un producto de inventario.' using errcode='23514';
    end if;
    if v_qty<>round(v_qty,4) or v_qty>v_contract_line.cantidad_tope then
      raise exception 'La cantidad de la línea excede el máximo contractual (%, tolerancia 0%%).',v_contract_line.cantidad_tope using errcode='23514';
    end if;
    if round(v_price,2)<>round(v_contract_line.costo_unitario,2)
       or v_treatment<>v_contract_line.tratamiento_tributario or v_rate<>v_contract_line.tasa_tributaria then
      raise exception 'Precio o tratamiento tributario distinto al snapshot contractual en el artículo %.',v_catalog_id using errcode='23514';
    end if;
    if v_contract_line.costo_unitario<>round(v_contract_line.costo_unitario,2) then
      raise exception 'El precio de la línea contractual tiene más precisión que la admitida por la orden de compra.' using errcode='23514';
    end if;
    select * into v_tax from app_private._calcular_impuestos_compra_v1(v_treatment,round(v_qty*v_price,2),v_rate);
    v_line_total:=v_tax.total;
    v_order_total:=v_order_total+v_line_total;
    select coalesce(sum(ll.cantidad),0) into v_used_qty
      from public.lineas_liberacion_contrato_compra ll
      join public.liberaciones_contrato_compra l on l.id=ll.liberacion_id
      where ll.linea_contrato_id=v_contract_line.id and l.estado='Comprometida';
    if v_used_qty+v_qty>v_contract_line.cantidad_tope then
      raise exception 'La cantidad acumulada comprometida excede el tope de línea (% disponibles).',v_contract_line.cantidad_tope-v_used_qty using errcode='23514';
    end if;
  end loop;
  v_order_total:=round(v_order_total,2);
  if v_order_total<=0 or v_active_amount+v_order_total>v_version.monto_tope then
    raise exception 'La liberación excede el saldo del tope bruto del contrato (% % disponibles).',
      round(v_version.monto_tope-v_active_amount,2),v_currency using errcode='23514';
  end if;
  if exists(select 1 from public.compras where idempotency_key=p_idempotency_key) then
    raise exception 'La clave ya se utilizó para crear una orden no vinculada a contrato.' using errcode='23505';
  end if;

  -- La RPC de creación de compras conserva snapshots fiscales, moneda y CxP.
  v_order:=public.crear_orden_compra_operativa_v4(v_contract.proveedor_id,p_detalle,p_fecha_limite,
    null,p_lineas,p_idempotency_key,v_currency,p_exchange_rate);
  if not exists(select 1 from public.compras where id=v_order and proveedor_id=v_contract.proveedor_id and moneda=v_currency) then
    raise exception 'La orden creada no conserva proveedor y moneda del contrato.' using errcode='23514';
  end if;
  if (select round(monto,2) from public.compras where id=v_order)<>v_order_total then
    raise exception 'El total bruto de la orden difiere del importe calculado para el contrato.' using errcode='23514';
  end if;

  insert into public.liberaciones_contrato_compra(contrato_id,version_id,compra_id,moneda,monto_comprometido,
    liberada_por,idempotency_key,payload_hash)
    values(p_contrato_id,p_version_id,v_order,v_currency,v_order_total,v_uid,p_idempotency_key,v_hash)
    returning id into v_release;
  for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'producto_id' loop
    v_catalog_id:=(v_line->>'producto_id')::uuid;
    v_qty:=(v_line->>'cantidad')::numeric;
    select l.id into v_contract_line_id from public.lineas_contrato_compra l
      where l.version_id=p_version_id and l.proveedor_producto_id=v_catalog_id;
    insert into public.lineas_liberacion_contrato_compra(liberacion_id,contrato_id,version_id,linea_contrato_id,
      detalle_compra_id,cantidad,monto_bruto)
    select v_release,p_contrato_id,p_version_id,v_contract_line_id,d.id,v_qty,d.total_linea
      from public.detalle_compras d where d.compra_id=v_order and d.proveedor_producto_id=v_catalog_id;
    get diagnostics v_count=row_count;
    if v_count<>1 then raise exception 'No se pudo enlazar de forma unívoca la línea creada con su compromiso contractual.' using errcode='23514'; end if;
  end loop;
  insert into public.liberaciones_contrato_compra_historial(liberacion_id,evento,actor_id,motivo,monto,idempotency_key)
    values(v_release,'Liberada',v_uid,null,v_order_total,p_idempotency_key);
  insert into app_private.purchase_contract_order_idempotency(idempotency_key,operation,payload_hash,compra_id,liberacion_id)
    values(p_idempotency_key,'liberar',v_hash,v_order,v_release);
  return v_order;
end
$function$;

-- Cancelación append-only e idempotente. Solo admite órdenes sin recepciones;
-- reabre cupo exactamente una vez y conserva el monto original de la liberación.
create or replace function public.cancelar_orden_compra_v1(
  p_compra_id uuid,p_motivo text,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_order public.compras%rowtype;
  v_release public.liberaciones_contrato_compra%rowtype; v_saved app_private.purchase_contract_order_idempotency%rowtype;
  v_hash text; v_history_key text;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'Se requiere permiso para cancelar órdenes de compra.' using errcode='42501';
  end if;
  if p_compra_id is null or length(trim(coalesce(p_motivo,''))) not between 5 and 500
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key)>128 then
    raise exception 'La cancelación requiere orden, motivo y clave idempotente válidos.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('compra_id',p_compra_id,'motivo',trim(p_motivo))::text);
  perform pg_advisory_xact_lock(hashtextextended('contract-purchase:'||p_idempotency_key,0));
  select * into v_saved from app_private.purchase_contract_order_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'cancelar' or v_saved.payload_hash<>v_hash then raise exception 'La clave ya se usó con otros datos.' using errcode='23505'; end if;
    return v_saved.compra_id;
  end if;
  select * into v_order from public.compras where id=p_compra_id for update;
  if not found then raise exception 'La orden no existe.' using errcode='23503'; end if;
  if v_order.estado::text in ('Cancelada','Rechazada','Pagada') then raise exception 'La orden ya está cerrada y no se puede cancelar.' using errcode='23514'; end if;
  if exists(select 1 from public.recepciones_compra where compra_id=p_compra_id) then
    raise exception 'No se puede cancelar ni restituir cupo de una orden que ya tuvo recepción.' using errcode='23514';
  end if;
  select * into v_release from public.liberaciones_contrato_compra where compra_id=p_compra_id for update;
  if not found then raise exception 'La orden no está vinculada a una liberación de contrato.' using errcode='23514'; end if;
  if v_release.estado<>'Comprometida' then raise exception 'El cupo de la orden ya fue restituido.' using errcode='23514'; end if;
  perform set_config('app.ec_contract_order_rpc','on',true);
  update public.compras set estado='Cancelada',updated_at=clock_timestamp() where id=p_compra_id;
  if not found then raise exception 'No se pudo cambiar el estado de la orden.' using errcode='23514'; end if;
  perform 1 from public.contratos_compra where id=v_release.contrato_id for update;
  update public.liberaciones_contrato_compra set estado='Restituida',restituida_por=v_uid,
    restituida_en=clock_timestamp(),motivo_restitucion=trim(p_motivo)
    where id=v_release.id and estado='Comprometida';
  if not found then raise exception 'La liberación ya no está comprometida; no se puede restituir dos veces.' using errcode='23514'; end if;
  v_history_key:=p_idempotency_key||':restitucion';
  insert into public.liberaciones_contrato_compra_historial(liberacion_id,evento,actor_id,motivo,monto,idempotency_key)
    values(v_release.id,'Cupo restituido',v_uid,trim(p_motivo),v_release.monto_comprometido,v_history_key);
  insert into app_private.purchase_contract_order_idempotency(idempotency_key,operation,payload_hash,compra_id,liberacion_id)
    values(p_idempotency_key,'cancelar',v_hash,p_compra_id,v_release.id);
  return p_compra_id;
end
$function$;

revoke all on function public.crear_orden_compra_desde_contrato_v1(uuid,uuid,text,date,jsonb,text,numeric) from public,anon;
revoke all on function public.cancelar_orden_compra_v1(uuid,text,text) from public,anon;
grant execute on function public.crear_orden_compra_desde_contrato_v1(uuid,uuid,text,date,jsonb,text,numeric) to authenticated;
grant execute on function public.cancelar_orden_compra_v1(uuid,text,text) to authenticated;

do $audit$
begin
  if to_regprocedure('public.fn_auditar()') is not null then
    execute 'create trigger trg_auditoria_liberacion_contrato after insert on public.liberaciones_contrato_compra for each row execute function public.fn_auditar()';
    execute 'create trigger trg_auditoria_linea_liberacion_contrato after insert on public.lineas_liberacion_contrato_compra for each row execute function public.fn_auditar()';
    execute 'create trigger trg_auditoria_historial_liberacion_contrato after insert on public.liberaciones_contrato_compra_historial for each row execute function public.fn_auditar()';
  end if;
end
$audit$;

commit;

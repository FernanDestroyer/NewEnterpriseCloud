-- Fase F01-F05: decisión D08, contratos y snapshots de versiones inmutables,
-- activación y suspensión. Sin liberaciones ni integración con órdenes (F06+).
-- Aplicación manual por el usuario; activar no registra CxP ni mueve inventario.
begin;

-- D08 (F01): el tope monetario se expresa en la moneda del contrato (PEN o USD);
-- las líneas heredan esa moneda y futuras órdenes vinculadas deberán coincidir.
-- El monto tope es bruto, incluidos impuestos; tolerancia monetaria/cantidad: 0%.
-- La cancelación previa a la recepción restitituirá cupo automáticamente (F08).
create sequence if not exists public.seq_contratos_compra as bigint;

create table if not exists public.contratos_compra (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('CTR-'||lpad(nextval('public.seq_contratos_compra')::text,6,'0')),
  proveedor_id uuid not null references public.proveedores(id) on delete restrict,
  responsable_id uuid not null references public.usuarios(id) on delete restrict,
  nombre text not null check(length(trim(nombre)) between 3 and 180),
  detalle text not null default '' check(length(detalle)<=2000),
  estado text not null default 'Borrador' check(estado in ('Borrador','Activo','Suspendido','Cerrado')),
  version_actual_id uuid,
  creado_por uuid not null references public.usuarios(id) on delete restrict default auth.uid(),
  creado_en timestamptz not null default now(),
  activado_por uuid references public.usuarios(id) on delete restrict,
  activado_en timestamptz,
  suspendido_por uuid references public.usuarios(id) on delete restrict,
  suspendido_en timestamptz,
  suspension_motivo text,
  updated_at timestamptz not null default now(),
  unique(id,proveedor_id),
  check((estado<>'Suspendido') or (suspendido_por is not null and suspendido_en is not null and suspension_motivo is not null)),
  check((estado not in ('Activo','Suspendido')) or version_actual_id is not null)
);

create table if not exists public.versiones_contrato_compra (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null,
  proveedor_id uuid not null,
  numero_version integer not null check(numero_version>0),
  estado text not null default 'Borrador' check(estado in ('Borrador','Activa','Reemplazada')),
  fecha_inicio date not null,
  fecha_fin date not null,
  moneda char(3) not null check(moneda in ('PEN','USD')),
  monto_tope numeric(14,2) not null check(monto_tope>0 and monto_tope::text not in ('NaN','Infinity','-Infinity')),
  condiciones text not null default '' check(length(condiciones)<=4000),
  creado_por uuid not null references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now(),
  activado_por uuid references public.usuarios(id) on delete restrict,
  activado_en timestamptz,
  check(fecha_inicio<=fecha_fin),
  check((estado<>'Activa') or (activado_por is not null and activado_en is not null)),
  unique(contrato_id,numero_version),
  unique(id,contrato_id,proveedor_id),
  foreign key(contrato_id,proveedor_id) references public.contratos_compra(id,proveedor_id) on delete restrict
);

-- El FK compuesto de líneas valida que el artículo pertenezca al proveedor del contrato.
-- PostgreSQL exige que esta clave sea única antes de crear la tabla que la referencia.
create unique index if not exists proveedor_productos_proveedor_id_unico_idx
  on public.proveedor_productos(proveedor_id,id);

create table if not exists public.lineas_contrato_compra (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null,
  version_id uuid not null,
  proveedor_id uuid not null,
  proveedor_producto_id uuid not null,
  unidad_medida_id uuid references public.unidades_medida(id) on delete restrict,
  unidad text not null check(length(trim(unidad)) between 1 and 40),
  descripcion text not null check(length(trim(descripcion)) between 1 and 500),
  cantidad_tope numeric(14,4) not null check(cantidad_tope>0 and cantidad_tope::text not in ('NaN','Infinity','-Infinity')),
  costo_unitario numeric(14,4) not null check(costo_unitario>=0 and costo_unitario::text not in ('NaN','Infinity','-Infinity')),
  tratamiento_tributario text not null check(tratamiento_tributario in ('Gravado','Exonerado','Inafecto')),
  tasa_tributaria numeric(5,2) not null check((tratamiento_tributario='Gravado' and tasa_tributaria=18) or (tratamiento_tributario in ('Exonerado','Inafecto') and tasa_tributaria=0)),
  condiciones text not null default '' check(length(condiciones)<=1000),
  creado_por uuid not null references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now(),
  foreign key(version_id,contrato_id,proveedor_id) references public.versiones_contrato_compra(id,contrato_id,proveedor_id) on delete restrict,
  foreign key(proveedor_id,proveedor_producto_id) references public.proveedor_productos(proveedor_id,id) on delete restrict,
  unique(version_id,proveedor_producto_id)
);

do $version_actual_fk$
begin
  if not exists(select 1 from pg_constraint where conname='contratos_compra_version_actual_fk'
    and conrelid='public.contratos_compra'::regclass) then
    alter table public.contratos_compra
      add constraint contratos_compra_version_actual_fk
      foreign key(version_actual_id,id,proveedor_id)
      references public.versiones_contrato_compra(id,contrato_id,proveedor_id) on delete restrict;
  end if;
end
$version_actual_fk$;

create table if not exists public.contratos_compra_historial (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos_compra(id) on delete restrict,
  version_id uuid references public.versiones_contrato_compra(id) on delete restrict,
  evento text not null check(evento in ('Creado','Nueva versión','Activado','Suspendido')),
  actor_id uuid not null references public.usuarios(id) on delete restrict,
  motivo text,
  datos jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table if not exists app_private.contract_purchase_idempotency (
  idempotency_key text primary key,
  operation text not null check(operation in ('crear','versionar','activar','suspender')),
  payload_hash text not null,
  contrato_id uuid not null references public.contratos_compra(id) on delete restrict,
  version_id uuid references public.versiones_contrato_compra(id) on delete restrict,
  result_id uuid not null,
  actor_id uuid not null references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now()
);
revoke all on app_private.contract_purchase_idempotency from public,anon,authenticated;

create unique index if not exists contratos_compra_codigo_unico_idx on public.contratos_compra(codigo);
create index if not exists contratos_compra_proveedor_estado_idx on public.contratos_compra(proveedor_id,estado,creado_en desc);
create index if not exists contratos_compra_estado_vigencia_idx on public.contratos_compra(estado,version_actual_id);
create unique index if not exists contratos_version_borrador_unica_idx
  on public.versiones_contrato_compra(contrato_id) where estado='Borrador';
create unique index if not exists contratos_version_activa_unica_idx
  on public.versiones_contrato_compra(contrato_id) where estado='Activa';
create index if not exists versiones_contrato_historial_idx
  on public.versiones_contrato_compra(contrato_id,numero_version desc);
create index if not exists lineas_contrato_version_idx on public.lineas_contrato_compra(version_id,id);
create index if not exists contratos_historial_fecha_idx on public.contratos_compra_historial(contrato_id,created_at desc,id desc);

alter table public.contratos_compra enable row level security;
alter table public.versiones_contrato_compra enable row level security;
alter table public.lineas_contrato_compra enable row level security;
alter table public.contratos_compra_historial enable row level security;
revoke all on public.contratos_compra,public.versiones_contrato_compra,public.lineas_contrato_compra,public.contratos_compra_historial from public,anon,authenticated;
grant select on public.contratos_compra,public.versiones_contrato_compra,public.lineas_contrato_compra,public.contratos_compra_historial to authenticated;
drop policy if exists contratos_compra_select on public.contratos_compra;
create policy contratos_compra_select on public.contratos_compra for select to authenticated
  using((select app_private._tiene_permiso('compras','ver')));
drop policy if exists versiones_contrato_compra_select on public.versiones_contrato_compra;
create policy versiones_contrato_compra_select on public.versiones_contrato_compra for select to authenticated
  using((select app_private._tiene_permiso('compras','ver')));
drop policy if exists lineas_contrato_compra_select on public.lineas_contrato_compra;
create policy lineas_contrato_compra_select on public.lineas_contrato_compra for select to authenticated
  using((select app_private._tiene_permiso('compras','ver')));
drop policy if exists contratos_compra_historial_select on public.contratos_compra_historial;
create policy contratos_compra_historial_select on public.contratos_compra_historial for select to authenticated
  using((select app_private._tiene_permiso('compras','ver')));

create or replace function app_private._proteger_version_contrato_compra_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op='DELETE' then raise exception 'Las versiones de contrato son históricas y no se eliminan.' using errcode='23514'; end if;
  if row(new.contrato_id,new.proveedor_id,new.numero_version,new.fecha_inicio,new.fecha_fin,new.moneda,new.monto_tope,new.condiciones,new.creado_por,new.creado_en)
     is distinct from row(old.contrato_id,old.proveedor_id,old.numero_version,old.fecha_inicio,old.fecha_fin,old.moneda,old.monto_tope,old.condiciones,old.creado_por,old.creado_en)
     or not ((old.estado='Borrador' and new.estado in ('Activa','Reemplazada')) or (old.estado='Activa' and new.estado='Reemplazada')) then
    raise exception 'El contenido de una versión contractual es inmutable; crea otra versión para editar.' using errcode='23514';
  end if;
  if old.estado='Borrador' and new.estado='Activa' then
    if new.activado_por is null or new.activado_en is null then
      raise exception 'La activación requiere actor y fecha.' using errcode='23514';
    end if;
  elsif row(new.activado_por,new.activado_en) is distinct from row(old.activado_por,old.activado_en) then
    raise exception 'No se puede alterar la auditoría de activación de una versión.' using errcode='23514';
  end if;
  return new;
end
$function$;
drop trigger if exists trg_inmutable_version_contrato_compra on public.versiones_contrato_compra;
create trigger trg_inmutable_version_contrato_compra before update or delete on public.versiones_contrato_compra
  for each row execute function app_private._proteger_version_contrato_compra_v1();
revoke all on function app_private._proteger_version_contrato_compra_v1() from public,anon,authenticated;

create or replace function app_private._proteger_linea_contrato_compra_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  raise exception 'Las líneas contractuales son inmutables; crea una nueva versión del contrato.' using errcode='23514';
end
$function$;
drop trigger if exists trg_inmutable_linea_contrato_compra on public.lineas_contrato_compra;
create trigger trg_inmutable_linea_contrato_compra before update or delete on public.lineas_contrato_compra
  for each row execute function app_private._proteger_linea_contrato_compra_v1();
revoke all on function app_private._proteger_linea_contrato_compra_v1() from public,anon,authenticated;

create or replace function app_private._validar_lineas_version_contrato_v1(
  p_proveedor_id uuid,p_moneda text,p_monto_tope numeric,p_lineas jsonb
)
returns void language plpgsql security definer set search_path = '' as $function$
declare v_line jsonb; v_product uuid; v_qty numeric; v_price numeric; v_treatment text; v_tax numeric; v_count integer:=0; v_capacity numeric:=0;
begin
  if p_lineas is null or jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas)=0 or jsonb_array_length(p_lineas)>200 then
    raise exception 'La versión requiere entre 1 y 200 líneas.' using errcode='22023';
  end if;
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    v_product:=nullif(v_line->>'proveedor_producto_id','')::uuid;
    v_qty:=nullif(v_line->>'cantidad_tope','')::numeric;
    v_price:=nullif(v_line->>'costo_unitario','')::numeric;
    v_treatment:=nullif(trim(v_line->>'tratamiento_tributario'),'');
    v_tax:=nullif(v_line->>'tasa_tributaria','')::numeric;
    if v_product is null or v_qty is null or v_qty::text in ('NaN','Infinity','-Infinity') or v_qty<=0 or v_qty>9999999999.9999
       or v_price is null or v_price::text in ('NaN','Infinity','-Infinity') or v_price<0 or v_price>9999999999.9999
       or v_treatment is null or v_treatment not in ('Gravado','Exonerado','Inafecto') or v_tax is null
       or not ((v_treatment='Gravado' and v_tax=18) or (v_treatment in ('Exonerado','Inafecto') and v_tax=0))
       or length(trim(coalesce(v_line->>'unidad','')))=0 or length(trim(coalesce(v_line->>'descripcion','')))=0
       or not exists(select 1 from public.proveedor_productos pp where pp.id=v_product and pp.proveedor_id=p_proveedor_id) then
      raise exception 'Línea inválida: requiere artículo del proveedor, cantidad tope, precio, unidad y tratamiento tributario compatibles.' using errcode='22023';
    end if;
    perform * from app_private._calcular_impuestos_compra_v1(v_treatment,v_qty*v_price,v_tax);
    v_capacity:=v_capacity+(select tax.total from app_private._calcular_impuestos_compra_v1(v_treatment,v_qty*v_price,v_tax) tax);
    v_count:=v_count+1;
  end loop;
  if (select count(distinct (value->>'proveedor_producto_id')) from jsonb_array_elements(p_lineas))<>v_count then
    raise exception 'No repitas el artículo del proveedor dentro de una misma versión.' using errcode='22023';
  end if;
  if v_capacity>p_monto_tope then
    raise exception 'El valor bruto máximo de las líneas (%) excede el tope monetario del contrato (% %).',round(v_capacity,2),round(p_monto_tope,2),p_moneda using errcode='23514';
  end if;
end
$function$;
revoke all on function app_private._validar_lineas_version_contrato_v1(uuid,text,numeric,jsonb) from public,anon,authenticated;

create or replace function app_private._insertar_lineas_version_contrato_v1(
  p_contrato_id uuid,p_version_id uuid,p_proveedor_id uuid,p_uid uuid,p_lineas jsonb
)
returns void language sql security definer set search_path = '' as $function$
  insert into public.lineas_contrato_compra(contrato_id,version_id,proveedor_id,proveedor_producto_id,unidad_medida_id,
    unidad,descripcion,cantidad_tope,costo_unitario,tratamiento_tributario,tasa_tributaria,condiciones,creado_por)
  select p_contrato_id,p_version_id,p_proveedor_id,x.proveedor_producto_id,x.unidad_medida_id,
    trim(x.unidad),trim(x.descripcion),x.cantidad_tope,x.costo_unitario,x.tratamiento_tributario,x.tasa_tributaria,
    coalesce(trim(x.condiciones),''),p_uid
  from jsonb_to_recordset(p_lineas) as x(
    proveedor_producto_id uuid,unidad_medida_id uuid,unidad text,descripcion text,cantidad_tope numeric,
    costo_unitario numeric,tratamiento_tributario text,tasa_tributaria numeric,condiciones text)
$function$;
revoke all on function app_private._insertar_lineas_version_contrato_v1(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;

create or replace function public.crear_contrato_compra_v1(
  p_proveedor_id uuid,p_responsable_id uuid,p_nombre text,p_detalle text,
  p_fecha_inicio date,p_fecha_fin date,p_moneda text,p_monto_tope numeric,
  p_condiciones text,p_lineas jsonb,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid:=(select auth.uid()); v_hash text; v_saved app_private.contract_purchase_idempotency%rowtype;
  v_contract uuid; v_version uuid;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','crear')) then raise exception 'Se requiere permiso de Compras para crear contratos.' using errcode='42501'; end if;
  if p_proveedor_id is null or p_responsable_id is null or nullif(trim(p_nombre),'') is null
     or length(trim(p_nombre)) not between 3 and 180 or p_fecha_inicio is null or p_fecha_fin is null or p_fecha_inicio>p_fecha_fin
     or p_fecha_fin<current_date or p_moneda is null or p_moneda not in ('PEN','USD')
     or not exists(select 1 from public.monedas m where m.codigo=p_moneda and m.activo)
     or p_monto_tope is null or p_monto_tope<=0 or p_monto_tope::text in ('NaN','Infinity','-Infinity')
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Datos de contrato, vigencia, moneda, tope o clave inválidos.' using errcode='22023';
  end if;
  if not exists(select 1 from public.proveedores where id=p_proveedor_id and estado::text='Activo') then raise exception 'El proveedor no existe o está inactivo.' using errcode='23503'; end if;
  if not exists(select 1 from public.usuarios where id=p_responsable_id and activo) then raise exception 'El responsable debe ser un usuario activo.' using errcode='23503'; end if;
  perform app_private._validar_lineas_version_contrato_v1(p_proveedor_id,p_moneda,p_monto_tope,p_lineas);
  v_hash:=md5(jsonb_build_object('proveedor_id',p_proveedor_id,'responsable_id',p_responsable_id,'nombre',trim(p_nombre),
    'detalle',coalesce(trim(p_detalle),''),'inicio',p_fecha_inicio,'fin',p_fecha_fin,'moneda',p_moneda,
    'monto_tope',p_monto_tope,'condiciones',coalesce(trim(p_condiciones),''),'lineas',p_lineas)::text);
  perform pg_advisory_xact_lock(hashtextextended('contrato-compra:'||p_idempotency_key,0));
  select * into v_saved from app_private.contract_purchase_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'crear' or v_saved.payload_hash<>v_hash then raise exception 'La clave de idempotencia ya se usó con otros datos.' using errcode='23505'; end if;
    return v_saved.result_id;
  end if;
  insert into public.contratos_compra(proveedor_id,responsable_id,nombre,detalle,creado_por)
    values(p_proveedor_id,p_responsable_id,trim(p_nombre),trim(coalesce(p_detalle,'')),v_uid) returning id into v_contract;
  insert into public.versiones_contrato_compra(contrato_id,proveedor_id,numero_version,fecha_inicio,fecha_fin,moneda,monto_tope,condiciones,creado_por)
    values(v_contract,p_proveedor_id,1,p_fecha_inicio,p_fecha_fin,p_moneda,p_monto_tope,trim(coalesce(p_condiciones,'')),v_uid) returning id into v_version;
  perform app_private._insertar_lineas_version_contrato_v1(v_contract,v_version,p_proveedor_id,v_uid,p_lineas);
  insert into public.contratos_compra_historial(contrato_id,version_id,evento,actor_id,datos,idempotency_key)
    values(v_contract,v_version,'Creado',v_uid,jsonb_build_object('version',1,'moneda',p_moneda,'monto_tope',p_monto_tope),p_idempotency_key);
  insert into app_private.contract_purchase_idempotency(idempotency_key,operation,payload_hash,contrato_id,version_id,result_id,actor_id)
    values(p_idempotency_key,'crear',v_hash,v_contract,v_version,v_contract,v_uid);
  return v_contract;
end
$function$;

create or replace function public.crear_version_contrato_compra_v1(
  p_contrato_id uuid,p_fecha_inicio date,p_fecha_fin date,p_moneda text,p_monto_tope numeric,
  p_condiciones text,p_lineas jsonb,p_motivo text,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid:=(select auth.uid()); v_contract public.contratos_compra%rowtype;
  v_hash text; v_saved app_private.contract_purchase_idempotency%rowtype; v_version uuid; v_number integer;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then raise exception 'Se requiere permiso de edición de Compras para versionar el contrato.' using errcode='42501'; end if;
  if p_contrato_id is null or length(trim(coalesce(p_motivo,''))) not between 5 and 500
     or p_fecha_inicio is null or p_fecha_fin is null or p_fecha_inicio>p_fecha_fin or p_fecha_fin<current_date
     or p_moneda is null or p_moneda not in ('PEN','USD') or p_monto_tope is null or p_monto_tope<=0
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Versión, motivo, vigencia, moneda, tope o clave inválidos.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('contrato_id',p_contrato_id,'inicio',p_fecha_inicio,'fin',p_fecha_fin,'moneda',p_moneda,
    'monto_tope',p_monto_tope,'condiciones',coalesce(trim(p_condiciones),''),'lineas',p_lineas,'motivo',trim(p_motivo))::text);
  perform pg_advisory_xact_lock(hashtextextended('contrato-compra:'||p_idempotency_key,0));
  select * into v_saved from app_private.contract_purchase_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'versionar' or v_saved.payload_hash<>v_hash then raise exception 'La clave de idempotencia ya se usó con otros datos.' using errcode='23505'; end if;
    return v_saved.version_id;
  end if;
  select * into v_contract from public.contratos_compra where id=p_contrato_id for update;
  if not found then raise exception 'El contrato no existe.' using errcode='23503'; end if;
  if v_contract.estado not in ('Borrador','Suspendido') then raise exception 'Suspende el contrato antes de preparar una nueva versión.' using errcode='23514'; end if;
  if not exists(select 1 from public.monedas m where m.codigo=p_moneda and m.activo) then raise exception 'La moneda no está activa.' using errcode='22023'; end if;
  perform app_private._validar_lineas_version_contrato_v1(v_contract.proveedor_id,p_moneda,p_monto_tope,p_lineas);
  update public.versiones_contrato_compra set estado='Reemplazada' where contrato_id=p_contrato_id and estado='Borrador';
  select coalesce(max(numero_version),0)+1 into v_number from public.versiones_contrato_compra where contrato_id=p_contrato_id;
  insert into public.versiones_contrato_compra(contrato_id,proveedor_id,numero_version,fecha_inicio,fecha_fin,moneda,monto_tope,condiciones,creado_por)
    values(p_contrato_id,v_contract.proveedor_id,v_number,p_fecha_inicio,p_fecha_fin,p_moneda,p_monto_tope,trim(coalesce(p_condiciones,'')),v_uid)
    returning id into v_version;
  perform app_private._insertar_lineas_version_contrato_v1(p_contrato_id,v_version,v_contract.proveedor_id,v_uid,p_lineas);
  insert into public.contratos_compra_historial(contrato_id,version_id,evento,actor_id,motivo,datos,idempotency_key)
    values(p_contrato_id,v_version,'Nueva versión',v_uid,trim(p_motivo),jsonb_build_object('numero_version',v_number,'moneda',p_moneda,'monto_tope',p_monto_tope),p_idempotency_key);
  insert into app_private.contract_purchase_idempotency(idempotency_key,operation,payload_hash,contrato_id,version_id,result_id,actor_id)
    values(p_idempotency_key,'versionar',v_hash,p_contrato_id,v_version,v_version,v_uid);
  return v_version;
end
$function$;

create or replace function public.activar_contrato_compra_v1(
  p_contrato_id uuid,p_version_id uuid,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid:=(select auth.uid()); v_contract public.contratos_compra%rowtype;
  v_version public.versiones_contrato_compra%rowtype; v_saved app_private.contract_purchase_idempotency%rowtype;
  v_hash text; v_line_count integer; v_capacity numeric;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then raise exception 'Se requiere permiso de edición de Compras para activar contratos.' using errcode='42501'; end if;
  if p_contrato_id is null or p_version_id is null or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Contrato, versión y clave idempotente son obligatorios.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('contrato_id',p_contrato_id,'version_id',p_version_id)::text);
  perform pg_advisory_xact_lock(hashtextextended('contrato-compra:'||p_idempotency_key,0));
  select * into v_saved from app_private.contract_purchase_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'activar' or v_saved.payload_hash<>v_hash then raise exception 'La clave de idempotencia ya se usó con otros datos.' using errcode='23505'; end if;
    return v_saved.contrato_id;
  end if;
  select * into v_contract from public.contratos_compra where id=p_contrato_id for update;
  if not found then raise exception 'El contrato no existe.' using errcode='23503'; end if;
  if v_contract.estado not in ('Borrador','Suspendido') then raise exception 'Solo se puede activar un contrato en borrador o suspendido.' using errcode='23514'; end if;
  select * into v_version from public.versiones_contrato_compra where id=p_version_id and contrato_id=p_contrato_id for update;
  if not found or v_version.estado<>'Borrador' then raise exception 'La versión debe pertenecer al contrato y estar en borrador.' using errcode='23514'; end if;
  if v_version.fecha_inicio>v_version.fecha_fin or v_version.fecha_fin<current_date then raise exception 'La vigencia está invertida o ya expiró.' using errcode='23514'; end if;
  if not exists(select 1 from public.proveedores p where p.id=v_contract.proveedor_id and p.estado::text='Activo') then raise exception 'El proveedor no está activo.' using errcode='23514'; end if;
  if not exists(select 1 from public.monedas m where m.codigo=v_version.moneda and m.activo) then raise exception 'La moneda de la versión ya no está activa.' using errcode='23514'; end if;
  select count(*),coalesce(sum((select tax.total from app_private._calcular_impuestos_compra_v1(
    l.tratamiento_tributario,round(l.cantidad_tope*l.costo_unitario,2),l.tasa_tributaria) tax)),0)
    into v_line_count,v_capacity from public.lineas_contrato_compra l where l.version_id=p_version_id;
  if v_line_count=0 then raise exception 'No se activa un contrato sin líneas.' using errcode='23514'; end if;
  if v_capacity>v_version.monto_tope then raise exception 'El total bruto de las líneas excede el monto tope de la versión.' using errcode='23514'; end if;
  update public.versiones_contrato_compra set estado='Reemplazada'
    where contrato_id=p_contrato_id and estado='Activa';
  update public.versiones_contrato_compra set estado='Activa',activado_por=v_uid,activado_en=clock_timestamp() where id=p_version_id;
  update public.contratos_compra set estado='Activo',version_actual_id=p_version_id,activado_por=v_uid,activado_en=clock_timestamp(),
    suspendido_por=null,suspendido_en=null,suspension_motivo=null,updated_at=clock_timestamp() where id=p_contrato_id;
  insert into public.contratos_compra_historial(contrato_id,version_id,evento,actor_id,datos,idempotency_key)
    values(p_contrato_id,p_version_id,'Activado',v_uid,jsonb_build_object('numero_version',v_version.numero_version,'moneda',v_version.moneda,'monto_tope',v_version.monto_tope),p_idempotency_key);
  insert into app_private.contract_purchase_idempotency(idempotency_key,operation,payload_hash,contrato_id,version_id,result_id,actor_id)
    values(p_idempotency_key,'activar',v_hash,p_contrato_id,p_version_id,p_contrato_id,v_uid);
  -- Esta transición solo afecta el expediente contractual: no crea CxP ni toca stock.
  return p_contrato_id;
end
$function$;

create or replace function public.suspender_contrato_compra_v1(
  p_contrato_id uuid,p_motivo text,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid:=(select auth.uid()); v_contract public.contratos_compra%rowtype;
  v_saved app_private.contract_purchase_idempotency%rowtype; v_hash text;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then raise exception 'Se requiere permiso de edición de Compras para suspender contratos.' using errcode='42501'; end if;
  if p_contrato_id is null or length(trim(coalesce(p_motivo,''))) not between 5 and 500
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'La suspensión requiere contrato, motivo y clave idempotente válidos.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('contrato_id',p_contrato_id,'motivo',trim(p_motivo))::text);
  perform pg_advisory_xact_lock(hashtextextended('contrato-compra:'||p_idempotency_key,0));
  select * into v_saved from app_private.contract_purchase_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'suspender' or v_saved.payload_hash<>v_hash then raise exception 'La clave de idempotencia ya se usó con otros datos.' using errcode='23505'; end if;
    return v_saved.contrato_id;
  end if;
  select * into v_contract from public.contratos_compra where id=p_contrato_id for update;
  if not found then raise exception 'El contrato no existe.' using errcode='23503'; end if;
  if v_contract.estado<>'Activo' or v_contract.version_actual_id is null then raise exception 'Solo se suspende un contrato activo.' using errcode='23514'; end if;
  update public.contratos_compra set estado='Suspendido',suspendido_por=v_uid,suspendido_en=clock_timestamp(),
    suspension_motivo=trim(p_motivo),updated_at=clock_timestamp() where id=p_contrato_id;
  insert into public.contratos_compra_historial(contrato_id,version_id,evento,actor_id,motivo,datos,idempotency_key)
    values(p_contrato_id,v_contract.version_actual_id,'Suspendido',v_uid,trim(p_motivo),jsonb_build_object('estado_anterior',v_contract.estado),p_idempotency_key);
  insert into app_private.contract_purchase_idempotency(idempotency_key,operation,payload_hash,contrato_id,version_id,result_id,actor_id)
    values(p_idempotency_key,'suspender',v_hash,p_contrato_id,v_contract.version_actual_id,p_contrato_id,v_uid);
  return p_contrato_id;
end
$function$;

revoke all on function public.crear_contrato_compra_v1(uuid,uuid,text,text,date,date,text,numeric,text,jsonb,text) from public,anon;
revoke all on function public.crear_version_contrato_compra_v1(uuid,date,date,text,numeric,text,jsonb,text,text) from public,anon;
revoke all on function public.activar_contrato_compra_v1(uuid,uuid,text) from public,anon;
revoke all on function public.suspender_contrato_compra_v1(uuid,text,text) from public,anon;
grant execute on function public.crear_contrato_compra_v1(uuid,uuid,text,text,date,date,text,numeric,text,jsonb,text) to authenticated;
grant execute on function public.crear_version_contrato_compra_v1(uuid,date,date,text,numeric,text,jsonb,text,text) to authenticated;
grant execute on function public.activar_contrato_compra_v1(uuid,uuid,text) to authenticated;
grant execute on function public.suspender_contrato_compra_v1(uuid,text,text) to authenticated;

do $audit$
declare v_table text;
begin
  if to_regprocedure('public.fn_auditar()') is not null then
    foreach v_table in array array['contratos_compra','versiones_contrato_compra','lineas_contrato_compra','contratos_compra_historial'] loop
      if not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass(format('public.%I',v_table))
        and t.tgfoid='public.fn_auditar()'::regprocedure and not t.tgisinternal) then
        execute format('create trigger trg_auditoria after insert or update or delete on public.%I for each row execute function public.fn_auditar()',v_table);
      end if;
    end loop;
  end if;
end
$audit$;

commit;

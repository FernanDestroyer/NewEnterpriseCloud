-- Fase G01-G05: carpetas de importación, vínculo seguro de órdenes USD,
-- gastos iniciales y previsualización determinística de costo puesto en almacén.
-- No aplica costos a inventario ni crea obligaciones financieras.
begin;

create sequence if not exists public.seq_carpetas_importacion as bigint;

create table if not exists public.carpetas_importacion (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('IMP-'||lpad(nextval('public.seq_carpetas_importacion')::text,6,'0')),
  nombre text not null check(length(trim(nombre)) between 3 and 180),
  referencia text not null default '' check(length(referencia)<=500),
  moneda char(3) not null default 'USD' check(moneda='USD'),
  estado text not null default 'Abierta' check(estado in ('Abierta','Cerrada')),
  creado_por uuid not null references public.usuarios(id) on delete restrict default auth.uid(),
  creado_en timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ordenes_importacion (
  id uuid primary key default gen_random_uuid(),
  carpeta_id uuid not null references public.carpetas_importacion(id) on delete restrict,
  compra_id uuid not null unique references public.compras(id) on delete restrict,
  codigo_orden text not null,
  proveedor_id uuid not null references public.proveedores(id) on delete restrict,
  moneda char(3) not null check(moneda='USD'),
  tipo_cambio numeric(18,6) not null check(tipo_cambio>0 and tipo_cambio::text not in ('NaN','Infinity','-Infinity')),
  vinculada_por uuid not null references public.usuarios(id) on delete restrict,
  vinculada_en timestamptz not null default now(),
  unique(carpeta_id,compra_id)
);

create table if not exists public.gastos_importacion (
  id uuid primary key default gen_random_uuid(),
  carpeta_id uuid not null references public.carpetas_importacion(id) on delete restrict,
  tipo text not null check(tipo in ('Flete','Seguro','Arancel/Advalorem','Agente de Aduanas','Otros')),
  descripcion text not null check(length(trim(descripcion)) between 1 and 500),
  monto numeric(14,2) not null check(monto>0 and monto::text not in ('NaN','Infinity','-Infinity')),
  moneda char(3) not null default 'USD' check(moneda='USD'),
  referencia text not null default '' check(length(referencia)<=300),
  idempotency_key text not null unique,
  creado_por uuid not null references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now()
);

create table if not exists public.carpetas_importacion_historial (
  id uuid primary key default gen_random_uuid(),
  carpeta_id uuid not null references public.carpetas_importacion(id) on delete restrict,
  evento text not null check(evento in ('Creada','Orden vinculada','Orden desvinculada','Gasto registrado')),
  actor_id uuid not null references public.usuarios(id) on delete restrict,
  compra_id uuid references public.compras(id) on delete restrict,
  gasto_id uuid references public.gastos_importacion(id) on delete restrict,
  motivo text,
  datos jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create table if not exists app_private.import_purchase_idempotency (
  idempotency_key text primary key,
  operation text not null check(operation in ('crear_carpeta','vincular_orden','desvincular_orden','registrar_gasto')),
  payload_hash text not null,
  carpeta_id uuid not null references public.carpetas_importacion(id) on delete restrict,
  result_id uuid not null,
  actor_id uuid not null references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists carpetas_importacion_estado_fecha_idx on public.carpetas_importacion(estado,creado_en desc);
create index if not exists ordenes_importacion_carpeta_idx on public.ordenes_importacion(carpeta_id,compra_id);
create index if not exists gastos_importacion_carpeta_fecha_idx on public.gastos_importacion(carpeta_id,creado_en,id);
create index if not exists carpetas_importacion_historial_idx on public.carpetas_importacion_historial(carpeta_id,created_at desc,id desc);

alter table public.carpetas_importacion enable row level security;
alter table public.ordenes_importacion enable row level security;
alter table public.gastos_importacion enable row level security;
alter table public.carpetas_importacion_historial enable row level security;
revoke all on public.carpetas_importacion,public.ordenes_importacion,public.gastos_importacion,public.carpetas_importacion_historial from public,anon,authenticated;
grant select on public.carpetas_importacion,public.ordenes_importacion,public.gastos_importacion,public.carpetas_importacion_historial to authenticated;
revoke all on app_private.import_purchase_idempotency from public,anon,authenticated;

drop policy if exists carpetas_importacion_select on public.carpetas_importacion;
create policy carpetas_importacion_select on public.carpetas_importacion for select to authenticated
  using((select app_private._tiene_permiso('compras','ver')));
drop policy if exists ordenes_importacion_select on public.ordenes_importacion;
create policy ordenes_importacion_select on public.ordenes_importacion for select to authenticated
  using((select app_private._tiene_permiso('compras','ver')));
drop policy if exists gastos_importacion_select on public.gastos_importacion;
create policy gastos_importacion_select on public.gastos_importacion for select to authenticated
  using((select app_private._tiene_permiso('compras','ver')));
drop policy if exists carpetas_importacion_historial_select on public.carpetas_importacion_historial;
create policy carpetas_importacion_historial_select on public.carpetas_importacion_historial for select to authenticated
  using((select app_private._tiene_permiso('compras','ver')));

create or replace function public.crear_carpeta_importacion_v1(
  p_nombre text,p_referencia text,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_id uuid; v_hash text; v_saved app_private.import_purchase_idempotency%rowtype;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','crear')) then
    raise exception 'Se requiere permiso de Compras para crear carpetas de importación.' using errcode='42501';
  end if;
  if length(trim(coalesce(p_nombre,''))) not between 3 and 180 or length(coalesce(p_referencia,''))>500
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Nombre, referencia o clave idempotente inválidos.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('nombre',trim(p_nombre),'referencia',trim(coalesce(p_referencia,'')),'moneda','USD')::text);
  perform pg_advisory_xact_lock(hashtextextended('import-purchase:'||p_idempotency_key,0));
  select * into v_saved from app_private.import_purchase_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'crear_carpeta' or v_saved.payload_hash<>v_hash then raise exception 'La clave idempotente ya se usó con otros datos.' using errcode='23505'; end if;
    return v_saved.result_id;
  end if;
  insert into public.carpetas_importacion(nombre,referencia,creado_por)
    values(trim(p_nombre),trim(coalesce(p_referencia,'')),v_uid) returning id into v_id;
  insert into public.carpetas_importacion_historial(carpeta_id,evento,actor_id,datos,idempotency_key)
    values(v_id,'Creada',v_uid,jsonb_build_object('moneda','USD','nombre',trim(p_nombre)),p_idempotency_key);
  insert into app_private.import_purchase_idempotency(idempotency_key,operation,payload_hash,carpeta_id,result_id,actor_id)
    values(p_idempotency_key,'crear_carpeta',v_hash,v_id,v_id,v_uid);
  return v_id;
end
$function$;

create or replace function public.vincular_orden_importacion_v1(
  p_carpeta_id uuid,p_compra_id uuid,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_folder public.carpetas_importacion%rowtype;
  v_order public.compras%rowtype; v_id uuid; v_hash text; v_saved app_private.import_purchase_idempotency%rowtype;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'Se requiere permiso de edición de Compras para vincular órdenes.' using errcode='42501';
  end if;
  if p_carpeta_id is null or p_compra_id is null or nullif(trim(p_idempotency_key),'') is null
     or length(p_idempotency_key) not between 8 and 128 then raise exception 'Carpeta, orden y clave idempotente son obligatorias.' using errcode='22023'; end if;
  v_hash:=md5(jsonb_build_object('carpeta_id',p_carpeta_id,'compra_id',p_compra_id)::text);
  perform pg_advisory_xact_lock(hashtextextended('import-purchase:'||p_idempotency_key,0));
  select * into v_saved from app_private.import_purchase_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'vincular_orden' or v_saved.payload_hash<>v_hash then raise exception 'La clave idempotente ya se usó con otros datos.' using errcode='23505'; end if;
    return v_saved.result_id;
  end if;
  select * into v_folder from public.carpetas_importacion where id=p_carpeta_id for update;
  if not found or v_folder.estado<>'Abierta' then raise exception 'La carpeta no existe o no está abierta.' using errcode='23514'; end if;
  select * into v_order from public.compras where id=p_compra_id for update;
  if not found then raise exception 'La orden no existe.' using errcode='23503'; end if;
  if v_order.estado::text not in ('Confirmada','Confirmado') or v_order.moneda::text<>'USD'
     or v_order.exchange_rate is null or v_order.exchange_rate<=0 or v_order.proveedor_id is null or not v_order.requiere_recepcion then
    raise exception 'Solo se vinculan órdenes confirmadas, recibibles, de proveedor identificado, USD y con tipo de cambio confirmado.' using errcode='23514';
  end if;
   if not exists(select 1 from public.detalle_compras d join public.proveedor_productos pp on pp.id=d.proveedor_producto_id where d.compra_id=p_compra_id and pp.producto_id is not null and d.cantidad>0) then
    raise exception 'La orden no contiene líneas de productos para importar.' using errcode='23514';
  end if;
  insert into public.ordenes_importacion(carpeta_id,compra_id,codigo_orden,proveedor_id,moneda,tipo_cambio,vinculada_por)
    values(p_carpeta_id,p_compra_id,v_order.codigo,v_order.proveedor_id,v_order.moneda::text,v_order.exchange_rate,v_uid)
    returning id into v_id;
  insert into public.carpetas_importacion_historial(carpeta_id,evento,actor_id,compra_id,datos,idempotency_key)
    values(p_carpeta_id,'Orden vinculada',v_uid,p_compra_id,jsonb_build_object('codigo',v_order.codigo,'proveedor_id',v_order.proveedor_id,'moneda',v_order.moneda),p_idempotency_key);
  insert into app_private.import_purchase_idempotency(idempotency_key,operation,payload_hash,carpeta_id,result_id,actor_id)
    values(p_idempotency_key,'vincular_orden',v_hash,p_carpeta_id,v_id,v_uid);
  return v_id;
end
$function$;

create or replace function public.desvincular_orden_importacion_v1(
  p_carpeta_id uuid,p_compra_id uuid,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_folder public.carpetas_importacion%rowtype;
  v_link public.ordenes_importacion%rowtype; v_hash text; v_saved app_private.import_purchase_idempotency%rowtype;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'Se requiere permiso de edición de Compras para desvincular órdenes.' using errcode='42501';
  end if;
  if p_carpeta_id is null or p_compra_id is null or nullif(trim(p_idempotency_key),'') is null
     or length(p_idempotency_key) not between 8 and 128 then raise exception 'Carpeta, orden y clave idempotente son obligatorias.' using errcode='22023'; end if;
  v_hash:=md5(jsonb_build_object('carpeta_id',p_carpeta_id,'compra_id',p_compra_id)::text);
  perform pg_advisory_xact_lock(hashtextextended('import-purchase:'||p_idempotency_key,0));
  select * into v_saved from app_private.import_purchase_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'desvincular_orden' or v_saved.payload_hash<>v_hash then raise exception 'La clave idempotente ya se usó con otros datos.' using errcode='23505'; end if;
    return v_saved.result_id;
  end if;
  select * into v_folder from public.carpetas_importacion where id=p_carpeta_id for update;
  if not found or v_folder.estado<>'Abierta' then raise exception 'La carpeta no existe o no está abierta.' using errcode='23514'; end if;
  select * into v_link from public.ordenes_importacion where carpeta_id=p_carpeta_id and compra_id=p_compra_id for update;
  if not found then raise exception 'La orden no está vinculada a esta carpeta.' using errcode='23503'; end if;
  delete from public.ordenes_importacion where id=v_link.id;
  insert into public.carpetas_importacion_historial(carpeta_id,evento,actor_id,compra_id,datos,idempotency_key)
    values(p_carpeta_id,'Orden desvinculada',v_uid,p_compra_id,jsonb_build_object('codigo',v_link.codigo_orden),p_idempotency_key);
  insert into app_private.import_purchase_idempotency(idempotency_key,operation,payload_hash,carpeta_id,result_id,actor_id)
    values(p_idempotency_key,'desvincular_orden',v_hash,p_carpeta_id,p_compra_id,v_uid);
  return p_compra_id;
end
$function$;

create or replace function public.registrar_gasto_importacion_v1(
  p_carpeta_id uuid,p_tipo text,p_descripcion text,p_monto numeric,p_referencia text,p_idempotency_key text
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
     or p_monto<>round(p_monto,2) or length(coalesce(p_referencia,''))>300
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Tipo, descripción, monto USD en centavos, referencia o clave idempotente inválidos.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('carpeta_id',p_carpeta_id,'tipo',p_tipo,'descripcion',trim(p_descripcion),
    'monto',p_monto,'moneda','USD','referencia',trim(coalesce(p_referencia,'')))::text);
  perform pg_advisory_xact_lock(hashtextextended('import-purchase:'||p_idempotency_key,0));
  select * into v_saved from app_private.import_purchase_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'registrar_gasto' or v_saved.payload_hash<>v_hash then raise exception 'La clave idempotente ya se usó con otros datos.' using errcode='23505'; end if;
    return v_saved.result_id;
  end if;
  select * into v_folder from public.carpetas_importacion where id=p_carpeta_id for update;
  if not found or v_folder.estado<>'Abierta' then raise exception 'La carpeta no existe o no está abierta.' using errcode='23514'; end if;
  insert into public.gastos_importacion(carpeta_id,tipo,descripcion,monto,referencia,idempotency_key,creado_por)
    values(p_carpeta_id,p_tipo,trim(p_descripcion),p_monto,trim(coalesce(p_referencia,'')),p_idempotency_key,v_uid)
    returning id into v_id;
  insert into public.carpetas_importacion_historial(carpeta_id,evento,actor_id,gasto_id,datos,idempotency_key)
    values(p_carpeta_id,'Gasto registrado',v_uid,v_id,jsonb_build_object('tipo',p_tipo,'monto',p_monto,'moneda','USD'),p_idempotency_key||':hist');
  insert into app_private.import_purchase_idempotency(idempotency_key,operation,payload_hash,carpeta_id,result_id,actor_id)
    values(p_idempotency_key,'registrar_gasto',v_hash,p_carpeta_id,v_id,v_uid);
  return v_id;
end
$function$;

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
  select coalesce(sum(g.monto),0)::numeric(14,2) into v_expenses from public.gastos_importacion g where g.carpeta_id=p_carpeta_id;
  if exists(
     select 1 from public.ordenes_importacion oi join public.detalle_compras d on d.compra_id=oi.compra_id
     join public.proveedor_productos pp on pp.id=d.proveedor_producto_id
     where oi.carpeta_id=p_carpeta_id and pp.producto_id is not null
      and (d.total_linea is null or d.cantidad<=0 or d.total_linea<0)
  ) then
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
    select b.*,sum(b.line_value) over() as denominator,
      row_number() over(order by b.compra_id,b.line_id) as rn,
      count(*) over() as n
    from base b
  ), rounded as (
    select r.*,round(v_expenses*r.line_value/nullif(r.denominator,0),2)::numeric(14,2) as rounded_allocation
    from ranked r
  ), allocated as (
    select r.*,
      case when r.rn=r.n then (v_expenses-coalesce(sum(r.rounded_allocation) over(order by r.compra_id,r.line_id rows between unbounded preceding and 1 preceding),0))::numeric(14,2)
           else r.rounded_allocation end as allocation
    from rounded r
  )
  select p_carpeta_id,a.compra_id,a.codigo_orden,a.line_id,a.producto_id,a.line_description,a.qty,
    a.line_value,round(a.line_value/a.denominator,10),a.allocation,
    (a.line_value+a.allocation)::numeric(14,2),
    round((a.line_value+a.allocation)/nullif(a.qty,0),6)
  from allocated a order by a.compra_id,a.line_id;
end
$function$;

revoke all on function public.crear_carpeta_importacion_v1(text,text,text) from public,anon;
revoke all on function public.vincular_orden_importacion_v1(uuid,uuid,text) from public,anon;
revoke all on function public.desvincular_orden_importacion_v1(uuid,uuid,text) from public,anon;
revoke all on function public.registrar_gasto_importacion_v1(uuid,text,text,numeric,text,text) from public,anon;
revoke all on function public.calcular_prorrateo_importacion_v1(uuid) from public,anon;
grant execute on function public.crear_carpeta_importacion_v1(text,text,text) to authenticated;
grant execute on function public.vincular_orden_importacion_v1(uuid,uuid,text) to authenticated;
grant execute on function public.desvincular_orden_importacion_v1(uuid,uuid,text) to authenticated;
grant execute on function public.registrar_gasto_importacion_v1(uuid,text,text,numeric,text,text) to authenticated;
grant execute on function public.calcular_prorrateo_importacion_v1(uuid) to authenticated;

do $audit$
declare v_table text;
begin
  if to_regprocedure('public.fn_auditar()') is not null then
    foreach v_table in array array['carpetas_importacion','ordenes_importacion','gastos_importacion','carpetas_importacion_historial'] loop
      if not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass(format('public.%I',v_table))
        and t.tgfoid='public.fn_auditar()'::regprocedure and not t.tgisinternal) then
        execute format('create trigger trg_auditoria after insert or update or delete on public.%I for each row execute function public.fn_auditar()',v_table);
      end if;
    end loop;
  end if;
end
$audit$;

commit;

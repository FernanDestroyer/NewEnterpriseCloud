-- Fundamentos operativos V1. Solo agrega estructura; conserva datos y cuentas Auth.
-- La apertura de existencias queda como acción administrativa explícita.
begin;

-- En una reconstrucción local esta tabla debe existir antes que sucursales.
create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  razon_social text not null,
  nombre_comercial text,
  ruc text,
  direccion_fiscal text,
  telefono text,
  email text,
  sitio_web text,
  logo_url text,
  moneda_base_id uuid references public.monedas(id) on delete set null,
  es_principal boolean not null default false,
  estado text not null default 'Activo' check (estado in ('Activo','Inactivo')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sucursales (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  codigo text not null,
  nombre text not null,
  proposito text,
  direccion text,
  telefono text,
  hora_apertura time,
  hora_cierre time,
  zona_horaria text not null default 'America/Lima',
  estado text not null default 'Activo' check (estado in ('Activo','Inactivo')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id,codigo),
  check (hora_apertura is null or hora_cierre is null or hora_cierre > hora_apertura)
);
create index if not exists sucursales_empresa_estado_idx on public.sucursales(empresa_id,estado);

create table if not exists public.unidades_medida (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  simbolo text not null,
  precision_decimales smallint not null default 0 check (precision_decimales between 0 and 6),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.zonas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  tipo text not null check (tipo in ('comercial','reparto')),
  proposito text,
  descripcion text,
  estado text not null default 'Activo' check (estado in ('Activo','Inactivo')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.zonas_sucursales (
  zona_id uuid not null references public.zonas(id) on delete restrict,
  sucursal_id uuid not null references public.sucursales(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (zona_id,sucursal_id)
);
create table if not exists public.zonas_clientes (
  zona_id uuid not null references public.zonas(id) on delete restrict,
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (zona_id,cliente_id)
);

alter table public.almacenes
  add column if not exists sucursal_id uuid references public.sucursales(id) on delete restrict,
  add column if not exists proposito text,
  add column if not exists hora_apertura time,
  add column if not exists hora_cierre time,
  add column if not exists zona_horaria text not null default 'America/Lima';
alter table public.almacenes drop constraint if exists almacenes_horario_check;
alter table public.almacenes add constraint almacenes_horario_check
  check (hora_apertura is null or hora_cierre is null or hora_cierre > hora_apertura);
create index if not exists almacenes_sucursal_estado_idx on public.almacenes(sucursal_id,activo);

alter table public.productos
  add column if not exists unidad_medida_id uuid references public.unidades_medida(id) on delete restrict;
create index if not exists productos_unidad_medida_idx on public.productos(unidad_medida_id);
alter table public.ventas
  add column if not exists almacen_id uuid references public.almacenes(id) on delete restrict;
create index if not exists ventas_almacen_fecha_idx on public.ventas(almacen_id,created_at desc);
alter table public.compras
  add column if not exists estado_recepcion text not null default 'pendiente'
    check (estado_recepcion in ('pendiente','parcial','completa'));

-- Recepciones parciales: cada evento conserva sus líneas y enlaza al origen.
create sequence if not exists public.seq_recepciones_compra;
create table if not exists public.recepciones_compra (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  compra_id uuid not null references public.compras(id) on delete restrict,
  almacen_id uuid not null references public.almacenes(id) on delete restrict,
  comprobante_tipo text,
  comprobante_numero text,
  referencia text,
  idempotency_key text not null unique,
  payload_hash text not null,
  recibido_por uuid default auth.uid() references auth.users(id) on delete set null,
  recibido_en timestamptz not null default now(),
  created_at timestamptz not null default now()
);
drop trigger if exists recepciones_compra_codigo on public.recepciones_compra;
create trigger recepciones_compra_codigo before insert on public.recepciones_compra
  for each row execute function public.asignar_codigo('RC','public.seq_recepciones_compra','5');
create index if not exists recepciones_compra_compra_fecha_idx on public.recepciones_compra(compra_id,recibido_en desc);

create table if not exists public.detalle_recepciones_compra (
  id uuid primary key default gen_random_uuid(),
  recepcion_id uuid not null references public.recepciones_compra(id) on delete restrict,
  detalle_compra_id uuid not null references public.detalle_compras(id) on delete restrict,
  producto_id uuid not null references public.productos(id) on delete restrict,
  cantidad integer not null check (cantidad > 0),
  costo_unitario numeric(14,2) not null check (costo_unitario >= 0),
  created_at timestamptz not null default now(),
  unique (recepcion_id,detalle_compra_id)
);
create index if not exists detalle_recepciones_compra_detalle_idx on public.detalle_recepciones_compra(detalle_compra_id);

-- pagos sigue representando la cuenta/obligación; estas tablas modelan el dinero recibido/pagado.
alter table public.pagos
  add column if not exists estado_cobro text not null default 'pendiente'
    check (estado_cobro in ('pendiente','parcial','completa'));
create sequence if not exists public.seq_movimientos_tesoreria;
create table if not exists public.movimientos_tesoreria (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  tipo text not null check (tipo in ('cobro','pago')),
  monto numeric(14,2) not null check (monto > 0),
  medio_pago text,
  referencia text,
  nota text,
  idempotency_key text not null unique,
  payload_hash text not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  anulado_en timestamptz,
  anulado_por uuid references auth.users(id) on delete set null,
  motivo_anulacion text,
  check ((anulado_en is null and anulado_por is null and motivo_anulacion is null)
      or (anulado_en is not null and motivo_anulacion is not null))
);
drop trigger if exists movimientos_tesoreria_codigo on public.movimientos_tesoreria;
create trigger movimientos_tesoreria_codigo before insert on public.movimientos_tesoreria
  for each row execute function public.asignar_codigo('MT','public.seq_movimientos_tesoreria','5');
create index if not exists movimientos_tesoreria_fecha_idx on public.movimientos_tesoreria(created_at desc);

create table if not exists public.aplicaciones_pago (
  id uuid primary key default gen_random_uuid(),
  movimiento_id uuid not null references public.movimientos_tesoreria(id) on delete restrict,
  cuenta_id uuid not null references public.pagos(id) on delete restrict,
  monto numeric(14,2) not null check (monto > 0),
  created_at timestamptz not null default now(),
  unique (movimiento_id,cuenta_id)
);
create index if not exists aplicaciones_pago_cuenta_idx on public.aplicaciones_pago(cuenta_id,created_at desc);

alter table public.movimientos_inventario
  add column if not exists idempotency_key text,
  add column if not exists origen_tipo text,
  add column if not exists origen_id uuid,
  add column if not exists motivo text;
create unique index if not exists movimientos_inventario_idempotency_uidx
  on public.movimientos_inventario(idempotency_key) where idempotency_key is not null;
create index if not exists movimientos_inventario_origen_idx
  on public.movimientos_inventario(origen_tipo,origen_id) where origen_id is not null;

-- Evita el segundo asiento de Kardex cuando el RPC mantiene productos.stock como total compatible.
create or replace function public.registrar_kardex()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_antes integer := case when tg_op = 'INSERT' then 0 else old.stock end;
begin
  if coalesce(current_setting('app.ec_inventory_rpc',true),'off') = 'on' then return new; end if;
  if new.stock is distinct from v_antes then
    insert into public.movimientos_inventario
      (producto_id,tipo,cantidad,stock_anterior,stock_nuevo,referencia,usuario_id)
    values (new.id,case when new.stock > v_antes then 'entrada' else 'salida' end,
      abs(new.stock-v_antes),v_antes,new.stock,new.codigo,(select auth.uid()));
  end if;
  return new;
end $$;

create or replace function public.registrar_movimiento_inventario(
  p_producto_id uuid,p_almacen_id uuid,p_tipo text,p_cantidad integer,
  p_referencia text,p_idempotency_key text,p_origen_tipo text default null,
  p_origen_id uuid default null,p_motivo text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_anterior integer;
  v_nuevo integer;
  v_mov public.movimientos_inventario%rowtype;
  v_hash text;
begin
  if v_uid is null then raise exception 'Se requiere una sesión activa.' using errcode='42501'; end if;
  if not ((select public.tiene_permiso('inventario','crear')) or (select public.tiene_permiso('inventario','editar'))) then
    raise exception 'No tienes permiso para registrar movimientos de inventario.' using errcode='42501';
  end if;
  if p_tipo not in ('entrada','salida') or p_cantidad is null or p_cantidad <= 0 then
    raise exception 'El tipo y la cantidad del movimiento no son válidos.' using errcode='22023';
  end if;
  if nullif(trim(p_idempotency_key),'') is null then raise exception 'Falta la clave de idempotencia.' using errcode='22023'; end if;
  v_hash := md5(concat_ws('|',p_producto_id,p_almacen_id,p_tipo,p_cantidad,coalesce(p_referencia,''),coalesce(p_origen_tipo,''),p_origen_id,coalesce(p_motivo,'')));
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
  select * into v_mov from public.movimientos_inventario where idempotency_key=p_idempotency_key;
  if found then
    if md5(concat_ws('|',v_mov.producto_id,v_mov.almacen_id,v_mov.tipo,v_mov.cantidad,coalesce(v_mov.referencia,''),coalesce(v_mov.origen_tipo,''),v_mov.origen_id,coalesce(v_mov.motivo,''))) <> v_hash then
      raise exception 'La clave de idempotencia ya fue usada con otros datos.' using errcode='23505';
    end if;
    return v_mov.id;
  end if;
  if not exists(select 1 from public.productos where id=p_producto_id) then raise exception 'El producto no existe.' using errcode='23503'; end if;
  if not exists(select 1 from public.almacenes where id=p_almacen_id and activo) then raise exception 'Selecciona un almacén activo.' using errcode='23503'; end if;
  insert into public.inventarios(producto_id,almacen_id,cantidad) values(p_producto_id,p_almacen_id,0)
    on conflict(producto_id,almacen_id) do nothing;
  select cantidad into v_anterior from public.inventarios where producto_id=p_producto_id and almacen_id=p_almacen_id for update;
  if p_tipo='salida' and v_anterior < p_cantidad then
    raise exception 'Stock insuficiente en el almacén. Disponible: %, solicitado: %.',v_anterior,p_cantidad using errcode='23514';
  end if;
  v_nuevo := case when p_tipo='entrada' then v_anterior+p_cantidad else v_anterior-p_cantidad end;
  update public.inventarios set cantidad=v_nuevo,updated_at=now() where producto_id=p_producto_id and almacen_id=p_almacen_id;
  insert into public.movimientos_inventario(producto_id,almacen_id,tipo,cantidad,stock_anterior,stock_nuevo,referencia,usuario_id,idempotency_key,origen_tipo,origen_id,motivo)
  values(p_producto_id,p_almacen_id,p_tipo,p_cantidad,v_anterior,v_nuevo,nullif(trim(p_referencia),''),v_uid,p_idempotency_key,p_origen_tipo,p_origen_id,nullif(trim(p_motivo),'')) returning id into v_mov.id;
  perform set_config('app.ec_inventory_rpc','on',true);
  update public.productos p set stock=(select coalesce(sum(i.cantidad),0)::integer from public.inventarios i where i.producto_id=p.id)
    where p.id=p_producto_id;
  return v_mov.id;
end $$;

create or replace function public.inicializar_stock_legacy_a_almacen(p_almacen_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_producto record; v_count integer := 0;
begin
  if (select auth.uid()) is null or not (select public.tiene_permiso('inventario','editar')) then
    raise exception 'Se requiere permiso para inicializar existencias.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('enterprisecloud:stock-legacy-opening',0));
  if exists(select 1 from public.inventarios) then raise exception 'La apertura no se puede repetir: ya hay saldos por almacén.' using errcode='23514'; end if;
  if not exists(select 1 from public.almacenes where id=p_almacen_id and activo) then raise exception 'Selecciona un almacén activo.' using errcode='23503'; end if;
  for v_producto in select id,stock,codigo from public.productos order by id for update loop
    insert into public.inventarios(producto_id,almacen_id,cantidad) values(v_producto.id,p_almacen_id,v_producto.stock);
    if v_producto.stock>0 then
      insert into public.movimientos_inventario(producto_id,almacen_id,tipo,cantidad,stock_anterior,stock_nuevo,referencia,usuario_id,idempotency_key,origen_tipo,motivo)
      values(v_producto.id,p_almacen_id,'entrada',v_producto.stock,0,v_producto.stock,'APERTURA · '||v_producto.codigo,(select auth.uid()),
        'apertura:'||p_almacen_id::text||':'||v_producto.id::text,'apertura','Distribución explícita del stock legado');
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

create or replace function public.registrar_recepcion_compra(
  p_compra_id uuid,p_almacen_id uuid,p_lineas jsonb,p_idempotency_key text,
  p_comprobante_tipo text default null,p_comprobante_numero text default null,p_referencia text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_hash text;
  v_recepcion uuid;
  v_old public.recepciones_compra%rowtype;
  v_line jsonb;
  v_dc public.detalle_compras%rowtype;
  v_detalle_id uuid;
  v_producto uuid;
  v_cantidad integer;
  v_recibido integer;
  v_pendiente boolean;
begin
  if v_uid is null or not (select public.tiene_permiso('compras','editar')) then raise exception 'Se requiere permiso para editar compras.' using errcode='42501'; end if;
  if not ((select public.tiene_permiso('inventario','crear')) or (select public.tiene_permiso('inventario','editar'))) then raise exception 'Se requiere permiso de ingreso a inventario.' using errcode='42501'; end if;
  if jsonb_typeof(p_lineas)<>'array' or jsonb_array_length(p_lineas)=0 or nullif(trim(p_idempotency_key),'') is null then raise exception 'La recepción requiere líneas y clave de idempotencia.' using errcode='22023'; end if;
  if (select count(*) from (select value->>'detalle_compra_id' from jsonb_array_elements(p_lineas) group by value->>'detalle_compra_id') x) <> jsonb_array_length(p_lineas) then
    raise exception 'Cada línea de compra solo puede aparecer una vez por recepción.' using errcode='22023';
  end if;
  v_hash:=md5(concat_ws('|',p_compra_id,p_almacen_id,p_lineas::text,coalesce(p_comprobante_tipo,''),coalesce(p_comprobante_numero,''),coalesce(p_referencia,'')));
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
  select * into v_old from public.recepciones_compra where idempotency_key=p_idempotency_key;
  if found then if v_old.payload_hash<>v_hash then raise exception 'La clave ya pertenece a otra recepción.' using errcode='23505'; end if; return v_old.id; end if;
  perform 1 from public.compras where id=p_compra_id for update;
  if not found then raise exception 'La compra no existe.' using errcode='23503'; end if;
  if not exists(select 1 from public.almacenes where id=p_almacen_id and activo) then raise exception 'Selecciona un almacén activo.' using errcode='23503'; end if;
  insert into public.recepciones_compra(codigo,compra_id,almacen_id,comprobante_tipo,comprobante_numero,referencia,idempotency_key,payload_hash,recibido_por)
  values('',p_compra_id,p_almacen_id,nullif(trim(p_comprobante_tipo),''),nullif(trim(p_comprobante_numero),''),nullif(trim(p_referencia),''),p_idempotency_key,v_hash,v_uid)
  returning id into v_recepcion;
  for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'detalle_compra_id' loop
    v_detalle_id:=(v_line->>'detalle_compra_id')::uuid;
    v_cantidad:=(v_line->>'cantidad')::integer;
    if v_cantidad is null or v_cantidad<=0 then raise exception 'La cantidad recibida debe ser mayor que cero.' using errcode='22023'; end if;
    select * into v_dc from public.detalle_compras where id=v_detalle_id and compra_id=p_compra_id for update;
    if not found then raise exception 'Una línea no pertenece a esta orden.' using errcode='23503'; end if;
    select coalesce(sum(dr.cantidad),0)::integer into v_recibido from public.detalle_recepciones_compra dr
      join public.recepciones_compra r on r.id=dr.recepcion_id where dr.detalle_compra_id=v_dc.id and r.id<>v_recepcion;
    if v_recibido+v_cantidad>v_dc.cantidad then raise exception 'La recepción excede la cantidad ordenada.' using errcode='23514'; end if;
    select producto_id into v_producto from public.proveedor_productos where id=v_dc.proveedor_producto_id;
    if v_producto is null then raise exception 'Vincula primero el artículo del proveedor con un producto maestro.' using errcode='23514'; end if;
    insert into public.detalle_recepciones_compra(recepcion_id,detalle_compra_id,producto_id,cantidad,costo_unitario)
      values(v_recepcion,v_dc.id,v_producto,v_cantidad,v_dc.costo_unitario);
    perform public.registrar_movimiento_inventario(v_producto,p_almacen_id,'entrada',v_cantidad,'Recepción '||v_recepcion::text,
      p_idempotency_key||':'||v_dc.id::text,'recepcion_compra',v_recepcion,'Recepción de compra nacional');
  end loop;
  select exists(select 1 from public.detalle_compras dc where dc.compra_id=p_compra_id and
    (select coalesce(sum(dr.cantidad),0) from public.detalle_recepciones_compra dr where dr.detalle_compra_id=dc.id)<dc.cantidad)
    into v_pendiente;
  update public.compras set estado_recepcion=case when v_pendiente then 'parcial' else 'completa' end where id=p_compra_id;
  if p_comprobante_tipo is not null or p_comprobante_numero is not null then
    update public.compras set comprobante_tipo=coalesce(nullif(trim(p_comprobante_tipo),''),comprobante_tipo),
      comprobante_numero=coalesce(nullif(trim(p_comprobante_numero),''),comprobante_numero) where id=p_compra_id;
  end if;
  return v_recepcion;
end $$;

create or replace function public.registrar_pago_parcial(
  p_tipo text,p_monto numeric,p_medio_pago text,p_referencia text,
  p_aplicaciones jsonb,p_idempotency_key text,p_nota text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_hash text;
  v_mov uuid;
  v_old public.movimientos_tesoreria%rowtype;
  v_line jsonb;
  v_cuenta uuid;
  v_aplicar numeric(14,2);
  v_tipo_cuenta text;
  v_obligacion numeric(14,2);
  v_total_aplicado numeric(14,2);
  v_total numeric(14,2):=0;
begin
  if v_uid is null or not (select public.tiene_permiso('finanzas','crear')) then raise exception 'Se requiere permiso para registrar cobros y pagos.' using errcode='42501'; end if;
  if p_tipo not in ('cobro','pago') or p_monto is null or p_monto<=0 or jsonb_typeof(p_aplicaciones)<>'array' or jsonb_array_length(p_aplicaciones)=0 then raise exception 'El movimiento o sus aplicaciones no son válidos.' using errcode='22023'; end if;
  if nullif(trim(p_idempotency_key),'') is null then raise exception 'Falta la clave de idempotencia.' using errcode='22023'; end if;
  if (select count(*) from (select value->>'cuenta_id' from jsonb_array_elements(p_aplicaciones) group by value->>'cuenta_id') x) <> jsonb_array_length(p_aplicaciones) then
    raise exception 'Cada cuenta solo puede aparecer una vez por movimiento.' using errcode='22023';
  end if;
  v_hash:=md5(concat_ws('|',p_tipo,p_monto,coalesce(p_medio_pago,''),coalesce(p_referencia,''),p_aplicaciones::text,coalesce(p_nota,'')));
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
  select * into v_old from public.movimientos_tesoreria where idempotency_key=p_idempotency_key;
  if found then if v_old.payload_hash<>v_hash then raise exception 'La clave ya pertenece a otro movimiento.' using errcode='23505'; end if; return v_old.id; end if;
  for v_line in select value from jsonb_array_elements(p_aplicaciones) order by value->>'cuenta_id' loop
    v_cuenta:=(v_line->>'cuenta_id')::uuid; v_aplicar:=round((v_line->>'monto')::numeric,2);
    if v_aplicar is null or v_aplicar<=0 then raise exception 'Cada aplicación debe ser mayor que cero.' using errcode='22023'; end if;
    select tipo,monto into v_tipo_cuenta,v_obligacion from public.pagos where id=v_cuenta for update;
    if not found then raise exception 'La cuenta no existe.' using errcode='23503'; end if;
    if (p_tipo='cobro' and v_tipo_cuenta<>'cobrar') or (p_tipo='pago' and v_tipo_cuenta<>'pagar') then raise exception 'El movimiento no coincide con el tipo de cuenta.' using errcode='23514'; end if;
    select coalesce(sum(a.monto),0)::numeric(14,2) into v_total_aplicado from public.aplicaciones_pago a
      join public.movimientos_tesoreria m on m.id=a.movimiento_id where a.cuenta_id=v_cuenta and m.anulado_en is null;
    if v_aplicar>v_obligacion-v_total_aplicado then raise exception 'La aplicación excede el saldo pendiente.' using errcode='23514'; end if;
    v_total:=v_total+v_aplicar;
  end loop;
  if round(v_total,2)<>round(p_monto,2) then raise exception 'Las aplicaciones deben sumar el importe del movimiento.' using errcode='23514'; end if;
  insert into public.movimientos_tesoreria(codigo,tipo,monto,medio_pago,referencia,nota,idempotency_key,payload_hash,created_by)
    values('',p_tipo,round(p_monto,2),nullif(trim(p_medio_pago),''),nullif(trim(p_referencia),''),nullif(trim(p_nota),''),p_idempotency_key,v_hash,v_uid)
    returning id into v_mov;
  for v_line in select value from jsonb_array_elements(p_aplicaciones) order by value->>'cuenta_id' loop
    v_cuenta:=(v_line->>'cuenta_id')::uuid; v_aplicar:=round((v_line->>'monto')::numeric,2);
    insert into public.aplicaciones_pago(movimiento_id,cuenta_id,monto) values(v_mov,v_cuenta,v_aplicar);
    select monto into v_obligacion from public.pagos where id=v_cuenta;
    select coalesce(sum(a.monto),0)::numeric(14,2) into v_total_aplicado from public.aplicaciones_pago a
      join public.movimientos_tesoreria m on m.id=a.movimiento_id where a.cuenta_id=v_cuenta and m.anulado_en is null;
    update public.pagos set estado_cobro=case when v_total_aplicado>=v_obligacion then 'completa' when v_total_aplicado>0 then 'parcial' else 'pendiente' end,
      estado=case when v_total_aplicado>=v_obligacion then 'Completada' else 'Pendiente' end where id=v_cuenta;
  end loop;
  return v_mov;
end $$;

create or replace function public.anular_movimiento_tesoreria(p_movimiento_id uuid,p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_cuenta uuid; v_obligacion numeric(14,2); v_aplicado numeric(14,2);
begin
  if (select auth.uid()) is null or not (select public.tiene_permiso('finanzas','editar')) then raise exception 'Se requiere permiso para anular el movimiento.' using errcode='42501'; end if;
  if nullif(trim(p_motivo),'') is null then raise exception 'Escribe el motivo de anulación.' using errcode='22023'; end if;
  perform 1 from public.movimientos_tesoreria where id=p_movimiento_id and anulado_en is null for update;
  if not found then raise exception 'El movimiento no existe o ya fue anulado.' using errcode='23503'; end if;
  update public.movimientos_tesoreria set anulado_en=now(),anulado_por=(select auth.uid()),motivo_anulacion=trim(p_motivo) where id=p_movimiento_id;
  for v_cuenta in select distinct cuenta_id from public.aplicaciones_pago where movimiento_id=p_movimiento_id loop
    select monto into v_obligacion from public.pagos where id=v_cuenta for update;
    select coalesce(sum(a.monto),0)::numeric(14,2) into v_aplicado from public.aplicaciones_pago a
      join public.movimientos_tesoreria m on m.id=a.movimiento_id where a.cuenta_id=v_cuenta and m.anulado_en is null;
    update public.pagos set estado_cobro=case when v_aplicado>=v_obligacion then 'completa' when v_aplicado>0 then 'parcial' else 'pendiente' end,
      estado=case when v_aplicado>=v_obligacion then 'Completada' else 'Pendiente' end where id=v_cuenta;
  end loop;
end $$;

-- RLS: lectura por permiso; los flujos críticos solo escriben con RPC.
alter table public.sucursales enable row level security;
alter table public.unidades_medida enable row level security;
alter table public.zonas enable row level security;
alter table public.zonas_sucursales enable row level security;
alter table public.zonas_clientes enable row level security;
alter table public.recepciones_compra enable row level security;
alter table public.detalle_recepciones_compra enable row level security;
alter table public.movimientos_tesoreria enable row level security;
alter table public.aplicaciones_pago enable row level security;
revoke all on public.sucursales,public.unidades_medida,public.zonas,public.zonas_sucursales,public.zonas_clientes,
  public.recepciones_compra,public.detalle_recepciones_compra,public.movimientos_tesoreria,public.aplicaciones_pago from public,anon;
grant select,insert,update,delete on public.sucursales,public.unidades_medida,public.zonas,public.zonas_sucursales,public.zonas_clientes to authenticated;
grant select on public.recepciones_compra,public.detalle_recepciones_compra,public.movimientos_tesoreria,public.aplicaciones_pago to authenticated;

drop policy if exists sucursales_read on public.sucursales;
create policy sucursales_read on public.sucursales for select to authenticated using ((select public.tiene_permiso('configuracion','ver')));
drop policy if exists sucursales_insert on public.sucursales;
create policy sucursales_insert on public.sucursales for insert to authenticated with check ((select public.tiene_permiso('configuracion','crear')));
drop policy if exists sucursales_update on public.sucursales;
create policy sucursales_update on public.sucursales for update to authenticated using ((select public.tiene_permiso('configuracion','editar'))) with check ((select public.tiene_permiso('configuracion','editar')));
drop policy if exists sucursales_delete on public.sucursales;
create policy sucursales_delete on public.sucursales for delete to authenticated using ((select public.tiene_permiso('configuracion','eliminar')));
drop policy if exists unidades_medida_read on public.unidades_medida;
create policy unidades_medida_read on public.unidades_medida for select to authenticated using ((select public.tiene_permiso('configuracion','ver')));
drop policy if exists unidades_medida_insert on public.unidades_medida;
create policy unidades_medida_insert on public.unidades_medida for insert to authenticated with check ((select public.tiene_permiso('configuracion','crear')));
drop policy if exists unidades_medida_update on public.unidades_medida;
create policy unidades_medida_update on public.unidades_medida for update to authenticated using ((select public.tiene_permiso('configuracion','editar'))) with check ((select public.tiene_permiso('configuracion','editar')));
drop policy if exists unidades_medida_delete on public.unidades_medida;
create policy unidades_medida_delete on public.unidades_medida for delete to authenticated using ((select public.tiene_permiso('configuracion','eliminar')));
drop policy if exists zonas_read on public.zonas;
create policy zonas_read on public.zonas for select to authenticated using ((select public.tiene_permiso('configuracion','ver')));
drop policy if exists zonas_insert on public.zonas;
create policy zonas_insert on public.zonas for insert to authenticated with check ((select public.tiene_permiso('configuracion','crear')));
drop policy if exists zonas_update on public.zonas;
create policy zonas_update on public.zonas for update to authenticated using ((select public.tiene_permiso('configuracion','editar'))) with check ((select public.tiene_permiso('configuracion','editar')));
drop policy if exists zonas_delete on public.zonas;
create policy zonas_delete on public.zonas for delete to authenticated using ((select public.tiene_permiso('configuracion','eliminar')));
drop policy if exists zonas_sucursales_read on public.zonas_sucursales;
create policy zonas_sucursales_read on public.zonas_sucursales for select to authenticated using ((select public.tiene_permiso('configuracion','ver')));
drop policy if exists zonas_sucursales_write on public.zonas_sucursales;
create policy zonas_sucursales_write on public.zonas_sucursales for all to authenticated using ((select public.tiene_permiso('configuracion','editar'))) with check ((select public.tiene_permiso('configuracion','editar')));
drop policy if exists zonas_clientes_read on public.zonas_clientes;
create policy zonas_clientes_read on public.zonas_clientes for select to authenticated using ((select public.tiene_permiso('configuracion','ver')));
drop policy if exists zonas_clientes_write on public.zonas_clientes;
create policy zonas_clientes_write on public.zonas_clientes for all to authenticated using ((select public.tiene_permiso('configuracion','editar'))) with check ((select public.tiene_permiso('configuracion','editar')));
drop policy if exists recepciones_compra_read on public.recepciones_compra;
create policy recepciones_compra_read on public.recepciones_compra for select to authenticated using ((select public.tiene_permiso('compras','ver')));
drop policy if exists detalle_recepciones_compra_read on public.detalle_recepciones_compra;
create policy detalle_recepciones_compra_read on public.detalle_recepciones_compra for select to authenticated using ((select public.tiene_permiso('compras','ver')));
drop policy if exists movimientos_tesoreria_read on public.movimientos_tesoreria;
create policy movimientos_tesoreria_read on public.movimientos_tesoreria for select to authenticated using ((select public.tiene_permiso('finanzas','ver')));
drop policy if exists aplicaciones_pago_read on public.aplicaciones_pago;
create policy aplicaciones_pago_read on public.aplicaciones_pago for select to authenticated using ((select public.tiene_permiso('finanzas','ver')));

drop trigger if exists sucursales_updated_at on public.sucursales;
create trigger sucursales_updated_at before update on public.sucursales for each row execute function public.set_updated_at();
drop trigger if exists unidades_medida_updated_at on public.unidades_medida;
create trigger unidades_medida_updated_at before update on public.unidades_medida for each row execute function public.set_updated_at();
drop trigger if exists zonas_updated_at on public.zonas;
create trigger zonas_updated_at before update on public.zonas for each row execute function public.set_updated_at();

revoke execute on function public.registrar_movimiento_inventario(uuid,uuid,text,integer,text,text,text,uuid,text),
  public.inicializar_stock_legacy_a_almacen(uuid),
  public.registrar_recepcion_compra(uuid,uuid,jsonb,text,text,text,text),
  public.registrar_pago_parcial(text,numeric,text,text,jsonb,text,text),
  public.anular_movimiento_tesoreria(uuid,text) from public,anon;
grant execute on function public.registrar_movimiento_inventario(uuid,uuid,text,integer,text,text,text,uuid,text),
  public.inicializar_stock_legacy_a_almacen(uuid),
  public.registrar_recepcion_compra(uuid,uuid,jsonb,text,text,text,text),
  public.registrar_pago_parcial(text,numeric,text,text,jsonb,text,text) to authenticated;
grant execute on function public.anular_movimiento_tesoreria(uuid,text) to authenticated;

commit;

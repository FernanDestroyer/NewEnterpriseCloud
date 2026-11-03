-- Inventario y Kardex: backend `ec_*` de la fase nueva.
--
-- Este esquema se aplicó originalmente de forma manual en Supabase y no estaba
-- versionado en el repositorio (ver "Cambios Eric/modulo_inventario_kardex.md").
-- La migración se reconstruyó desde el catálogo remoto y es idempotente:
--   * `create table if not exists` no altera las tablas existentes.
--   * `create index if not exists` y `drop policy/trigger if exists` permiten
--     reaplicarla sin duplicar objetos.
--   * Las funciones se recrean con la definición desplegada.
--
-- Depende de `20261119000000_ventas_integrales.sql`, que crea `ec_reservas`,
-- `ec_pedidos` y `ec_proteger_reservas()` usados por las consultas de
-- existencias y por el bloqueo de stock libre.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------

create table if not exists public.ec_transferencias (
  id uuid primary key default gen_random_uuid(),
  almacen_origen_id uuid not null references public.almacenes(id),
  almacen_destino_id uuid not null references public.almacenes(id),
  motivo text not null check (length(btrim(motivo)) between 3 and 1000),
  lineas jsonb not null check (jsonb_typeof(lineas) = 'array'),
  clave text not null unique,
  hash text not null,
  creado_por uuid not null default auth.uid(),
  creado_en timestamptz not null default now(),
  constraint ec_transferencias_check check (almacen_origen_id <> almacen_destino_id)
);

create table if not exists public.ec_transferencia_lineas (
  transferencia_id uuid not null references public.ec_transferencias(id),
  producto_id uuid not null references public.productos(id),
  cantidad integer not null check (cantidad > 0),
  movimiento_salida_id uuid not null unique references public.movimientos_inventario(id),
  movimiento_entrada_id uuid not null unique references public.movimientos_inventario(id),
  primary key (transferencia_id, producto_id)
);

create table if not exists public.ec_ajustes (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id),
  almacen_id uuid not null references public.almacenes(id),
  cantidad integer not null check (cantidad <> 0),
  stock_anterior integer not null check (stock_anterior >= 0),
  stock_nuevo integer not null check (stock_nuevo >= 0),
  motivo text not null check (length(btrim(motivo)) between 3 and 1000),
  movimiento_id uuid not null unique references public.movimientos_inventario(id),
  clave text not null unique,
  hash text not null,
  creado_por uuid not null default auth.uid(),
  creado_en timestamptz not null default now()
);

create table if not exists public.ec_conteos_fisicos (
  id uuid primary key default gen_random_uuid(),
  almacen_id uuid not null references public.almacenes(id),
  motivo text not null check (length(btrim(motivo)) between 3 and 1000),
  estado text not null default 'abierto' check (estado in ('abierto', 'cerrado')),
  clave_apertura text not null unique,
  hash_apertura text not null,
  clave_cierre text unique,
  creado_por uuid not null default auth.uid(),
  creado_en timestamptz not null default now(),
  cerrado_por uuid,
  cerrado_en timestamptz
);

create table if not exists public.ec_conteo_lineas (
  conteo_id uuid not null references public.ec_conteos_fisicos(id),
  producto_id uuid not null references public.productos(id),
  stock_sistema integer not null check (stock_sistema >= 0),
  stock_contado integer not null check (stock_contado >= 0),
  costo_entrada numeric(18,6) check (costo_entrada is null or costo_entrada >= 0),
  ajuste_id uuid unique references public.ec_ajustes(id),
  primary key (conteo_id, producto_id)
);

create table if not exists public.ec_producto_trazabilidad (
  producto_id uuid primary key references public.productos(id),
  modo text not null check (modo in ('lote', 'serie')),
  configurado_por uuid not null default auth.uid(),
  configurado_en timestamptz not null default now()
);

create table if not exists public.ec_lotes (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id),
  codigo text check (codigo is null or length(btrim(codigo)) > 0),
  vence_el date,
  movimiento_entrada_id uuid references public.movimientos_inventario(id),
  creado_en timestamptz not null default now(),
  unique (producto_id, codigo),
  unique (id, producto_id)
);

create table if not exists public.ec_series (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id),
  numero text check (numero is null or length(btrim(numero)) > 0),
  almacen_id uuid references public.almacenes(id),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'disponible', 'transito', 'salida')),
  movimiento_entrada_id uuid references public.movimientos_inventario(id),
  creado_en timestamptz not null default now(),
  unique (producto_id, numero)
);

create table if not exists public.ec_existencias_lote (
  lote_id uuid not null,
  producto_id uuid not null,
  almacen_id uuid not null references public.almacenes(id),
  cantidad integer not null check (cantidad >= 0),
  primary key (lote_id, almacen_id),
  foreign key (lote_id, producto_id) references public.ec_lotes(id, producto_id)
);

create table if not exists public.ec_movimiento_lotes (
  movimiento_id uuid not null references public.movimientos_inventario(id),
  lote_id uuid not null references public.ec_lotes(id),
  cantidad integer not null check (cantidad > 0),
  primary key (movimiento_id, lote_id)
);

create table if not exists public.ec_movimiento_series (
  movimiento_id uuid not null references public.movimientos_inventario(id),
  serie_id uuid not null references public.ec_series(id),
  primary key (movimiento_id, serie_id)
);

create table if not exists public.ec_kardex_valorizado (
  movimiento_id uuid primary key references public.movimientos_inventario(id),
  producto_id uuid not null references public.productos(id),
  almacen_id uuid not null references public.almacenes(id),
  cantidad integer not null check (cantidad > 0),
  sentido text not null check (sentido in ('entrada', 'salida')),
  costo_peps numeric(24,6),
  costo_promedio numeric(24,6),
  saldo_unidades integer not null check (saldo_unidades >= 0),
  saldo_peps numeric(24,6),
  saldo_promedio numeric(24,6),
  creado_en timestamptz not null default now()
);

create table if not exists public.ec_capas_peps (
  id bigint generated always as identity primary key,
  producto_id uuid not null references public.productos(id),
  almacen_id uuid not null references public.almacenes(id),
  movimiento_entrada_id uuid references public.movimientos_inventario(id),
  cantidad_restante integer not null check (cantidad_restante >= 0),
  costo_unitario numeric(18,6) check (costo_unitario is null or costo_unitario >= 0),
  creado_en timestamptz not null default now()
);

create table if not exists public.ec_consumos_peps (
  movimiento_salida_id uuid not null references public.movimientos_inventario(id),
  capa_id bigint not null references public.ec_capas_peps(id),
  cantidad integer not null check (cantidad > 0),
  costo_unitario numeric(18,6),
  primary key (movimiento_salida_id, capa_id)
);

create table if not exists public.ec_valoracion_estado (
  producto_id uuid not null references public.productos(id),
  almacen_id uuid not null references public.almacenes(id),
  unidades integer not null check (unidades >= 0),
  valor_promedio numeric(24,6),
  primary key (producto_id, almacen_id)
);

create table if not exists public.ec_operaciones_inventario (
  clave text primary key,
  tipo text not null,
  hash text not null,
  resultado_id uuid not null
);

-- ---------------------------------------------------------------------------
-- 2. Índices
-- ---------------------------------------------------------------------------

create index if not exists ec_transferencias_fecha_idx
  on public.ec_transferencias (creado_en desc, id);
create index if not exists ec_ajustes_producto_fecha_idx
  on public.ec_ajustes (producto_id, almacen_id, creado_en desc);
create index if not exists ec_conteos_almacen_fecha_idx
  on public.ec_conteos_fisicos (almacen_id, creado_en desc);
create index if not exists ec_lotes_vencimiento_idx
  on public.ec_lotes (producto_id, vence_el);
create index if not exists ec_series_disponibles_idx
  on public.ec_series (producto_id, almacen_id, id) where estado = 'disponible';
create index if not exists ec_kardex_producto_almacen_idx
  on public.ec_kardex_valorizado (producto_id, almacen_id, creado_en desc);
create index if not exists ec_capas_peps_disponibles_idx
  on public.ec_capas_peps (producto_id, almacen_id, id) where cantidad_restante > 0;

-- ---------------------------------------------------------------------------
-- 3. RLS: lectura para Inventario; escritura solo mediante RPC SECURITY DEFINER
-- ---------------------------------------------------------------------------

alter table public.ec_transferencias enable row level security;
alter table public.ec_transferencia_lineas enable row level security;
alter table public.ec_ajustes enable row level security;
alter table public.ec_conteos_fisicos enable row level security;
alter table public.ec_conteo_lineas enable row level security;
alter table public.ec_producto_trazabilidad enable row level security;
alter table public.ec_lotes enable row level security;
alter table public.ec_series enable row level security;
alter table public.ec_existencias_lote enable row level security;
alter table public.ec_movimiento_lotes enable row level security;
alter table public.ec_movimiento_series enable row level security;
alter table public.ec_kardex_valorizado enable row level security;
alter table public.ec_capas_peps enable row level security;
alter table public.ec_consumos_peps enable row level security;
alter table public.ec_valoracion_estado enable row level security;
alter table public.ec_operaciones_inventario enable row level security;

drop policy if exists ec_transferencias_read on public.ec_transferencias;
create policy ec_transferencias_read on public.ec_transferencias
  for select to authenticated using (public.tiene_permiso('inventario', 'ver'));
drop policy if exists ec_transferencia_lineas_read on public.ec_transferencia_lineas;
create policy ec_transferencia_lineas_read on public.ec_transferencia_lineas
  for select to authenticated using (public.tiene_permiso('inventario', 'ver'));
drop policy if exists ec_ajustes_read on public.ec_ajustes;
create policy ec_ajustes_read on public.ec_ajustes
  for select to authenticated using (public.tiene_permiso('inventario', 'ver'));
drop policy if exists ec_conteos_read on public.ec_conteos_fisicos;
create policy ec_conteos_read on public.ec_conteos_fisicos
  for select to authenticated using (public.tiene_permiso('inventario', 'ver'));
drop policy if exists ec_conteo_lineas_read on public.ec_conteo_lineas;
create policy ec_conteo_lineas_read on public.ec_conteo_lineas
  for select to authenticated using (public.tiene_permiso('inventario', 'ver'));
drop policy if exists ec_producto_trazabilidad_read on public.ec_producto_trazabilidad;
create policy ec_producto_trazabilidad_read on public.ec_producto_trazabilidad
  for select to authenticated using (public.tiene_permiso('inventario', 'ver'));
drop policy if exists ec_lotes_read on public.ec_lotes;
create policy ec_lotes_read on public.ec_lotes
  for select to authenticated using (public.tiene_permiso('inventario', 'ver'));
drop policy if exists ec_series_read on public.ec_series;
create policy ec_series_read on public.ec_series
  for select to authenticated using (public.tiene_permiso('inventario', 'ver'));
drop policy if exists ec_existencias_lote_read on public.ec_existencias_lote;
create policy ec_existencias_lote_read on public.ec_existencias_lote
  for select to authenticated using (public.tiene_permiso('inventario', 'ver'));
drop policy if exists ec_movimiento_lotes_read on public.ec_movimiento_lotes;
create policy ec_movimiento_lotes_read on public.ec_movimiento_lotes
  for select to authenticated using (public.tiene_permiso('inventario', 'ver'));
drop policy if exists ec_movimiento_series_read on public.ec_movimiento_series;
create policy ec_movimiento_series_read on public.ec_movimiento_series
  for select to authenticated using (public.tiene_permiso('inventario', 'ver'));
drop policy if exists ec_kardex_valorizado_read on public.ec_kardex_valorizado;
create policy ec_kardex_valorizado_read on public.ec_kardex_valorizado
  for select to authenticated using (public.tiene_permiso('inventario', 'ver'));

-- `ec_capas_peps`, `ec_consumos_peps`, `ec_valoracion_estado` y
-- `ec_operaciones_inventario` conservan RLS sin políticas: solo las RPC
-- SECURITY DEFINER pueden leerlas o escribir en ellas.

-- ---------------------------------------------------------------------------
-- 4. Funciones
-- ---------------------------------------------------------------------------

create or replace function public.ec_consultar_existencias()
returns table (
  producto_id uuid,
  almacen_id uuid,
  stock_fisico integer,
  stock_reservado bigint,
  stock_libre bigint
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null or not public.tiene_permiso('inventario', 'ver') then
    raise exception 'Sin permiso para consultar existencias.'
      using errcode = '42501';
  end if;

  return query
  select i.producto_id, i.almacen_id, i.cantidad,
         coalesce(r.reservado, 0),
         i.cantidad::bigint - coalesce(r.reservado, 0)
  from public.inventarios i
  left join lateral (
    select sum(er.cantidad - er.entregado)::bigint as reservado
    from public.ec_reservas er
    join public.ec_pedidos p on p.id = er.pedido_id
    where p.almacen_id = i.almacen_id
      and p.estado in ('reservado', 'facturado')
      and er.producto_id = i.producto_id
  ) r on true
  order by i.almacen_id, i.producto_id;
end $function$;

create or replace function public.ec_consultar_kardex(
  p_producto_id uuid default null,
  p_almacen_id uuid default null
)
returns table (
  movimiento_id uuid,
  producto_id uuid,
  almacen_id uuid,
  fecha timestamptz,
  tipo text,
  cantidad integer,
  stock_anterior integer,
  stock_nuevo integer,
  referencia text,
  motivo text,
  costo_peps numeric,
  costo_promedio numeric,
  saldo_peps numeric,
  saldo_promedio numeric
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null or not public.tiene_permiso('inventario', 'ver') then
    raise exception 'Sin permiso para consultar Kardex.'
      using errcode = '42501';
  end if;

  return query
  select m.id, m.producto_id, m.almacen_id, m.created_at,
         m.tipo, m.cantidad, m.stock_anterior, m.stock_nuevo,
         m.referencia, m.motivo, v.costo_peps,
         v.costo_promedio, v.saldo_peps, v.saldo_promedio
  from public.movimientos_inventario m
  left join public.ec_kardex_valorizado v on v.movimiento_id = m.id
  where (p_producto_id is null or m.producto_id = p_producto_id)
    and (p_almacen_id is null or m.almacen_id = p_almacen_id)
  order by m.created_at desc, m.id desc;
end $function$;

create or replace function public.ec_procesar_transferencia(
  p_almacen_origen_id uuid,
  p_almacen_destino_id uuid,
  p_lineas jsonb,
  p_motivo text,
  p_key text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_old public.ec_transferencias%rowtype;
  v_line jsonb;
  v_item record;
  v_producto uuid;
  v_cantidad integer;
  v_hash text;
  v_salida uuid;
  v_entrada uuid;
begin
  if auth.uid() is null
     or not (public.tiene_permiso('inventario', 'crear')
             or public.tiene_permiso('inventario', 'editar')) then
    raise exception 'Sin permiso para transferir inventario.'
      using errcode = '42501';
  end if;
  if p_almacen_origen_id is null or p_almacen_destino_id is null
     or p_almacen_origen_id = p_almacen_destino_id
     or coalesce(jsonb_typeof(p_lineas), '') <> 'array'
     or jsonb_array_length(p_lineas) = 0
     or length(btrim(coalesce(p_motivo, ''))) < 3
     or nullif(btrim(p_key), '') is null then
    raise exception 'Almacenes, líneas, motivo o clave inválidos.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lineas) x
    group by x->>'producto_id' having count(*) > 1
  ) then
    raise exception 'No repitas productos.' using errcode = '22023';
  end if;

  v_hash := md5(jsonb_build_object(
    'origen', p_almacen_origen_id, 'destino', p_almacen_destino_id,
    'lineas', p_lineas, 'motivo', btrim(p_motivo)
  )::text);
  perform pg_advisory_xact_lock(
    hashtextextended('ec:transfer:' || p_key, 0)
  );

  select * into v_old from public.ec_transferencias where clave = p_key;
  if found then
    if v_old.hash <> v_hash then
      raise exception 'Clave reutilizada con otros datos.'
        using errcode = '23505';
    end if;
    return v_old.id;
  end if;

  if not exists (
    select 1 from public.almacenes
    where id = p_almacen_origen_id and activo
  ) or not exists (
    select 1 from public.almacenes
    where id = p_almacen_destino_id and activo
  ) then
    raise exception 'Ambos almacenes deben estar activos.'
      using errcode = '23503';
  end if;

  -- Mismo espacio de bloqueo utilizado por las reservas y guías de Ventas.
  for v_item in
    select (x->>'producto_id')::uuid as producto_id, a.almacen_id
    from jsonb_array_elements(p_lineas) x
    cross join lateral (
      values (p_almacen_origen_id), (p_almacen_destino_id)
    ) a(almacen_id)
    order by producto_id, almacen_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'ec:stock:' || v_item.almacen_id::text
      || ':' || v_item.producto_id::text, 0
    ));
  end loop;

  insert into public.ec_transferencias
    (almacen_origen_id, almacen_destino_id, motivo, lineas,
     clave, hash)
  values
    (p_almacen_origen_id, p_almacen_destino_id, btrim(p_motivo),
     p_lineas, p_key, v_hash)
  returning id into v_id;

  for v_line in
    select value from jsonb_array_elements(p_lineas)
    order by value->>'producto_id'
  loop
    v_producto := (v_line->>'producto_id')::uuid;
    v_cantidad := (v_line->>'cantidad')::integer;
    if v_producto is null or v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Producto o cantidad inválidos.'
        using errcode = '22023';
    end if;

    v_salida := public.registrar_movimiento_inventario(
      v_producto, p_almacen_origen_id, 'salida', v_cantidad,
      'Transferencia ' || v_id, 'ec:transfer:' || v_id
        || ':' || v_producto || ':salida',
      'ec_transferencia', v_id, btrim(p_motivo)
    );
    v_entrada := public.registrar_movimiento_inventario(
      v_producto, p_almacen_destino_id, 'entrada', v_cantidad,
      'Transferencia ' || v_id, 'ec:transfer:' || v_id
        || ':' || v_producto || ':entrada',
      'ec_transferencia', v_id, btrim(p_motivo)
    );

    insert into public.ec_transferencia_lineas
      (transferencia_id, producto_id, cantidad,
       movimiento_salida_id, movimiento_entrada_id)
    values (v_id, v_producto, v_cantidad, v_salida, v_entrada);
  end loop;

  return v_id;
end $function$;

create or replace function public.ec_registrar_ajuste(
  p_producto_id uuid,
  p_almacen_id uuid,
  p_delta integer,
  p_motivo text,
  p_costo_unitario numeric,
  p_key text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_old public.ec_ajustes%rowtype;
  v_hash text;
  v_anterior integer;
  v_movimiento uuid;
begin
  if auth.uid() is null
     or not (public.tiene_permiso('inventario', 'crear')
             or public.tiene_permiso('inventario', 'editar')) then
    raise exception 'Sin permiso para ajustar inventario.'
      using errcode = '42501';
  end if;
  if p_producto_id is null or p_almacen_id is null
     or p_delta is null or p_delta = 0
     or length(btrim(coalesce(p_motivo, ''))) < 3
     or nullif(btrim(p_key), '') is null
     or (p_costo_unitario is not null
         and (p_delta < 0 or p_costo_unitario < 0)) then
    raise exception 'Datos de ajuste inválidos.'
      using errcode = '22023';
  end if;

  v_hash := md5(jsonb_build_object(
    'producto', p_producto_id, 'almacen', p_almacen_id,
    'delta', p_delta, 'motivo', btrim(p_motivo),
    'costo', p_costo_unitario
  )::text);
  perform pg_advisory_xact_lock(
    hashtextextended('ec:adjust:' || p_key, 0)
  );
  select * into v_old from public.ec_ajustes where clave = p_key;
  if found then
    if v_old.hash <> v_hash then
      raise exception 'Clave reutilizada con otros datos.'
        using errcode = '23505';
    end if;
    return v_old.id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'ec:stock:' || p_almacen_id::text
    || ':' || p_producto_id::text, 0
  ));

  if not exists (
    select 1 from public.almacenes
    where id = p_almacen_id and activo
  ) then
    raise exception 'Almacén inactivo.' using errcode = '23503';
  end if;

  insert into public.inventarios(producto_id, almacen_id, cantidad)
  values (p_producto_id, p_almacen_id, 0)
  on conflict (producto_id, almacen_id) do nothing;

  select cantidad into v_anterior from public.inventarios
  where producto_id = p_producto_id and almacen_id = p_almacen_id
  for update;

  if v_anterior + p_delta < 0 then
    raise exception 'El ajuste dejaría stock negativo.'
      using errcode = '23514';
  end if;

  v_id := gen_random_uuid();
  if p_delta > 0 and p_costo_unitario is not null then
    perform set_config(
      'app.ec_inventory_cost', p_costo_unitario::text, true
    );
  end if;

  v_movimiento := public.registrar_movimiento_inventario(
    p_producto_id, p_almacen_id,
    case when p_delta > 0 then 'entrada' else 'salida' end,
    abs(p_delta), 'Ajuste ' || v_id,
    'ec:adjust:' || v_id || ':' || p_producto_id,
    'ec_ajuste', v_id, btrim(p_motivo)
  );
  perform set_config('app.ec_inventory_cost', '', true);

  insert into public.ec_ajustes
    (id, producto_id, almacen_id, cantidad, stock_anterior,
     stock_nuevo, motivo, movimiento_id, clave, hash)
  values
    (v_id, p_producto_id, p_almacen_id, p_delta, v_anterior,
     v_anterior + p_delta, btrim(p_motivo), v_movimiento,
     p_key, v_hash);
  return v_id;
end $function$;

create or replace function public.ec_abrir_conteo_fisico(
  p_almacen_id uuid,
  p_lineas jsonb,
  p_motivo text,
  p_key text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_old public.ec_conteos_fisicos%rowtype;
  v_line jsonb;
  v_producto uuid;
  v_contado integer;
  v_sistema integer;
  v_hash text;
begin
  if auth.uid() is null
     or not (public.tiene_permiso('inventario', 'crear')
             or public.tiene_permiso('inventario', 'editar')) then
    raise exception 'Sin permiso para contar inventario.'
      using errcode = '42501';
  end if;
  if p_almacen_id is null
     or coalesce(jsonb_typeof(p_lineas), '') <> 'array'
     or jsonb_array_length(p_lineas) = 0
     or length(btrim(coalesce(p_motivo, ''))) < 3
     or nullif(btrim(p_key), '') is null then
    raise exception 'Conteo incompleto.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lineas) x
    group by x->>'producto_id' having count(*) > 1
  ) then
    raise exception 'Producto repetido en el conteo.'
      using errcode = '22023';
  end if;

  v_hash := md5(jsonb_build_object(
    'almacen', p_almacen_id, 'lineas', p_lineas,
    'motivo', btrim(p_motivo)
  )::text);
  perform pg_advisory_xact_lock(
    hashtextextended('ec:countopen:' || p_key, 0)
  );
  select * into v_old from public.ec_conteos_fisicos
  where clave_apertura = p_key;
  if found then
    if v_old.hash_apertura <> v_hash then
      raise exception 'Clave reutilizada con otros datos.'
        using errcode = '23505';
    end if;
    return v_old.id;
  end if;

  if not exists (
    select 1 from public.almacenes
    where id = p_almacen_id and activo
  ) then
    raise exception 'Almacén inactivo.' using errcode = '23503';
  end if;

  insert into public.ec_conteos_fisicos
    (almacen_id, motivo, clave_apertura, hash_apertura)
  values (p_almacen_id, btrim(p_motivo), p_key, v_hash)
  returning id into v_id;

  for v_line in
    select value from jsonb_array_elements(p_lineas)
    order by value->>'producto_id'
  loop
    v_producto := (v_line->>'producto_id')::uuid;
    v_contado := (v_line->>'cantidad_contada')::integer;
    if v_producto is null or v_contado is null or v_contado < 0 then
      raise exception 'Cantidad contada inválida.'
        using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(
      'ec:stock:' || p_almacen_id::text
      || ':' || v_producto::text, 0
    ));

    insert into public.inventarios(producto_id, almacen_id, cantidad)
    values (v_producto, p_almacen_id, 0)
    on conflict (producto_id, almacen_id) do nothing;

    select cantidad into v_sistema from public.inventarios
    where producto_id = v_producto and almacen_id = p_almacen_id
    for update;

    insert into public.ec_conteo_lineas
      (conteo_id, producto_id, stock_sistema,
       stock_contado, costo_entrada)
    values
      (v_id, v_producto, v_sistema, v_contado,
       nullif(v_line->>'costo_entrada', '')::numeric);
  end loop;
  return v_id;
end $function$;

create or replace function public.ec_cerrar_inventario_fisico(
  p_conteo_id uuid,
  p_key text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_conteo public.ec_conteos_fisicos%rowtype;
  v_line record;
  v_actual integer;
  v_ajuste uuid;
begin
  if auth.uid() is null
     or not (public.tiene_permiso('inventario', 'crear')
             or public.tiene_permiso('inventario', 'editar')) then
    raise exception 'Sin permiso para cerrar inventario físico.'
      using errcode = '42501';
  end if;
  if p_conteo_id is null or nullif(btrim(p_key), '') is null then
    raise exception 'Conteo y clave obligatorios.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('ec:countclose:' || p_key, 0)
  );
  select * into v_conteo from public.ec_conteos_fisicos
  where id = p_conteo_id for update;
  if not found then
    raise exception 'Conteo inexistente.' using errcode = '23503';
  end if;
  if v_conteo.estado = 'cerrado' then
    if v_conteo.clave_cierre = p_key then return p_conteo_id; end if;
    raise exception 'El conteo ya fue cerrado.' using errcode = '23505';
  end if;

  for v_line in
    select * from public.ec_conteo_lineas
    where conteo_id = p_conteo_id order by producto_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'ec:stock:' || v_conteo.almacen_id::text
      || ':' || v_line.producto_id::text, 0
    ));

    select cantidad into v_actual from public.inventarios
    where producto_id = v_line.producto_id
      and almacen_id = v_conteo.almacen_id
    for update;

    if v_actual is distinct from v_line.stock_sistema then
      raise exception
        'El stock cambió después del conteo para el producto %. Repite ese conteo.',
        v_line.producto_id using errcode = '40001';
    end if;

    if v_line.stock_contado <> v_actual then
      v_ajuste := public.ec_registrar_ajuste(
        v_line.producto_id, v_conteo.almacen_id,
        v_line.stock_contado - v_actual,
        'Conciliación de conteo ' || p_conteo_id
          || ': ' || v_conteo.motivo,
        case when v_line.stock_contado > v_actual
          then v_line.costo_entrada else null end,
        'ec:count:' || p_conteo_id || ':' || v_line.producto_id
      );
      update public.ec_conteo_lineas
      set ajuste_id = v_ajuste
      where conteo_id = p_conteo_id
        and producto_id = v_line.producto_id;
    end if;
  end loop;

  update public.ec_conteos_fisicos
  set estado = 'cerrado', clave_cierre = p_key,
      cerrado_por = auth.uid(), cerrado_en = now()
  where id = p_conteo_id;

  return p_conteo_id;
end $function$;

create or replace function public.ec_configurar_trazabilidad(
  p_producto_id uuid,
  p_modo text
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if auth.uid() is null
     or not public.tiene_permiso('inventario', 'editar') then
    raise exception 'Sin permiso para configurar trazabilidad.'
      using errcode = '42501';
  end if;
  if p_modo not in ('lote', 'serie') or p_producto_id is null then
    raise exception 'Modo de trazabilidad inválido.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('ec:trace:' || p_producto_id::text, 0)
  );
  perform 1 from public.productos where id = p_producto_id for update;
  if not found then
    raise exception 'Producto inexistente.' using errcode = '23503';
  end if;
  if exists (
    select 1 from public.inventarios
    where producto_id = p_producto_id and cantidad > 0
  ) then
    raise exception
      'La trazabilidad se activa con stock cero: el stock histórico no tiene lote ni serie.'
      using errcode = '23514';
  end if;

  insert into public.ec_producto_trazabilidad(producto_id, modo)
  values (p_producto_id, p_modo)
  on conflict (producto_id) do update
  set modo = excluded.modo
  where public.ec_producto_trazabilidad.modo = excluded.modo;

  if not found then
    raise exception 'No cambies de lote a serie, o viceversa, tras configurar el producto.'
      using errcode = '23514';
  end if;
end $function$;

create or replace function public.ec_identificar_lote(
  p_lote_id uuid,
  p_codigo text,
  p_vence_el date,
  p_key text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_lote public.ec_lotes%rowtype;
  v_old public.ec_operaciones_inventario%rowtype;
  v_hash text;
begin
  if auth.uid() is null
     or not public.tiene_permiso('inventario', 'editar') then
    raise exception 'Sin permiso para identificar lotes.'
      using errcode = '42501';
  end if;
  if p_lote_id is null or nullif(btrim(p_codigo), '') is null
     or nullif(btrim(p_key), '') is null then
    raise exception 'Lote, código y clave obligatorios.'
      using errcode = '22023';
  end if;

  v_hash := md5(jsonb_build_object(
    'lote', p_lote_id, 'codigo', btrim(p_codigo),
    'vence', p_vence_el
  )::text);
  perform pg_advisory_xact_lock(
    hashtextextended('ec:lot:' || p_key, 0)
  );
  select * into v_old from public.ec_operaciones_inventario
  where clave = p_key;
  if found then
    if v_old.tipo <> 'lote' or v_old.hash <> v_hash then
      raise exception 'Clave reutilizada con otros datos.'
        using errcode = '23505';
    end if;
    return v_old.resultado_id;
  end if;

  select * into v_lote from public.ec_lotes
  where id = p_lote_id for update;
  if not found or v_lote.codigo is not null then
    raise exception 'Lote inexistente o ya identificado.'
      using errcode = '23514';
  end if;

  update public.ec_lotes
  set codigo = btrim(p_codigo), vence_el = p_vence_el
  where id = p_lote_id;

  insert into public.ec_operaciones_inventario
    (clave, tipo, hash, resultado_id)
  values (p_key, 'lote', v_hash, p_lote_id);
  return p_lote_id;
end $function$;

create or replace function public.ec_identificar_serie(
  p_serie_id uuid,
  p_numero text,
  p_key text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_serie public.ec_series%rowtype;
  v_old public.ec_operaciones_inventario%rowtype;
  v_hash text;
begin
  if auth.uid() is null
     or not public.tiene_permiso('inventario', 'editar') then
    raise exception 'Sin permiso para identificar series.'
      using errcode = '42501';
  end if;
  if p_serie_id is null or nullif(btrim(p_numero), '') is null
     or nullif(btrim(p_key), '') is null then
    raise exception 'Serie, número y clave obligatorios.'
      using errcode = '22023';
  end if;

  v_hash := md5(jsonb_build_object(
    'serie', p_serie_id, 'numero', btrim(p_numero)
  )::text);
  perform pg_advisory_xact_lock(
    hashtextextended('ec:serial:' || p_key, 0)
  );
  select * into v_old from public.ec_operaciones_inventario
  where clave = p_key;
  if found then
    if v_old.tipo <> 'serie' or v_old.hash <> v_hash then
      raise exception 'Clave reutilizada con otros datos.'
        using errcode = '23505';
    end if;
    return v_old.resultado_id;
  end if;

  select * into v_serie from public.ec_series
  where id = p_serie_id for update;
  if not found or v_serie.estado <> 'pendiente'
     or v_serie.numero is not null then
    raise exception 'Serie inexistente o ya identificada.'
      using errcode = '23514';
  end if;

  update public.ec_series
  set numero = btrim(p_numero), estado = 'disponible'
  where id = p_serie_id;

  insert into public.ec_operaciones_inventario
    (clave, tipo, hash, resultado_id)
  values (p_key, 'serie', v_hash, p_serie_id);
  return p_serie_id;
end $function$;

create or replace function public.ec_valorizar_apertura(
  p_producto_id uuid,
  p_almacen_id uuid,
  p_costo_unitario numeric,
  p_key text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_estado public.ec_valoracion_estado%rowtype;
  v_old public.ec_operaciones_inventario%rowtype;
  v_hash text;
begin
  if auth.uid() is null
     or not public.tiene_permiso('inventario', 'editar') then
    raise exception 'Sin permiso para valorizar la apertura.'
      using errcode = '42501';
  end if;
  if p_producto_id is null or p_almacen_id is null
     or p_costo_unitario is null or p_costo_unitario < 0
     or nullif(btrim(p_key), '') is null then
    raise exception 'Costo de apertura inválido.'
      using errcode = '22023';
  end if;

  v_hash := md5(jsonb_build_object(
    'producto', p_producto_id, 'almacen', p_almacen_id,
    'costo', p_costo_unitario
  )::text);
  perform pg_advisory_xact_lock(
    hashtextextended('ec:openingcost:' || p_key, 0)
  );
  select * into v_old from public.ec_operaciones_inventario
  where clave = p_key;
  if found then
    if v_old.tipo <> 'apertura' or v_old.hash <> v_hash then
      raise exception 'Clave reutilizada con otros datos.'
        using errcode = '23505';
    end if;
    return v_old.resultado_id;
  end if;

  select * into v_estado from public.ec_valoracion_estado
  where producto_id = p_producto_id and almacen_id = p_almacen_id
  for update;
  if not found or exists (
    select 1 from public.ec_kardex_valorizado
    where producto_id = p_producto_id and almacen_id = p_almacen_id
  ) then
    raise exception
      'La apertura solo puede costearse antes del primer movimiento nuevo.'
      using errcode = '23514';
  end if;

  update public.ec_capas_peps
  set costo_unitario = p_costo_unitario
  where producto_id = p_producto_id
    and almacen_id = p_almacen_id
    and movimiento_entrada_id is null;

  update public.ec_valoracion_estado
  set valor_promedio = unidades * p_costo_unitario
  where producto_id = p_producto_id and almacen_id = p_almacen_id;

  insert into public.ec_operaciones_inventario
    (clave, tipo, hash, resultado_id)
  values (p_key, 'apertura', v_hash, p_producto_id);
  return p_producto_id;
end $function$;

create or replace function public.ec_serializar_stock_producto()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform 1
  from public.productos
  where id = new.producto_id
  for update;

  return new;
end $function$;

create or replace function public.ec_trazar_movimiento()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_modo text;
  v_cantidad integer;
  v_restante integer;
  v_tomar integer;
  v_lote record;
  v_serie record;
  v_salida uuid;
begin
  if new.producto_id is null or new.almacen_id is null
     or new.stock_anterior is null or new.stock_nuevo is null
     or new.stock_anterior = new.stock_nuevo then
    return new;
  end if;

  select modo into v_modo from public.ec_producto_trazabilidad
  where producto_id = new.producto_id;
  if v_modo is null then return new; end if;

  v_cantidad := abs(new.stock_nuevo - new.stock_anterior);

  if new.stock_nuevo > new.stock_anterior then
    if new.origen_tipo = 'ec_transferencia' then
      select m.id into v_salida
      from public.movimientos_inventario m
      where m.origen_tipo = 'ec_transferencia'
        and m.origen_id = new.origen_id
        and m.producto_id = new.producto_id
        and m.tipo = 'salida'
      order by m.created_at desc, m.id desc limit 1;
      if v_salida is null then
        raise exception 'Transferencia sin movimiento de salida.';
      end if;

      if v_modo = 'lote' then
        insert into public.ec_existencias_lote
          (lote_id, producto_id, almacen_id, cantidad)
        select ml.lote_id, new.producto_id, new.almacen_id, ml.cantidad
        from public.ec_movimiento_lotes ml
        where ml.movimiento_id = v_salida
        on conflict (lote_id, almacen_id) do update
        set cantidad = public.ec_existencias_lote.cantidad
          + excluded.cantidad;

        insert into public.ec_movimiento_lotes
          (movimiento_id, lote_id, cantidad)
        select new.id, lote_id, cantidad
        from public.ec_movimiento_lotes
        where movimiento_id = v_salida;
      else
        update public.ec_series s
        set almacen_id = new.almacen_id, estado = 'disponible'
        from public.ec_movimiento_series ms
        where ms.movimiento_id = v_salida and ms.serie_id = s.id
          and s.estado = 'transito';

        insert into public.ec_movimiento_series (movimiento_id, serie_id)
        select new.id, serie_id from public.ec_movimiento_series
        where movimiento_id = v_salida;
      end if;
      return new;
    end if;

    if v_modo = 'lote' then
      insert into public.ec_lotes
        (producto_id, movimiento_entrada_id)
      values (new.producto_id, new.id)
      returning id into v_salida;

      insert into public.ec_existencias_lote
        (lote_id, producto_id, almacen_id, cantidad)
      values (v_salida, new.producto_id, new.almacen_id, v_cantidad);

      insert into public.ec_movimiento_lotes
        (movimiento_id, lote_id, cantidad)
      values (new.id, v_salida, v_cantidad);
    else
      if v_cantidad > 10000 then
        raise exception 'Identifica las series en entradas de hasta 10000 unidades.';
      end if;
      insert into public.ec_series
        (producto_id, almacen_id, movimiento_entrada_id)
      select new.producto_id, new.almacen_id, new.id
      from generate_series(1, v_cantidad);
    end if;
  else
    v_restante := v_cantidad;

    if v_modo = 'lote' then
      for v_lote in
        select e.lote_id, e.cantidad
        from public.ec_existencias_lote e
        join public.ec_lotes l on l.id = e.lote_id
        where e.producto_id = new.producto_id
          and e.almacen_id = new.almacen_id
          and e.cantidad > 0
          and l.codigo is not null
          and (l.vence_el is null
               or l.vence_el >= (now() at time zone 'America/Lima')::date)
        order by l.vence_el nulls last, l.id
        for update of e
      loop
        exit when v_restante = 0;
        v_tomar := least(v_restante, v_lote.cantidad);
        update public.ec_existencias_lote
        set cantidad = cantidad - v_tomar
        where lote_id = v_lote.lote_id
          and almacen_id = new.almacen_id;
        insert into public.ec_movimiento_lotes
          (movimiento_id, lote_id, cantidad)
        values (new.id, v_lote.lote_id, v_tomar);
        v_restante := v_restante - v_tomar;
      end loop;
    else
      for v_serie in
        select id from public.ec_series
        where producto_id = new.producto_id
          and almacen_id = new.almacen_id
          and estado = 'disponible' and numero is not null
        order by id for update
      loop
        exit when v_restante = 0;
        update public.ec_series
        set almacen_id = null,
            estado = case when new.origen_tipo = 'ec_transferencia'
              then 'transito' else 'salida' end
        where id = v_serie.id;
        insert into public.ec_movimiento_series
          (movimiento_id, serie_id)
        values (new.id, v_serie.id);
        v_restante := v_restante - 1;
      end loop;
    end if;

    if v_restante <> 0 then
      raise exception
        'Stock trazable insuficiente: identifica lotes/series pendientes antes de la salida.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end $function$;

create or replace function public.ec_valorizar_movimiento()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_estado public.ec_valoracion_estado%rowtype;
  v_capa record;
  v_consumo record;
  v_cantidad integer;
  v_restante integer;
  v_tomar integer;
  v_entrada boolean;
  v_costo numeric;
  v_costo_peps numeric := 0;
  v_costo_promedio numeric;
  v_saldo_peps numeric;
  v_saldo_promedio numeric;
  v_nuevo_stock integer;
  v_movimiento_salida uuid;
begin
  if new.producto_id is null or new.almacen_id is null
     or new.stock_anterior is null or new.stock_nuevo is null
     or new.stock_anterior = new.stock_nuevo then
    return new;
  end if;

  v_entrada := new.stock_nuevo > new.stock_anterior;
  v_cantidad := abs(new.stock_nuevo - new.stock_anterior);
  v_nuevo_stock := new.stock_nuevo;

  insert into public.ec_valoracion_estado
    (producto_id, almacen_id, unidades, valor_promedio)
  values (new.producto_id, new.almacen_id, 0, 0)
  on conflict (producto_id, almacen_id) do nothing;

  select * into v_estado from public.ec_valoracion_estado
  where producto_id = new.producto_id and almacen_id = new.almacen_id
  for update;

  if v_estado.unidades <> new.stock_anterior then
    raise exception 'Kardex desalineado para producto % y almacén %.',
      new.producto_id, new.almacen_id using errcode = '23514';
  end if;

  if v_entrada then
    v_costo := nullif(current_setting('app.ec_inventory_cost', true), '')::numeric;

    if new.origen_tipo = 'recepcion_compra' then
      select case
        when bool_or(c.moneda = 'USD'
          and (c.exchange_rate is null or c.exchange_rate <= 0))
          then null
        else sum(dr.cantidad * dr.costo_unitario *
         case when c.moneda = 'USD' then c.exchange_rate else 1 end)
          / nullif(sum(dr.cantidad), 0)
        end
      into v_costo
      from public.detalle_recepciones_compra dr
      join public.recepciones_compra r on r.id = dr.recepcion_id
      join public.compras c on c.id = r.compra_id
      where r.id = new.origen_id and dr.producto_id = new.producto_id;
    end if;

    if new.origen_tipo = 'ec_transferencia' then
      select m.id into v_movimiento_salida
      from public.movimientos_inventario m
      where m.origen_tipo = 'ec_transferencia'
        and m.origen_id = new.origen_id
        and m.producto_id = new.producto_id
        and m.tipo = 'salida'
      order by m.created_at desc, m.id desc limit 1;

      select k.costo_promedio / nullif(k.cantidad, 0)
      into v_costo
      from public.ec_kardex_valorizado k
      where k.movimiento_id = v_movimiento_salida;

      for v_consumo in
        select cantidad, costo_unitario
        from public.ec_consumos_peps
        where movimiento_salida_id = v_movimiento_salida
        order by capa_id
      loop
        insert into public.ec_capas_peps
          (producto_id, almacen_id, movimiento_entrada_id,
           cantidad_restante, costo_unitario)
        values
          (new.producto_id, new.almacen_id, new.id,
           v_consumo.cantidad, v_consumo.costo_unitario);
        if v_consumo.costo_unitario is null then
          v_costo_peps := null;
        elsif v_costo_peps is not null then
          v_costo_peps := v_costo_peps
            + v_consumo.cantidad * v_consumo.costo_unitario;
        end if;
      end loop;
    else
      v_costo := coalesce(v_costo, new.costo_unitario);
      insert into public.ec_capas_peps
        (producto_id, almacen_id, movimiento_entrada_id,
         cantidad_restante, costo_unitario)
      values (new.producto_id, new.almacen_id, new.id,
              v_cantidad, v_costo);
      v_costo_peps := case when v_costo is null
        then null else v_cantidad * v_costo end;
    end if;

    v_costo_promedio := case when v_costo is null
      then null else v_cantidad * v_costo end;
    v_saldo_promedio := case
      when v_estado.unidades = 0 then v_costo_promedio
      when v_estado.valor_promedio is null or v_costo_promedio is null
        then null
      else v_estado.valor_promedio + v_costo_promedio
    end;
  else
    v_restante := v_cantidad;

    for v_capa in
      select id, cantidad_restante, costo_unitario
      from public.ec_capas_peps
      where producto_id = new.producto_id
        and almacen_id = new.almacen_id
        and cantidad_restante > 0
      order by id for update
    loop
      exit when v_restante = 0;
      v_tomar := least(v_restante, v_capa.cantidad_restante);

      update public.ec_capas_peps
      set cantidad_restante = cantidad_restante - v_tomar
      where id = v_capa.id;

      insert into public.ec_consumos_peps
        (movimiento_salida_id, capa_id, cantidad, costo_unitario)
      values (new.id, v_capa.id, v_tomar, v_capa.costo_unitario);

      if v_capa.costo_unitario is null then
        v_costo_peps := null;
      elsif v_costo_peps is not null then
        v_costo_peps := v_costo_peps
          + v_tomar * v_capa.costo_unitario;
      end if;

      v_restante := v_restante - v_tomar;
    end loop;

    if v_restante <> 0 then
      raise exception 'No hay capas PEPS suficientes para el movimiento.'
        using errcode = '23514';
    end if;

    v_costo_promedio := case
      when v_estado.valor_promedio is null
        or v_estado.unidades = 0 then null
      else v_estado.valor_promedio * v_cantidad / v_estado.unidades
    end;
    v_saldo_promedio := case
      when v_nuevo_stock = 0 then 0
      when v_estado.valor_promedio is null
        or v_costo_promedio is null then null
      else v_estado.valor_promedio - v_costo_promedio
    end;
  end if;

  select case
    when count(*) filter (where costo_unitario is null) > 0 then null
    else coalesce(sum(cantidad_restante * costo_unitario), 0)
  end into v_saldo_peps
  from public.ec_capas_peps
  where producto_id = new.producto_id
    and almacen_id = new.almacen_id
    and cantidad_restante > 0;

  update public.ec_valoracion_estado
  set unidades = v_nuevo_stock, valor_promedio = v_saldo_promedio
  where producto_id = new.producto_id and almacen_id = new.almacen_id;

  insert into public.ec_kardex_valorizado
    (movimiento_id, producto_id, almacen_id, cantidad, sentido,
     costo_peps, costo_promedio, saldo_unidades, saldo_peps,
     saldo_promedio)
  values
    (new.id, new.producto_id, new.almacen_id, v_cantidad,
     case when v_entrada then 'entrada' else 'salida' end,
     v_costo_peps, v_costo_promedio, v_nuevo_stock,
     v_saldo_peps, v_saldo_promedio);

  return new;
end $function$;

-- ---------------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists ec_serializar_stock_producto on public.inventarios;
create trigger ec_serializar_stock_producto
  before insert or update of cantidad on public.inventarios
  for each row execute function public.ec_serializar_stock_producto();

drop trigger if exists ec_trazar_movimiento on public.movimientos_inventario;
create trigger ec_trazar_movimiento
  after insert on public.movimientos_inventario
  for each row execute function public.ec_trazar_movimiento();

drop trigger if exists ec_valorizar_movimiento on public.movimientos_inventario;
create trigger ec_valorizar_movimiento
  after insert on public.movimientos_inventario
  for each row execute function public.ec_valorizar_movimiento();

-- ---------------------------------------------------------------------------
-- 6. Permisos
-- ---------------------------------------------------------------------------

revoke all on public.ec_transferencias, public.ec_transferencia_lineas,
  public.ec_ajustes, public.ec_conteos_fisicos, public.ec_conteo_lineas,
  public.ec_producto_trazabilidad, public.ec_lotes, public.ec_series,
  public.ec_existencias_lote, public.ec_movimiento_lotes,
  public.ec_movimiento_series, public.ec_kardex_valorizado,
  public.ec_capas_peps, public.ec_consumos_peps,
  public.ec_valoracion_estado, public.ec_operaciones_inventario
  from public, anon, authenticated;

grant select on public.ec_transferencias, public.ec_transferencia_lineas,
  public.ec_ajustes, public.ec_conteos_fisicos, public.ec_conteo_lineas,
  public.ec_producto_trazabilidad, public.ec_lotes, public.ec_series,
  public.ec_existencias_lote, public.ec_movimiento_lotes,
  public.ec_movimiento_series, public.ec_kardex_valorizado
  to authenticated;

revoke all on function public.ec_consultar_existencias() from public, anon;
revoke all on function public.ec_consultar_kardex(uuid, uuid) from public, anon;
revoke all on function public.ec_procesar_transferencia(uuid, uuid, jsonb, text, text) from public, anon;
revoke all on function public.ec_registrar_ajuste(uuid, uuid, integer, text, numeric, text) from public, anon;
revoke all on function public.ec_abrir_conteo_fisico(uuid, jsonb, text, text) from public, anon;
revoke all on function public.ec_cerrar_inventario_fisico(uuid, text) from public, anon;
revoke all on function public.ec_configurar_trazabilidad(uuid, text) from public, anon;
revoke all on function public.ec_identificar_lote(uuid, text, date, text) from public, anon;
revoke all on function public.ec_identificar_serie(uuid, text, text) from public, anon;
revoke all on function public.ec_valorizar_apertura(uuid, uuid, numeric, text) from public, anon;
revoke all on function public.ec_valorizar_movimiento() from public, anon, authenticated;
revoke all on function public.ec_trazar_movimiento() from public, anon, authenticated;

grant execute on function public.ec_consultar_existencias() to authenticated;
grant execute on function public.ec_consultar_kardex(uuid, uuid) to authenticated;
grant execute on function public.ec_procesar_transferencia(uuid, uuid, jsonb, text, text) to authenticated;
grant execute on function public.ec_registrar_ajuste(uuid, uuid, integer, text, numeric, text) to authenticated;
grant execute on function public.ec_abrir_conteo_fisico(uuid, jsonb, text, text) to authenticated;
grant execute on function public.ec_cerrar_inventario_fisico(uuid, text) to authenticated;
grant execute on function public.ec_configurar_trazabilidad(uuid, text) to authenticated;
grant execute on function public.ec_identificar_lote(uuid, text, date, text) to authenticated;
grant execute on function public.ec_identificar_serie(uuid, text, text) to authenticated;
grant execute on function public.ec_valorizar_apertura(uuid, uuid, numeric, text) to authenticated;

commit;

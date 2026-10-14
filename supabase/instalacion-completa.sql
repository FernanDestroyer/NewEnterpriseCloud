-- =============================================================================
-- ERP EnterpriseCloud · Instalación completa en UN SOLO PASO
-- Cómo usarlo: abre este archivo en el Bloc de notas, Ctrl+A, Ctrl+C,
-- pégalo en Supabase Dashboard -> SQL Editor -> New query y pulsa Run.
-- Contiene las 18 migraciones en orden. Es idempotente: si algo falla a la
-- mitad, puedes volver a pegar y ejecutar todo de nuevo sin duplicar nada.
-- =============================================================================

-- >>> supabase/migrations/20261009000000_erp_enterprisecloud.sql
-- =============================================================================
-- ERP EnterpriseCloud · Esquema de base de datos para Supabase (PostgreSQL)
-- Basado en el Documento Maestro (sección 13: Diseño de base de datos,
-- sección 18: Seguridad y sección 20: Auditoría).
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin romper datos existentes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipos de apoyo
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'estado_registro') then
    create domain public.estado_registro as text
      check (value in ('Activo','Bajo stock','Completada','Crítico','En curso',
                       'En tránsito','Estable','Pendiente','Vigente'));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Seguridad: roles, permisos y usuarios
-- -----------------------------------------------------------------------------
create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  descripcion text,
  created_at  timestamptz not null default now()
);

create table if not exists public.permisos (
  id      uuid primary key default gen_random_uuid(),
  modulo  text not null,
  accion  text not null check (accion in ('ver','crear','editar','eliminar')),
  unique (modulo, accion)
);

create table if not exists public.rol_permisos (
  rol_id     uuid not null references public.roles(id)    on delete cascade,
  permiso_id uuid not null references public.permisos(id) on delete cascade,
  primary key (rol_id, permiso_id)
);

-- Un registro por cada cuenta de Supabase Auth (se crea solo, ver trigger más abajo).
create table if not exists public.usuarios (
  id            uuid primary key references auth.users(id) on delete cascade,
  nombre        text not null,
  email         text,
  rol_id        uuid references public.roles(id),
  activo        boolean not null default true,
  ultimo_acceso timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists usuarios_email_uidx on public.usuarios (lower(email));
create index if not exists usuarios_rol_idx on public.usuarios (rol_id);

-- -----------------------------------------------------------------------------
-- 3. Catálogos: categorías y almacenes
-- -----------------------------------------------------------------------------
create table if not exists public.categorias (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  descripcion text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.almacenes (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  ubicacion   text,
  responsable text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 4. Secuencias para los códigos legibles (V-2048, OC-302, PRD-001, ...)
-- -----------------------------------------------------------------------------
create sequence if not exists public.seq_ventas      as bigint;
create sequence if not exists public.seq_compras     as bigint;
create sequence if not exists public.seq_productos   as bigint;
create sequence if not exists public.seq_clientes    as bigint;
create sequence if not exists public.seq_proveedores as bigint;
create sequence if not exists public.seq_cxc         as bigint;
create sequence if not exists public.seq_cxp         as bigint;
create sequence if not exists public.seq_fin         as bigint;
create sequence if not exists public.seq_documentos  as bigint;
create sequence if not exists public.seq_reportes    as bigint;
create sequence if not exists public.seq_config      as bigint;

-- -----------------------------------------------------------------------------
-- 5. Tablas de negocio (cada una alimenta un módulo de la interfaz)
--    Todas llevan: codigo (referencia visible), estado, created_by y fechas.
-- -----------------------------------------------------------------------------
create table if not exists public.clientes (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  razon_social   text not null,
  detalle        text not null default '',
  linea_credito  numeric(14,2) not null default 0 check (linea_credito >= 0),
  estado         public.estado_registro not null default 'Activo',
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists clientes_razon_idx on public.clientes (lower(razon_social));

create table if not exists public.proveedores (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  razon_social   text not null,
  detalle        text not null default '',
  linea_credito  numeric(14,2) not null default 0 check (linea_credito >= 0),
  estado         public.estado_registro not null default 'Activo',
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists proveedores_razon_idx on public.proveedores (lower(razon_social));

create table if not exists public.productos (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null unique,
  nombre       text not null,
  detalle      text not null default '',
  categoria_id uuid references public.categorias(id) on delete set null,
  stock        integer not null default 0 check (stock >= 0),
  estado       public.estado_registro not null default 'Estable',
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists productos_categoria_idx on public.productos (categoria_id);

-- Existencias por almacén (un producto mantiene existencias por almacén).
create table if not exists public.inventarios (
  id          uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  almacen_id  uuid not null references public.almacenes(id) on delete cascade,
  cantidad    integer not null default 0 check (cantidad >= 0),
  updated_at  timestamptz not null default now(),
  unique (producto_id, almacen_id)
);

create table if not exists public.ventas (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  cliente_id     uuid references public.clientes(id) on delete set null,
  cliente_nombre text not null,
  detalle        text not null default '',
  monto          numeric(14,2) not null default 0 check (monto >= 0),
  estado         public.estado_registro not null default 'Pendiente',
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists ventas_cliente_idx on public.ventas (cliente_id);
create index if not exists ventas_created_idx on public.ventas (created_at desc);

create table if not exists public.detalle_ventas (
  id              uuid primary key default gen_random_uuid(),
  venta_id        uuid not null references public.ventas(id) on delete cascade,
  producto_id     uuid references public.productos(id) on delete set null,
  descripcion     text,
  cantidad        integer not null default 1 check (cantidad > 0),
  precio_unitario numeric(14,2) not null default 0 check (precio_unitario >= 0),
  subtotal        numeric(14,2) generated always as (cantidad * precio_unitario) stored
);
create index if not exists detalle_ventas_venta_idx on public.detalle_ventas (venta_id);

create table if not exists public.compras (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique,
  proveedor_id     uuid references public.proveedores(id) on delete set null,
  proveedor_nombre text not null,
  detalle          text not null default '',
  monto            numeric(14,2) not null default 0 check (monto >= 0),
  estado           public.estado_registro not null default 'En curso',
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists compras_proveedor_idx on public.compras (proveedor_id);
create index if not exists compras_created_idx on public.compras (created_at desc);

create table if not exists public.detalle_compras (
  id              uuid primary key default gen_random_uuid(),
  compra_id       uuid not null references public.compras(id) on delete cascade,
  producto_id     uuid references public.productos(id) on delete set null,
  descripcion     text,
  cantidad        integer not null default 1 check (cantidad > 0),
  costo_unitario  numeric(14,2) not null default 0 check (costo_unitario >= 0),
  subtotal        numeric(14,2) generated always as (cantidad * costo_unitario) stored
);
create index if not exists detalle_compras_compra_idx on public.detalle_compras (compra_id);

-- Finanzas: cuentas por cobrar (CxC) y por pagar (CxP).
create table if not exists public.pagos (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null unique,
  tipo               text check (tipo in ('cobrar','pagar')),
  contraparte        text not null,
  detalle            text not null default '',
  monto              numeric(14,2) not null default 0 check (monto >= 0),
  estado             public.estado_registro not null default 'Pendiente',
  fecha_vencimiento  date,
  venta_id           uuid references public.ventas(id)  on delete set null,
  compra_id          uuid references public.compras(id) on delete set null,
  created_by         uuid default auth.uid() references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Metadatos de archivos; el archivo físico vive en almacenamiento de objetos.
create table if not exists public.documentos (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  nombre_archivo text not null,
  detalle        text not null default '',
  storage_path   text,
  entidad_tipo   text,        -- 'venta', 'compra', 'cliente', ...
  entidad_id     uuid,        -- Documento -> Entidad (operación empresarial)
  estado         public.estado_registro not null default 'Vigente',
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.reportes (
  id         uuid primary key default gen_random_uuid(),
  codigo     text not null unique,
  nombre     text not null,
  detalle    text not null default '',
  estado     public.estado_registro not null default 'Vigente',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.configuracion (
  id         uuid primary key default gen_random_uuid(),
  codigo     text not null unique,
  nombre     text not null,
  detalle    text not null default '',
  estado     public.estado_registro not null default 'Activo',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Kardex: se llena solo cuando cambia el stock de un producto.
create table if not exists public.movimientos_inventario (
  id             uuid primary key default gen_random_uuid(),
  producto_id    uuid references public.productos(id) on delete set null,
  almacen_id     uuid references public.almacenes(id) on delete set null,
  tipo           text not null check (tipo in ('entrada','salida','ajuste','transferencia')),
  cantidad       integer not null,
  stock_anterior integer,
  stock_nuevo    integer,
  referencia     text,
  usuario_id     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists mov_inv_producto_idx on public.movimientos_inventario (producto_id, created_at desc);

-- Auditoría: usuario -> acción -> módulo -> registro afectado -> fecha/hora -> resultado.
create table if not exists public.auditoria (
  id             bigint generated always as identity primary key,
  usuario_id     uuid,
  usuario_email  text,
  accion         text not null,
  modulo         text not null,
  registro_id    text,
  datos_antes    jsonb,
  datos_despues  jsonb,
  resultado      text not null default 'exitoso',
  created_at     timestamptz not null default now()
);
create index if not exists auditoria_created_idx on public.auditoria (created_at desc);
create index if not exists auditoria_modulo_idx  on public.auditoria (modulo, created_at desc);

-- -----------------------------------------------------------------------------
-- 6. Funciones auxiliares de autorización (principio de mínimo privilegio)
-- -----------------------------------------------------------------------------
create or replace function public.usuario_activo()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.usuarios u where u.id = (select auth.uid()) and u.activo);
$$;

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.usuarios u join public.roles r on r.id = u.rol_id
    where u.id = (select auth.uid()) and u.activo and r.nombre = 'Administrador');
$$;

create or replace function public.tiene_permiso(p_modulo text, p_accion text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.usuarios u
    join public.rol_permisos rp on rp.rol_id = u.rol_id
    join public.permisos p      on p.id = rp.permiso_id
    where u.id = (select auth.uid()) and u.activo
      and p.modulo = p_modulo and p.accion = p_accion);
$$;

revoke execute on function public.usuario_activo(), public.es_admin(),
                           public.tiene_permiso(text, text) from public, anon;
grant  execute on function public.usuario_activo(), public.es_admin(),
                           public.tiene_permiso(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Triggers de utilidad: updated_at, códigos, vínculos y kardex
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Código legible: TG_ARGV[0] = prefijo, [1] = secuencia, [2] = relleno de ceros.
create or replace function public.asignar_codigo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.codigo is null or new.codigo = '' then
    new.codigo := tg_argv[0] || '-' ||
                  lpad(nextval(tg_argv[1]::regclass)::text, tg_argv[2]::int, '0');
  end if;
  return new;
end $$;

-- Pagos: deduce CxC/CxP desde el detalle y asigna CXC-/CXP-/FIN-.
create or replace function public.pagos_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare d text := lower(coalesce(new.detalle, ''));
begin
  if new.tipo is null then
    if d like '%por cobrar%' and d not like '%por pagar%' then new.tipo := 'cobrar';
    elsif d like '%por pagar%' and d not like '%por cobrar%' then new.tipo := 'pagar';
    end if;
  end if;
  if tg_op = 'INSERT' and (new.codigo is null or new.codigo = '') then
    new.codigo := case new.tipo
      when 'cobrar' then 'CXC-' || lpad(nextval('public.seq_cxc')::text, 3, '0')
      when 'pagar'  then 'CXP-' || lpad(nextval('public.seq_cxp')::text, 3, '0')
      else               'FIN-' || lpad(nextval('public.seq_fin')::text, 3, '0') end;
  end if;
  return new;
end $$;

-- Vincula la venta/compra con el cliente/proveedor cuando el nombre coincide.
create or replace function public.vincular_cliente()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.cliente_id is null then
    select c.id into new.cliente_id from public.clientes c
    where lower(c.razon_social) = lower(trim(new.cliente_nombre)) limit 1;
  end if;
  return new;
end $$;

create or replace function public.vincular_proveedor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.proveedor_id is null then
    select p.id into new.proveedor_id from public.proveedores p
    where lower(p.razon_social) = lower(trim(new.proveedor_nombre)) limit 1;
  end if;
  return new;
end $$;

-- Kardex automático.
create or replace function public.registrar_kardex()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_antes integer := case when tg_op = 'INSERT' then 0 else old.stock end;
begin
  if new.stock is distinct from v_antes then
    insert into public.movimientos_inventario
      (producto_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia, usuario_id)
    values
      (new.id, case when new.stock > v_antes then 'entrada' else 'salida' end,
       abs(new.stock - v_antes), v_antes, new.stock, new.codigo, (select auth.uid()));
  end if;
  return new;
end $$;

-- Bloquea que un usuario común se cambie el rol o se reactive a sí mismo.
create or replace function public.proteger_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not public.es_admin()
     and (new.rol_id is distinct from old.rol_id or new.activo is distinct from old.activo
          or new.id is distinct from old.id) then
    raise exception 'Solo un administrador puede cambiar el rol o el estado de un usuario'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- Auditoría automática de operaciones críticas.
create or replace function public.fn_auditar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row   jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_uid   uuid  := (select auth.uid());
begin
  insert into public.auditoria
    (usuario_id, usuario_email, accion, modulo, registro_id, datos_antes, datos_despues)
  values
    (v_uid,
     (select u.email from public.usuarios u where u.id = v_uid),
     tg_op, tg_table_name,
     coalesce(v_row->>'codigo', v_row->>'id'),
     case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
     case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end $$;

-- Cada trigger se recrea para que el script sea re-ejecutable.
do $$
declare
  r record;
begin
  -- updated_at en todas las tablas que lo tienen
  for r in select unnest(array['usuarios','clientes','proveedores','productos','inventarios','ventas',
                               'compras','pagos','documentos','reportes','configuracion']) as t loop
    execute format('drop trigger if exists trg_updated_at on public.%I', r.t);
    execute format('create trigger trg_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', r.t);
  end loop;

  -- códigos legibles
  for r in select * from (values
      ('ventas','V','public.seq_ventas',4), ('compras','OC','public.seq_compras',3),
      ('productos','PRD','public.seq_productos',3), ('clientes','CLI','public.seq_clientes',3),
      ('proveedores','PRV','public.seq_proveedores',3), ('documentos','DOC','public.seq_documentos',3),
      ('reportes','RPT','public.seq_reportes',3), ('configuracion','CFG','public.seq_config',3)
    ) as x(t, prefijo, seq, relleno) loop
    execute format('drop trigger if exists trg_codigo on public.%I', r.t);
    execute format('create trigger trg_codigo before insert on public.%I
                    for each row execute function public.asignar_codigo(%L, %L, %L)',
                   r.t, r.prefijo, r.seq, r.relleno);
  end loop;

  -- auditoría
  for r in select unnest(array['usuarios','clientes','proveedores','productos','ventas','compras',
                               'pagos','documentos','reportes','configuracion']) as t loop
    execute format('drop trigger if exists trg_auditoria on public.%I', r.t);
    execute format('create trigger trg_auditoria after insert or update or delete on public.%I
                    for each row execute function public.fn_auditar()', r.t);
  end loop;
end $$;

drop trigger if exists trg_pagos_before on public.pagos;
create trigger trg_pagos_before before insert or update of detalle, tipo on public.pagos
  for each row execute function public.pagos_before_write();

drop trigger if exists trg_vincular on public.ventas;
create trigger trg_vincular before insert or update of cliente_nombre on public.ventas
  for each row execute function public.vincular_cliente();

drop trigger if exists trg_vincular on public.compras;
create trigger trg_vincular before insert or update of proveedor_nombre on public.compras
  for each row execute function public.vincular_proveedor();

drop trigger if exists trg_kardex on public.productos;
create trigger trg_kardex after insert or update of stock on public.productos
  for each row execute function public.registrar_kardex();

drop trigger if exists trg_proteger_usuario on public.usuarios;
create trigger trg_proteger_usuario before update on public.usuarios
  for each row execute function public.proteger_usuario();

-- Las funciones de trigger no deben poder llamarse desde la API.
revoke execute on function public.set_updated_at(), public.asignar_codigo(),
  public.pagos_before_write(), public.vincular_cliente(), public.vincular_proveedor(),
  public.registrar_kardex(), public.proteger_usuario(), public.fn_auditar()
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. Roles y permisos iniciales
-- -----------------------------------------------------------------------------
insert into public.roles (nombre, descripcion) values
  ('Administrador', 'Acceso total, incluye usuarios, roles y auditoría'),
  ('Gerente',       'Opera y supervisa todos los módulos'),
  ('Operador',      'Opera los módulos de negocio'),
  ('Vendedor',      'Ventas y clientes')
on conflict (nombre) do nothing;

insert into public.permisos (modulo, accion)
select m, a
from unnest(array['ventas','compras','inventario','clientes','proveedores','finanzas',
                  'documentos','reportes','configuracion','usuarios','auditoria']) as m,
     unnest(array['ver','crear','editar','eliminar']) as a
on conflict (modulo, accion) do nothing;

-- Matriz rol -> módulo -> acciones
with matriz(rol, modulo, acciones) as (values
  -- Administrador: todo
  ('Administrador','ventas',        array['ver','crear','editar','eliminar']),
  ('Administrador','compras',       array['ver','crear','editar','eliminar']),
  ('Administrador','inventario',    array['ver','crear','editar','eliminar']),
  ('Administrador','clientes',      array['ver','crear','editar','eliminar']),
  ('Administrador','proveedores',   array['ver','crear','editar','eliminar']),
  ('Administrador','finanzas',      array['ver','crear','editar','eliminar']),
  ('Administrador','documentos',    array['ver','crear','editar','eliminar']),
  ('Administrador','reportes',      array['ver','crear','editar','eliminar']),
  ('Administrador','configuracion', array['ver','crear','editar','eliminar']),
  ('Administrador','usuarios',      array['ver','crear','editar','eliminar']),
  ('Administrador','auditoria',     array['ver']),
  -- Gerente
  ('Gerente','ventas',        array['ver','crear','editar','eliminar']),
  ('Gerente','compras',       array['ver','crear','editar','eliminar']),
  ('Gerente','inventario',    array['ver','crear','editar','eliminar']),
  ('Gerente','clientes',      array['ver','crear','editar','eliminar']),
  ('Gerente','proveedores',   array['ver','crear','editar','eliminar']),
  ('Gerente','finanzas',      array['ver','crear','editar','eliminar']),
  ('Gerente','documentos',    array['ver','crear','editar','eliminar']),
  ('Gerente','reportes',      array['ver','crear','editar','eliminar']),
  ('Gerente','configuracion', array['ver','crear','editar','eliminar']),
  ('Gerente','usuarios',      array['ver']),
  ('Gerente','auditoria',     array['ver']),
  -- Operador (rol por defecto de los nuevos registros)
  ('Operador','ventas',        array['ver','crear','editar','eliminar']),
  ('Operador','compras',       array['ver','crear','editar','eliminar']),
  ('Operador','inventario',    array['ver','crear','editar','eliminar']),
  ('Operador','clientes',      array['ver','crear','editar','eliminar']),
  ('Operador','proveedores',   array['ver','crear','editar','eliminar']),
  ('Operador','finanzas',      array['ver','crear','editar','eliminar']),
  ('Operador','documentos',    array['ver','crear','editar','eliminar']),
  ('Operador','reportes',      array['ver','crear','editar','eliminar']),
  ('Operador','configuracion', array['ver','crear','editar']),
  -- Vendedor
  ('Vendedor','ventas',      array['ver','crear','editar']),
  ('Vendedor','clientes',    array['ver','crear','editar']),
  ('Vendedor','inventario',  array['ver']),
  ('Vendedor','documentos',  array['ver','crear']),
)
insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
from matriz m
join public.roles r on r.nombre = m.rol
join public.permisos p on p.modulo = m.modulo and p.accion = any (m.acciones)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 9. Registro de usuarios: cada cuenta nueva de Auth aparece en public.usuarios
--    * La primera cuenta registrada es Administrador; las demás, Operador.
--    * El rol NUNCA se toma de los metadatos que envía el navegador.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_primero boolean;
  v_rol     uuid;
begin
  perform pg_advisory_xact_lock(hashtext('erp_enterprisecloud_primer_usuario'));
  select not exists (select 1 from public.usuarios) into v_primero;
  select id into v_rol from public.roles
   where nombre = case when v_primero then 'Administrador' else 'Básico' end;

  insert into public.usuarios (id, nombre, email, rol_id, ultimo_acceso)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''),
             nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Usuario'),
    new.email, v_rol, new.last_sign_in_at)
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.handle_user_updated()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.usuarios
     set email = new.email,
         ultimo_acceso = coalesce(new.last_sign_in_at, ultimo_acceso)
   where id = new.id
     and (email is distinct from new.email
          or ultimo_acceso is distinct from coalesce(new.last_sign_in_at, ultimo_acceso));
  return new;
end $$;

revoke execute on function public.handle_new_user(), public.handle_user_updated()
  from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated after update of email, last_sign_in_at on auth.users
  for each row execute function public.handle_user_updated();

-- Cuentas que ya existían antes de ejecutar este script: se agregan a usuarios.
do $$
declare
  u record;
  v_rol uuid;
begin
  for u in select * from auth.users au
           where not exists (select 1 from public.usuarios x where x.id = au.id)
           order by au.created_at loop
    select id into v_rol from public.roles
     where nombre = case when exists (select 1 from public.usuarios) then 'Operador' else 'Administrador' end;
    insert into public.usuarios (id, nombre, email, rol_id, ultimo_acceso)
    values (u.id,
            coalesce(nullif(trim(u.raw_user_meta_data ->> 'nombre'), ''),
                     nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Usuario'),
            u.email, v_rol, u.last_sign_in_at)
    on conflict (id) do nothing;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 10. Row Level Security
-- -----------------------------------------------------------------------------
alter table public.roles                  enable row level security;
alter table public.permisos               enable row level security;
alter table public.rol_permisos           enable row level security;
alter table public.usuarios               enable row level security;
alter table public.categorias             enable row level security;
alter table public.almacenes              enable row level security;
alter table public.auditoria              enable row level security;
alter table public.movimientos_inventario enable row level security;

-- Roles y permisos: los lee cualquier usuario activo; solo el administrador los modifica.
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles for select to authenticated
  using ((select public.usuario_activo()));
drop policy if exists roles_admin on public.roles;
create policy roles_admin on public.roles for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

drop policy if exists permisos_select on public.permisos;
create policy permisos_select on public.permisos for select to authenticated
  using ((select public.usuario_activo()));
drop policy if exists permisos_admin on public.permisos;
create policy permisos_admin on public.permisos for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

drop policy if exists rol_permisos_select on public.rol_permisos;
create policy rol_permisos_select on public.rol_permisos for select to authenticated
  using ((select public.usuario_activo()));
drop policy if exists rol_permisos_admin on public.rol_permisos;
create policy rol_permisos_admin on public.rol_permisos for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

-- Usuarios: cada quien ve y edita su propio perfil; ver/editar a otros requiere permiso.
-- (No hay política de INSERT/DELETE: las altas las hace el trigger y las bajas, Auth.)
drop policy if exists usuarios_select on public.usuarios;
create policy usuarios_select on public.usuarios for select to authenticated
  using (id = (select auth.uid()) or (select public.tiene_permiso('usuarios', 'ver')));
drop policy if exists usuarios_update on public.usuarios;
create policy usuarios_update on public.usuarios for update to authenticated
  using (id = (select auth.uid()) or (select public.es_admin()))
  with check (id = (select auth.uid()) or (select public.es_admin()));

-- Catálogos: lectura para usuarios activos; escritura con permiso de configuración.
do $$
declare t text;
begin
  foreach t in array array['categorias','almacenes'] loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
                    using ((select public.usuario_activo()))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                    with check ((select public.tiene_permiso(''configuracion'', ''crear'')))', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                    using ((select public.tiene_permiso(''configuracion'', ''editar'')))
                    with check ((select public.tiene_permiso(''configuracion'', ''editar'')))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
                    using ((select public.tiene_permiso(''configuracion'', ''eliminar'')))', t);
  end loop;
end $$;

-- Tablas de negocio: una política por acción, ligada al permiso del módulo.
do $$
declare r record;
begin
  for r in select * from (values
      ('clientes','clientes'), ('proveedores','proveedores'), ('productos','inventario'),
      ('inventarios','inventario'), ('ventas','ventas'), ('detalle_ventas','ventas'),
      ('compras','compras'), ('detalle_compras','compras'), ('pagos','finanzas'),
      ('documentos','documentos'), ('reportes','reportes'), ('configuracion','configuracion')
    ) as x(tabla, modulo) loop
    execute format('alter table public.%I enable row level security', r.tabla);

    execute format('drop policy if exists %1$s_select on public.%1$I', r.tabla);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
                    using ((select public.tiene_permiso(%2$L, ''ver'')))', r.tabla, r.modulo);

    execute format('drop policy if exists %1$s_insert on public.%1$I', r.tabla);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                    with check ((select public.tiene_permiso(%2$L, ''crear'')))', r.tabla, r.modulo);

    execute format('drop policy if exists %1$s_update on public.%1$I', r.tabla);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                    using ((select public.tiene_permiso(%2$L, ''editar'')))
                    with check ((select public.tiene_permiso(%2$L, ''editar'')))', r.tabla, r.modulo);

    execute format('drop policy if exists %1$s_delete on public.%1$I', r.tabla);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
                    using ((select public.tiene_permiso(%2$L, ''eliminar'')))', r.tabla, r.modulo);
  end loop;
end $$;

-- Kardex y auditoría: solo lectura para quien tenga el permiso (las altas las hacen los triggers).
drop policy if exists mov_inv_select on public.movimientos_inventario;
create policy mov_inv_select on public.movimientos_inventario for select to authenticated
  using ((select public.tiene_permiso('inventario', 'ver')));

drop policy if exists auditoria_select on public.auditoria;
create policy auditoria_select on public.auditoria for select to authenticated
  using ((select public.tiene_permiso('auditoria', 'ver')));

-- El rol anónimo (visitante sin sesión) no necesita tocar ninguna tabla.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Los datos de auditoría y kardex no se pueden alterar desde la API.
revoke insert, update, delete on public.auditoria, public.movimientos_inventario from authenticated;

-- >>> supabase/migrations/20261010000000_producto_proveedor.sql
-- =============================================================================
-- ERP EnterpriseCloud · Producto ↔ Proveedor (opcional)
-- Permite relacionar un producto con un proveedor registrado, a elección del
-- usuario. Es 100% opcional y no rompe datos existentes.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

-- 1. Columna opcional en productos (uuid del proveedor, puede ser NULL).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'productos' and column_name = 'proveedor_id'
  ) then
    alter table public.productos
      add column proveedor_id uuid references public.proveedores(id) on delete set null;
  end if;
end $$;

-- 2. Índice para búsquedas y joins (si no existe).
create index if not exists productos_proveedor_idx on public.productos (proveedor_id);

-- 3. Comentario de documentación.
comment on column public.productos.proveedor_id is
  'Proveedor habitual del producto. Opcional: NULL = sin proveedor asignado.';

-- 4. Las políticas RLS existentes de productos (módulo inventario) ya cubren la
--    nueva columna: no se necesita ninguna política adicional. La lectura del
--    nombre del proveedor vía join requiere además permiso de ver proveedores,
--    que ya tienen Administrador, Gerente, Operador, Contador y Almacenero.

-- >>> supabase/migrations/20261011000000_producto_precio.sql
-- =============================================================================
-- ERP EnterpriseCloud · Precio de venta en productos
-- Cada producto trae su precio definido. Si no tiene, el usuario lo agrega al
-- crear/editar el producto. Las ventas lo usan como precio sugerido (editable
-- por línea).
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'productos' and column_name = 'precio'
  ) then
    alter table public.productos
      add column precio numeric(14,2) not null default 0 check (precio >= 0);
  end if;
end $$;

comment on column public.productos.precio is
  'Precio de venta referencial del producto. Se sugiere en cada línea de venta y puede ajustarse por línea.';

-- RLS existente del módulo inventario ya cubre la nueva columna.

-- >>> supabase/migrations/20261012000000_cotizaciones.sql
-- =============================================================================
-- ERP EnterpriseCloud · Módulo de Cotizaciones
-- Cotizar productos con precio fijo, hacer seguimiento por estados y convertir
-- la cotización aprobada en venta (descuenta stock y genera la cobranza).
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

-- 1. Nuevos estados para el ciclo de la cotización. Amplía el dominio existente
--    (superset: no afecta ningún dato ya guardado).
do $$
declare v_constraint name;
begin
  select conname into v_constraint
    from pg_constraint
   where contypid = 'public.estado_registro'::regtype and contype = 'c'
   limit 1;
  if v_constraint is not null then
    execute format('alter domain public.estado_registro drop constraint %I', v_constraint);
  end if;
  alter domain public.estado_registro add check (value in (
    'Activo','Bajo stock','Completada','Crítico','En curso','En tránsito',
    'Estable','Pendiente','Vigente','Aprobada','Rechazada','Vencida'));
end $$;

-- 2. Secuencia para los códigos legibles (COT-0001, COT-0002, ...).
create sequence if not exists public.seq_cotizaciones as bigint;

-- 3. Cabecera y líneas. La cotización NO mueve stock: solo lo hace su venta.
create table if not exists public.cotizaciones (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  cliente_id     uuid references public.clientes(id) on delete set null,
  cliente_nombre text not null,
  detalle        text not null default '',
  monto          numeric(14,2) not null default 0 check (monto >= 0),
  estado         public.estado_registro not null default 'Pendiente',
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists cotizaciones_cliente_idx on public.cotizaciones (cliente_id);
create index if not exists cotizaciones_created_idx on public.cotizaciones (created_at desc);

create table if not exists public.detalle_cotizaciones (
  id              uuid primary key default gen_random_uuid(),
  cotizacion_id   uuid not null references public.cotizaciones(id) on delete cascade,
  producto_id     uuid references public.productos(id) on delete set null,
  descripcion     text,
  cantidad        integer not null default 1 check (cantidad > 0),
  precio_unitario numeric(14,2) not null default 0 check (precio_unitario >= 0),
  subtotal        numeric(14,2) generated always as (cantidad * precio_unitario) stored
);
create index if not exists detalle_cotizaciones_cotizacion_idx on public.detalle_cotizaciones (cotizacion_id);

-- 4. Triggers de utilidad (misma convención que el resto de módulos).
drop trigger if exists trg_updated_at on public.cotizaciones;
create trigger trg_updated_at before update on public.cotizaciones
  for each row execute function public.set_updated_at();

drop trigger if exists trg_codigo on public.cotizaciones;
create trigger trg_codigo before insert on public.cotizaciones
  for each row execute function public.asignar_codigo('COT', 'public.seq_cotizaciones', 4);

drop trigger if exists trg_vincular on public.cotizaciones;
create trigger trg_vincular before insert or update of cliente_nombre on public.cotizaciones
  for each row execute function public.vincular_cliente();

drop trigger if exists trg_auditoria on public.cotizaciones;
create trigger trg_auditoria after insert or update or delete on public.cotizaciones
  for each row execute function public.fn_auditar();

-- 5. Seguridad: RLS con una política por acción, ligada al permiso del módulo.
alter table public.cotizaciones         enable row level security;
alter table public.detalle_cotizaciones enable row level security;

drop policy if exists cotizaciones_select on public.cotizaciones;
create policy cotizaciones_select on public.cotizaciones for select to authenticated
  using ((select public.tiene_permiso('cotizaciones', 'ver')));
drop policy if exists cotizaciones_insert on public.cotizaciones;
create policy cotizaciones_insert on public.cotizaciones for insert to authenticated
  with check ((select public.tiene_permiso('cotizaciones', 'crear')));
drop policy if exists cotizaciones_update on public.cotizaciones;
create policy cotizaciones_update on public.cotizaciones for update to authenticated
  using ((select public.tiene_permiso('cotizaciones', 'editar')))
  with check ((select public.tiene_permiso('cotizaciones', 'editar')));
drop policy if exists cotizaciones_delete on public.cotizaciones;
create policy cotizaciones_delete on public.cotizaciones for delete to authenticated
  using ((select public.tiene_permiso('cotizaciones', 'eliminar')));

drop policy if exists detalle_cotizaciones_select on public.detalle_cotizaciones;
create policy detalle_cotizaciones_select on public.detalle_cotizaciones for select to authenticated
  using ((select public.tiene_permiso('cotizaciones', 'ver')));
drop policy if exists detalle_cotizaciones_insert on public.detalle_cotizaciones;
create policy detalle_cotizaciones_insert on public.detalle_cotizaciones for insert to authenticated
  with check ((select public.tiene_permiso('cotizaciones', 'crear')));
drop policy if exists detalle_cotizaciones_update on public.detalle_cotizaciones;
create policy detalle_cotizaciones_update on public.detalle_cotizaciones for update to authenticated
  using ((select public.tiene_permiso('cotizaciones', 'editar')))
  with check ((select public.tiene_permiso('cotizaciones', 'editar')));
drop policy if exists detalle_cotizaciones_delete on public.detalle_cotizaciones;
create policy detalle_cotizaciones_delete on public.detalle_cotizaciones for delete to authenticated
  using ((select public.tiene_permiso('cotizaciones', 'eliminar')));

-- El rol anónimo (visitante sin sesión) no toca estas tablas.
revoke all on public.cotizaciones, public.detalle_cotizaciones from anon;
revoke all on sequence public.seq_cotizaciones from anon;

-- 6. Permisos del módulo y matriz por rol.
insert into public.permisos (modulo, accion)
select 'cotizaciones', a from unnest(array['ver','crear','editar','eliminar']) as a
on conflict (modulo, accion) do nothing;

with matriz(rol, modulo, acciones) as (values
  ('Administrador','cotizaciones', array['ver','crear','editar','eliminar']),
  ('Gerente',      'cotizaciones', array['ver','crear','editar','eliminar']),
  ('Operador',     'cotizaciones', array['ver','crear','editar','eliminar']),
  ('Vendedor',     'cotizaciones', array['ver','crear','editar'])
)
insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
from matriz m
join public.roles r on r.nombre = m.rol
join public.permisos p on p.modulo = m.modulo and p.accion = any (m.acciones)
on conflict do nothing;

-- >>> supabase/migrations/20261013000000_catalogo_proveedores.sql
-- =============================================================================
-- ERP EnterpriseCloud · Catálogo de productos por proveedor
-- Modelo correcto: el catálogo del proveedor vive solo (lo que ofrece). La
-- compra lo trae y, SOLO al completarse, ingresa a MI inventario (crea el
-- producto si es nuevo o suma stock si ya existe). El inventario ya no se
-- vincula al proveedor.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- Requiere haber ejecutado antes las migraciones de productos (proveedor_id y
-- precio) para rescatar los vínculos ya cargados; si no existen, se omite el
-- rescate y todo lo demás se crea igual.
-- =============================================================================

-- 1. Secuencia para los códigos del catálogo (PP-0001, PP-0002, ...).
create sequence if not exists public.seq_catalogo as bigint;

-- 2. Catálogo: lo que ofrece cada proveedor, independiente de mi inventario.
--    producto_id apunta a MI producto equivalente una vez que ingresó (null =
--    aún no lo tengo en inventario; se vincula solo al completar la compra).
create table if not exists public.proveedor_productos (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null unique,
  proveedor_id uuid not null references public.proveedores(id) on delete cascade,
  nombre       text not null,
  detalle      text not null default '',
  costo        numeric(14,2) not null default 0 check (costo >= 0),
  producto_id  uuid references public.productos(id) on delete set null,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (proveedor_id, nombre)
);
create index if not exists proveedor_productos_proveedor_idx on public.proveedor_productos (proveedor_id);

-- 3. Triggers de utilidad (misma convención que el resto de módulos).
drop trigger if exists trg_updated_at on public.proveedor_productos;
create trigger trg_updated_at before update on public.proveedor_productos
  for each row execute function public.set_updated_at();

drop trigger if exists trg_codigo on public.proveedor_productos;
create trigger trg_codigo before insert on public.proveedor_productos
  for each row execute function public.asignar_codigo('PP', 'public.seq_catalogo', 4);

drop trigger if exists trg_auditoria on public.proveedor_productos;
create trigger trg_auditoria after insert or update or delete on public.proveedor_productos
  for each row execute function public.fn_auditar();

-- 4. Rescate (solo si existen las columnas viejas): convierte los vínculos
--    producto→proveedor y las líneas de compras de prueba en catálogo.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'productos' and column_name = 'proveedor_id') then
    -- 4a. Cada producto vinculado pasa a ser oferta de su proveedor.
    insert into public.proveedor_productos (proveedor_id, nombre, detalle, costo, producto_id)
    select p.proveedor_id, p.nombre, p.detalle, coalesce(p.precio, 0), p.id
      from public.productos p
     where p.proveedor_id is not null
    on conflict (proveedor_id, nombre) do nothing;

    -- 4b. Líneas de compras de prueba que referencian mi inventario.
    insert into public.proveedor_productos (proveedor_id, nombre, detalle, costo, producto_id)
    select distinct c.proveedor_id, p.nombre, p.detalle, d.costo_unitario, p.id
      from public.detalle_compras d
      join public.compras c   on c.id = d.compra_id
      join public.productos p on p.id = d.producto_id
     where c.proveedor_id is not null and d.producto_id is not null
    on conflict (proveedor_id, nombre) do nothing;

    -- 4c. Re-apunta esas líneas al catálogo recién creado.
    update public.detalle_compras d set producto_id = pp.id
      from public.compras c, public.productos p, public.proveedor_productos pp
     where d.compra_id = c.id and d.producto_id = p.id
       and pp.proveedor_id = c.proveedor_id and pp.nombre = p.nombre;
  end if;
end $$;

-- 5. Huérfanas a null (incluye pruebas viejas sin proveedor atribuible).
update public.detalle_compras set producto_id = null
 where producto_id is not null
   and not exists (select 1 from public.proveedor_productos pp where pp.id = detalle_compras.producto_id);

-- 6. La línea de compra ahora referencia al CATÁLOGO, no a mi inventario.
alter table public.detalle_compras rename column producto_id to proveedor_producto_id;

do $$
declare v_constraint name;
begin
  -- Suelta la FK vieja hacia productos (si existe).
  select conname into v_constraint
    from pg_constraint
   where conrelid = 'public.detalle_compras'::regclass
     and confrelid = 'public.productos'::regclass
   limit 1;
  if v_constraint is not null then
    execute format('alter table public.detalle_compras drop constraint %I', v_constraint);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'detalle_compras_catalogo_fkey') then
    alter table public.detalle_compras add constraint detalle_compras_catalogo_fkey
      foreign key (proveedor_producto_id) references public.proveedor_productos(id) on delete set null;
  end if;
end $$;

-- 7. El inventario deja de depender del proveedor.
drop index if exists public.productos_proveedor_idx;
alter table public.productos drop column if exists proveedor_id;

-- 8. Seguridad: el catálogo se gobierna con los permisos de COMPRAS
--    (quien compra gestiona el catálogo; el detalle hereda el mismo módulo).
alter table public.proveedor_productos enable row level security;

drop policy if exists proveedor_productos_select on public.proveedor_productos;
create policy proveedor_productos_select on public.proveedor_productos for select to authenticated
  using ((select public.tiene_permiso('compras', 'ver')));
drop policy if exists proveedor_productos_insert on public.proveedor_productos;
create policy proveedor_productos_insert on public.proveedor_productos for insert to authenticated
  with check ((select public.tiene_permiso('compras', 'crear')));
drop policy if exists proveedor_productos_update on public.proveedor_productos;
create policy proveedor_productos_update on public.proveedor_productos for update to authenticated
  using ((select public.tiene_permiso('compras', 'editar')))
  with check ((select public.tiene_permiso('compras', 'editar')));
drop policy if exists proveedor_productos_delete on public.proveedor_productos;
create policy proveedor_productos_delete on public.proveedor_productos for delete to authenticated
  using ((select public.tiene_permiso('compras', 'eliminar')));

-- El rol anónimo (visitante sin sesión) no toca esta tabla.
revoke all on public.proveedor_productos from anon;
revoke all on sequence public.seq_catalogo from anon;

-- >>> supabase/migrations/20261014000000_fases_compra.sql
-- =============================================================================
-- ERP EnterpriseCloud · Órdenes de compra por fases
-- La orden avanza: Solicitud → Orden → Recepción → Factura → Pagada.
-- El stock ingresa a almacén (+ kardex) SOLO al llegar a Recepción, donde se
-- registra el comprobante del proveedor. La CxP se completa al pagar.
-- Además guarda fecha límite y comprobante (tipo + número) de la recepción.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

-- 1. Nuevos estados de fase (superset: no afecta ningún dato ya guardado).
do $$
declare v_constraint name;
begin
  select conname into v_constraint
    from pg_constraint
   where contypid = 'public.estado_registro'::regtype and contype = 'c'
   limit 1;
  if v_constraint is not null then
    execute format('alter domain public.estado_registro drop constraint %I', v_constraint);
  end if;
  alter domain public.estado_registro add check (value in (
    'Activo','Bajo stock','Completada','Crítico','En curso','En tránsito',
    'Estable','Pendiente','Vigente','Aprobada','Rechazada','Vencida',
    'Solicitud','Orden','Recepción','Factura','Pagada'));
end $$;

-- 2. Columnas de seguimiento en compras.
alter table public.compras add column if not exists fecha_limite date;
alter table public.compras add column if not exists comprobante_tipo text;
alter table public.compras add column if not exists comprobante_numero text;
comment on column public.compras.fecha_limite is 'Fecha límite o aproximada para concretar la compra.';
comment on column public.compras.comprobante_tipo is 'Comprobante entregado en la recepción: Factura, Boleta, Guía de Remisión o Nota de Venta.';
comment on column public.compras.comprobante_numero is 'Número del comprobante de recepción.';

-- 3. Mapeo de estados viejos a fases (solo toca los 4 valores anteriores).
update public.compras set estado = 'Solicitud' where estado = 'Pendiente';
update public.compras set estado = 'Orden'      where estado = 'En curso';
update public.compras set estado = 'Recepción'  where estado = 'En tránsito';
update public.compras set estado = 'Factura'    where estado = 'Completada';

-- >>> supabase/migrations/20261015000000_proveedor_ruc.sql
-- =============================================================================
-- ERP EnterpriseCloud · RUC del proveedor
-- Cada orden de compra muestra la ficha de la empresa (RUC, razón social,
-- contacto) para verificar que existe en el registro antes de aprobar fases.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

alter table public.proveedores add column if not exists ruc text;

-- RUC único por empresa (los null no cuentan: varias filas sin RUC conviven).
create unique index if not exists proveedores_ruc_uidx
  on public.proveedores (ruc) where ruc is not null;

comment on column public.proveedores.ruc is 'RUC de 11 dígitos de la empresa proveedora. Se muestra en cada orden de compra para verificarla.';

-- >>> supabase/migrations/20261016000000_perfil_avatar.sql
-- =============================================================================
-- ERP EnterpriseCloud · Foto de perfil del usuario
-- Agrega la columna avatar_url a public.usuarios para guardar la foto de
-- perfil (data URL optimizada desde la aplicación, sin Storage adicional).
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

alter table public.usuarios add column if not exists avatar_url text;

comment on column public.usuarios.avatar_url is 'Foto de perfil del usuario (data URL o URL pública). NULL = sin foto, se muestran las iniciales.';

-- >>> supabase/migrations/20261017000000_cliente_documento.sql
-- =============================================================================
-- ERP EnterpriseCloud · Documento del cliente (DNI / RUC)
-- Cada cliente puede identificarse con DNI (persona, vía RENIEC) o RUC
-- (empresa, vía SUNAT). La aplicación autocompleta razón social y dirección
-- desde esas consultas y guarda el documento para reutilizarlo en ventas.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

alter table public.clientes add column if not exists tipo_doc text;
alter table public.clientes add column if not exists documento text;

comment on column public.clientes.tipo_doc is 'Tipo de documento del cliente: DNI o RUC. NULL = sin registrar.';
comment on column public.clientes.documento is 'Número de documento del cliente (8 dígitos DNI u 11 dígitos RUC). NULL = sin registrar.';

-- Las políticas RLS existentes del módulo clientes ya cubren las columnas.

-- >>> supabase/migrations/20261018000000_proveedor_contacto.sql
-- =============================================================================
-- ERP EnterpriseCloud · Contacto del proveedor
-- Cada proveedor guarda dirección, correo, teléfono y condición de pago para
-- coordinar órdenes sin buscar los datos en otro lado. Todo es opcional.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

alter table public.proveedores add column if not exists direccion text;
alter table public.proveedores add column if not exists correo text;
alter table public.proveedores add column if not exists telefono text;
alter table public.proveedores add column if not exists forma_pago text;

comment on column public.proveedores.direccion is 'Dirección fiscal o de entrega del proveedor. Opcional.';
comment on column public.proveedores.correo is 'Correo de contacto del proveedor. Opcional.';
comment on column public.proveedores.telefono is 'Teléfono de contacto del proveedor. Opcional.';
comment on column public.proveedores.forma_pago is 'Condición de pago habitual: Contado, Transferencia bancaria, Yape / Plin, Crédito 30 días, Crédito 60 días. Opcional.';

-- Las políticas RLS existentes del módulo proveedores ya cubren las columnas.

-- >>> supabase/migrations/20261019000000_permisos_authenticated.sql
-- =============================================================================
-- ERP EnterpriseCloud · Permisos base del rol authenticated
-- Las políticas RLS autorizan por acción y rol, pero PostgREST además exige
-- privilegios a nivel de tabla. Sin estos GRANT, todo devuelve 403 aunque
-- las políticas sean correctas (pasa si "Exponer automáticamente nuevas
-- tablas" está desactivado, como se recomienda).
-- RLS sigue mandando: esto no abre nada que las políticas no permitan.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni romper nada.
-- =============================================================================

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- >>> supabase/migrations/20261020000000_compra_recibida.sql
-- =============================================================================
-- ERP EnterpriseCloud · Estado Recibida en órdenes de compra
-- Flujo en dos pasos (como la referencia): Recibir marca la orden como
-- Recibida SIN mover stock; Registrar ingreso (Ingreso al Kardex) la pasa a
-- Recepción y aplica lo comprado al inventario (+ kardex).
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

-- 1. Nuevo estado (superset: no afecta ningún dato ya guardado).
do $$
declare v_constraint name;
begin
  select conname into v_constraint
    from pg_constraint
   where contypid = 'public.estado_registro'::regtype and contype = 'c'
   limit 1;
  if v_constraint is not null then
    execute format('alter domain public.estado_registro drop constraint %I', v_constraint);
  end if;
  alter domain public.estado_registro add check (value in (
    'Activo','Bajo stock','Completada','Crítico','En curso','En tránsito',
    'Estable','Pendiente','Vigente','Aprobada','Rechazada','Vencida',
    'Solicitud','Orden','Recibida','Recepción','Factura','Pagada'));
end $$;

-- >>> supabase/migrations/20261021000000_centro_mantenimiento.sql
-- =============================================================================
-- ERP EnterpriseCloud · Centro de Mantenimiento (fase 1)
-- 1. Turnos de caja para apertura y cierre con descuadre (Tesorería -> Caja).
-- 2. Medio de pago en cuentas (Efectivo, Yape, Plin, Tarjeta, Transferencia).
-- 3. Descuento % en ventas (solo roles con acceso a finanzas).
-- 4. Catálogo de métodos de pago gestionable.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

-- 1. Turnos de caja.
create table if not exists public.caja_turnos (
  id                uuid primary key default gen_random_uuid(),
  abierto_por_email text,
  abierto_en        timestamptz not null default now(),
  monto_inicial     numeric(14,2) not null default 0 check (monto_inicial >= 0),
  estado            text not null default 'Abierto' check (estado in ('Abierto', 'Cerrado')),
  cerrado_en        timestamptz,
  conteo            jsonb not null default '{}',
  notas             text not null default ''
);
alter table public.caja_turnos enable row level security;
drop policy if exists caja_turnos_select on public.caja_turnos;
create policy caja_turnos_select on public.caja_turnos for select to authenticated
  using ((select public.tiene_permiso('finanzas', 'ver')));
drop policy if exists caja_turnos_insert on public.caja_turnos;
create policy caja_turnos_insert on public.caja_turnos for insert to authenticated
  with check ((select public.tiene_permiso('finanzas', 'crear')));
drop policy if exists caja_turnos_update on public.caja_turnos;
create policy caja_turnos_update on public.caja_turnos for update to authenticated
  using ((select public.tiene_permiso('finanzas', 'editar')))
  with check ((select public.tiene_permiso('finanzas', 'editar')));

-- 2. Medio de pago en la cuenta (nulo = Efectivo / registro antiguo).
alter table public.pagos add column if not exists medio_pago text;

-- 3. Descuento % en la venta (0-100, se aplica al subtotal de productos).
alter table public.ventas add column if not exists descuento numeric(6,2) not null default 0
  check (descuento >= 0 and descuento <= 100);

-- 4. Catálogo de métodos de pago.
create table if not exists public.metodos_pago (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.metodos_pago (nombre)
values ('Efectivo'), ('Yape'), ('Plin'), ('Tarjeta'), ('Transferencia bancaria')
on conflict (nombre) do nothing;
alter table public.metodos_pago enable row level security;
drop policy if exists metodos_pago_select on public.metodos_pago;
create policy metodos_pago_select on public.metodos_pago for select to authenticated
  using ((select public.tiene_permiso('finanzas', 'ver')));
drop policy if exists metodos_pago_insert on public.metodos_pago;
create policy metodos_pago_insert on public.metodos_pago for insert to authenticated
  with check ((select public.tiene_permiso('finanzas', 'crear')));
drop policy if exists metodos_pago_update on public.metodos_pago;
create policy metodos_pago_update on public.metodos_pago for update to authenticated
  using ((select public.tiene_permiso('finanzas', 'editar')))
  with check ((select public.tiene_permiso('finanzas', 'editar')));

-- 5. Privilegios para las tablas nuevas (y futuras) del esquema público.
grant select, insert, update, delete on public.caja_turnos to authenticated;
grant select, insert, update, delete on public.metodos_pago to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;


-- >>> supabase/migrations/20261022000000_monedas.sql
-- =============================================================================
-- ERP EnterpriseCloud · Catálogo de tipos de moneda
-- La moneda base es el sol peruano (PEN). Se pueden agregar otras y
-- desactivar las que fallen, igual que los métodos de pago.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

create table if not exists public.monedas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  codigo     text not null unique,
  simbolo    text not null default 'S/',
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.monedas (nombre, codigo, simbolo)
values ('Sol peruano', 'PEN', 'S/')
on conflict (codigo) do nothing;
alter table public.monedas enable row level security;
drop policy if exists monedas_select on public.monedas;
create policy monedas_select on public.monedas for select to authenticated
  using ((select public.tiene_permiso('finanzas', 'ver')));
drop policy if exists monedas_insert on public.monedas;
create policy monedas_insert on public.monedas for insert to authenticated
  with check ((select public.tiene_permiso('finanzas', 'crear')));
drop policy if exists monedas_update on public.monedas;
create policy monedas_update on public.monedas for update to authenticated
  using ((select public.tiene_permiso('finanzas', 'editar')))
  with check ((select public.tiene_permiso('finanzas', 'editar')));

grant select, insert, update, delete on public.monedas to authenticated;


-- >>> supabase/migrations/20261023000000_permisos_cuentas.sql
-- =============================================================================
-- ERP EnterpriseCloud · Cuentas y permisos
-- 1. Rol Básico (ver + crear en módulos operativos): es el rol por defecto
--    de toda cuenta nueva (antes era Operador, demasiado amplio).
-- 2. La cuenta 1604251@senati.pe queda como administradora permanente:
--    nadie (ni ella misma por error) puede quitarle el rol ni desactivarla.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

-- 1. Rol Básico: solo consultar y crear en los módulos de operación.
insert into public.roles (nombre, descripcion)
values ('Básico', 'Rol por defecto: solo consultar y crear en ventas, compras, inventario, clientes y proveedores')
on conflict (nombre) do nothing;

insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
  from public.roles r
  join public.permisos p on p.modulo in ('ventas', 'compras', 'inventario', 'clientes', 'proveedores')
                       and p.accion in ('ver', 'crear')
 where r.nombre = 'Básico'
on conflict do nothing;

-- 2. Las cuentas nuevas nacen con rol Básico (ya no Operador).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_primero boolean;
  v_rol     uuid;
begin
  perform pg_advisory_xact_lock(hashtext('erp_enterprisecloud_primer_usuario'));
  select not exists (select 1 from public.usuarios) into v_primero;
  select id into v_rol from public.roles
   where nombre = case when v_primero then 'Administrador' else 'Básico' end;

  insert into public.usuarios (id, nombre, email, rol_id, ultimo_acceso)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''),
             nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Usuario'),
    new.email, v_rol, new.last_sign_in_at)
  on conflict (id) do nothing;
  return new;
end $$;

-- 3. Cuenta administradora permanente.
do $$
declare v_admin uuid;
begin
  select id into v_admin from public.roles where nombre = 'Administrador';
  update public.usuarios
     set rol_id = v_admin, activo = true, updated_at = now()
   where lower(email) = '1604251@senati.pe';
end $$;

create or replace function public.proteger_admin_permanente()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_admin uuid;
begin
  select id into v_admin from public.roles where nombre = 'Administrador';
  if lower(old.email) = '1604251@senati.pe'
     and (new.rol_id is distinct from v_admin or new.activo is distinct from true) then
    raise exception 'La cuenta administradora principal no puede dejar de ser administradora ni desactivarse'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_admin_permanente on public.usuarios;
create trigger trg_admin_permanente before update on public.usuarios
  for each row execute function public.proteger_admin_permanente();

revoke execute on function public.proteger_admin_permanente()
  from public, anon, authenticated;


-- >>> supabase/migrations/20261024000000_quitar_roles.sql
-- =============================================================================
-- ERP EnterpriseCloud · Retiro de roles sin uso
-- Se eliminan Almacenero, Auditor y Contador. Las cuentas que los tuvieran
-- pasan al rol Básico (o a Operador si Básico aún no existe).
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

do $$
declare v_destino uuid;
begin
  select id into v_destino from public.roles where nombre = 'Básico';
  if v_destino is null then
    select id into v_destino from public.roles where nombre = 'Operador';
  end if;
  if v_destino is not null then
    update public.usuarios
       set rol_id = v_destino, updated_at = now()
     where rol_id in (select id from public.roles where nombre in ('Almacenero', 'Auditor', 'Contador'));
  end if;
  delete from public.rol_permisos
   where rol_id in (select id from public.roles where nombre in ('Almacenero', 'Auditor', 'Contador'));
  delete from public.roles
   where nombre in ('Almacenero', 'Auditor', 'Contador');
end $$;

-- >>> supabase/migrations/20261025000000_venta_medio_pago.sql
-- =============================================================================
-- ERP EnterpriseCloud · Medio de pago en ventas
-- La venta guarda con qué medio pagará el cliente (del catálogo de métodos).
-- Al cobrar en Tesorería se propone ese medio por defecto.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

alter table public.ventas add column if not exists medio_pago text;

-- >>> supabase/migrations/20261026000000_yape_qr.sql
-- QR de Yape: se guarda en configuracion (codigo YAPE_QR).
-- Los usuarios de ventas/finanzas pueden leer exclusivamente esa configuración.
-- La escritura conserva los permisos de configuración existentes.

drop policy if exists configuracion_yape_select on public.configuracion;
create policy configuracion_yape_select on public.configuracion
  for select to authenticated
  using (
    codigo = 'YAPE_QR'
    and (
      (select public.tiene_permiso('ventas', 'ver'))
      or (select public.tiene_permiso('finanzas', 'ver'))
    )
  );

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
  ('Operador',      'Rol por defecto: opera los módulos de negocio'),
  ('Vendedor',      'Ventas y clientes'),
  ('Almacenero',    'Inventario y recepción de compras'),
  ('Contador',      'Finanzas, reportes y consulta comercial'),
  ('Auditor',       'Solo lectura, incluye auditoría')
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
  -- Almacenero
  ('Almacenero','inventario',  array['ver','crear','editar']),
  ('Almacenero','compras',     array['ver','crear','editar']),
  ('Almacenero','proveedores', array['ver']),
  ('Almacenero','documentos',  array['ver','crear']),
  -- Contador
  ('Contador','finanzas',   array['ver','crear','editar','eliminar']),
  ('Contador','ventas',     array['ver']),
  ('Contador','compras',    array['ver']),
  ('Contador','clientes',   array['ver']),
  ('Contador','proveedores',array['ver']),
  ('Contador','reportes',   array['ver','crear','editar']),
  ('Contador','documentos', array['ver','crear']),
  -- Auditor: solo lectura
  ('Auditor','ventas',array['ver']), ('Auditor','compras',array['ver']),
  ('Auditor','inventario',array['ver']), ('Auditor','clientes',array['ver']),
  ('Auditor','proveedores',array['ver']), ('Auditor','finanzas',array['ver']),
  ('Auditor','documentos',array['ver']), ('Auditor','reportes',array['ver']),
  ('Auditor','configuracion',array['ver']), ('Auditor','auditoria',array['ver'])
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
   where nombre = case when v_primero then 'Administrador' else 'Operador' end;

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

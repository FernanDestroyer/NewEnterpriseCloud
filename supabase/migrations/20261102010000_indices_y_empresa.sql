-- Índices recomendados por el asesor y ficha de empresa estructurada.
begin;
create index if not exists clientes_created_by_idx on public.clientes (created_by);
create index if not exists compras_created_by_idx on public.compras (created_by);
create index if not exists configuracion_created_by_idx on public.configuracion (created_by);
create index if not exists cotizaciones_created_by_idx on public.cotizaciones (created_by);
create index if not exists detalle_compras_proveedor_producto_idx on public.detalle_compras (proveedor_producto_id);
create index if not exists detalle_cotizaciones_producto_idx on public.detalle_cotizaciones (producto_id);
create index if not exists detalle_ventas_producto_idx on public.detalle_ventas (producto_id);
create index if not exists documentos_created_by_idx on public.documentos (created_by);
create index if not exists inventarios_almacen_idx on public.inventarios (almacen_id);
create index if not exists movimientos_inventario_almacen_idx on public.movimientos_inventario (almacen_id);
create index if not exists movimientos_inventario_usuario_idx on public.movimientos_inventario (usuario_id);
create index if not exists pagos_compra_idx on public.pagos (compra_id);
create index if not exists pagos_created_by_idx on public.pagos (created_by);
create index if not exists pagos_venta_idx on public.pagos (venta_id);
create index if not exists productos_created_by_idx on public.productos (created_by);
create index if not exists proveedor_productos_created_by_idx on public.proveedor_productos (created_by);
create index if not exists proveedor_productos_producto_idx on public.proveedor_productos (producto_id);
create index if not exists proveedores_created_by_idx on public.proveedores (created_by);
create index if not exists reportes_created_by_idx on public.reportes (created_by);
create index if not exists rol_permisos_permiso_idx on public.rol_permisos (permiso_id);
create index if not exists usuario_permisos_actualizado_por_idx on public.usuario_permisos (actualizado_por);
create index if not exists usuario_permisos_permiso_idx on public.usuario_permisos (permiso_id);
create index if not exists ventas_created_by_idx on public.ventas (created_by);

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
  estado text not null default 'Activo' check (estado in ('Activo', 'Inactivo')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);
create unique index if not exists empresas_una_principal_uidx on public.empresas (es_principal) where es_principal;
create index if not exists empresas_moneda_base_idx on public.empresas (moneda_base_id);
create index if not exists empresas_created_by_idx on public.empresas (created_by);
alter table public.empresas enable row level security;
revoke all on table public.empresas from public, anon;
grant select, insert, update on table public.empresas to authenticated;
drop policy if exists empresas_select on public.empresas;
drop policy if exists empresas_insert on public.empresas;
drop policy if exists empresas_update on public.empresas;
create policy empresas_select on public.empresas for select to authenticated
  using ((select app_private._usuario_activo()));
create policy empresas_insert on public.empresas for insert to authenticated
  with check ((select app_private._tiene_permiso('configuracion', 'crear')));
create policy empresas_update on public.empresas for update to authenticated
  using ((select app_private._tiene_permiso('configuracion', 'editar')))
  with check ((select app_private._tiene_permiso('configuracion', 'editar')));
drop trigger if exists empresas_set_updated_at on public.empresas;
create trigger empresas_set_updated_at before update on public.empresas
  for each row execute function public.set_updated_at();

-- Migra la ficha antigua si existe; conserva la fila original como respaldo.
with legacy as (
  select c.id, c.nombre, c.created_by, c.created_at, c.updated_at,
    case when pg_catalog.pg_input_is_valid(c.detalle, 'jsonb') then c.detalle::jsonb else '{}'::jsonb end as profile
  from public.configuracion c where c.codigo = 'EMPRESA'
), candidate as (
  select * from legacy where not exists (
    select 1 from public.empresas e where e.es_principal or e.codigo = 'PRINCIPAL'
  )
)
insert into public.empresas (id, codigo, razon_social, ruc, direccion_fiscal, telefono, email, es_principal, estado, created_by, created_at, updated_at)
select id, 'PRINCIPAL', nombre, nullif(profile ->> 'ruc', ''), nullif(profile ->> 'direccion', ''),
  nullif(profile ->> 'telefono', ''), nullif(profile ->> 'email', ''), true, 'Activo', created_by, created_at, updated_at
from candidate on conflict (codigo) do nothing;
commit;

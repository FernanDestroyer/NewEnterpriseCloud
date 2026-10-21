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

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

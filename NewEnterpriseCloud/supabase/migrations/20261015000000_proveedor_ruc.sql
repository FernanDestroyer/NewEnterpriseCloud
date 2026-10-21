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

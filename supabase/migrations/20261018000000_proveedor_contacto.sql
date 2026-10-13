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

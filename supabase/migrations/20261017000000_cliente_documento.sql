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

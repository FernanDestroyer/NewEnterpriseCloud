-- =============================================================================
-- ERP EnterpriseCloud · Medio de pago en ventas
-- La venta guarda con qué medio pagará el cliente (del catálogo de métodos).
-- Al cobrar en Tesorería se propone ese medio por defecto.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

alter table public.ventas add column if not exists medio_pago text;

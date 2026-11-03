-- =============================================================================
-- ERP EnterpriseCloud · Módulo 06 Logística y Transporte · 6.3 Seguimiento, entrega y devoluciones
--
-- Agrega a los despachos la línea de tiempo del seguimiento (salida a ruta, entregas, reingresos,
-- cierre). El resultado de cada parada (entregada / parcial / no entregada y su devolución) vive
-- dentro de la columna paradas (jsonb) que ya existe, así que no hace falta otra tabla.
-- Requiere haber aplicado antes 20261104010000_despachos.sql.
-- La bitácora (trigger fn_auditar) ya registra cada cambio. Es idempotente.
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- =============================================================================
begin;

alter table public.despachos
  add column if not exists eventos jsonb not null default '[]'::jsonb;

alter table public.despachos drop constraint if exists despachos_eventos_array;
alter table public.despachos
  add constraint despachos_eventos_array check (jsonb_typeof(eventos) = 'array');

commit;

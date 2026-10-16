-- =============================================================================
-- ERP EnterpriseCloud · Limpieza operativa selectiva
-- Elimina SOLO los datos de: compras, kardex, ventas, movimientos, tesorería y caja.
-- NO toca: clientes, proveedores, productos (catálogo), cotizaciones, usuarios,
-- roles, almacenes, categorías, métodos de pago, monedas, configuración ni reportes.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Se ejecuta como postgres (bypasea RLS). Es irreversible: descarga antes tu
-- respaldo desde Mantenimiento -> Descargar respaldo.
-- =============================================================================

BEGIN;

-- 1. Detalles (hijos primero por seguridad, aunque hay CASCADE)
DELETE FROM public.detalle_ventas;
DELETE FROM public.detalle_compras;

-- 2. Tesorería (pagos/CxC-CxP). Tiene FK SET NULL a ventas/compras, se limpia aparte.
DELETE FROM public.pagos;

-- 3. Cabeceras operativas
DELETE FROM public.ventas;
DELETE FROM public.compras;

-- 4. Kardex
-- 4a. Movimientos de kardex (histórico de entradas/salidas)
DELETE FROM public.movimientos_inventario;
-- 4b. Existencias por almacén (kardex actual)
DELETE FROM public.inventarios;

-- 5. Caja (turnos de apertura/cierre)
DELETE FROM public.caja_turnos;

-- 6. Coherencia: si el kardex queda vacío, el stock global no puede quedar con saldos
--    huérfanos sin movimientos que lo respalden. Se deja en 0 para reiniciar limpio.
--    Si quieres conservar el stock actual de productos, comenta la línea siguiente.
UPDATE public.productos SET stock = 0;

COMMIT;

-- Verificación rápida (deben salir en 0):
-- SELECT 'detalle_ventas', count(*) FROM public.detalle_ventas
-- UNION ALL SELECT 'detalle_compras', count(*) FROM public.detalle_compras
-- UNION ALL SELECT 'pagos', count(*) FROM public.pagos
-- UNION ALL SELECT 'ventas', count(*) FROM public.ventas
-- UNION ALL SELECT 'compras', count(*) FROM public.compras
-- UNION ALL SELECT 'movimientos_inventario', count(*) FROM public.movimientos_inventario
-- UNION ALL SELECT 'inventarios', count(*) FROM public.inventarios
-- UNION ALL SELECT 'caja_turnos', count(*) FROM public.caja_turnos;

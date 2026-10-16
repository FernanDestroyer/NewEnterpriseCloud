-- =============================================================================
-- ERP EnterpriseCloud · Limpieza total MENOS cuentas
-- Borra todos los datos del proyecto y conserva el acceso:
-- CONSERVA: usuarios (cuentas), roles, permisos, rol_permisos,
--            configuracion (EMPRESA/YAPE), metodos_pago, monedas.
-- ELIMINA: clientes, proveedores, productos, inventarios, movimientos,
--           ventas + detalles, compras + detalles, catálogo proveedor,
--           cotizaciones + detalles, pagos, caja_turnos, documentos, reportes,
--           categorías, almacenes, auditoría.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es irreversible: descarga antes tu respaldo (Mantenimiento -> Descargar respaldo).
-- Después recarga la app: entrarás con las mismas cuentas y todo lo demás en 0.
-- =============================================================================

BEGIN;

-- 1. Detalles (hijos primero)
DELETE FROM public.detalle_ventas;
DELETE FROM public.detalle_compras;
DELETE FROM public.detalle_cotizaciones;

-- 2. Tesorería
DELETE FROM public.pagos;

-- 3. Cabeceras comerciales
DELETE FROM public.ventas;
DELETE FROM public.compras;
DELETE FROM public.cotizaciones;

-- 4. Catálogo de proveedor (ofertas; referenciado por detalle_compras)
DELETE FROM public.proveedor_productos;

-- 5. Kardex
DELETE FROM public.movimientos_inventario;
DELETE FROM public.inventarios;

-- 6. Maestros comerciales
DELETE FROM public.productos;
DELETE FROM public.clientes;
DELETE FROM public.proveedores;

-- 7. Maestros de apoyo
DELETE FROM public.categorias;
DELETE FROM public.almacenes;

-- 8. Documentos y reportes
DELETE FROM public.documentos;
DELETE FROM public.reportes;

-- 9. Caja
DELETE FROM public.caja_turnos;

-- 10. Auditoría (historial de altas/cambios/bajas)
DELETE FROM public.auditoria;

COMMIT;

-- Si quieres un cero ABSOLUTO (solo cuentas y roles), ejecuta además:
-- DELETE FROM public.configuracion;
-- DELETE FROM public.metodos_pago;
-- DELETE FROM public.monedas;
-- (Tendrás que reconfigurar empresa, Yape, métodos y moneda.)

-- Verificación (todo debe salir en 0, usuarios debe conservar tu N° de cuentas):
-- SELECT 'ventas', count(*) FROM public.ventas
-- UNION ALL SELECT 'compras', count(*) FROM public.compras
-- UNION ALL SELECT 'cotizaciones', count(*) FROM public.cotizaciones
-- UNION ALL SELECT 'productos', count(*) FROM public.productos
-- UNION ALL SELECT 'clientes', count(*) FROM public.clientes
-- UNION ALL SELECT 'proveedores', count(*) FROM public.proveedores
-- UNION ALL SELECT 'pagos', count(*) FROM public.pagos
-- UNION ALL SELECT 'caja_turnos', count(*) FROM public.caja_turnos
-- UNION ALL SELECT 'movimientos_inventario', count(*) FROM public.movimientos_inventario
-- UNION ALL SELECT 'inventarios', count(*) FROM public.inventarios
-- UNION ALL SELECT 'usuarios (se conservan)', count(*) FROM public.usuarios;

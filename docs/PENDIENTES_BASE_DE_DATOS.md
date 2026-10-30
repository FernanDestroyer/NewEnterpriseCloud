# Pendientes que requieren base de datos

Trabajo diferido porque la etapa actual se limita a código (sin cambios en Supabase).

## Seguridad y Auditoría
- **Registrar intentos denegados y operaciones fallidas.** Los triggers de `auditoria` solo se activan cuando un dato cambia, así que un rechazo no deja rastro. Los usuarios autenticados no pueden insertar en `auditoria` (correcto). Hace falta una función del servidor que registre esos eventos, o ampliar las funciones RPC existentes para que lo hagan antes de rechazar.
- Después de implementarlo, mostrar el resultado (exitoso / denegado / fallido) como filtro en `/auditoria`.

## Otros módulos de esta etapa
- Logística y Transporte y la definición/asignación de metas necesitan tablas propias y permisos nuevos en `permisos`. Hasta entonces se trabaja detrás de una interfaz de datos intercambiable.

## Logística y Transporte — Vehículos y asignación de conductores
Hoy los datos viven en el navegador (`src/modules/logistica/storage.ts`, clave `enterprisecloud:logistica:<usuario>:*`). Para pasar a Supabase:
- **Tablas:** `vehiculos`, `conductores`, `asignaciones_vehiculo` (con `despacho_id` nulo hasta que exista la planificación de despachos).
- **Restricciones que hoy solo valida el cliente:** placa única, DNI de conductor único, y que un vehículo o un conductor no tengan dos asignaciones `programada` con horarios que se crucen (restricción de exclusión sobre el rango `desde`–`hasta`).
- **Reglas que deben repetirse en el servidor:** SOAT, revisión técnica y licencia no vencidos al fin de la asignación; vehículo y conductor activos; categoría de licencia compatible con el tipo de vehículo (regla simplificada en `rules.ts`, validar con el responsable de transporte).
- **Permisos:** filas `logistica` en `permisos` (ver, crear, editar) y asignarlas a los roles; luego cambiar solo `PERMISO_LOGISTICA` en `modules/logistica/permisos.ts` y agregar la clave a `permissionModule`.
- **Auditoría:** agregar las tablas nuevas a la lista de tablas con trigger `fn_auditar`.
- **Código:** implementar `AlmacenLogistica` con Supabase en `storage.ts` (misma interfaz) y devolver `origen: 'base-de-datos'`; el aviso «Datos guardados solo en este navegador» desaparece solo.

## Logística y Transporte — Planificación de despachos y rutas
Hoy los despachos viven en el navegador (`storage.ts`, colección `despachos`). Las ventas, clientes, zonas de reparto, almacenes y líneas de venta sí se leen de Supabase (`modules/logistica/fuentes.ts`). Para pasar a Supabase:
- **Tablas:** `despachos` (cabecera: número, fecha, prioridad, almacén, peso estimado, vehículo, conductor, ventana, estado, `asignacion_id`) y `despacho_paradas` / `despacho_parada_lineas` (ruta ordenada: `orden`, `venta_id`, dirección, zona, `producto_id`, `cantidad_vendida`, `cantidad`).
- **Numeración:** `DSP-AAAAMMDD-NN` debe salir de una secuencia en la base (hoy la calcula el cliente).
- **Restricciones que hoy solo valida el cliente:** la suma de `cantidad` por (venta, producto) en despachos no cancelados no puede superar `cantidad_vendida`; una venta no puede repetirse dentro del mismo despacho; transiciones de estado válidas (borrador → programado → en_ruta → completado; cancelado desde borrador o programado). Hacerlas por RPC (`SECURITY DEFINER`, idempotente) y no por UPDATE directo.
- **Atomicidad:** programar un despacho crea la asignación de vehículo y conductor y guarda el despacho; en la base debe ser una sola transacción (hoy el cliente compensa cancelando la asignación si falla).
- **Estados de venta despachables:** `ESTADOS_VENTA_DESPACHABLES` en `despachos.ts` (Completada, Pendiente, En curso). Confirmar con negocio; una venta rechazada nunca se despacha.
- **Stock:** el despacho no mueve inventario porque la venta ya lo descontó. Las devoluciones por entrega fallida necesitarán `devoluciones_venta` (pendiente en la pieza de seguimiento).
- **Auditoría y permisos:** igual que en Vehículos y conductores (triggers `fn_auditar` y filas `logistica` en `permisos`).

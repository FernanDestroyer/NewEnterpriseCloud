# Decisiones de Evaluación de Proveedores — Fase H

## H01 — Unidad y momento de evaluación

- La unidad de evaluación es la orden de compra, no el período ni el proveedor de forma agregada.
- Una orden es elegible cuando registra al menos una recepción y `compras.estado_recepcion` es `parcial` o `completa`.
- Se conserva una sola fila por orden. Una actualización reemplaza los tres puntajes de esa evaluación; no crea una segunda evaluación para la misma orden.
- El proveedor de la evaluación se deriva de la orden en el servidor y no lo elige el cliente.

## H02 — Criterios y escala

- Cada orden recibe tres puntajes enteros de 1 a 5; 5 representa excelente:
  - Calidad del Producto.
  - Cumplimiento de Plazos.
  - Nivel de Servicio.
- Los tres valores son obligatorios. No hay valor cero ni criterios ausentes en esta primera captura.

## H03 — Histórico y promedio consolidado

- Se conserva el detalle de puntajes por orden y proveedor.
- El promedio consolidado se calcula sobre todas las evaluaciones actuales del proveedor, con media aritmética de las tres métricas por orden y redondeo a dos decimales.
- El RPC de resumen devuelve también cantidad de evaluaciones y promedio de cada criterio. Para proveedor sin evaluaciones, la cantidad es cero y los promedios son `NULL`.
- Al editar una evaluación se actualiza la única fila de esa orden; no se mantiene una serie de versiones históricas en este primer bloque.

## Decisiones aún pendientes

- Pesos distintos por criterio, ventanas/períodos de evaluación, exclusiones, evidencia/comentarios, versionado/publicación y efectos en futuras compras no quedan definidos por H01–H03 y no se incorporan al esquema de esta entrega.
- Integrar métricas de importación, incidencias y devoluciones queda fuera de este primer bloque.

## Implementación H01–H05

La migración `20261117000000_evaluaciones_proveedor_por_orden.sql` implementa persistencia por orden, unicidad, elegibilidad transaccional, escala, permisos/RLS y consulta consolidada. El usuario confirmó su aplicación y validación remota.

## Certificación H06–H09 y cierre

El usuario probó localmente la ruta `/evaluaciones-proveedores` y su acceso desde el menú. Confirmó el filtro de órdenes elegibles, la operación del panel de captura y la presentación de promedios históricos en el comparativo con caché. La Fase H y el Módulo de Compras (Fases A–H) quedan certificados oficialmente al 100% por el usuario.

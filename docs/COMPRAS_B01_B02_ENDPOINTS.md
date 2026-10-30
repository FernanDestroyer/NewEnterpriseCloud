# Compras — inventario de escrituras y contratos candidatos (B01–B02)

Fecha: 29-10-2026. Inventario de código local; no afirma despliegue remoto.

## Escrituras actuales

| Operación | Llamador / ruta | Escrituras actuales | Observación |
|---|---|---|---|
| Crear orden normal | `RecordsContext` → `insertPurchaseWithLines` | `crear_orden_compra_operativa` | Atómica: cabecera, líneas y CxP; devuelve UUID. |
| Importar compras CSV históricas | `ModuleCsvImport` → `importPurchases` → `insertPurchaseWithLines` | `compras`, luego `pagos`; compensación de error best-effort | Solo cabecera, sin líneas/stock; crea CxP. Duplicado revisado previamente en cliente y vulnerable a carrera. |
| Crear orden histórica/manual con referencia | `insertPurchaseWithLines` | `compras`, `detalle_compras`, `pagos` | Escrituras separadas y borrado compensatorio best-effort. Incluye rutas con origen import. |
| Editar orden y líneas | `PurchaseOrderDetail` / editor → `updatePurchaseWithLines` | `compras`, DELETE/INSERT `detalle_compras`, `pagos` | No es transaccional; recepción bloquea cambios de líneas en cliente; estado `Pagada` se rechaza en cliente. D03 bloquea rediseñar reglas comerciales/financieras. |
| Marcar múltiples estados | `updateStatuses` genérico | UPDATE directo de tabla por `codigo` | Incluye compras; no hay endpoint operativo de transición ni protección de estados en este método. Revisar llamadores y permisos antes de migrar. |
| Registrar recepción | modal de recepción → `registerPurchaseReceipt` | `registrar_recepcion_compra` | RPC; líneas, almacén y clave idempotente; efecto de stock/Kardex en servidor. |
| Registrar devolución | `PurchaseReturnsPage` | `registrar_devolucion_compra` | RPC; debe conservarse su contrato actual. |
| Solicitud / oferta / adjudicación | `PurchaseSourcingPage` | `crear_solicitud_compra`, `abrir_solicitud_compra`, `registrar_oferta_compra`, `seleccionar_oferta_compra` | RPC existentes; contratos y migración local en `20261029120000_compras_solicitudes_comparativo.sql`. |
| Crear y editar CxP | `createRelatedPago`, `syncRelatedPago` | INSERT/UPDATE directo `pagos` | Se usa desde rutas de compra y venta; separar en B/C sin alterar el circuito general de Tesorería. |
| Aplicar pago y cerrar orden pagada | `registerTreasuryPayment`, después `completeLinkedDocument` | RPC `registrar_pago_parcial_en_turno`; UPDATE directo `compras.estado` | El pago es RPC, pero el cambio de estado relacionado no lo es. La transición debe coordinarse con Tesorería y D03. |
| Ajuste de stock legado | `setStock` | UPDATE directo `productos.stock` | No es una escritura de orden; inventario debe auditar su uso/permisos y no confundirlo con recepción actual por almacén. |

## Contratos de RPC (diseño, no implementación)

Regla de compatibilidad: no cambiar parámetros, tipos de retorno ni semántica de RPC desplegados. Para evolución, agregar nombres versionados nuevos; mantener fachadas actuales mientras existan clientes. Errores conservan SQLSTATE útil (`42501` permiso, `22023` entrada inválida, `23503` referencia, `23505` clave/versión conflictiva) y mensaje apto para traducir en UI.

| RPC candidato | Entrada / salida | Garantías requeridas |
|---|---|---|
| `editar_orden_compra_operativa_v1` | `compra_id`, `expected_version`, cabecera, líneas JSON, clave idempotente → JSON `{compra_id, version, codigo}` | Validación de actor, versión optimista, elegibilidad y líneas; cambios de cabecera/líneas/CxP en una transacción. Las reglas de cambio/cancelación y deuda esperan D03. |
| `importar_compra_historica_v1` | lote de documentos con clave de lote y claves por fila → JSON con creados/omitidos/fallidos por referencia | Atómico por documento (no necesariamente por archivo completo); sin inventar líneas ni stock; política explícita para CxP histórica; duplicados y reintentos deterministas. No reemplaza la futura importación comercial. |
| `transicionar_orden_compra_v1` | IDs, transición, motivo, clave idempotente → JSON con resultados por ID | Rechazo por elemento con SQLSTATE estable; actor y estado anterior/nuevo auditados; no marcar pagada fuera de Tesorería. Definir matriz de estados tras D03. |

Los nombres y formas anteriores son candidatos nuevos, no endpoints que ya existan. La RPC de creación actual (`crear_orden_compra_operativa`) devuelve UUID; las RPC actuales de solicitud/recepción/devolución no se versionan ni se alteran en este bloque.

## Decisión D03 confirmada y aplicación pendiente

El usuario confirma que la obligación nace únicamente con una recepción física o documental; antes de recibir, editar/cancelar no genera efectos en Tesorería. La migración de edición de B03–B05 implementa la edición atómica y no toca CxP. La auditoría encontró que el flujo actual aún insertaba CxP al crear una orden y que la recepción no creaba una. La corrección está preparada en `supabase/migrations/20261029220000_cxp_al_recibir_compra.sql`: versiona creación y recepción, y mantiene la fachada antigua de creación redirigida para no dejar el endpoint anterior como bypass. La recepción reconoce CxP por el valor acumulado efectivamente recibido (parciales incluidos) con IGV estándar del 18%; las cuentas históricas no se borran ni recalculan. La ruta de CSV histórico deja de originar CxP desde el cliente. Migración pendiente de ejecución manual y validación remota.

## Límites del inventario

- `updateStatuses` debe verificarse junto con todos sus llamadores antes de migrar o retirarlo.
- Las escrituras genéricas de `insertRecord` / `updateRecord` deben trazarse por formulario y permisos en el siguiente inventario de implementación; no asumir que todo cambio de estado de compra llega por el editor de detalle.
- No implementar aún RPC de edición/transición: primero se resuelve D03 y se verifica el esquema remoto, sus firmas y clientes activos.
- Importación CSV significa carga histórica de cabeceras. Importación comercial internacional es otro proceso (D01, G).

# Decisiones de Importaciones Comerciales — Fase G

## G-01 — Carpeta y órdenes

- La unidad de trabajo es una Carpeta de Importación (dossier).
- Una carpeta agrupa una o varias órdenes de compra confirmadas en moneda extranjera.
- En el esquema vigente solo existe moneda extranjera USD; esta primera entrega limita los expedientes y órdenes vinculadas a USD.
- Una orden pertenece como máximo a una carpeta a la vez. Se puede desvincular mediante RPC mientras la carpeta esté abierta.
- No se restringe que las órdenes sean de distintos proveedores; cada vínculo conserva proveedor, código y moneda de origen.
- Para este primer bloque solo se admiten órdenes `Confirmada`/`Confirmado`, con tipo de cambio confirmado y al menos una línea de producto con recepción.

## G-02 / D07 — Gastos de importación

- La carpeta admite gastos de Flete, Seguro, Arancel/Advalorem y Agente de Aduanas, más una categoría Otros.
- El expediente y el prorrateo se expresan en USD; el gasto puede capturarse en USD o PEN.
- En gastos PEN se exige el tipo de cambio snapshot en PEN por USD; normalización: `monto_USD = round(monto_PEN / tipo_cambio, 2)`. Gasto USD usa tipo de cambio 1.
- El RPC no crea cuentas por pagar ni movimientos financieros. Documentos/contrapartes, recuperabilidad tributaria y obligaciones de gasto siguen pendientes de G09/G15; no se asume tratamiento fiscal.

## G-03 — Prorrateo inicial

- Todos los gastos registrados se tratan como capitalizables para el cálculo de Landed Cost y se distribuyen por el valor bruto (`detalle_compras.total_linea`) de cada línea de producto recibible vinculada.
- Cálculo: `peso_línea = valor_línea / suma_valores`; `gasto_asignado = round(gastos_USD × peso_línea, 2)`.
- El residuo de redondeo a centavos se asigna determinísticamente a la última línea por UUID, para que la suma asignada sea exactamente igual al total de gastos.
- `costo_real_línea = valor_línea + gasto_asignado`; `costo_unitario_real = costo_real_línea / cantidad`, a 6 decimales.
- El RPC de nacionalización de este bloque (referido como G08 en la solicitud) procesa de forma atómica todas las órdenes de la carpeta, exige estado En Aduanas y que no haya recepciones previas (evita mezclar costo FOB y Landed Cost). Recibe el total pendiente de cada línea en un almacén activo.
- La recepción conserva el costo Landed en detalle de recepción y Kardex. La CxP conserva el total original de la orden/proveedor; los gastos no duplican obligaciones. La parte de costeo porción de inventario sigue sin afectar salidas históricas.
- El RPC de preview calcula costos, no persiste liquidaciones. El valor base cero es error explícito; G10–G12 aún definen liquidación persistida y valoración posterior de inventario.

## Alcance de esta entrega

Incluye G01–G09: carpeta, vínculo de órdenes, registro de gastos, tracking, prorrateo y nacionalización/recepción atómica. La recepción exige además permisos de inventario. Embarques/documentos detallados, liquidación persistida, obligaciones de gastos y valoración de inventario siguen pendientes. Cualquier escritura queda protegida por RPC, permiso, RLS e idempotencia.

## Certificación de Fase G

El usuario confirmó la aplicación remota de las migraciones `20261115000000` y `20261116000000`, probó localmente la interfaz completa de importaciones y certificó la Fase G. La nacionalización mantiene el FOB original para CxP y aplica Landed Cost a recepción/Kardex. Las mejoras explícitamente fuera del alcance entregado no bloquean la certificación.

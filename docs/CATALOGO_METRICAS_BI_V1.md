# Catálogo técnico de métricas BI V1

**Proyecto:** NewEnterprise / EnterpriseCloud  
**Corte de código:** 13 de noviembre de 2026  
**Estado:** definición de lo que el código calcula hoy; no sustituye una política contable aprobada.

## Criterios comunes

- El período se interpreta con el calendario de negocio de Perú (`America/Lima`). Los reportes de movimiento usan fecha de registro (`created_at` o `fecha`), no necesariamente fecha de aprobación, emisión, vencimiento o pago.
- Las tarjetas de ventas y compras incluyen los estados que devuelve el módulo. El total no excluye automáticamente anulaciones, borradores u otros estados; la etiqueta visible debe conservar esa advertencia hasta acordar el universo oficial.
- PEN y USD se presentan por separado en tarjetas operativas. No se convierten importes a otra moneda si el reporte no conserva un tipo de cambio aplicable.
- Saldos actuales no se filtran por el período seleccionado. No existe un snapshot histórico “a la fecha” para todas las fuentes.
- Los registros solo son visibles según los permisos y RLS de cada módulo. Las consultas descargan hasta 10 000 movimientos en los informes que tienen paginación defensiva; el detalle visual muestra hasta 200.

## Reportes operativos existentes

| Indicador | Cálculo que implementa el código | Fuente y fecha usada | Moneda / alcance | Estado técnico y limitación |
|---|---|---|---|---|
| Ventas del período | Por cada moneda, suma `max(monto, 0)` de las ventas dentro del período. | `public.ventas.monto`, filtrado por `created_at` convertido a fecha de Perú. | PEN y USD separados; no excluye estados automáticamente. | Operativo. No equivale a ventas netas contables: falta acordar anulaciones, devoluciones, notas de crédito e impuestos. |
| Compras por proveedor | Por cada moneda, suma el `monto` registrado en las órdenes del período. | `public.compras.monto`, filtrado por `created_at`. | PEN y USD separados. La tarjeta lo describe como subtotal sin IGV. | Operativo. Las órdenes no equivalen a compras recibidas ni gasto contabilizado; se deben distinguir estados, bienes y servicios antes de usarlo como KPI financiero. |
| Valor referencial de existencias | Suma `stock actual × precio de venta actual` por producto. | `public.productos.stock` y `public.productos.precio`; saldo actual. | Una sola unidad monetaria implícita en el maestro. | Solo referencia comercial; no es costo de inventario, valoración contable ni saldo histórico. |
| Valorización PEPS actual | Suma saldos PEPS por producto/almacén solo si todas las ubicaciones con stock positivo concilian con Kardex y existencias. | RPC `ec_consultar_valorizacion_peps_actual_v1`, basada en el último snapshot de `ec_kardex_valorizado` y `inventarios`. | La interfaz presenta moneda base PEN; falta validar y documentar formalmente la unidad monetaria del costo. | Parcialmente conciliada. Si existe ubicación sin costo, sin movimiento, con saldo distinto o empate temporal, se oculta el total global. La RPC mantiene RLS y permiso `inventario:ver`. |
| Cuentas por cobrar abiertas | Suma el saldo pendiente de obligaciones abiertas clasificadas como `cobrar`; los abonos registrados reducen el saldo mediante `obtener_saldos_cuentas`. | `public.pagos` y RPC de saldos. El indicador es actual, no por período. | Agrupado por PEN/USD; el USD procede de la moneda de la obligación. | Saldo operativo. Para un corte histórico se requieren snapshots o reconstrucción con eventos fechados; `fecha_vencimiento` sirve para antigüedad, no como fecha de saldo. |
| Actividad de Tesorería | Cuenta cobros y pagos no anulados, y agrupa importe/neto por moneda y medio. Los movimientos anulados se identifican aparte; los de moneda desconocida no entran en importes. | `public.movimientos_tesoreria.created_at`, filtrado por fecha de Perú. | PEN y USD se calculan por separado. La migración `20261113132238` persistió moneda y completó solo movimientos históricos cuyas aplicaciones cuadraban en tipo, monto y moneda. | Sigue sin ser un estado contable de flujo de efectivo ni un saldo bancario. CSV solo se habilita para el conjunto completo y estable; advierte si quedan monedas desconocidas. |
| Movimientos de Kardex | Cuenta movimientos y los agrupa por tipo; el detalle presenta los 200 más recientes con entradas, salidas, saldo y costos PEPS/promedio. | RPC `ec_consultar_kardex`, filtrado por `fecha` con límites UTC inclusivo/exclusivo derivados del día de Perú. | Costos por movimiento tal como los mantiene el Kardex. | CSV incluye el conjunto completo hasta 10 000 filas. Si el total excede el límite o cambia durante la lectura, no se ofrecen resúmenes ni exportación parcial. |

## Salidas ejecutivas y controles ya aplicados

- El panel principal presenta ventas, compras y cuentas por cobrar por moneda; su gráfico selecciona PEN o USD.
- Se retiró la métrica denominada “margen” que restaba ventas menos compras: mezclaba monedas y bases tributarias, y no representaba utilidad.
- Los CSV/Excel de ventas incluyen moneda y tipo de cambio.
- El PDF ejecutivo se genera para una moneda por exportación (PEN o USD). Ventas, compras, finanzas, saldos, vencidos, rankings y tendencias se limitan a la moneda elegida; no se convierten importes entre monedas.
- Tesorería calcula totales separados PEN/USD; movimientos futuros sin moneda quedan fuera de los importes y se cuentan como no conciliados.

## Trabajo pendiente antes de llamar a esto BI completo

1. Aprobar el catálogo oficial: estados incluidos, fecha que determina cada período, tratamiento de anulaciones/devoluciones, alcance por sucursal/almacén y dueño de cada KPI.
2. **Completado en esquema y código:** persistir moneda por movimiento, conciliar solo las filas históricas con aplicaciones demostrables, separar PEN/USD en Tesorería y caja y bloquear cierres con efectivo de moneda desconocida. La migración `20261113132238_tesoreria_moneda_y_cierre_multimoneda_v1` dejó 8 movimientos clasificados (7 PEN, 1 USD; 0 desconocidos) en el corte verificado. Mantener los desconocidos fuera de sumas si aparecen en adelante.
3. Mantener pruebas del PDF ejecutivo para ambas monedas y auditar la moneda histórica de las cuentas antes de ampliar el informe; la exportación selecciona una moneda por archivo.
4. Mover agregaciones de alto volumen a consultas seguras del servidor con filtro de fechas y permisos/RLS. El snapshot completo en el navegador no es una estrategia BI escalable.
5. Crear snapshots fechados solo cuando el negocio necesite indicadores históricos; cada uno debe mostrar fecha de corte, fuente y estado de conciliación.
6. Conciliar con muestras manuales y documentos origen antes de aprobar las fórmulas contables. No modificar importes fuente para hacer coincidir una tarjeta.

## Código de referencia

- Reportes: `src/components/ReportsPage.tsx`, `src/data/treasuryReport.ts`, `src/services/treasuryReport.ts`, `src/data/inventoryReport.ts`, `src/services/inventoryReport.ts`.
- Ventas, saldos y tarjetas: `src/data/dashboard.ts`, `src/services/records.ts`, `src/components/dashboard/DashboardOverview.tsx`.
- PDF ejecutivo por moneda seleccionada: `src/data/executiveReport.ts`, `src/data/executiveReportHtml.ts`.
- Esquema PEPS revisado: `supabase/migrations/20261113035956_ec_consultar_valorizacion_peps_actual_v1.sql`.
- Moneda y cierre de caja por divisa: `supabase/migrations/20261113132238_tesoreria_moneda_y_cierre_multimoneda_v1.sql`.

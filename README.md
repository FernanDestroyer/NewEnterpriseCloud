# EnterpriseCloud · Panel empresarial conectado a Supabase

React, TypeScript y Vite. La autenticación, los perfiles, los permisos y los registros empresariales se consultan en Supabase. El panel, los reportes y las tablas utilizan el mismo estado de datos; no existe un modo de demostración ni una carga de registros de ejemplo en la aplicación.

## Ejecutar

1. Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en `.env`.
2. Ejecuta `npm install` y `npm run dev`.
3. Accede con una cuenta existente de Supabase Auth o regístrate. La cuenta necesita su perfil en `usuarios` y un rol con permisos en `rol_permisos`.

```text
npm run typecheck
npm test
npm run build
```

En PowerShell con restricciones de ejecución puedes utilizar `npm.cmd`.

## Apartados del espacio de trabajo

- Panel: ventas y compras por período, gráfico sobre fechas originales, inventario, alertas, actividad y saldos financieros.
- Compras y recepciones: seguimiento Solicitud → Orden → Recepción → Factura → Pagada y catálogo de proveedores.
- Ventas, cotizaciones y comprobantes: productos del inventario, conversión de cotizaciones y comprobantes imprimibles.
- Inventario y Kardex: existencias por almacén (`inventarios`), Kardex valorizado PEPS, transferencias, ajustes, conteo físico y control de lotes/series.
- Finanzas: cuentas por cobrar/pagar y cancelación total persistida de una cuenta.
- Bancos y conciliación (`/tesoreria`): cuentas bancarias con activación por RPC, ingresos/egresos, transferencias atómicas e idempotentes y conciliación de extracto con cierre validado.
- Maestros (`/maestros`): transportistas y vendedores con activar/desactivar sin borrar historial, y catálogos comerciales/tributarios (`catalogos_negocio`).
- Comisiones de vendedores (`/comisiones`): reglas, escalas, excepciones, asignación venta–vendedor, cálculo por período, liquidación, ajustes y pagos con asiento bancario opcional.
- Reportes: cálculos sobre registros reales, intervalos de fechas y exportación del resultado filtrado.
- Mantenimientos: los mismos clientes, productos, proveedores y parámetros utilizados en los módulos operativos.
- Clientes y proveedores con documento: DNI (RENIEC) o RUC (SUNAT) con autocompletado de nombre y dirección desde el formulario.
- Perfil: nombre persistente, correo de la cuenta y permisos del rol.

## Compras por solicitud y módulos integrados (29-10-2026)

Las compras siguen el flujo Solicitud (versionada) → Ofertas de proveedor → Orden de compra con idempotencia por clave, cantidades fraccionarias (hasta 3 decimales) y anulación como 'Cancelada'. El ajuste de inventario va por RPC con idempotencia y asiento auditable. Los módulos Maestros, Tesorería bancaria y Comisiones comparten las convenciones del proyecto: RLS con permisos mínimos, auditoría en todas las tablas y escrituras sensibles solo por RPC autorizados. El detalle técnico y de validación está en `docs/IMPLEMENTACION_MAESTROS_TESORERIA_COMISIONES.md`.

## QR de Yape en ventas

1. Ejecuta `supabase/migrations/20261026000000_yape_qr.sql` para que los usuarios de ventas/finanzas puedan leer el QR del comercio.
2. En **Mantenimiento → Otros catálogos → QR de Yape**, sube tu QR original (PNG, JPG o WebP de hasta 1 MB), escribe el titular y guarda. El celular es opcional.
3. En **Nueva venta**, selecciona **Yape**: se muestra el QR junto al total actualizado de productos y descuentos. También funciona con el monto manual de una venta sin líneas.

La imagen se guarda en `configuracion` con código `YAPE_QR`. El cliente ingresa el monto en su app; este QR habitual no recibe un monto dinámico ni confirma el abono automáticamente. Registra el estado Completada después de revisar el pago en Yape.

## Consulta RENIEC/SUNAT

1. Configura en `.env` tu `VITE_PERU_API_TOKEN` (y `VITE_PERU_API_URL`, por defecto `https://dniruc.apisperu.com/api/v1`; también compatible con `https://api.apis.net.pe/v1`). Reinicia el servidor.
2. Ejecuta en Supabase la migración `supabase/migrations/20261017000000_cliente_documento.sql` para guardar el documento del cliente.
3. En **Clientes** elige DNI o RUC, escribe el número y pulsa el botón de búsqueda: se completan nombre y detalle. En **Proveedores** escribe el RUC y pulsa **SUNAT**.

Sin token o sin la migración, todo sigue funcionando con digitación manual: la búsqueda avisa qué falta en lugar de fallar.

## Semántica de los datos existentes

- Una venta con líneas mueve el stock al guardarse. La vista de comprobantes consulta esa misma venta; imprimirla no vuelve a descontar existencias.
- En compras, `monto` representa el subtotal; la cuenta por pagar incorpora IGV del 18 %. El stock ingresa a partir de Recepción.
- El importe registrado de la venta es el total utilizado por la cuenta por cobrar. El comprobante desglosa el IGV incluido sin añadir un segundo impuesto.
- Las cuentas completadas forman los importes cobrados/pagados registrados. El esquema actual registra la cancelación total de una cuenta.
- `productos.stock` es el inventario global operativo. La vista Almacenes muestra exclusivamente las filas reales de `inventarios`; no distribuye ni duplica automáticamente el stock global.
- Documentos guarda referencias y metadatos. Los archivos físicos requieren una integración de almacenamiento adicional.

## Base de datos y despliegue

Consulta `supabase/README.md` para las migraciones. La aplicación presenta los errores de un módulo sin sustituir sus datos por ejemplos. Todas las autorizaciones siguen sujetas a RLS.

En Vercel configura ambas variables de entorno antes de compilar y vuelve a desplegar después de cambiarlas. `vercel.json` contiene el fallback de las rutas de la SPA.

## Logística y Metas (30-10-2026)

Los tres submódulos de Logística y los tres de Metas ya tienen ruta y pantalla propia; el sidebar deja de mostrarlos como «Próximamente».

- **Logística y Transporte** (`/logistica/despachos`, `/logistica/flota`, `/logistica/seguimiento`): planificación de despachos con paradas, reserva de vehículo/conductor, seguimiento de entrega, devoluciones e incidencias. Persiste en `vehiculos`, `conductores`, `asignaciones_vehiculo` y `despachos`. Las asignaciones programadas no pueden cruzarse por vehículo ni por conductor, y el servidor valida SOAT, revisión técnica, licencia y compatibilidad de categoría.
- **Metas y Objetivos** (`/metas#definicion`, `/metas#avance`, `/metas#ranking`): definición de metas, asignaciones por vendedor/sucursal/producto, cortes manuales, avance calculado con ventas completadas, ranking y alertas. Persiste en `metas`, `metas_asignaciones` y `metas_cortes`, con RPC `metas_logrado`, `metas_catalogo`, `metas_aportes` y `metas_ubicaciones`.
- **Permisos**: `metas` (ver/crear/editar/eliminar) y `logistica` (ver/crear/editar) se asignan por rol en `rol_permisos`. Administrador, Gerente y Supervisor pueden gestionar ambos módulos; Operador solo Logística; Vendedor solo consulta Metas. Sin el permiso, el sidebar oculta el módulo y RLS rechaza las escrituras.
- **Migraciones**: `20261105090000_logistica_flota_base.sql`, `20261103000000_metas_objetivos.sql`, `20261104010000_despachos.sql`, `20261104020000_bitacora_operaciones.sql`, `20261104030000_seguimiento_despachos.sql`, `20261104040000_metas_ventas_automaticas.sql`, `20261104050000_vendedor_turno_sucursal.sql`, `20261104060000_caja_vendedor_asignado.sql` y `20261105091000_metas_logistica_permisos.sql`. Todas quedaron aplicadas y registradas en el proyecto `auxqjoxnsasnmtnakgmg`.
- **Bitácora**: las tablas nuevas tienen trigger `fn_auditar`; la aplicación registra intentos denegados y operaciones fallidas con `registrar_evento_auditoria`.

## Inventario, Ventas y Compras de Erick (03-11-2026)

Se integraron los tres módulos de Erick y sus 19 submódulos abren una pantalla operativa real: Compras (7), Ventas (6) e Inventario y Kardex (6). Todas las rutas del sidebar tienen `path`, por lo que dejan de mostrarse como elementos deshabilitados o «Próximamente».

### Compras: Modelo A activo

La entrega activa de Compras usa el Modelo A: `solicitudes_compra` → `solicitud_compra_lineas` → `ofertas_compra` → `detalle_ofertas_compra`, con historial, idempotencia, moneda/tipo de cambio y selección de oferta. El Modelo B (`requisiciones_compra` → `ofertas_proveedor`) permanece como backend alternativo inactivo; no se eliminó ni se volvió a conectar a la interfaz. La restauración del Modelo A se hizo con una migración idempotente porque su DDL original solo existía en el proyecto remoto.

### Ventas

El flujo operativo usa `ec_cotizaciones`, `ec_cotizacion_versiones`, `ec_pedidos`, `ec_reservas`, `ec_comprobantes`, `ec_guias` y `ec_notas_credito`. Crear un pedido reserva stock; facturar genera la cuenta por cobrar; la salida física del almacén ocurre solo al emitir la guía. La anulación libera la reserva y no genera comprobante ni CxC.

### Inventario y Kardex

Las existencias se consultan por almacén en `inventarios` y el Kardex se alimenta de `movimientos_inventario`, con valorización PEPS (`ec_capas_peps`, `ec_consumos_peps`, `ec_kardex_valorizado`). Transferencias, ajustes, conteo físico y lotes/series usan RPC idempotentes (`ec_procesar_transferencia`, `ec_registrar_ajuste`, `ec_abrir_conteo_fisico`, `ec_cerrar_inventario_fisico`, `ec_configurar_trazabilidad`, `ec_identificar_lote`, `ec_identificar_serie`). La transferencia es atómica: salida y entrada se registran juntas.

### Migraciones y validación

Las migraciones aplicadas mediante `apply_migration` en `auxqjoxnsasnmtnakgmg` son:

- `20261102060000_restaurar_modelo_a_compras.sql` — restauración idempotente del Modelo A.
- `20261119000001_inventario_kardex_ec.sql` — versiona el backend de inventario y Kardex.
- `20261119000002_compras_abrir_solicitud_v2.sql` — agrega el RPC faltante `abrir_solicitud_compra_v2`.
- `20261119000003_compras_fix_seleccion_oferta.sql` — corrige `seleccionar_oferta_compra_v4` (`x.line_total` → `x.total`).
- `20261119000004_monedas_tipo_cambio_venta.sql` — agrega `monedas.tipo_cambio`, siembra USD y crea las RPC de consulta/actualización del TC.
- `20261119000005_monedas_lectura_configuracion.sql` — permite leer monedas desde Configuración además de Finanzas.
- `20261119000006_ventas_moneda_tipo_cambio.sql` — conserva `moneda` y `tipo_cambio` del pedido al crear la venta facturada.
- `20261119000007_ventas_cobro_pedido.sql` — integra el cobro con método de pago (`ec_registrar_cobro_venta` y `ec_facturar_pedido_pago`) en Ventas, venta directa y facturación de pedidos.

Validación funcional realizada: 19 rutas renderizadas sin textos provisionales ni errores de consola; Compras completo (crear solicitud, abrir, registrar oferta y seleccionar); Ventas completo (crear pedido con reserva y anular); Inventario completo (ajuste de entrada +1, ajuste de salida −1, stock restituido y ambos movimientos visibles en Kardex). Los datos de prueba se eliminaron al terminar.

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
- Inventario: existencias globales en `productos`, movimientos de Kardex y consulta de asignaciones por almacén.
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

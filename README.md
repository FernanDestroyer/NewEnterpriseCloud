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
- Reportes: cálculos sobre registros reales, intervalos de fechas y exportación del resultado filtrado.
- Mantenimientos: los mismos clientes, productos, proveedores y parámetros utilizados en los módulos operativos.
- Clientes y proveedores con documento: DNI (RENIEC) o RUC (SUNAT) con autocompletado de nombre y dirección desde el formulario.
- Perfil: nombre persistente, correo de la cuenta y permisos del rol.

## QR de Yape en ventas

1. Ejecuta `supabase/migrations/20261026000000_yape_qr.sql` para que los usuarios de ventas/finanzas puedan leer el QR del comercio.
2. En **Mantenimiento → Otros catálogos → QR de Yape**, sube tu QR original (PNG, JPG o WebP de hasta 1 MB), escribe el titular y guarda. El celular es opcional.
3. En **Nueva venta**, selecciona **Yape**: se muestra el QR junto al total actualizado de productos y descuentos. También funciona con el monto manual de una venta sin líneas.

La imagen se guarda en `configuracion` con código `YAPE_QR`. El cliente ingresa el monto en su app; este QR habitual no recibe un monto dinámico ni confirma el abono automáticamente. Registra el estado Completada después de revisar el pago en Yape.

## Importar clientes desde un dataset CSV

1. Asegúrate de haber ejecutado `supabase/migrations/20261017000000_cliente_documento.sql` (guarda el documento del cliente).
2. En **Clientes** pulsa **Importar CSV**, descarga la plantilla o usa `dataset-clientes.csv` (18 clientes de ejemplo) y selecciona el archivo.
3. Revisa la vista previa (cada fila se valida: DNI de 8 dígitos o RUC de 11 con dígito verificador, crédito ≥ 0, sin duplicados) y pulsa **Confirmar importación**.

Columnas: `tipo_doc,documento,razon_social,detalle,linea_credito,estado`. Si falta `tipo_doc` se deduce por la longitud del documento. Los clientes cuyo documento ya existe se omiten y se informan en el reporte final.

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

# Arquitectura funcional objetivo de EnterpriseCloud

**Versión funcional:** 24 de octubre de 2026; ajustes locales y reconciliación documental: 26 de octubre de 2026  
**Propósito:** ordenar el ERP como una plataforma modular que pueda crecer por procesos, sin presentar enlaces de menú como funciones terminadas.  
**Referencia:** el PDF compartido se usa como guía de amplitud y organización funcional. EnterpriseCloud conserva su identidad y sus propios procesos.

## 1. Reglas de diseño

1. Cada dato maestro debe tener una sola fuente responsable. El maestro de productos vive en Maestros; existencias y movimientos viven en Inventario; las cuentas por cobrar y pagar y sus aplicaciones viven en Tesorería.
2. El documento que origina una operación conserva su detalle y referencia. Por ejemplo, una recepción referencia su compra y una cobranza referencia la cuenta por cobrar.
3. El servidor valida permisos, estados, saldos, almacenes y duplicados. Ocultar un botón en el frontend no es un control de seguridad.
4. Los movimientos operativos que afectan stock o dinero se registran de forma atómica, con referencia al origen e idempotencia. No se reconstruye el historial editando el saldo.
5. Un módulo se considera terminado solo cuando cubre datos, reglas, permisos, estados, errores, auditoría y reportes de su flujo.
6. V1 se limita a un espacio de trabajo de una organización principal con varias empresas legales/sucursales/almacenes si el negocio lo requiere. No hay todavía aislamiento entre organizaciones cliente.
7. La distribución inicial de stock se ingresa con evidencia del usuario. El sistema no adivina a qué almacén pertenece el saldo legado.

## 2. Mapa de los 12 módulos

| Módulo | Responsabilidad y submódulos | Estado actual | Próximo alcance recomendado |
|---|---|---|---|
| **1. Maestros** | Clientes; proveedores; productos y clasificación; ficha de empresa; sucursales y almacenes; zonas comerciales y de reparto; catálogos compartidos. | Clientes, proveedores y productos funcionan. Empresa, sucursales, almacenes y zonas tienen gestión parcial. Las asociaciones de clientes/sucursales a zonas ya se gestionan desde esta pantalla con permiso de configuración; falta completar unidades/catálogos y estructurar direcciones de clientes. | Completar unidades de medida, categorías y atributos de producto, asignaciones a zonas, transportistas/vendedores y validaciones fiscales. Mantener aquí la configuración descriptiva de empresa/ubicaciones, no reglas de pagos o permisos.
| **2. Compras** | Órdenes nacionales; bienes y servicios/gastos; recepción; solicitud interna y comparativo de ofertas; devoluciones al proveedor. Importaciones, contratos marco y evaluación formal son extensiones futuras. | Recepciones parciales/totales por almacén; RPC remoto idempotente que crea orden, líneas y cuenta por pagar en una transacción. El servicio/gasto no mueve inventario. El cálculo fiscal actual admite únicamente IGV estándar del 18%. | Antes de operar comprobantes reales, admitir gravado, exonerado, inafecto y tasas por línea. Después completar solicitud/comparativo y devoluciones. El saldo y pago de las obligaciones se consulta desde Tesorería para evitar dos entradas principales.
| **3. Ventas** | Cotizaciones; ventas; documentos imprimibles; guía de remisión; devoluciones/notas de crédito; eventual emisión electrónica. | Cotización y venta conectadas a almacén. Conversión de cotización no cobra por sí sola. La venta inmediata en efectivo necesita turno abierto. Documentos imprimibles parciales. | Completar pedidos/reservas, devolución y nota de crédito. Integración SUNAT requiere definir proveedor/certificados/costos antes de implementarse.
| **4. Inventario y Kardex** | Existencias por almacén; Kardex; apertura; transferencias; ajustes; conteo físico. Lotes/series solo si el tipo de producto lo exige. | Stock por almacén y movimientos conectados a recepción/venta. Apertura distribuida preparada, aún no ejecutada porque no hay almacenes ni distribución física ingresada. | Habilitar apertura tras configurar almacenes y contar cada producto. Luego transferencias y ajustes autorizados; conteos con aprobación de diferencias.
| **5. Tesorería** | Cuentas por cobrar y pagar; pagos/cobros parciales; caja y turnos; bancos, flujo y conciliación. | Cuentas y movimientos parciales; saldos consultables; pagos operativos ligados al turno cuando son cobro/pago de caja. | Aclarar caja vs banco, crear cuentas bancarias y conciliación, reglas de anulación/reverso y cierre diario.
| **6. Logística y Transporte** | Despachos/rutas; vehículos y conductores; asignación de carga; eventos de entrega; incidencias y devoluciones. | Navegación/agrupación funcional; procesos y tablas aún no implementados. | Implementar después de que ventas y zonas tengan datos confiables. Un despacho debe reservar o consumir stock según una regla acordada y dejar eventos trazables.
| **7. Comisiones de Vendedores** | Reglas/escalas; cálculo y ajustes; liquidaciones; pagos e historial. | No implementado. | Definir base de cálculo (venta, cobro o margen), tratamiento de anulaciones/devoluciones y aprobación antes de crear tablas y liquidaciones.
| **8. Metas y Objetivos** | Definición y asignación; avance por vendedor/sucursal/producto; ranking y alertas. | No implementado. | Metas calculadas desde ventas ya consolidadas, con periodo, responsable y regla para devoluciones. Evitar duplicar agregados transaccionales.
| **9. Reportes e Inteligencia de Negocios** | Panel ejecutivo y reportes operativos/analíticos. | Panel y reportes básicos disponibles; confiabilidad depende de los datos de los flujos que los alimentan. | Agregar indicadores solo con definiciones y datos conciliados; rastrear cada cifra hasta ventas, compras, stock o tesorería.
| **10. Seguridad y Auditoría** | Usuarios; roles y permisos; historial de cambios/operaciones; revisión de accesos. | Auth, perfiles y roles; RLS activado en las 40 tablas públicas; bitácora de solo lectura con permiso separado y triggers en las 39 tablas de negocio/configuración. | Probar los permisos por rol y diseñar membresía/organización antes de permitir varias organizaciones cliente.
| **11. Configuración e Integraciones** | Parámetros generales; series/plantillas; cobros; respaldos; API/webhooks e integraciones. | Ficha de empresa, medios de pago, monedas, QR Yape/Plin y cuenta para transferencias tienen cobertura parcial. | Separar parámetros generales de credenciales. Añadir secretos solo en servidor; construir integraciones con estados, reintentos y registros de ejecución.
| **12. Notificaciones y Aprobaciones** | Centro de alertas; flujos y reglas; bandeja de aprobaciones; canales e historial. | Existe presentación del centro de alertas; workflows, aprobaciones y canales persistentes no están implementados. | Crear estados y responsables configurables tras definir qué operaciones requieren aprobación, límites y escalamiento.

## 3. Estado de la base de datos

La revisión remota del 26-10-2026 encontró 40 tablas en `public`, con RLS habilitado en las 40 y 23 migraciones registradas. Los permisos administrativos de los roles de API se corrigieron; las 9 cuentas Auth y sus 9 perfiles siguen intactos. Se agregó `cajas`, vinculada a una sucursal, y `caja_turnos.caja_id` para separar turnos. Cada almacén exige `sucursal_id`; el event trigger activa RLS en tablas nuevas. También se retiró el permiso DELETE de `authenticated` sobre `empresas`. Están organizadas por estas capacidades:

- **Organización y maestros:** `empresas`, `sucursales`, `almacenes`, `zonas`, `zonas_clientes`, `zonas_sucursales`, `clientes`, `proveedores`, `productos`, `categorias`, `unidades_medida`, `proveedor_productos`, `monedas`, `metodos_pago`.
- **Compras y ventas:** `compras`, `detalle_compras`, `recepciones_compra`, `detalle_recepciones_compra`, `cotizaciones`, `detalle_cotizaciones`, `ventas`, `detalle_ventas`, `documentos`.
- **Inventario y caja/tesorería:** `inventarios`, `movimientos_inventario`, `aperturas_inventario`, `cajas`, `caja_turnos`, `movimientos_tesoreria`, `aplicaciones_pago`, `pagos`.
- **Seguridad, operación y soporte:** `usuarios`, `roles`, `permisos`, `rol_permisos`, `usuario_permisos`, `auditoria`, `configuracion`, `reportes`, `analisis_proyectos`.

### Datos observados

| Registro | Cantidad al 26-10-2026 |
|---|---:|
| Cuentas Supabase Auth / perfiles `usuarios` | 9 / 9 |
| Empresas / sucursales / almacenes | 0 / 0 / 0 |
| Cajas por sucursal | 0 |
| Categorías / unidades de medida | 0 / 0 |
| Productos / filas de inventario por almacén | 8 / 0 |
| Unidades en el stock global legado de productos | 41 |
| Movimientos históricos de inventario | 16 |
| Compras / recepciones | 4 / 0 |
| Ventas | 8 |
| Cuentas / movimientos de tesorería | 12 / 0 |
| Turnos de caja abiertos | 1 |
| Aperturas distribuidas de inventario | 0 |
| Eventos de auditoría / tablas auditadas | 283 / 39 |

Las cuatro compras históricas aparecen pagadas y marcadas con recepción completa para evitar que se les vuelva a ingresar stock. Esa marca no creó documentos de recepción ni movimientos de inventario. Los triggers de auditoría cubren ahora las 39 tablas de negocio/configuración; `auditoria` queda sin trigger para evitar recursión. El recuento de 283 eventos corresponde al 24 de octubre y no se usa como conteo actual. Los datos de negocio no se eliminaron; las nueve cuentas y sus perfiles se conservaron. No se creó una caja ni sucursal ficticia.

### Lo que falta en el modelo

Las tablas de apertura, stock por almacén, recepción, tesorería y asociaciones de zona ya existen. No se agregan copias de las mismas entidades. Las próximas tablas se crearán solo al implementar su proceso, por migración propia y con aceptación funcional:

| Dominio futuro | Tablas candidatas | Dependencias/reglas que deben quedar decididas primero |
|---|---|---|
| Multi-organización (solo antes de SaaS multi-cliente) | `organizaciones`, `organizacion_usuarios` y `organizacion_id` en cada registro operativo | Propietario, membresías, invitaciones, roles por organización y migración de cada fila existente. RLS debe filtrar `organizacion_id` en servidor.
| Requisiciones/comparativo de compra | `requisiciones_compra`, `detalle_requisiciones_compra`, `ofertas_proveedor`, `detalle_ofertas_proveedor` | Quién solicita/aprueba, vigencia de ofertas, moneda, impuestos y forma de seleccionar proveedor.
| Devolución a proveedor | `devoluciones_compra`, `detalle_devoluciones_compra` | Referenciar recepción y líneas; decidir devolución física, ajuste de stock y nota de crédito del proveedor.
| Transferencia, ajuste y conteo | `transferencias_almacen`, `detalle_transferencias_almacen`, `ajustes_inventario`, `detalle_ajustes_inventario`, `conteos_inventario`, `detalle_conteos_inventario` | Estados borrador/aprobado/contabilizado, razones, responsables y registro doble de salida/entrada con idempotencia.
| Devolución de cliente | `devoluciones_venta`, `detalle_devoluciones_venta`, `notas_credito` | Venta original, condiciones de reposición, reverso de ingresos/stock y autorización fiscal.
| Bancos | `cuentas_bancarias`, `conciliaciones_bancarias`, `detalle_conciliacion_bancaria` | Cuenta real vs caja, importación de extracto, moneda, coincidencia y gestión de diferencias.
| Logística | `vehiculos`, `conductores`, `despachos`, `detalle_despachos`, `eventos_entrega` | Despacho parcial, entrega fallida, evidencia y política de stock reservado/consumido.
| Comisiones/metas | `reglas_comision`, `liquidaciones_comision`, `detalle_liquidacion_comision`, `metas_comerciales`, `asignaciones_meta` | Fórmulas, periodos, ajustes, responsables y tratamiento de devoluciones/anulaciones.
| Aprobaciones/notificaciones | `workflows_aprobacion`, `reglas_aprobacion`, `solicitudes_aprobacion`, `historial_aprobacion`, `notificaciones` | Umbrales, cadena de aprobación, sustituciones, vencimientos, canales y retención.

Los reportes deben preferir vistas de lectura sobre las tablas transaccionales. Si el volumen lo exige, se agregan vistas materializadas refrescables sin alterar el libro contable de stock o dinero. Los archivos y comprobantes requieren almacenamiento privado; la tabla `documentos` guarda referencias, no equivale a un bucket con archivos físicos.

## 4. Reglas comunes acordadas

- **Identidad:** `auth.users` es la identidad de acceso; `usuarios` guarda su perfil. No eliminar usuarios para reiniciar información de desarrollo.
- **Autorización:** permisos en el frontend mejoran la experiencia, pero RPC/RLS son la frontera de seguridad. Toda rutina privilegiada debe validar identidad y permiso de acción.
- **Permisos de documentos:** Ventas/Compras pueden crear sus documentos y la cuenta financiera derivada dentro de la misma transacción. Tesorería se exige al registrar/aplicar cobros y pagos; el permiso de origen no habilita a modificar saldos manualmente.
- **Data API:** toda tabla expuesta necesita grants explícitos y RLS; no depender de concesiones implícitas. `app_private` se mantiene fuera de la lista de esquemas expuestos.
- **Ámbito:** hoy no hay aislamiento de varias organizaciones cliente. RLS habilitado protege por políticas actuales, pero no significa que exista segregación SaaS por empresa.
- **Documento:** usar estados explícitos y transiciones válidas. Documentos contabilizados no se editan para corregir el libro; se anulan o revierten mediante un evento trazable.
- **Dinero:** pago parcial crea un movimiento y una aplicación referenciada; anular crea un reverso, no se borra el movimiento. Cobros/pagos de caja exigen turno abierto.
- **Caja por sucursal:** `cajas` queda ligada a una sucursal y cada turno puede referenciar una caja. El índice permite un turno abierto por caja y conserva, solo para transición, un turno legado sin caja. Los pagos/cobros en efectivo y el cierre consultan el turno elegido y sus movimientos; la caja antigua no se reasignó automáticamente. Crear cajas reales después de completar empresa y sucursales; cerrar el turno legado tras conciliarlo.
- **Inventario:** cantidad por almacén debe coincidir con el inventario físico inicial. Recibir/comprar no debe aplicarse dos veces. Evitar cambios manuales del saldo global después de la apertura.
- **Unidades:** el esquema operativo actual usa cantidades enteras. Pesos/unidades fraccionarias requieren cambiar detalle, stock, Kardex y RPC juntos; no introducir decimales solo en la interfaz.
- **Archivos/secretos:** los buckets, claves privadas y webhooks no se exponen en variables `VITE_*` ni se guardan en tablas leíbles por usuarios comunes.
- **Auditoría:** operaciones de stock, pago, anulación, cambio de permiso y aprobación deben registrar actor, hora, origen, antes/después cuando aplique y referencia.
- **Tiempo y moneda:** almacenar instantes con zona horaria; mostrar zona configurable. Cada importe declara moneda y regla de redondeo; no sumar monedas distintas sin tipo de cambio y fecha.

## 5. Plan de siete fases

| Fase | Resultado exigible | Estado al corte |
|---|---|---|
| **1. Reconciliar esquema e historial** | Inventario SQL-local/remoto, baseline verificable, historial consistente y restauración local reproducible sin tocar Auth. | **Parcial.** Hay 23 versiones coincidentes, diez cambios forward-only aplicados y una matriz de 25 archivos pendientes. Las primeras 47 migraciones pasaron cronológicamente en PostgreSQL 17 desechable; la número 48 se aplicó en remoto y su ACL quedó verificada. Falta repetir la cadena completa local, restaurar una exportación y conciliar 18 versiones históricas más siete archivos futuros.
| **2. Mapa y alcance V1** | Menú sin duplicidad, rutas clasificadas en listo/parcial/futuro y lista de exclusiones. | **Hecho como definición y navegación;** se corrigió “cuentas por pagar” duplicado y ahora las asignaciones de clientes/sucursales a zonas se gestionan en sus pestañas.
| **3. Reglas comunes** | Identidad/permisos, estados, auditoría, documentos, stock, caja, archivos e integraciones definidos y reforzados. | **Parcial.** RLS en las 40 tablas, bitácora con cobertura de 39 tablas y privilegios administrativos retirados de los roles API. Las cajas y turnos usan permisos de Tesorería y quedan auditados. Cada almacén queda dentro de una sucursal. Falta restaurar una exportación real del esquema y verificar políticas/permisos por rol con datos de prueba representativos.
| **4. Inventario multi-almacén** | Apertura distribuida comprobable, saldos y Kardex por almacén y bloqueo de doble contabilización. | **Parcial, listo para configurar.** La apertura transaccional está preparada; no puede ejecutarse sin crear almacenes y asignar físicamente las 8 existencias.
| **5. Compras nacionales** | Orden, recepción parcial/totales, AP y pagos con un registro único y trazable. | **Parcial implementado.** Orden de bienes idempotente, gasto sin recepción y cuenta por pagar pasaron en PostgreSQL 17 con fixture reducido. Falta restaurar el esquema completo y probar la recepción real por almacén; también faltan tratamientos tributarios por línea, requisición/comparativo y devoluciones.
| **6. Ventas y Tesorería** | Cotización/venta, salida de stock, cobranza/pago parcial, turno y reversos trazables. | **Parcial implementado.** La prueba desechable validó crédito sin turno, permiso financiero para cobro inmediato y reversión de venta en efectivo sin caja abierta. Falta probar RPC, RLS y permisos en el esquema remoto restaurado; también faltan conciliación bancaria, devoluciones/notas de crédito y comprobante fiscal electrónico.
| **7. Módulos restantes y BI** | Diseños/reglas acordados y desarrollo secuenciado de logística, comisiones, metas, aprobaciones, notificaciones y BI. | **Definición preparada; implementación pendiente.** No activar reportes de dirección hasta que sus fuentes sean conciliables.

## 6. Riesgos y límites conocidos

1. El historial remoto no puede reconciliarse automáticamente mientras la CLI local no esté autenticada. No se debe ejecutar `db push`, `db reset --linked` ni marcar migraciones aplicadas sin prueba del esquema correspondiente.
2. El proyecto está en plan Free. Supabase confirma que la protección contra contraseñas filtradas requiere Pro o superior; la advertencia de Auth no se puede cerrar sin costo. No se recomienda actualizar plan por esta característica. Sí se debe usar contraseña larga y MFA disponible para cuentas administrativas.
3. Los índices marcados “unused” son información estadística, no una orden de borrarlos. En un proyecto con pocos movimientos todavía no han acumulado uso.
4. La cantidad fraccionaria, multi-organización SaaS y facturación electrónica requieren decisiones de modelo antes de comprometer datos.
5. No existe confirmación de una copia de respaldo descargada y restaurada durante esta revisión. Antes de una migración remota futura, exportar una copia y verificar una restauración local.

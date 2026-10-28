# Guía paso a paso de implementación de EnterpriseCloud

**Esquema remoto verificado:** 26 de octubre de 2026. **Trabajo local documentado:** 26 de octubre de 2026.  
**Objetivo:** completar el ERP por flujos verificables, preservar las cuentas y mantener el costo en cero mientras el plan Free sea suficiente.  
**Mapa y propuesta de datos:** [arquitectura objetivo](ARQUITECTURA_OBJETIVO_ENTERPRISECLOUD.md).

## 1. Principios de ejecución

- El PDF es referencia de amplitud modular, no identidad ni reglas de otra empresa.
- V1 atiende un espacio de trabajo de una organización principal. No está preparado para aislar distintas organizaciones cliente.
- Un módulo no está completo por tener menú: necesita datos, reglas, permisos de servidor/RLS, estados, transacciones, auditoría, errores y reportes.
- Se conservan las 9 cuentas Auth y sus perfiles. No usar reset remoto ni borrar usuarios para limpiar datos.
- No se inventan empresa, almacenes, stock, clientes ni transacciones.
- Cada cambio del esquema se versiona, revisa, prueba en una base local desechable, respalda y luego se aplica de manera controlada.
- Supabase Free, CLI gratuita y desarrollo local con Docker son suficientes para avanzar. No presupongo Pro, AWS de pago ni facturación electrónica pagada.
- Cada tabla o función nueva debe recibir permisos explícitos y controles RLS según su uso; no depender de concesiones implícitas. Mantener `app_private` fuera de los esquemas expuestos por Data API.

## 2. Alcance V1

### Incluye o tiene avance parcial

1. Maestros de clientes, proveedores, productos/clasificación, empresa, sucursales, almacenes, zonas y catálogos compartidos.
2. Compras nacionales: orden, recepción parcial/total por almacén, obligación por pagar y pagos parciales.
3. Ventas: cotización, venta por almacén, salida de stock, cuenta por cobrar y cobro.
4. Inventario por almacén, apertura inicial con distribución física y Kardex.
5. Tesorería: caja/turnos, cuentas por cobrar/pagar, aplicaciones y movimientos parciales.
6. Seguridad de usuarios/roles/permisos y menú organizado en 12 módulos.
7. Panel e informes básicos sustentados por los datos actuales.

### Después de V1

Multi-organización SaaS, importaciones, contratos y evaluación formal de proveedores, devoluciones/notas de crédito, reservas, guías, SUNAT, transferencias/ajustes/conteos, conciliación bancaria, logística de flota, comisiones, metas, workflows, notificaciones persistentes, webhooks, lotes/series, cantidades fraccionarias y BI avanzado.

## 3. Fase 1 — reconciliar esquema e historial

### Estado comprobado

El remoto tiene 40 tablas públicas con RLS, 9 cuentas Auth y 9 perfiles. El historial remoto contiene 23 migraciones: 13 originales y diez forward-only. El repositorio tiene 48 archivos SQL: 23 coinciden exactamente con el historial; de las otras 25, 18 tienen fecha hasta el corte y requieren conciliación, y siete tienen fechas posteriores y son futuras locales. No se deben ejecutar en bloque ni usar futuras para reparar el historial. La CLI aún no está enlazada; Docker no tiene un motor local disponible. PostgreSQL 17 permitió reproducir 47 SQL cronológicamente en una base desechable con stubs mínimos de Auth; la migración más reciente se aplicó en Supabase y se verificó su ACL. Falta repetir la reproducción local con los 48 archivos y restaurar una exportación del esquema/datos remotos.

Las 13 versiones originales permanecen registradas: 20261024200926 enterprise_v1_operational_foundations; 20261024201951 marca_compras_legacy_recibidas; 20261024202024 funcion_saldo_tesoreria; 20261024202317 ventas_por_almacen_y_turno; 20261024202647 restringir_rpc_pago_sin_turno; 20261024203548 politicas_zonas_sin_duplicados; 20261024203558 indices_fk_advisor; 20261024203610 bloquear_cotizacion_vacia; 20261024203814 aislar_rpc_operativos; 20261024204307 inventario_apertura_distribuida; 20261024204453 indexar_apertura_inventario; 20261024210602 auditoria_operaciones_criticas; 20261024210642 auditar_cambios_permisos. Las diez migraciones forward-only son `20261026182059_privilegios_api_minimos`, `20261026182706_un_solo_turno_abierto`, `20261026182720_orden_compra_atomica`, `20261026182728_venta_credito_permisos`, `20261026195955_cajas_multisucursal`, `20261026200116_cajas_indices_fk`, `20261026200340_unificar_lectura_sucursales`, `20261026200923_almacenes_por_sucursal`, `20261026202241_registrar_auto_rls` y `20261026203451_empresas_sin_borrado_api`. La última revoca DELETE a `authenticated` en el maestro de empresas. La lista de las 25 versiones restantes está en [RECONCILIACION_MIGRACIONES.md](RECONCILIACION_MIGRACIONES.md).

### Secuencia segura al iniciar sesión en la CLI local

1. Autenticar CLI de forma interactiva en el terminal local. No pegar tokens ni contraseñas en el chat.
2. Enlazar el repo con el proyecto ref confirmado auxqjoxnsasnmtnakgmg.
3. Correr la lista de migraciones y confirmar que aparecen las 23 versiones remotas registradas; guardar el resultado localmente.
4. Crear una exportación lógica del esquema/datos relevantes y comprobar que se restaura en una base local desechable.
5. Comparar cada una de las 25 versiones fuera del historial con tablas, columnas, funciones, triggers, grants, políticas RLS y efectos sobre datos remotos, usando la matriz como checklist; sus clasificaciones aún no son certificación final.
6. Clasificar cada SQL: aplicado completo, aplicado parcial, no aplicado, obsoleto/redundante o destructivo. Nunca usar “parece que existe” como evidencia suficiente.
7. **Hecho el 26 de octubre:** se reprodujeron los 47 SQL locales en orden en PostgreSQL 17 desechable. La validación terminó con 40 tablas, todas con RLS, y el event trigger activo. Falta repetir la revisión sobre una restauración real del esquema remoto.
8. Solo registrar como aplicada una versión cuyo efecto SQL ya exista íntegramente en remoto. Para lo que no existe, crear una migración nueva forward-only; no reejecutar un archivo histórico destructivo.
9. Comparar el historial y el esquema final, explicar cada diferencia y documentar responsable/fecha.
10. A partir de esa línea base, crear una migración pequeña con la CLI → prueba local → respaldo comprobado → aplicación remota → revisión de logs, datos, RLS y advisors.

Comandos iniciales, en el terminal local del usuario:
- **npx supabase login**
- **npx supabase link --project-ref auxqjoxnsasnmtnakgmg**
- **npx supabase migration list --linked**

No ejecutar db push, db reset --linked ni migration repair antes de terminar la comparación y la prueba. Supabase advierte que migration repair solo edita el registro del historial, no ejecuta el SQL: https://supabase.com/docs/guides/deployment/database-migrations

## 4. Fase 2 — mapa funcional y alcance

Los doce módulos y responsabilidades están en la arquitectura objetivo. Reglas para evitar duplicidad:

- Maestros mantiene fichas y catálogos. Las pantallas de zonas comerciales y de reparto ya permiten asignar clientes y sucursales con permisos de configuración.
- Compras origina la deuda y recepción de bienes.
- Tesorería es la pantalla principal para saldo y liquidación de cuentas por cobrar/pagar.
- Inventario controla existencias por almacén y Kardex.
- Ventas origina la venta, salida y cuenta por cobrar.
- Seguridad define actores y acciones permitidas.
- Configuración administra parámetros e integración; no sustituye permisos o maestros.
- Reportes leen fuentes oficiales y no tienen saldos manuales paralelos.

El menú debe indicar qué está operativo, parcial o pendiente. La cuenta por pagar no debe figurar como entrada duplicada bajo Compras y Tesorería.

## 5. Fase 3 — reglas comunes

1. Identidad: auth.users es acceso; public.usuarios es el perfil. No eliminar cuentas para reiniciar negocio.
2. Autorizar en RPC/servidor y RLS, no solo mediante botones ocultos.
3. Usar estados y transiciones explícitas: borrador, confirmado/contabilizado, completado o anulado. Documento contabilizado no se reescribe.
4. Corregir dinero mediante reverso enlazado; nunca borrar movimiento ni recalcular un saldo en cliente.
5. Limitar pago por saldo pendiente; aplicación referencia la cuenta y el movimiento.
6. Limitar recepción por cantidad pendiente; contabilizar stock/Kardex en la misma transacción.
7. Idempotencia por operación/origen y bloqueo transaccional para concurrencia.
8. La compra/venta autorizada crea su cuenta por pagar/cobrar como parte del documento. Tesorería se exige para registrar el pago/cobro, no para crear la deuda derivada.
9. El visor de bitácora consulta eventos mediante RLS y el permiso auditoria:ver. Los triggers cubren las 39 tablas de negocio y configuración, incluyendo cajas, turnos, recepciones, movimientos, ubicaciones, asociaciones, aperturas, roles y permisos. La propia tabla de auditoría queda sin trigger para evitar una recursión.
10. Archivos en Storage privado y enlaces temporales; credenciales solo en servidor, nunca en VITE_*.
11. Fechas con zona horaria explícita, moneda/precisión coherente y reglas de redondeo.
12. Antes de multi-organización: definir organización, miembros, asignación de filas y RLS probado con dos organizaciones de prueba.
13. Antes de aprobaciones: nombrar responsable, umbral, reemplazo, vencimiento, rechazo y segregación de funciones.

## 6. Fase 4 — configurar e iniciar inventario

Orden real de trabajo:

1. Registrar empresa real y sus datos fiscales/contacto.
2. Registrar sucursales con dirección, horario y responsable.
3. Crear almacenes bajo sucursales: ubicación, horario, propósito y estado.
4. Validar productos, categorías, unidad de medida y correspondencia del catálogo proveedor-producto.
5. Contar físicamente cada producto por almacén.
6. Completar la matriz de apertura. Por producto, suma de almacenes debe ser igual al stock global legado.
7. Confirmar una sola apertura; revisar cabecera, existencias y movimientos del Kardex.
8. Desde entonces no editar stock global manualmente: usar recepción, venta, ajuste o transferencia autorizada.

La empresa, sucursales, almacenes, cajas e inventarios por almacén siguen vacíos. Por eso no se ejecuta la apertura aún. El sistema no conoce la ubicación de las 41 existencias globales actuales y no debe adivinar. La migración de apertura distribuida no crea saldos sin una matriz física aprobada.

**Criterios de salida:** cada producto con distribución física, suma sin diferencia, apertura única, Kardex conciliado y permisos comprobados.

**Límite de unidad:** columnas actuales usan cantidades enteras. Si se requiere peso o fracción, pausar apertura y migrar de manera coordinada detalle, stock, Kardex, restricciones y RPC.

## 7. Fase 5 — compras nacionales

Flujo:

1. Crear orden con proveedor, producto, cantidades, precio, moneda/IGV, fecha y actor. La creación normal ya usa un RPC remoto transaccional e idempotente para cabecera, líneas y cuenta por pagar; no exige turno de caja ni permiso de registrar pagos. También admite servicio/gasto sin recepción ni movimiento de inventario.
2. Validar correspondencia del producto interno con el catálogo del proveedor.
3. Confirmar orden y generar obligación con su referencia.
4. Registrar recepción parcial o total en almacén. Validar pendiente, contabilizar inventario y Kardex atómicamente.
5. Registrar pago parcial desde Tesorería; si sale de caja exigir turno abierto.
6. Cerrar la orden cuando se completen recepción y pago bajo reglas independientes.
7. Corregir recepción/pago mediante devolución o reverso referenciado, no borrando el historial.

Pendiente del V1 nacional: requisición interna, comparativo de ofertas, selección auditable del proveedor y devolución.

**Límite fiscal antes de usar compras reales:** el borrador aplica exclusivamente IGV estándar del 18% al total base. No cargar comprobantes exonerados, inafectos, mixtos o con otra tasa. Antes de abrir Compras a operación real se necesita clasificar el impuesto por línea, mostrar base/IGV/total por tratamiento y conciliarlo con el comprobante; una sola tasa para toda la orden no cubre facturas mixtas.

**Casos de salida manual:** dos recepciones parciales; una recepción que excede el pendiente; reintento tras timeout; doble envío; proveedor-producto desconocido; pago menor/mayor al saldo; cierre de orden; anulación. La creación usa una clave idempotente para que el reintento de la misma solicitud devuelva la orden ya guardada; reutilizar esa clave con otra carga se rechaza. No debe duplicarse stock o dinero y el Kardex debe reconstruir el origen.

## 8. Fase 6 — ventas y Tesorería

1. Crear cotización con productos y precios; cotización vacía no se convierte.
2. Confirmar la venta transaccionalmente: detalle, almacén, salida de stock y cuenta por cobrar.
3. Venta a crédito no exige turno de caja. Venta cobrada en efectivo sí requiere elegir una caja con turno abierto; cada turno se asocia a una caja por sucursal y el servidor valida que siga abierto. El aviso del frontend no bloquea ventas a crédito ni otros medios.
4. Registrar cobros parciales con aplicaciones al saldo. El servidor valida saldo concurrente.
5. Registrar pago a proveedor en su cuenta por pagar con medio y referencia.
6. Revertir errores con movimiento enlazado, conservando auditoría.
7. Incorporar bancos/conciliación solo al separar caja, cuentas bancarias y extractos.
8. Incorporar devolución, nota de crédito y SUNAT solo tras reglas tributarias, permisos y proveedor de integración definidos.

**Casos de salida manual:** crédito sin turno; efectivo sin turno rechazado; stock insuficiente; almacén distinto; cotización vacía; pago parcial; saldo excedido; reintento; reverso; usuario sin permiso. Una operación fallida no puede dejar detalle sin stock ni dinero sin cuenta. La venta a crédito usa permiso de Ventas; un cobro inmediato requiere además permiso de Tesorería.

## 9. Fase 7 — construir módulos restantes y BI

Orden:
1. La bitácora permite consultar eventos, filtrar por módulo/acción y paginar; sus triggers ya cubren las 39 tablas de negocio/configuración. Completar pruebas de acceso por rol y después definir aprobadores.
2. Diseñar workflow: límites de aprobación, responsables, suplencia, rechazo, expiración y segregación.
3. Logística: rutas, carga, stock reservado/liberado, entrega parcial/fallida y evidencia.
4. Comisiones: por venta/cobro/margen, escalas, ajustes y efecto de devoluciones.
5. Metas: periodo, asignación, vendedor/sucursal/producto, fuente y efecto de anulaciones.
6. Persistir notificaciones internas; luego agregar canales, reintentos e historial.
7. Publicar BI con definición, fórmula, corte y tabla de origen; conciliar con documentos operativos.

No crear tablas genéricas antes de aprobar reglas. Las tablas candidatas y sus dependencias están en la arquitectura objetivo.

## 10. Escenarios complicados que deben cubrirse

- Doble clic, timeout o reintento después del commit: clave idempotente, ningún doble movimiento.
- Dos usuarios intentan vender el último stock: bloqueo y validación transaccional.
- Compra histórica marcada completa: no se vuelve a recibir.
- Recepción o pago mayor al pendiente: rechazo del servidor.
- Almacén desactivado entre borrador y confirmación: segunda validación al confirmar.
- Documento con línea eliminada, precio inválido o catálogo sin vínculo: falla completa sin escritura parcial.
- Auth vencido, perfil ausente o permiso revocado: rechazo entendible y sin efectos parciales.
- Tabla nueva sin política RLS: no exponerla antes de desplegar sus políticas.
- Restauración: verificarla en local desechable y no pisar la base viva.

## 11. Protocolo para cada entrega

Antes de aplicar:
- Revisar SQL, RLS, grants, índices, funciones y manejo de errores.
- Probar procesos normales, permisos, concurrencia y casos negativos en entorno local.
- Exportar respaldo y confirmar que se puede restaurar.
- Aplicar una migración pequeña.
- Revisar logs, recuentos, asesores de seguridad/rendimiento y drift del esquema.
- Compilar y revisar el frontend afectado.
- Registrar versión, fecha, autor, resultado y plan de reverso/compensación.

Cada migración que agregue tablas públicas debe decidir explícitamente qué rol necesita acceso, otorgar solo esos permisos y habilitar/poblar RLS antes de que la pantalla dependa de la tabla. Funciones `SECURITY DEFINER` deben revocar EXECUTE de `PUBLIC`/`anon`, limitar el rol permitido y validar identidad/permisos dentro de la función. Referencias oficiales: [seguridad de Data API](https://supabase.com/docs/guides/api/securing-your-api) y [funciones de base de datos](https://supabase.com/docs/guides/database/functions).

No habilitar servicios de pago ni Pro sin una decisión explícita. Supabase confirma que la protección contra contraseñas filtradas requiere Pro o superior: https://supabase.com/docs/guides/auth/password-security

## 12. Situación pendiente de esta ronda

La compilación de producción (`npm run build`) pasó y `npm test` terminó con 48 pruebas aprobadas, 0 fallidas. En Supabase se verificó que las 9 cuentas y 9 perfiles siguen intactos, las 40 tablas conservan RLS y las 23 migraciones están registradas. `authenticated` ya no tiene permiso DELETE sobre `empresas`; `authenticated` conserva DML sujeto a RLS en `cajas`, y `anon`/`service_role` no tienen grants sobre esa tabla. La caja y turnos usan permisos de Tesorería, auditoría e índices para claves foráneas; la lectura de sucursales se consolidó en una sola política. Cada almacén requiere sucursal. El asesor mantiene la advertencia de protección contra contraseñas filtradas y 51 avisos informativos de índices sin uso; no se borraron datos.

Las 47 migraciones previas se ejecutaron cronológicamente en PostgreSQL 17 desechable con stubs mínimos de Auth y terminaron con 40 tablas, RLS activo en todas y el event trigger habilitado. La migración número 48 se aplicó remotamente y se verificó que `authenticated` ya no puede borrar empresas; falta reproducir la cadena de 48 localmente. Esto no sustituye restaurar el esquema remoto/datos reales ni probar RLS con los nueve usuarios. No se hicieron escrituras de negocio.

El corte actual confirma empresa/sucursales/almacenes/cajas e inventario por almacén en cero; el stock global legado de los 8 productos suma 41 unidades. No se debe abrir inventario hasta registrar ubicaciones reales y distribuir esas cantidades con conteo físico. Las compras históricas están pagadas y marcadas recibidas, por lo que no se deben reingresar. Hay un turno de caja abierto sin sucursal/caja asociada: debe conciliarse y cerrarse antes de usar los turnos por sucursal. Después, registra la empresa y sucursal reales en Maestros, crea una caja por cada punto real y abre turnos asociados. No compartir credenciales ni tokens.

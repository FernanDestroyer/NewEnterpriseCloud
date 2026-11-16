# Plan de implementación de los módulos pendientes

**Proyecto:** NewEnterprise / EnterpriseCloud  
**Corte del inventario usado:** 13 de noviembre de 2026  
**Alcance:** Configuración e Integraciones; Notificaciones y Aprobaciones; Reportes e Inteligencia de Negocios; Analizador de Proyectos.  
**Decisión de secuencia:** el Analizador se implementará al final, como pidió el usuario.

Este plan continúa el código y los flujos que ya existen. No considera terminada una función solo porque tenga una pantalla o una marca en el menú. Cada fase deja evidencia verificable antes de pasar al cambio siguiente.

Este documento es la ruta vigente para los cuatro módulos pendientes; las fases de módulos operativos que aparecen en guías anteriores son antecedentes y no cambian el orden aquí acordado.

## Ruta ejecutiva

1. Congelar una línea base segura del repositorio y Supabase; mantener intacta la historia divergente y validar las dependencias concretas de cada migración nueva antes de aplicarla.
2. Acordar reglas compartidas de permisos, datos, auditoría, estados e idempotencia que necesitan los módulos.
3. Completar **Configuración e Integraciones** reutilizando la configuración ya presente.
4. Completar **Notificaciones y Aprobaciones**, primero con bandeja interna y aprobaciones con reglas expresas.
5. Consolidar **Reportes e Inteligencia de Negocios** sobre fuentes reconciliadas y fórmulas aprobadas.
6. Implementar el **Analizador de Proyectos** al final mediante una API de análisis ejecutada en servidor.
7. Cerrar cada entrega con controles de seguridad, recuperación, aceptación funcional y documentación actualizada.

Las fases son una ruta y puertas de control; no son autorización para ejecutar cambios remotos en bloque.

## Estado de ejecución

- **Último corte remoto verificado:** 13 de noviembre de 2026: proyecto, historial, RLS, cuentas, aprobaciones, avisos, Tesorería/Caja multimoneda y saneamiento de avisos de políticas/índice duplicado. La copia local de esquema sigue siendo la del 12 de noviembre y no representa las migraciones remotas posteriores a ese corte.
- **Cambio local completado:** la descarga JSON que se presentaba como respaldo ahora se identifica como exportación operativa e informa sus límites y sensibilidad.
- **Cambio local completado:** los reportes de existencias y cuentas abiertas usan ahora saldos actuales; el filtro temporal queda para ventas, compras y Kardex. El detalle de cada saldo conserva la misma definición que la tarjeta.
- **Cambio local completado:** Configuración se organizó en pestañas Empresa, Sucursales y zonas, Catálogos, Datos de cobro y Exportar datos. Se conservaron los anclajes del menú; los datos de Yape/Plin/transferencia se describen como informativos, sin presentarlos como procesamiento de pago.
- **Cambio local y remoto:** se añadió la pestaña API/webhooks para consultar y guardar el estado no secreto del conector RENIEC/SUNAT en la tabla existente `configuracion`. `peru-document-lookup` está desplegada como v1 `ACTIVE` con JWT obligatorio. La pantalla puede consultar el estado del secreto sin exponerlo; aún falta ejecutar esa comprobación desde una sesión autorizada y probar una consulta real cuando exista una credencial válida.
- **Cambio local y remoto aplicado:** `AppLayout` sincroniza snapshots al cargar/actualizar los módulos autorizados; la campana muestra no leídas persistidas. `/notificaciones` permite marcar leído, archivar y consultar alertas archivadas/resueltas. La RPC sincroniza con `SECURITY INVOKER`; la tabla aplica RLS por usuario y permiso del módulo. Si una consulta del módulo falla o excede el límite de sincronización, no se resuelven sus alertas previas; la pantalla informa cuando muestra una vista temporal.
- **Estado anterior, reemplazado:** la campana y `/aprobaciones` mostraban un conteo derivado. Las migraciones `20261113113300` y `20261113120316` añadieron decisiones protegidas y avisos internos persistentes en la misma transacción.
- **Límite funcional de la primera entrega:** la bandeja inicial conservaba solo alertas operativas y lectura/archivo. Las migraciones `20261113113300` y `20261113120316` agregan decisiones de aprobación y avisos internos persistentes; no envían correo ni habilitan workflows configurables.
- **Cambio aplicado y verificado:** el reporte de inventario ahora usa una valoración PEPS conciliada por producto y almacén; si hay ubicaciones con stock sin Kardex, con movimientos empatados, cantidades distintas o sin costo, no presenta un total engañoso. El RPC corre como `SECURITY INVOKER`, verifica `auth.uid()` y `inventario:ver`, mantiene RLS, y quedó aplicado como migración `20261113035956`. La prueba autenticada remota vio 3 ubicaciones: 1 valorizada y 2 con incidencias.
- **Cambio local y remoto aplicado:** la migración `20261113132238_tesoreria_moneda_y_cierre_multimoneda_v1` persiste moneda por movimiento, completa solo datos históricos conciliables y separa los totales PEN/USD en Reportes. El cierre de Caja calcula esperado, contado y diferencia por moneda bajo bloqueo; los movimientos de efectivo sin moneda bloquean el cierre. En la verificación posterior hubo 8 movimientos (7 PEN, 1 USD, 0 desconocidos). Se revocó la escritura directa de turnos y se mantuvo RLS.
- **Cambio local y remoto aplicado:** `20261113144509_seguridad_rls_y_indice_duplicado_v1` retira un índice único duplicado, combina dos pares de políticas de lectura conservando su lógica OR y separa los escritores `FOR ALL` en políticas INSERT/UPDATE/DELETE. El aviso de seis grupos permisivos y el índice duplicado desaparecieron; no se modificaron filas ni cuentas.
- **Corrección local:** ventas, compras, cuentas abiertas y exportaciones operativas conservan PEN/USD por separado. El gráfico principal permite elegir la moneda y se retiró la resta de ventas menos compras que se presentaba como “margen”; esa resta mezclaba monedas y bases tributarias. El PDF ejecutivo ya se genera por separado para PEN o USD, filtra todas sus fuentes monetarias a la moneda elegida y no presenta la resta ventas-compras como utilidad.
- **Catálogo BI V1 documentado:** `docs/CATALOGO_METRICAS_BI_V1.md` registra fórmulas actuales, fuentes, fechas, monedas, limitaciones y los pasos que faltan para convertir los reportes operativos en BI aprobado.
- **Cambio local completado:** el detalle del reporte Kardex ahora consulta el mismo RPC `ec_consultar_kardex` que el módulo Inventario, aplica los límites de fecha de Perú, muestra como máximo 200 movimientos recientes con costos PEPS y promedio, y pagina hasta 10 000 filas. Solo calcula resúmenes y habilita CSV cuando confirma que el conjunto completo es estable; si no, solicita reducir el período.
- **Verificación de módulos y migraciones (13 de noviembre):** `npm run typecheck`, `npm test` (102 pruebas) y `npm run build` pasan. Aprobaciones (`20261113113300`), notificaciones internas (`20261113120316`) y Caja/Tesorería multimoneda (`20261113132238`) aparecen aplicadas en el remoto. Supabase confirmó RLS, ACL, funciones, conservación de 10 cuentas/10 perfiles y clasificación por moneda. La CLI está autenticada y enlazada; la prueba de interfaz/RPC con una sesión real queda pendiente.
- **Revisión local de exposición:** `.env` no está versionado y sí está ignorado; no se encontraron patrones de claves `service_role` o claves privadas en el código del cliente. No se leyó ni imprimió el contenido de `.env`.
- **Copia actual de esquema (13 de noviembre):** se exportaron `public,app_private` con la CLI enlazada y se restauraron en un PostgreSQL local 17.5 nuevo y aislado (`.local-validation-postgres/restore-current-20261113`). La verificación encontró 121 tablas públicas con RLS, 270 políticas públicas, seis tablas privadas con RLS y 0 usuarios en el Auth simulado. El remoto mantiene 10 cuentas Auth y 10 perfiles. El dump no contiene filas de negocio ni Auth; el servidor local se detuvo después de verificarlo. La copia del 12-11 se conserva solo como evidencia histórica.
- **Hallazgo de reconstrucción local:** una reproducción limpia aplica 40 archivos y falla en el 41.º, `20261029120000_compras_solicitudes_comparativo.sql`, porque invoca `app_private._tiene_permiso` antes de que los archivos locales lo creen. Dos archivos anteriores más dependen del mismo helper. El helper sí existe en el esquema remoto restaurado. La lista local no es una cadena ejecutable que reconstruya el proyecto remoto; no se reordenará ni se reejecutará como bloque.
- **Estado de la puerta de migraciones:** el historial remoto contiene 58 versiones y su última es `20261113144509`. El cruce actual contiene 29 coincidencias exactas, 76 archivos locales sin versión remota exacta y 29 versiones remotas sin archivo local con la misma versión. La copia actual de esquema está restaurada; no usar `db push`, `migration repair` ni reproducción histórica en bloque. Cada migración futura se comparará y aplicará individualmente, verificando Auth antes y después.

## 1. Punto de partida comprobado

La revisión de código en `docs/ESTADO_ACTUAL_MODULOS_PENDIENTES.md` encontró una base utilizable:

| Módulo | Ya existe | Trabajo pendiente principal |
|---|---|---|
| Configuración e Integraciones | En `MaintenancePage` se administran empresa, sucursales, almacenes, zonas, catálogos, pagos, monedas y datos informativos de cobro. | Ordenar responsabilidades, completar parámetros y series que realmente hagan falta, y definir integraciones y respaldo restaurable. El JSON actual no es una copia completa del sistema. |
| Notificaciones y Aprobaciones | `AppLayout` mantiene snapshots sincronizados; el centro persiste alertas y avisos de solicitud/decisión. Las migraciones `20261113113300` y `20261113120316` activan aprobación V1 y notificación interna idempotente en la misma transacción. | Pruebas de interfaz con sesiones reales y confirmación de destinatarios en aprobación, rechazo y documento obsoleto. Canales externos y workflows configurables quedan fuera de V1. |
| Reportes e Inteligencia de Negocios | Siete reportes operativos, filtros y detalle; Tesorería agrega PEN/USD; Caja concilia cierres por moneda; PDF y CSV respetan filtros y moneda. | Aprobar fórmulas/fuentes canónicas, cruzar flujos heredados con `ec_*`, definir históricos y conciliar resultados con documentos origen. |
| Analizador de Proyectos | Entrada ZIP/repositorio, obtención de código mediante GitHub/GitLab, evaluación por reglas, historial y exportación; el análisis se ejecuta mediante `project-analyzer` en Supabase Edge Functions con JWT. | Confirmar si el instructor requiere una API externa de IA además de la API propia. Verificar límites de tamaño, autorización real y errores con una sesión autenticada antes de cerrar el módulo. |

El baseline remoto actual se restauró el 13 de noviembre: 121 tablas públicas y seis privadas tienen RLS, con 270 políticas públicas, 331 funciones públicas y 69 privadas. Auth y perfiles remotos siguen en 10/10; en la restauración Auth es un stub vacío. El corte remoto registra 58 versiones. Hay 105 archivos locales (29 coincidencias exactas, 76 sin versión remota exacta y 29 remotas sin archivo con la misma versión). **La deriva restante no equivale a migraciones por ejecutar.**

## 2. Reglas que evitan retrabajo y sorpresas

- Preservar todas las cuentas de Supabase Auth y sus perfiles. No usar `db reset --linked`, limpieza general ni borrado de usuarios.
- No confiar en campos de estado del menú o documentos antiguos: verificar pantallas, servicios, consultas, RPC, tablas, políticas y comportamiento del flujo.
- Reutilizar las entidades y funciones vigentes. Antes de crear una tabla, buscar su equivalente en los dos modelos de Compras, `ec_*`, Maestros, Tesorería, Seguridad y Auditoría.
- No ejecutar migraciones históricas o reparar su registro hasta demostrar si sus efectos ya están, faltan o entran en conflicto. Los cambios nuevos serán pequeños y forward-only.
- Toda tabla expuesta tendrá grants explícitos y RLS probado según los roles reales. El permiso del frontend no sustituye autorización del servidor o de la base de datos.
- No guardar secretos de integraciones en columnas públicas, `VITE_*`, el navegador, reportes ni registros de eventos. Las funciones de Supabase pueden consumir secretos de entorno del lado servidor; documentar por separado los valores de desarrollo local y producción. ([Secretos de Edge Functions](https://supabase.com/docs/guides/functions/secrets))
- Operaciones sensibles usarán RPC/transacciones, autorización dentro del servidor, validación de estado y clave idempotente para tolerar doble clic, timeout y reintento.
- No comprar servicios ni suponer disponibilidad de capacidades de pago. Los conectores externos, envío de mensajes o proveedores con costo son optativos hasta verificar costo, cuota y autorización.
- V1 mantiene el espacio de trabajo actual. No introducir aislamiento SaaS de múltiples organizaciones cliente como parte de estos módulos.
- Zona horaria de negocio, moneda, sucursal, almacén, estados y reglas fiscales se definirán explícitamente; no dejar decisiones implícitas en el navegador.

## 3. Fase 0 — línea base y conciliación de Supabase

**Por qué va primero:** las cifras de migraciones muestran deriva entre el repositorio y el remoto. Añadir tablas antes de conocer el esquema efectivo puede duplicar objetos, resucitar lógica vieja o modificar permisos ya corregidos.

### Trabajo

1. Confirmar repositorio/carpeta principal, rama, cambios locales y proyecto/ref de Supabase conectado. No incluir carpetas de colaboradores.
2. Registrar el estado vigente de Auth, perfiles, tablas, columnas, constraints, secuencias, vistas, funciones, triggers, índices, grants, RLS y Storage. Guardar resultados de lectura con fecha, sin exportar secretos.
3. **Completado en esta sesión:** exportar y restaurar solo el esquema de `public` y `app_private` en PostgreSQL local. Por instrucción del usuario, no copiar filas comerciales, ya que son datos de desarrollo descartables; tampoco copiar usuarios Auth ni credenciales. Auth se protege comprobando las cuentas/perfiles antes y después de cualquier cambio remoto, y prohibiendo operaciones que eliminen o recreen `auth.users`. Storage, Edge Functions, configuración y secretos no se incluyeron en esta copia.
4. Comparar cada archivo local y cada versión remota por **efecto SQL**, no solo por nombre o número. Clasificar como: efecto completo, parcial, ausente, equivalente en otra migración, obsoleto o inseguro/destructivo.
5. No exigir una reproducción del archivo histórico completo cuando contiene dependencias que solo existen en la base viva y hay evidencia de despliegues con versiones distintas. Mantener el esquema restaurado como baseline de pruebas para migraciones nuevas.
6. Completar un libro de conciliación de efectos: objeto afectado, evidencia local/remota, diferencias, decisión (`equivalente`, `parcial`, `ausente`, `obsoleta` o `insegura`), riesgo y recuperación.
7. Conservar el historial existente. Crear migraciones nuevas con la CLI y aplicarlas de una en una solo después de probarlas sobre el baseline restaurado; no ejecutar `db push`, `migration repair` ni SQL histórico destructivo “para probar”.

### Puerta de salida

- Hay copia restaurable del esquema verificada en ambiente aislado; la exclusión de filas comerciales y Auth está documentada según la instrucción del usuario.
- El inventario actual de Supabase tiene fecha y corresponde al proyecto confirmado.
- Las 10 cuentas observadas se conservan; la cantidad se vuelve a comprobar antes y después de operaciones de esquema.
- Cada divergencia relevante para el esquema objetivo tiene explicación, sin interpretar las 76 versiones sin coincidencia exacta como pendientes automáticas.
- Existe un procedimiento de vuelta atrás o compensación para las migraciones nuevas.

**Puerta para migraciones nuevas:** el baseline y el proyecto ya se verificaron. Una migración nueva solo puede aplicarse de forma individual después de comprobar que el objeto no existe, comparar tablas/permisos/RLS relevantes, probar el SQL contra el baseline, revisar seguridad y volver a medir Auth/perfiles antes y después. Esta excepción no permite `db push`, `migration repair` ni reejecutar archivos históricos; la conciliación del resto continúa.

## 4. Fase 1 — contratos compartidos

Esta fase define reglas, no crea una plataforma genérica anticipada.

### Decisiones a cerrar

- Permisos existentes por rol para consultar y editar configuración, ver alertas, solicitar aprobación, aprobar y consultar informes.
- Alcance de los datos por empresa, sucursal y almacén en el espacio de trabajo actual.
- Zona horaria y “día de negocio” para cierres, reportes, vencimientos y alertas.
- Estados permitidos y transiciones; quién puede ejecutarlas y qué queda registrado.
- Criterio común de auditoría: actor, operación, fecha, objeto, resultado y referencia de origen; reutilizar la bitácora existente.
- Clave idempotente, manejo de reintentos y transacción para eventos operativos.
- Catálogo de eventos internos con nombre estable y payload mínimo, sin datos sensibles innecesarios.
- Política de retención y exportación para notificaciones, decisiones y ejecuciones de integración.

### Puerta de salida

Una matriz compacta de roles × acciones y un glosario de estados/eventos que los cuatro módulos reutilicen. Las políticas RLS deben seguir las reglas reales de autorización; RLS combina permisos SQL con políticas de filas y una política `authenticated` genérica no restringe por sí misma los datos. ([Guía de RLS](https://supabase.com/docs/guides/database/postgres/row-level-security))

## 5. Fase 2 — Configuración e Integraciones

**Orden:** primero terminar los datos descriptivos y parámetros compartidos; luego incorporar conectores puntuales. Configuración no sustituye Maestros, Seguridad ni Tesorería.

### Alcance propuesto

1. **Mapa y navegación:** separar en pantallas claras Configuración general, documentos/plantillas, integraciones y respaldo. Mantener en Maestros las fichas de productos, clientes, proveedores, zonas y ubicaciones.
2. **Parámetros generales:** reutilizar ficha de empresa, sucursales, almacenes, monedas y catálogos ya existentes. Identificar campos faltantes con usuarios; evitar un almacén genérico tipo clave-valor si un dato tiene significado, validación o dueño de módulo propio.
3. **Series y plantillas:** inventariar primero la numeración actual de documentos. Si falta, definir serie por tipo de documento y ámbito, unicidad, concurrencia, reinicio de período, documentos anulados y permisos. El número se asigna atómicamente al confirmar, no al abrir el formulario.
4. **Integraciones:** comenzar con un registro de conectores autorizados y su estado (configurado, válido, fallido, suspendido), versión/configuración no secreta, fecha de última comprobación y resultado resumido. Implementar un conector real solo cuando el flujo de negocio y proveedor estén definidos.
5. **Secretos:** guardar credenciales solo en secretos del servidor. La interfaz únicamente configura parámetros no secretos y muestra si la conexión está disponible, sin poder recuperar ni volver a presentar una clave.
6. **Ejecuciones y reintentos:** para cada integración habilitada, registrar identificador de operación, estado, intento, tiempos, respuesta sanitizada y referencia al documento. No reintentar automáticamente una acción no idempotente.
7. **Respaldo:** sustituir la idea de “JSON descargado = backup” por una descripción real del alcance. El plan de V1 incluirá exportación segura y una restauración ensayada de base de datos; Auth, Storage, funciones y secretos tendrán pasos explícitos de recuperación y protección de cuentas.

### No incluir inicialmente

Marketplace de conectores, sincronización bidireccional genérica, múltiples proveedores abstractos sin caso real, gestor de secretos propio, facturación electrónica, WhatsApp/SMS pagados y respaldo completo de infraestructura desde el navegador.

### Criterios de aceptación

- Cada parámetro tiene dueño funcional, validación, alcance y permiso identificables.
- Una configuración histórica usada por un documento contabilizado no cambia retroactivamente su contenido.
- Series no generan duplicados bajo solicitudes simultáneas ni se reutilizan por anulaciones.
- El estado de integración puede consultarse sin exponer token o credencial.
- Fallos, timeouts y reintentos quedan registrados y no duplican compras, pagos u otras operaciones.
- Exportación y restauración se prueban fuera de la base de producción/desarrollo compartida.

## 6. Fase 3 — Notificaciones y Aprobaciones

**Estrategia:** mantener la bandeja interna persistente y aplicar una política V1 confirmada para órdenes y conteos. Las reglas quedan explícitas en el servidor; no se configura un motor genérico sin un caso de negocio aprobado.

### Hallazgo verificado en los flujos actuales

- La interfaz activa de Compras usa Modelo A para solicitud y comparativo; también permite órdenes manuales y liberaciones de contrato. El Modelo B de `requisiciones_compra` tiene una aprobación histórica, pero está inactivo en la navegación; reutilizarla como si aprobara las órdenes actuales dejaría un flujo falso.
- El Inventario actual usa conteos `ec_*`; cerrar un conteo es irreversible y registra ajustes por diferencias. La función heredada `aprobar_conteo_fisico` trabaja con `conteos_inventario`, por lo que no aprueba el flujo que hoy usa `PhysicalInventoryPage`.
- No hay actualmente una bandeja de documentos pendientes de decisión ni una transición de negocio que se pause hasta aprobación. El centro persistente de alertas ya aplicado no cambia estados de compras ni de inventario.

**Reglas V1 confirmadas por el usuario:** las órdenes manuales, las convertidas desde una oferta y las liberadas desde un contrato requieren la misma aprobación; los conteos físicos requieren aprobación si presentan diferencias. Solo Gerente y Administrador pueden decidir, quien solicita no puede autoaprobarse y un rechazo exige motivo. El negocio se escribe en la misma transacción de la decisión. Las reglas se aplican igual a las tres rutas de órdenes. No se incluyen pagos, descuentos, comisiones, aprobación multinivel ni configuración de políticas desde la interfaz.

**Implementación V1 aplicada:** la migración `20261113113300` define snapshots, eventos, RLS, permisos y RPC transaccionales; `20261113120316` publica avisos internos idempotentes al solicitar y decidir. Las cuatro rutas de escritura solicitan aprobación; `/aprobaciones` consulta, decide y muestra eventos. El conteo sin diferencias usa su cierre protegido. RLS, ACL, triggers, Auth y revocación de escritores se verificaron en Supabase. Falta prueba visual con sesiones reales.

### Diseño funcional

1. Reemplazar progresivamente alertas calculadas solo en `AppLayout` por eventos del servidor originados en operaciones reales. Mantener una alerta derivada únicamente si se demuestra que no necesita historial o confirmación.
2. Definir cada evento: origen, destinatario, prioridad, acción requerida, vencimiento, datos mínimos y condición para cancelar/actualizarlo.
3. Crear notificación in-app con destinatarios explícitos, estados no leída/leída/archivada, fecha y vínculo al documento. No dar por leída una notificación solo por abrir el menú.
4. Guardar el evento/outbox en la misma transacción de la operación que lo origina. Un procesador idempotente crea entregas; fallar al enviar una notificación nunca debe deshacer una venta, recepción o pago ya confirmado.
5. Diseñar aprobación sobre una referencia al documento origen, con política y versión, solicitante, monto/datos evaluados, pasos requeridos, decisiones, fechas, motivo y resultado.
6. Una aprobación final habilita la transición del documento mediante una función autorizada. No crea una copia paralela del documento ni permite editar libremente el estado desde el cliente.
7. Rechazo, retiro, expiración, cambio del documento, aprobador ausente, delegación y reenvío deben tener transiciones expresas. Si cambia un dato clave después de solicitar aprobación, invalidar o reabrir según la regla acordada.
8. Aplicar segregación: el solicitante no se autoaprueba cuando la política lo prohíbe; validar rol/permisos actuales en servidor al decidir, no solo al asignar la tarea.
9. Añadir correo u otros canales únicamente después de que la bandeja interna sea confiable y el proveedor/costo estén aprobados. Registrar entregas, límites, errores y reintentos por canal.

### Decisiones de negocio de la primera versión

- **Incluidas:** órdenes manuales, conversiones de oferta, liberaciones de contrato y conteos con diferencias.
- **Aprobadores:** Gerente o Administrador; se consulta el rol y permiso vigente al decidir.
- **Segregación:** el solicitante no aprueba su propia solicitud.
- **Rechazo:** exige motivo de 3 a 1000 caracteres. Se registra actor, fecha y motivo.
- **Mientras espera:** no se crea la orden ni se aplican ajustes. La solicitud de oferta permanece seleccionada, el conteo pasa a pendiente de aprobación y el contrato limita a una liberación pendiente para evitar duplicar cupo.
- **Documento cambiado:** se cierra como obsoleto y se pide crear otra solicitud; la escritura final y la decisión se ejecutan en una transacción.
- **Fuera de V1:** umbrales por monto, aprobación multinivel/delegada, aprobaciones de pagos/comisiones, reglas administrables, email/SMS y vencimientos automáticos.

El usuario confirmó este alcance: aprobación común para las tres rutas de órdenes (manual, oferta seleccionada y contrato) y para conteos con diferencias. No volver a pedir confirmación de estas reglas. La política y las notificaciones internas están aplicadas en Supabase como `20261113113300` y `20261113120316`; RLS, grants, triggers y cuentas se verificaron. Falta probar el flujo visual con sesiones reales.

### Criterios de aceptación

- La bandeja pagina solicitudes visibles según RLS y permisos; quien solicita consulta las suyas y Gerente/Administrador las visibles para decidir.
- Las cuatro rutas de escritura terminan en la misma transacción de aprobación y ninguna llama desde el navegador a las RPC privilegiadas de creación/cierre.
- Solicitante y aprobador no pueden ser la misma cuenta; rechazos requieren motivo.
- Doble clic y reintentos reutilizan una clave idempotente; una orden o un ajuste no se duplican.
- Una validación de negocio fallida revierte la escritura y cierra la solicitud como obsoleta, con motivo y evento.
- El historial deja actor, hora, decisión y snapshot; los clientes no pueden escribir en las tablas de eventos.
- Antes de usarlo contra la aplicación activa, se debe aplicar la migración individualmente y verificar RLS/RPC con roles reales, Auth antes/después y las reglas de compra/inventario.

## 7. Fase 4 — Reportes e Inteligencia de Negocios

**Dependencia:** completar primero la reconciliación de fuentes y las reglas de configuración/estados. Los reportes actuales se conservan y se convierten en la primera batería de conciliación.

**Avance técnico:** Tesorería ya persiste moneda por movimiento y presenta importes separados PEN/USD. Caja registra saldo inicial y arqueo final por divisa; el servidor bloquea el turno durante el cierre, rechaza efectivo sin moneda y devuelve esperado/contado/descuadre. La migración `20261113132238_tesoreria_moneda_y_cierre_multimoneda_v1` está aplicada. La verificación remota confirmó 8 movimientos clasificados, 0 monedas desconocidas, 10 cuentas Auth y 10 perfiles. La interfaz completa sigue pendiente de una sesión autenticada real; BI formal sigue dependiendo del catálogo y la conciliación de KPI.

### Catálogo de métricas

Para cada indicador registrar: nombre, propósito, propietario, fórmula, fuentes canónicas, granularidad, estados incluidos/excluidos, fecha de negocio, zona horaria, moneda, redondeo, filtros, reglas de anulaciones/devoluciones, nivel de acceso, periodicidad y ejemplo de cálculo reconciliado.

### Orden de trabajo

1. Inventariar los siete reportes actuales y sus consultas: ventas, compras por proveedor, valor de existencias al precio de venta, valoración PEPS actual, cuentas por cobrar, cobros/pagos de Tesorería y Kardex.
2. Definir fuente canónica por dato. No sumar el flujo heredado y `ec_*` si representan la misma operación; documentar qué registros son históricos, duplicados o migrados.
3. Definir las fechas: fecha de documento, confirmación, movimiento físico, pago/cobro y corte. El saldo histórico debe calcularse “a la fecha” y no mezclar automáticamente saldos actuales con ventas de un período pasado.
4. Reconciliar cada total con documentos, líneas, Kardex y movimientos financieros subyacentes. Diferencias pequeñas por redondeo se documentan; diferencias de fuente se corrigen en origen, no con ajustes ocultos al reporte.
5. Mover agregaciones críticas a consultas/vistas seguras del servidor/base de datos y filtrar por los permisos/ámbito. Para vistas expuestas, definir explícitamente su relación con RLS; Postgres 15+ permite `security_invoker` para usar permisos del invocador.
6. Añadir gráficos y tendencias solo cuando haya datos históricos y fórmula estable. Crear snapshots/materialización si el volumen lo exige, con política de actualización y fecha de corte visibles.
7. Exportar los mismos filtros y fórmulas que se muestran en pantalla; registrar usuario y parámetros de exportación si incluye información sensible.

### Métricas V1 sugeridas

- Ventas brutas, anulaciones y ventas netas por período, sucursal y vendedor.
- Compras confirmadas, recibidas y pendientes, distinguiendo bienes de gastos.
- Existencias y valorización por almacén, conciliadas con Kardex PEPS según el flujo actual.
- Cuentas por cobrar/pagar abiertas y vencidas a una fecha de corte.
- Flujo de cobros/pagos aplicados, sin confundirlos con facturación/creación de deuda.
- Trazabilidad a documentos de origen en cada detalle.

Estos indicadores son candidatos. Antes de publicarlos se aprueba su fórmula y se valida con muestras calculadas manualmente.

### Criterios de aceptación

- Para cada informe, totales y filas se concilian con consultas fuente reproducibles.
- Fecha, estado, moneda, zona horaria y alcance aparecen explícitos.
- Los permisos de reportes no amplían el acceso a filas protegidas.
- No se incluyen usuarios/perfiles ni secretos en exportaciones.
- Un reporte histórico no cambia silenciosamente por modificaciones actuales de maestros o saldos.
- CSV/PDF respetan filtros y muestran fecha de generación/corte.

## 8. Fase 5 — Analizador de Proyectos (último módulo)

La obligación confirmada del instructor es que la evaluación use una API. Para mantener el proyecto dentro de la cuota disponible y no transferir código a un tercero, la V1 implementa una API propia de Supabase Edge Functions (`project-analyzer`). La función ejecuta en el servidor el motor determinista de hallazgos y recomendaciones AWS compartido con el proyecto. Esto cumple el flujo API, pero **no es una API de IA externa** ni una auditoría SAST certificada. Si el instructor exige explícitamente un proveedor de IA, se debe decidir proveedor, presupuesto y tratamiento de código en otra fase, con aprobación expresa.

### Contrato implementado

- El navegador abre ZIP de hasta 60 MB o lee solo repositorios públicos de GitHub/GitLab; los privados requieren exportar un ZIP autorizado.
- Antes de enviar, la interfaz exige consentimiento explícito y explica que rutas y texto seleccionado se procesan en el proyecto Supabase; el contenido no se escribe en tablas/Storage y el historial solo se guarda al pulsar «Guardar análisis».
- El cliente manda el inventario compacto a `project-analyzer`. Supabase exige JWT y la función vuelve a verificar la identidad y `tiene_permiso('analizador','ver')`; no usa `service_role` ni un secreto externo.
- El cliente prioriza manifiestos, configuración, infraestructura y código; límite por solicitud: 2.000 rutas, 250 archivos de texto seleccionados, 128 KB por archivo, 700 KB de texto acumulado y 1.65 MB de cuerpo preparado. El endpoint rechaza más de 2.500 rutas, 128 KB por texto, 800 KB acumulados o 1.8 MB de cuerpo. La respuesta informa cuántas rutas/textos fueron recibidos y si el inventario remoto fue parcial.
- El endpoint normaliza nombre/ruta, rechaza traversal y contenido fuera de límites, no guarda ni registra cuerpos; la respuesta incluye versión del motor, fecha, cobertura, hallazgos y recomendaciones. Las reglas/heurísticas no deben presentarse como prueba exhaustiva.
- No hay migración de base de datos para este endpoint. Las funciones `project-analyzer` y `peru-document-lookup` se despliegan de manera independiente; se mantiene `verify_jwt=true`.

### Criterios de aceptación y límites restantes

- ZIP y enlace terminan el cálculo en una Edge Function, no en el navegador; las APIs GitHub/GitLab solo entregan fuentes públicas.
- Pruebas cubren sesión/permiso, métodos, path traversal, tamaño de texto/cuerpo, respuesta versionada y ausencia de escrituras persistentes.
- Sigue pendiente la prueba de extremo a extremo desde la interfaz con una sesión autenticada existente y confirmar con el instructor si por «API» exige un proveedor de IA externo. No crear cuentas QA ni compartir tokens.
- Mantener avisos sobre límites, cobertura y heurísticas en pantalla e informe exportado.

## 9. Forma de ejecutar cada entrega

Cada subfase se entrega en una unidad pequeña, revisable y recuperable:

1. **Descubrir:** localizar pantalla, rutas, tipos, servicios, tablas, RPC y permisos que ya existen.
2. **Acordar contrato:** flujo, actor, estados, errores, datos y criterios de aceptación.
3. **Diseñar:** decidir si se reutiliza/extiende/crea; revisar RLS, grants, índices, concurrencia y auditoría antes del DDL.
4. **Implementar:** migración nueva y pequeña, servicio tipado, UI accesible y comportamiento de errores/carga/vacío.
5. **Verificar localmente:** aplicar en base desechable, probar caminos válidos y fallidos, permisos por rol, concurrencia e idempotencia; conservar evidencias sin secretos.
6. **Revisar seguridad y asesores:** revisar RLS, grants, funciones privilegiadas, índices de FK y alertas pertinentes. Una alerta no se corrige sin entender su contexto.
7. **Liberar de forma controlada:** respaldo comprobado, confirmar proyecto/ref, aplicar una migración, comprobar datos y comportamiento; mantener plan de compensación.
8. **Cerrar:** actualizar mapa de módulos, guía, estado, historial de migraciones y lista de decisiones; quitar etiqueta “pendiente” solo si pasa todos los criterios.

Los casos negativos esenciales incluyen: sesión vencida, permiso revocado, sucursal inactiva, duplicado, dos solicitudes simultáneas, documento ya modificado, timeout posterior al commit, notificación fallida, restauración de copia y usuario sin acceso a la fila.

## 10. Riesgos, decisiones y límites

| Riesgo | Tratamiento previsto |
|---|---|
| Historial local/remoto divergente | Fase 0 bloquea cambios de esquema hasta que el efecto esté conciliado; no ejecutar archivos por lote. |
| Borrar accidentalmente usuarios | No reset remoto; comprobar Auth antes/después y separar restauración de base de datos de la recuperación de cuentas. |
| Duplicar modelo de datos ya existente | Búsqueda de tablas/RPC por función y decisión explícita de reutilizar/ampliar/crear para cada entidad. |
| Permisos “correctos” en UI pero abiertos en DB | Matriz rol-acción más pruebas RLS/grants/RPC con identidades reales de QA. |
| Aprobar documento que cambió desde la solicitud | Guardar versión/snapshot del objeto aprobado y rechazar o reiniciar aprobación ante cambios relevantes. |
| Alertas duplicadas o perdidas | Outbox transaccional, clave idempotente, estado de entrega y reintentos limitados. |
| Indicadores contradictorios | Catálogo de métrica y conciliación contra documentos fuente antes de publicar tendencia. |
| Exceder plan gratuito | Empezar con bandeja interna y consultas normales; medir consumo; aprobar cualquier servicio externo/pagado por separado. |
| Exponer secretos o código privado en Analizador | API propia, consentimiento, límites, sin persistencia de código y sin envío a terceros en V1. Cualquier proveedor externo requiere decisión de costo y retención. |

Decisiones funcionales que deben quedar cerradas justo antes de cada fase: (a) qué conectores necesita realmente Configuración; (b) qué documentos requieren aprobación y con qué umbral/roles; (c) fórmula aprobada para cada KPI; (d) solo si el instructor exige un modelo/proveedor externo además del endpoint propio del Analizador, acordar presupuesto, retención y ubicación de la clave. No bloquean la V1 ya implementada ni la reconciliación restante.

## 11. Definición global de terminado

El conjunto de módulos se considera listo cuando:

- las rutas principales preservadas funcionan de extremo a extremo con Supabase conectado;
- los datos y migraciones están reconciliados y reproducibles desde una base aislada;
- las cuentas Auth permanecen intactas;
- cada flujo tiene validación del servidor, RLS/grants apropiados, auditoría, errores claros y protección ante reintento/concurrencia;
- las notificaciones y decisiones no duplican ni reemplazan el estado de los documentos operativos;
- los informes son reproducibles y conciliables;
- el Analizador cumple el requisito de API en servidor y controles de privacidad/costo;
- la restauración y la recuperación se ensayaron y la documentación coincide con el comportamiento desplegado.

## Referencias Supabase para la etapa de implementación

- [Migraciones de base de datos](https://supabase.com/docs/guides/deployment/database-migrations)
- [Seguridad de Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Secretos de Edge Functions](https://supabase.com/docs/guides/functions/secrets)
- [Autenticación y seguridad de Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Backups de base de datos](https://supabase.com/docs/guides/platform/backups)


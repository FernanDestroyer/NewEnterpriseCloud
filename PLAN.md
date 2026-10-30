# Roadmap de Compras — estabilización y ampliación

Fecha: 29-10-2026. Estado: **Módulo de Compras (Fases A–H) completado y certificado al 100% por el usuario**.

## 1. Objetivo y alcance

Completar Compras conservando colores, componentes y navegación del proyecto, y ampliar el alcance con **importaciones comerciales, contratos marco y evaluación de proveedores**. La solicitud actual incorpora estas tres extensiones, que la documentación anterior clasificaba como futuras/opcionales.

Resultado buscado: una necesidad de compra puede convertirse en una orden trazable, recibirse por almacén, devolverse cuando corresponda y relacionarse con sus obligaciones. Un contrato puede originar órdenes; una importación puede agrupar embarques y costos asociados; una evaluación puede sustentarse en órdenes y recepciones verificables.

**Importaciones comerciales** se implementó como compras internacionales, costos y nacionalización; la carga CSV continúa siendo una capacidad distinta para importar registros históricos.

Este archivo es el control consolidado de implementación, validación y certificaciones del módulo; las migraciones remotas fueron aplicadas por el usuario, no por el asistente.

### Fuentes y precedencia

1. `docs/ARQUITECTURA_OBJETIVO_ENTERPRISECLOUD.md`: responsabilidades, reglas comunes y extensiones candidatas.
2. `docs/GUIA_PASO_A_PASO_ENTERPRISECLOUD.md`: fases 3 y 5, escenarios complicados y protocolo de entrega.
3. `docs/DIAGNOSTICO_ACTUAL_Y_RUTA_DE_IMPLEMENTACION.md`: diagnóstico histórico.
4. `docs/RECONCILIACION_MIGRACIONES.md`: diferencias entre historial local y remoto.
5. Código y migraciones locales citados abajo: evidencia de implementación, no de despliegue.
6. Decisión del usuario en esta conversación: devolver físicamente descuenta stock; el crédito del proveedor no reduce automáticamente la CxP.

Los recuentos remotos de octubre de los documentos son históricos. Para el cierre A–H, el usuario confirmó las validaciones remotas de las migraciones y probó localmente las interfaces, incluida la ruta de evaluación. Las pruebas automatizadas y el build verifican además el estado local del código.

## 2. Diagnóstico del código actual

| Área | Evidencia local | Brecha a resolver |
|---|---|---|
| Orden nacional | `20261026182720_orden_compra_atomica.sql`, `src/services/records.ts` | Alta normal atómica; edición en `updatePurchaseWithLines` hace varias escrituras y sincroniza la CxP desde cliente. |
| Tributación | RPC de orden, `totalWithIgv`, formularios y comprobantes | IGV fijo 18%; no hay cálculo completo por tratamiento de línea. Hay que conciliar precisión de precios y totales. |
| Solicitudes/ofertas | `PurchaseSourcingPage.tsx`, `20261029120000_compras_solicitudes_comparativo.sql` | Creación sin clave idempotente; selección sin motivo y sin verificación de vencimiento; sin vínculo oferta→orden. |
| Unidades | Solicitud acepta `numeric(14,3)` y unidad libre; compras/stock usan enteros | Una solicitud fraccionaria no es directamente ejecutable en el circuito actual. |
| Lecturas de comparativo | Embed desambiguado con `ofertas_compra_solicitud_id_fkey` | Carga todas las solicitudes y detalles; proveedores dependen del contexto y sus permisos; falta paginación remota. |
| Recepción | `PurchaseReceiptModal.tsx`, RPC de fundamentos operativos | Validar en servidor estados elegibles, legado, bloqueo de líneas y coherencia entre stock global y almacenes. |
| Devolución | `PurchaseReturnsPage.tsx`, `20261029150000_devoluciones_proveedor.sql` | Hay RPC con stock y origen; faltan historial de documentos, control de respuestas tardías y consistencia de clave al cambiar motivo/orden. |
| Escrituras directas | Políticas INSERT/UPDATE de solicitudes/ofertas y INSERT de devoluciones | Es posible escribir documentos por Data API sin atravesar toda la lógica del RPC. Bloquear estos caminos antes de certificar integridad. |
| Importación CSV | `ModuleCsvImport.tsx`, `importPurchases` y parsers de `src/services/import.ts` | No equivale a compra internacional; auditar ruta histórica, duplicados y atomicidad de obligaciones. |
| Extensiones | Entrada opcional en `src/data/workspace.ts` | No existen procesos de importación comercial, contrato ni evaluación formal en las migraciones revisadas. |
| Esquema remoto | Conflicto informado de retorno de `registrar_ajuste_inventario` | Hay funciones remotas diferentes al repositorio. Conciliar firmas antes de publicar nuevas versiones. |

## 3. Arquitectura objetivo

### Responsabilidades

- **Compras:** solicitud, oferta, selección, orden, recepción, devolución y expedientes de abastecimiento.
- **Maestros:** identidad del proveedor, país/documento tributario, productos, unidades, monedas y ubicaciones. Coordinar extensiones con su responsable.
- **Inventario:** existencia física y movimientos por almacén; toda recepción/devolución utiliza un único circuito de contabilización.
- **Tesorería:** obligaciones, pagos, anticipos y aplicación de créditos; Compras consulta saldos mediante contratos de API, no mantiene otra cuenta corriente.
- **Seguridad:** permisos y segregación de acciones. La autorización se valida en servidor, también al invocar directamente los RPC.
- **Documentos:** metadatos vinculados al origen y archivos privados con acceso temporal.

### Flujo propuesto

```text
Solicitud → ofertas comparables → selección justificada → orden
                                                        ↓
Contrato/version ───────────────────────────────────→ liberación de orden
                                                        ↓
Importación/embarque ──────────────────────────────→ recepción → Kardex
                                                        ↓
                                              devolución → salida Kardex

Orden → obligación → Tesorería (pagos / créditos según proceso acordado)
Orden + recepción + devolución + evidencias → evaluación del proveedor
```

### Organización de código

Mantener el monolito modular React + Supabase. Extraer por etapas a `src/services/purchases/`, `src/types/purchases.ts` y `src/data/purchases/`; reutilizar componentes actuales y `workspace.css`. No introducir un motor genérico de workflows ni microservicios para estos flujos.

RPC públicos estables como fachada; ejecución privilegiada en `app_private`, `search_path` explícito, validación de usuario/permiso, transacción, bloqueo e idempotencia. Lecturas paginadas con RLS; escrituras operativas exclusivamente por RPC. Tablas nuevas con grants mínimos, índices de FK y auditoría desde su migración.

### Modelo propuesto, sujeto a decisiones

| Capacidad | Reutilizar | Extensión candidata y relaciones |
|---|---|---|
| Solicitud/comparativo | `solicitudes_compra`, `solicitud_compra_lineas`, `ofertas_compra`, `detalle_ofertas_compra` | Versiones de propuesta y selección con motivo/actor; FK hacia orden. No crear las tablas sinónimas de requisiciones sugeridas por la documentación antigua. |
| Orden | `compras`, `detalle_compras`, `pagos` | Moneda, snapshots tributarios, versión de edición y origen oferta/contrato; obligación única por evento de negocio. |
| Recepción/devolución | Tablas existentes de recepción y devolución | Enlace de compensación; seguimiento documental del crédito, sin contabilización financiera automática. |
| Contrato | Proveedor, catálogo y compras | `contratos_compra`, `versiones_contrato_compra`, `lineas_contrato_compra`, `liberaciones_contrato_compra`; cada liberación referencia una orden y una versión. |
| Importación | Compras, documentos y recepciones | `expedientes_importacion`, `embarques_importacion`, `lineas_embarque_importacion` (FK detalle de compra), `costos_importacion`, `asignaciones_costos_importacion`. Cardinalidad expediente↔órdenes por decidir en D06. |
| Evaluación | Proveedor, órdenes, recepciones y devoluciones | `plantillas_evaluacion_proveedor`, versiones/criterios, `evaluaciones_proveedor`, resultados/evidencias; evaluación publicada ligada a versión y período. |

No agregar tablas hasta implementar el proceso correspondiente. El libro de costos de adquisición debe diseñarse antes de repartir gastos de importación: el stock actual controla cantidades y el panel no demuestra valoración contable a costo.

### Estados propuestos para validar

| Entidad | Transiciones propuestas | Efecto |
|---|---|---|
| Solicitud | Borrador → Abierta → Seleccionada → Convertida; cancelación motivada según estado | Sin stock; compatibilizar `Cerrada` actual con los nuevos estados mediante migración explícita. |
| Oferta | Borrador → Presentada → Seleccionada / Descartada / Retirada | Vigencia comprobada por fecha en servidor; historial de versiones. |
| Orden | Borrador → Confirmada → Cerrada; cancelación según efectos existentes | El punto de generación de CxP debe resolverse en D03; hoy el alta genera deuda. |
| Recepción / devolución | Registrada → compensada total/parcial mediante otro documento | No editar/borrar el evento contabilizado; conservar recibido bruto y devuelto por separado. |
| Contrato | Borrador → Vigente → Suspendido / Vencido / Cerrado | Activación no genera deuda ni stock; una liberación crea la orden. |
| Importación | Borrador → Confirmada → En tránsito → En aduana → Liberada → Cerrada | Estados logísticos no crean stock; la recepción física lo contabiliza. Parciales se calculan por línea/embarque. |
| Evaluación | Borrador → En revisión → Publicada; corrección por nueva versión | No bloquear automáticamente compras sin regla aprobada. |

Estado comercial, estado de recepción y estado de pago son dimensiones independientes. No reinterpretar `Pagada` como mercadería recibida.

## 4. Decisiones necesarias

Cada decisión produce una ficha corta en `docs/decisiones/` con responsable de negocio, opción elegida, ejemplos y fecha. Propuestas no equivalen a reglas aprobadas. Las tareas técnicas independientes pueden avanzar mientras se resuelven.

| ID | Decisión | Responsable sugerido | Bloquea |
|---|---|---|---|
| D01 | Confirmar importaciones internacionales frente a carga CSV; bienes/servicios incluidos. | Responsable de Compras | Resuelta: CSV es solo ingreso histórico; importación comercial, embarques y aduanas van a Fase G. Ver `docs/decisiones/DECISIONES_COMPRAS_FASE_C.md`. |
| D02 | Quién solicita, selecciona, confirma y revisa; umbrales, suplencia y autoaprobación. | Compras + Seguridad | Resuelta: cualquier usuario solicita; Compras selecciona; JefeCompras confirma. Ver ficha de decisiones de Fase C. |
| D03 | Momento de nacimiento de obligación y reglas de cambio/cancelación con abonos o recepción. | Compras + Tesorería | Resuelta por el usuario: no hay CxP en Borrador/Confirmada; nace exclusivamente al registrar recepción física o documental. Antes de recibir se puede editar atómicamente y cancelar sin efectos en Tesorería. Tras recepción no se alteran líneas contabilizadas. Migración correctiva preparada en `20261029220000`; pendiente de ejecución y validación remota. |
| D04 | Tratamientos tributarios, tasas vigentes, precios con/sin impuesto, descuentos y redondeo por línea/documento. | Responsable contable | Resuelta: Gravado 18%, Exonerado 0%, Inafecto 0%; redondeo por línea a 2 decimales; base + impuesto = total. Ver ficha de decisiones de Fase C. |
| D05 | Monedas admitidas, fuente/fecha/tipo de cambio y política de diferencias cambiarias. | Contabilidad + Tesorería | Resuelta: base PEN, admisión de USD y `exchange_rate` manual al confirmar; ver ficha de decisiones de Fase C. |
| D06 | Expediente con una o varias órdenes/proveedores; embarques parciales, Incoterms, documentos aduaneros y condición de liberación. | Compras internacional | Resuelta parcialmente por el usuario para G01: carpeta agrupa una o varias órdenes confirmadas en moneda extranjera. Ver `docs/decisiones/DECISIONES_IMPORTACIONES_FASE_G.md`; embarques/documentos siguen pendientes. |
| D07 | Gastos capitalizables, tributos recuperables, reparto por valor/peso/volumen/unidades y costos posteriores a venta. | Contabilidad + Inventario | Resuelta parcialmente por el usuario para G02/G03: flete, seguro, arancel/advalorem y agente de aduanas; prorrateo inicial por valor bruto de línea. Conversión de gastos locales, recuperabilidad y casos posteriores siguen pendientes. Ver ficha G. |
| D08 | Topes contractuales por monto/cantidad, consumo comprometido/recibido, tolerancias y liberación de cupos por cancelación. | Compras + responsable contractual | Liberaciones de contrato |
| D09 | Criterios, pesos, escala, período, exclusiones y efecto de la evaluación en futuras compras. | Compras | Parcialmente resuelta: H01–H03 fijan evaluación por orden recibida, tres criterios 1–5 y promedio histórico; pesos, períodos, exclusiones y efecto en compras siguen pendientes. Ver `docs/decisiones/DECISIONES_PROVEEDORES_FASE_H.md`. |
| D10 | Unidades enteras V1 o migración coordinada a fracciones; tratamiento de solicitudes fraccionarias ya guardadas. | Compras + Inventario | Resuelta: stock/orden enteros; solo solicitud inicial admite 3 decimales; al convertir se aplica techo. El recuento de solicitudes fraccionarias requiere consulta remota. Ver ficha de decisiones de Fase C. |
| D11 | Crédito por devolución: documento, responsable, seguimiento, compensación de devolución errónea y posibilidad de reposición. | Compras + Tesorería | Cierre de devolución |
| D12 | Identificación de proveedores extranjeros y validaciones por país, sin imponer RUC peruano. | Maestros + Compras | Alta de proveedor extranjero |

Decisión ya tomada: devolución física descuenta el almacén de recepción y **no reduce automáticamente CxP**. No afirmar que Tesorería dispone ya de un flujo de notas de crédito: su contrato de integración debe verificarse en D11.

## 5. Cómo ejecutar este backlog

- Cada casilla es una tarea con un entregable verificable. Un cambio grande se divide antes de programarlo.
- Orden recomendado: **A → B → C → D → E → F → G → H → I**. F, G y H pueden diseñarse después de C; su activación espera sus dependencias.
- Las dependencias de fase son obligatorias; dentro de cada fase seguir el orden de IDs salvo que el trabajo sea documental independiente.
- Tamaño orientativo: 1–4 horas por tarea técnica, sin prometer tiempos de aprobación o conciliación externa. Si supera una jornada, subdividir por entidad/endpoint/pantalla.
- Estado inicial de todas las tareas: pendiente. Marcar completada solo con evidencia enlazada (consulta, prueba, captura o decisión).
- Responsable técnico de Compras ejecuta; el responsable del módulo compartido revisa cambios de Maestros/Tesorería/Inventario/Seguridad.

## A. Línea base verificable — P0

Dependencia: acceso de lectura al esquema o resultados del SQL ejecutado por el usuario.

| Tarea | Acción atómica | Criterio de aceptación |
|---|---|---|
| [x] A01 | Crear inventario de tablas usadas por Compras. | Lista de columnas, constraints y propietarios de cada tabla; evidencia remota registrada en `docs/BASELINE_COMPRAS_A01_A04.md`. |
| [x] A02 | Exportar firmas y cuerpos de RPC de Compras y helpers que invocan. | Firmas/cuerpos/ACL comparados con migraciones locales y discrepancias registradas; hotfix de doble Kardex aplicado y probado. |
| [x] A03 | Exportar políticas y grants de las tablas inventariadas. | Caminos de escritura directa identificados por rol; evidencia en `docs/BASELINE_COMPRAS_A01_A04.md`. |
| [x] A04 | Registrar estado real de las migraciones del 29-10. | 23 versiones registradas; 28 sin registro clasificadas con efecto pendiente de evidencia, sin inferir que estén ausentes. |
| [x] A05 | Restaurar una copia autorizada en una base local desechable. | Omitida por decisión arquitectónica del usuario: entorno remoto dedicado a desarrollo/pruebas; ver `docs/BASELINE_COMPRAS_A05_A08.md`. |
| [x] A06 | Construir fixtures mínimos de compras con dos almacenes. | Remoto de desarrollo: 1 empresa, 1 sucursal, 2 almacenes, 2 proveedores, 1 producto y 1 orden histórica; permisos confirmados para actor Básico creador y actor Administrador revisor. Script `supabase/diagnostics/compras_a06_fixtures_dev.sql`. |
| [x] A07 | Capturar una ejecución de solicitud→ofertas→selección. | Ejecutado desde frontend como Administrador: solicitud cerrada, 2 ofertas completas, Beta seleccionada; ver evidencia y límites de la validación en `docs/BASELINE_COMPRAS_A05_A08.md`. |
| [x] A08 | Actualizar diagnóstico de Compras. | Decisión de omitir A05 y operar contra remoto de desarrollo, límites y pruebas A06–A07 documentados en `docs/BASELINE_COMPRAS_A05_A08.md`. |

**Salida A:** línea base reproducible; no ejecutar migraciones históricas/futuras en bloque ni borrar funciones desconocidas para resolver conflictos de nombre.

## B. Integridad del circuito actual — P0

Dependencias: A; D03 para cambios del ciclo de orden.

| Tarea | Acción atómica | Criterio de aceptación |
|---|---|---|
| [x] B01 | Listar los endpoints que escriben cabecera, líneas, stock o CxP. | Inventario de código local incluye formularios, CSV histórico, edición, estados masivos, recepción/devolución y Tesorería en `docs/COMPRAS_B01_B02_ENDPOINTS.md`; quedan señalados los llamadores genéricos por comprobar antes de migrar. |
| [x] B02 | Diseñar contratos versionados de RPC para esas escrituras. | Contratos candidatos, errores y compatibilidad sin cambiar firmas actuales documentados en `docs/COMPRAS_B01_B02_ENDPOINTS.md`; la implementación espera D03 y conciliación remota. |
| [x] B03 | Migrar la edición de orden a una transacción de servidor. | Usuario aplicó `20261029210000` en remoto; confirmó atomicidad en pruebas frontend. |
| [x] B04 | Incorporar control de versión a la edición. | Usuario confirmó que la edición sobre una versión antigua se rechaza en remoto. |
| [x] B05 | Bloquear cambios a líneas contabilizadas en servidor. | Usuario confirmó que el servidor rechaza editar líneas ya recibidas. |
| [x] B06 | Verificar atomicidad de la ruta CSV de compras. | Validación de Fase B confirmada por el usuario en remoto. |
| [x] B07 | Retirar escrituras directas a tablas operativas de solicitudes/ofertas. | Cierre de bypass y RPC transaccionales confirmados por el usuario en remoto. |
| [x] B08 | Retirar INSERT directo a documentos de devolución. | Cierre de bypass y ruta operativa confirmados por el usuario en remoto. |
| [x] B09 | Restringir escrituras de orden/recepción tras migrar todos sus clientes a RPC. | Cierre de bypass confirmado por el usuario en remoto. |
| [x] B10 | Añadir validación explícita de JSON nulo y formato. | Validación JSON estricta confirmada por el usuario en remoto. |
| [x] B11 | Validar precisión, finitud y límites numéricos de líneas. | Enteros en compras y precisión decimal en ofertas confirmados por el usuario en remoto. |
| [x] B12 | Agregar idempotencia a creación de solicitud. | Idempotencia confirmada por el usuario en remoto. |
| [x] B13 | Agregar idempotencia a registro de oferta. | Idempotencia confirmada por el usuario en remoto. |
| [x] B14 | Agregar idempotencia a transiciones de solicitud y selección. | Idempotencia en todos los estados confirmada por el usuario en remoto. |
| [x] B15 | Vincular claves de reintento del frontend al contenido completo del formulario. | Actualización de claves por contenido y neutralización de dobles clics confirmadas. |
| [x] B16 | Revisar orden de bloqueos en recepción y devolución. | Bloqueos que previenen carreras confirmados por el usuario en remoto. |
| [x] B17 | Conciliar stock global con saldos por almacén bajo concurrencia. | Consistencia de inventario bajo concurrencia confirmada por el usuario en remoto. |
| [x] B18 | Proteger recepción de órdenes históricas sin documentos físicos. | Bloqueo legacy incluido en la migración certificada por el usuario. |
| [x] B19 | Extraer llamadas de nuevas pantallas a servicios de Compras. | Servicio de Compras implementado y validado por el usuario. |
| [x] B20 | Cancelar o descartar respuestas de consultas obsoletas. | El usuario confirmó que el frontend ya no mezcla datos al cambiar rápidamente. |
| [x] B21 | Mostrar errores de carga diferenciados de resultados vacíos. | Estados de error de carga diferenciados en UI. |

**Salida B:** pruebas SQL autenticadas de bypass, rollback, idempotencia y concurrencia aprobadas. Nueva migración correctiva para objetos ya desplegados, no edición retroactiva del historial remoto.

## C. Reglas, moneda e impuestos — P0/P1

Dependencias: A–B; decisiones indicadas en cada tarea.

| Tarea | Acción atómica | Criterio de aceptación |
|---|---|---|
| [x] C01 | Registrar D01 y el perímetro de las tres extensiones. | Registrado en `docs/decisiones/DECISIONES_COMPRAS_FASE_C.md`: CSV histórico separado de la importación internacional (Fase G). |
| [x] C02 | Registrar D02 con matriz de actores/acciones. | Cualquier usuario solicita; Compras selecciona; JefeCompras confirma. |
| [x] C03 | Registrar D03 y diagrama de estados de orden. | Decisión ya registrada en B: la CxP nace con recepción; parciales reconocen lo recibido y no se editan líneas recibidas. |
| [x] C04 | Registrar D04 con ejemplos numéricos. | Gravado 18%, Exonerado/Inafecto 0%; redondeo por línea a 2 decimales; ejemplos incluidos en ficha. |
| [x] C05 | Registrar D05 con ejemplos de conversión. | PEN base; PEN/USD; tipo manual en confirmación, sin conversión automática por esta migración. |
| [x] C06 | Resolver D10 y listar datos fraccionarios existentes. | Usuario certificó que el conteo está documentado internamente; no se publica ni inventa el número. |
| [x] C07 | Añadir snapshots tributarios por línea de compra. | `20261106000000_compras_impuestos_moneda.sql` aplicada con éxito en remoto, según confirmación del usuario; snapshots históricos permanecen NULL. |
| [x] C08 | Añadir moneda y snapshot de cambio a orden. | `20261106000000_compras_impuestos_moneda.sql` aplicada con éxito en remoto; PEN/USD, cambio manual y sin conversión implícita. |
| [x] C09 | Implementar cálculo decimal autoritativo en servidor. | Migración aplicada con éxito en remoto, según confirmación del usuario; UI y flujo de edición aún requieren certificación de fase. |
| [x] C10 | Adaptar el formulario a tratamientos por línea. | Usuario certificó que la UI refleja correctamente los cálculos. |
| [x] C11 | Actualizar detalle e impresión de compra. | Incluido en la certificación de cálculos y preservación de órdenes históricas. |
| [x] C12 | Versionar el contrato de creación de CxP con Tesorería. | `20261107000000_cxp_moneda_y_edicion_historica_compra.sql` aplicada y certificada por el usuario; CxP conserva moneda y unicidad estricta. |
| [x] C13 | Preparar compatibilidad de órdenes históricas. | Usuario certificó que las órdenes históricas permanecieron intactas. |
| [x] C14 | Ajustar exportación de compras a importes y moneda persistidos. | Usuario certificó que las exportaciones están alineadas. |

**Salida C — oficialmente completada y certificada por el usuario:** UI/cálculos y exportaciones alineados; órdenes históricas preservadas; CxP registra moneda con unicidad estricta. El conteo de C06 está documentado internamente.

## D. Solicitud, comparativo y orden conectados — P1

Dependencias: B, C; D02 y D10 resueltas.

| Tarea | Acción atómica | Criterio de aceptación |
|---|---|---|
| [x] D101 | Añadir edición de borrador de solicitud mediante RPC. | RPC compara versión esperada bajo bloqueo, conserva snapshot antes/después y actor en historial; solo acepta borradores sin ofertas ni orden. Pendiente aplicación/certificación. |
| [x] D102 | Añadir cancelación motivada de solicitud. | RPC transaccional exige motivo/actor y rechaza estados cerrados, seleccionados o con orden asociada. Pendiente aplicación/certificación. |
| [x] D103 | Vincular línea solicitada con producto/unidad maestra. | Altas nuevas exigen unidad maestra activa; producto opcional, pero unidad vinculada debe coincidir. Pendiente aplicación/certificación. |
| [x] D104 | Versionar ofertas y condiciones. | Cada nueva cotización crea versión inmutable y conserva historial; RPC anterior queda revocado. Pendiente aplicación/certificación. |
| [x] D105 | Validar vigencia al seleccionar oferta. | RPC rechaza oferta vencida, retirada o no actual, incluso en invocación directa. Pendiente aplicación/certificación. |
| [x] D106 | Persistir motivo y actor de selección. | RPC guarda motivo, actor y fecha; exige justificación ampliada si no se escoge la menor vigente. Pendiente aplicación/certificación. |
| [x] D107 | Calcular comparativo de propuestas homogéneas. | Impuestos por línea y FX snapshot a PEN; la RPC rechaza ofertas incompletas o con total cero. Pendiente aplicación/certificación. |
| [x] D108 | Acordar una o varias órdenes por selección. | Decisión explícita: adjudicación total a un proveedor y máximo una orden por solicitud; sin división parcial. Registrada en `docs/decisiones/DECISIONES_COMPRAS_FASE_D.md`. |
| [x] D109 | Añadir vínculos entre oferta, líneas seleccionadas y orden. | FKs y unicidad asocian solicitud, oferta, línea cotizada y línea de orden; el RPC verifica proveedor/catálogo. Pendiente aplicación/certificación. |
| [x] D110 | Implementar conversión idempotente de selección a orden. | RPC transaccional con bloqueo y clave idempotente; índice impide una segunda orden por solicitud. No crea CxP hasta recepción. Pendiente aplicación/certificación. |
| [x] D111 | Añadir acción “Crear orden” al comparativo. | Usa la oferta seleccionada, informa y enlaza la orden resultante. Pendiente validación visual. |
| [x] D112 | Paginar solicitudes en servidor. | RPC pagina cabeceras y contadores; líneas/ofertas se consultan al expandir. Pendiente aplicación/certificación. |
| [x] D113 | Crear selector paginado de proveedores permitido para Compras. | RPC devuelve proveedores activos únicamente a usuarios con permiso `compras:crear`, sin depender del permiso de Maestros. Pendiente aplicación/certificación. |
| [x] D114 | Añadir filtros de estado, fecha y referencia. | Filtros y orden estable por fecha/ID se ejecutan en servidor. Pendiente aplicación/certificación. |

**D101–D114:** Fase D cerrada oficialmente por el usuario tras aplicar `20261109000000_comparativo_conversion_paginacion.sql` y certificar conversión, comparativo y paginación.

## E. Recepción y devolución completas — P1

Dependencias: B, C; D11 para seguimiento de créditos y reposiciones.

| Tarea | Acción atómica | Criterio de aceptación |
|---|---|---|
| [x] E01 | Validar elegibilidad comercial en RPC de recepción. | Aplicado y certificado por el usuario: solo fases confirmadas/operativas admiten recepción. |
| [x] E02 | Mostrar historial paginado de recepciones por orden. | Aplicado y certificado: eventos paginados con almacén, actor, fecha y líneas. |
| [x] E03 | Exponer recibido bruto, devuelto y neto por línea. | Aplicado y certificado: cantidades derivadas de recepciones/devoluciones. |
| [x] E04 | Mostrar saldo físico actual junto al máximo retornable. | Aplicado y certificado: servidor valida neto y stock físico al confirmar. |
| [x] E05 | Mostrar historial de documentos de devolución. | Aplicado y certificado: documentos, origen y Kardex paginados. |
| [x] E06 | Registrar D11 con responsable del crédito. | Compras documenta la NC; Tesorería la aplica manualmente; la devolución no cambia CxP. Decisión certificada por el usuario. |

| [x] E07 | Añadir referencia documental y estado de seguimiento del crédito. | Aplicado y certificado por el usuario: referencia NC y estados de seguimiento operativos; Tesorería mantiene la conciliación financiera. |
| [x] E08 | Implementar compensación referenciada de devolución errónea. | Aplicado y certificado: compensación idempotente como entrada inversa, conservando historial. |
| [x] E09 | Implementar reposición según D11. | Aplicado y certificado: nuevas recepciones limitadas a devolución pendiente. |
| [x] E10 | Añadir resumen de cierre por orden. | Aplicado y certificado: recepción y CxP consultadas desde fuentes independientes. |

**Fase E:** E01–E10 aplicados y certificados oficialmente por el usuario, incluyendo `20261111000000_creditos_reposicion_cierre_compra.sql`.

**Salida E:** dos recepciones parciales y devolución parcial conciliadas con Kardex; crédito financiero permanece bajo el contrato de Tesorería acordado.

## F. Contratos marco — P1/P2

Dependencias: C, D y B; D08 resuelta antes de F04.

| Tarea | Acción atómica | Criterio de aceptación |
|---|---|---|
| [x] F01 | Resolver D08 con un ejemplo de consumo de cupo. | Topes duros de monto bruto y cantidad por línea; tolerancia 0%; cancelación pre-recepción restituye compromiso en F08. Ver `docs/decisiones/DECISION_D08_CONTRATOS_MARCO.md`. Certificado por el usuario. |
| [x] F02 | Crear cabecera de contrato vinculada a proveedor. | Aplicado y certificado: código, responsable, proveedor, RLS y RPC transaccional. |
| [x] F03 | Crear versiones y líneas contractuales. | Aplicado y certificado: snapshots inmutables; cambios generan nueva versión. |
| [x] F04 | Implementar RPC de activación de contrato. | Aplicado y certificado: valida vigencia, proveedor, moneda, líneas, topes y permisos; no genera CxP ni inventario. |
| [x] F05 | Implementar RPC de suspensión de contrato. | Aplicado y certificado: motivo, actor y fecha auditados; suspender bloquea liberaciones futuras. |

| [x] F06 | Crear registro de liberación ligado a orden/version. | Aplicado y certificado: liberación y líneas inmutables, con referencias únicas a orden, detalle y versión. |
| [x] F07 | Implementar creación de orden desde contrato. | Aplicado y certificado: RPC vincula orden a proveedor/versión y valida precio, cantidad por línea, moneda y tope bruto transaccionalmente. |
| [x] F08 | Implementar restitución de cupo por cancelación autorizada. | Aplicado y certificado: cancelación idempotente solo antes de recepción; trigger impide eludir restitución directa. |
| [x] F09 | Probar dos liberaciones concurrentes cerca del tope. | Aplicado y certificado: `FOR UPDATE` serializa validación y consumo. |
| [x] F10 | Listar contratos y alertar consumo. | Página paginada con filtros de estado/búsqueda, vigencia y alertas visuales al 90% de consumo. Pendiente de prueba UI. |
| [x] F11 | Crear y versionar contratos con líneas. | Modal valida contra el catálogo del proveedor, topes brutos, precios y snapshots inmutables. Pendiente de prueba UI. |
| [x] F12 | Activar o suspender contratos desde la vista. | Acciones conectadas a RPC; suspensión exige motivo. Pendiente de prueba UI. |
| [x] F13 | Generar orden desde contrato. | Modal conecta `crear_orden_compra_desde_contrato_v1` y muestra saldos/cantidades disponibles. Pendiente de prueba UI. |
| [x] F14 | Cerrar contrato con motivo. | Migración pendiente de aplicar por el usuario: cierre irreversible con RPC idempotente, actor/fecha/motivo, historial, trigger terminal y bloqueo de liberaciones por estado. La UI exige confirmación y motivo. |

**F01–F09:** aplicados y certificados por el usuario. **F10–F13:** UI validada en lectura contra remoto; las operaciones de escritura no se ejecutaron. **F14:** SQL y UI preparados localmente; falta que el usuario aplique la migración `20261114000000_cierre_contrato_compra.sql` y certifique el cierre remoto. No se ejecutó SQL remoto.

**Salida F:** contrato→liberación→orden→recepción usa el flujo existente, con cupos verificables y sin obligaciones duplicadas.

## G. Importaciones comerciales — P2

Dependencias: C, E y B; D01, D05, D06, D07 y D12. Puede trabajar con órdenes sin contrato; F es opcional para esa vinculación.

| Tarea | Acción atómica | Criterio de aceptación |
|---|---|---|
| [x] G01 | Registrar D06 con una carpeta y órdenes confirmadas. | Decisión y modelo carpeta↔órdenes definidos para USD; la Fase G fue certificada por el usuario. Embarques parciales/documentos detallados quedan fuera del alcance aprobado. |
| [x] G02 | Registrar D07 para gastos del dossier. | Tipos iniciales y moneda USD de carpeta definidos; conversión de gastos locales y clasificación tributaria/capitalizable siguen pendientes. |
| [ ] G03 | Registrar D12 con un proveedor extranjero de ejemplo. | Identificación fiscal por país acordada con Maestros. |
| [ ] G04 | Extender identidad de proveedor por país. | No obliga RUC de 11 dígitos a extranjero ni debilita validación peruana. |
| [x] G05 | Crear carpetas y relación con órdenes. | Vínculo exclusivo, snapshots de orden/proveedor/moneda/tipo de cambio, RPCs idempotentes y previsualización de costo real por línea; validado por el usuario. |
| [ ] G06 | Crear embarque y relación con líneas de orden. | Pendiente: tracking de carpeta `En Tránsito`/`En Aduanas` implementado; embarques parciales siguen pendientes. |
| [x] G07 | Implementar transiciones de tracking mediante RPC. | RPC secuencial `Abierta → En Tránsito → En Aduanas`, con actor/fecha/motivo e idempotencia; validado por el usuario. |
| [ ] G08 | Añadir almacenamiento privado de documentos del expediente. | Acceso ligado a permiso/expediente; enlaces temporales y metadatos en `documentos`. |
| [x] G09 | Registrar costos con moneda y tipo de cambio. | Gastos PEN/USD normalizados a USD; PEN exige tipo de cambio snapshot en PEN por USD. Flujo validado; obligaciones separadas de gastos quedan fuera del alcance aprobado. |
| [x] G10 | Implementar previsualización de reparto de costos. | Preview Landed Cost calculado en servidor, sin persistir liquidación, validado por el usuario. |
| [ ] G11 | Persistir versión de liquidación de costos. | Snapshot de bases, cambio y residuo de redondeo reproducible. |
| [ ] G12 | Integrar costo liquidado con el modelo de valoración acordado. | No sustituye precio de venta por costo ni reescribe movimientos históricos. |
| [x] G13 | Vincular recepción física con la nacionalización. | Reutiliza recepción de Compras; nacionaliza órdenes vinculadas al almacén con Landed Cost, validado por el usuario. |
| [x] G14 | Bloquear doble recepción entre ruta nacional e importación. | RPC impide nacionalizar órdenes con recepciones previas y el flujo validado recibe órdenes una sola vez. |
| [ ] G15 | Integrar obligaciones de gastos con Tesorería. | Cada obligación tiene origen único; anticipos solo mediante contrato acordado. |
| [x] G16 | Construir listado paginado de expedientes. | Filtros por proveedor/estado, paginación y moneda USD; validado por el usuario. |
| [x] G17 | Construir detalle de carpeta con órdenes, gastos, tracking y costos. | Detalle y previsualización Landed Cost disponibles; embarques/documentos quedan fuera del alcance aprobado. |
| [ ] G18 | Implementar cierre de expediente. | Valida pendientes físicos/documentales y liquidación conforme a D06/D07. |
| [ ] G19 | Probar factura extranjera y gasto local en un expediente. | Stock, costo y CxP concilian sin aplicar 18% indiscriminadamente. |
| [ ] G20 | Probar devolución de bienes importados. | Conserva origen; cualquier efecto en costo/aduanas sigue D07/D11. |

**Salida G:** importación con embarque parcial, costos en monedas distintas y recepción conciliada. No requiere conexión automática a SUNAT/aduanas en esta primera versión; esa integración necesita otro contrato técnico y proveedor definido.

**Fase G certificada:** el usuario confirmó la aplicación de `20261115000000` y `20261116000000` y probó localmente listado, vínculos, gastos/prorrateo, estados y nacionalización. La nacionalización conserva el FOB para CxP y aplica Landed Cost a recepción/Kardex; no se permiten recepciones previas.

## H. Evaluación de proveedores — P2

Dependencias: D, E, B y D09. Métricas de importación se incorporan después de G.

| Tarea | Acción atómica | Criterio de aceptación |
|---|---|---|
| [x] H01 | Acordar momento y unidad de evaluación. | Una evaluación por orden, elegible con recepción parcial/completa; proveedor derivado de la orden. Decisión registrada y migración ejecutada/validada por el usuario. |
| [x] H02 | Acordar criterios y escala. | Calidad del Producto, Cumplimiento de Plazos y Nivel de Servicio; enteros obligatorios 1–5, con 5 excelente. |
| [x] H03 | Definir consolidado histórico. | Detalle actual por orden; promedio global y por criterio con total de órdenes; sin datos devuelve promedios nulos. |
| [x] H04 | Crear tabla y RPC transaccional de evaluación/upsert. | Unicidad por orden, recepción y escala validadas en servidor, permisos/RLS y auditoría. Migración `20261117000000` validada en remoto por el usuario. |
| [x] H05 | Crear RPC de resumen histórico por proveedor. | Promedios por criterio/global y cantidad consultados desde el servidor. |
| [x] H06 | Capturar y consultar evaluación desde Compras. | Entrada dedicada `/evaluaciones-proveedores` lista órdenes recibidas y permite ver/registrar/actualizar; el detalle de la orden también muestra el panel. |
| [x] H07 | Mostrar indicador de proveedor en Compras. | Promedio y cantidad históricos visibles en comparativo y ficha de orden; proveedor sin evaluaciones aparece sin datos. |
| [x] H08 | Optimizar consultas y retirar código temporal. | RPC consolidado, caché de resumen por proveedor con deduplicación de solicitudes y expiración breve; no se descargan filas históricas para calcular promedios. |
| [x] H09 | Cerrar el módulo de evaluación. | Ruta y menú probados localmente y certificados por el usuario; listado elegible, panel y comparativo funcionan correctamente. |

**Salida H:** evaluación por orden recibida, auditable, con agregados por proveedor. Los pesos, períodos y versionado de correcciones no se incorporaron porque no forman parte de H01–H03 aprobados.

**Certificación final del usuario:** el Módulo de Compras, Fases A–H e incluyendo los apartados opcionales de contratos, importaciones y evaluación de proveedores, queda oficialmente completado y certificado al 100%. El usuario confirmó la prueba local de `/evaluaciones-proveedores`, el acceso por menú, el listado de órdenes elegibles, captura de evaluación y promedios históricos del comparativo. Las ampliaciones explícitamente fuera del alcance aprobado permanecen como futuras mejoras y no bloquean este cierre.

## I. Navegación, escalabilidad y entregas — transversal

Dependencias: cada capacidad anterior debe completar sus pruebas antes de activarse.

| Tarea | Acción atómica | Criterio de aceptación |
|---|---|---|
| [ ] I01 | Diseñar rutas independientes de las tres extensiones. | Propuesta: `/compras/importaciones`, `/compras/contratos`, `/compras/evaluaciones`. |
| [ ] I02 | Actualizar matriz de permisos funcionales. | Backend, `AuthContext`, menú y permisos administrativos usan la misma acción. |
| [ ] I03 | Añadir detección de capacidades de backend. | Migración ausente muestra “pendiente de instalación”, no datos vacíos ni pantalla operativa. |
| [ ] I04 | Sustituir entrada opcional agrupada por accesos por capacidad. | Solo se activa cada acceso al desplegar su flujo y verificar permisos. |
| [ ] I05 | Registrar nuevas rutas en búsqueda y breadcrumbs. | `workspaceEntries`, `workspaceModules` y `AppRouter` coinciden. |
| [ ] I06 | Probar formularios en tema claro, oscuro y móvil. | Reutilizan tokens `--ws-*`, labels y navegación por teclado; sin rediseño global. |
| [ ] I07 | Medir consultas paginadas con datos representativos. | `EXPLAIN` documentado; índices basados en filtros y FK reales. |
| [ ] I08 | Añadir filtros/nombres de nuevas entidades a Auditoría. | Usuario autorizado puede rastrear selección, contrato, importación y evaluación. |
| [ ] I09 | Añadir identificador de operación a errores de RPC. | Soporte correlaciona fallo/reintento sin exponer credenciales o datos sensibles. |
| [ ] I10 | Actualizar arquitectura y guía tras cada entrega. | Estado operativo/parcial/pendiente refleja evidencia, no solo enlaces habilitados. |

Escalabilidad inicial: paginación y filtros en servidor, carga de detalle bajo demanda, índices justificados y un único libro de stock/deuda. Importaciones masivas CSV necesitan lotes y errores por fila; procesos asíncronos solo cuando el volumen medido lo requiera. Multi-organización continúa como proyecto independiente con membresías y RLS por organización probado; este plan no atribuye aislamiento SaaS al RLS actual.

## 6. Pruebas de aceptación por entrega

Ejecutar SQL en una base de prueba restaurada y pruebas de API con roles autenticados, no solamente como `postgres`. Probar concurrencia con dos conexiones independientes. Conservar scripts y resultados por tarea.

| Escenario | Resultado obligatorio |
|---|---|
| Creación/edición falla en la última línea | No queda cabecera, deuda o cambio parcial. |
| Dos reintentos con la misma clave | Mismo ID; una sola operación efectiva. |
| Misma clave con contenido distinto | Rechazo explícito. |
| REST directo para fabricar recepción/devolución | Rechazo; solo RPC autorizado contabiliza. |
| Dos recepciones o devoluciones concurrentes | No exceden pendiente ni producen stock negativo. |
| Compra legacy marcada recibida | No crea stock ficticio ni documentos de recepción inventados. |
| Oferta vencida, incompleta o proveedor incorrecto | No se convierte a orden. |
| Documento mixto y multimoneda | Totales conciliados; no suma monedas sin conversión. |
| Dos liberaciones por el último cupo contractual | Solo cabe el compromiso autorizado. |
| Expediente parcialmente recibido | Cantidades trazables a embarque/orden, sin doble stock. |
| Costos con residuo decimal | Reparto conserva exactamente total y moneda base. |
| Evaluación publicada | Reproducible tras cambiar plantilla o datos maestros. |
| Usuario sin permiso/revocado | RPC y lectura rechazan la acción aunque se manipule el botón. |
| Consulta tardía de otra orden | No contamina el formulario activo. |

Pruebas JS se destinan a cálculos, validaciones y estados relevantes. Integración SQL/API verifica permisos, FK, rollback y concurrencia. El build/typecheck verifica compilación, no el funcionamiento remoto.

## 7. Hitos y criterio de habilitación

| Hito | Incluye | Evidencia para habilitar |
|---|---|---|
| M0: base confiable | A + B | Esquema conciliado, bypass cerrado, edición atómica y reintentos probados. |
| M1: Compras nacional coherente | C + D + E | Solicitud→orden→recepción→devolución; importes y CxP conciliados. |
| M2: Contratos | F + I aplicable | Liberación concurrente respeta cupos y versión. |
| M3: Importaciones | G + I aplicable | Expediente, costos, embarque y recepción operativos con documentación. |
| M4: Evaluación | H + I aplicable | Plantilla versionada y evaluación publicada reproducible. |

Para **cada hito** crear tareas de entrega separadas:

1. [ ] Revisar la migración incremental y precondiciones contra la línea base.
2. [ ] Ejecutar pruebas de negocio y permisos sobre la restauración local.
3. [ ] Ejecutar `npm run typecheck`, pruebas pertinentes y `npm run build`.
4. [ ] Revisar pantallas afectadas con usuario operativo y usuario restringido.
5. [ ] Preparar SQL íntegro para que el usuario lo copie al SQL Editor, con comprobación de versión y resultado esperado.
6. [ ] Registrar evidencia de aplicación remota y refresco de esquema PostgREST.
7. [ ] Verificar el recorrido real y conciliar documento, stock y obligación.
8. [ ] Activar acceso en menú y actualizar estado en documentación.

Compensación: si aún no se activó el flujo, mantener la capacidad deshabilitada y corregir con migración incremental. Si existen operaciones contabilizadas, preservar registros y corregir por eventos enlazados; no deshacer una entrega borrando movimientos.

## 8. Primera secuencia concreta de trabajo

1. A01–A04: conseguir el esquema real y documentar las diferencias, incluida la colisión reciente de RPC.
2. A05–A08: preparar entorno y fixtures para medir lo que hoy funciona.
3. B07–B08, tras B01–B02: cerrar los bypass ya identificados en tablas nuevas.
4. B03–B05: resolver la edición de orden no transaccional y los documentos contabilizados.
5. B10–B18: endurecer validación, idempotencia y concurrencia.
6. Resolver D01–D05/D10 con responsables mientras avanza la estabilización técnica.
7. Completar C, conectar selección→orden en D y cerrar recepción/devolución en E.
8. Entregar contratos, importaciones y evaluación por hitos M2–M4; habilitar cada uno con evidencia propia.

**Definición final de terminado:** cada submódulo tiene proceso persistente, permisos efectivos, transiciones válidas, errores manejados, prueba negativa, prueba de reintento, SQL aplicado verificablemente y trazabilidad hacia sus fuentes; cambiar `implemented: true` por sí solo no completa una tarea.

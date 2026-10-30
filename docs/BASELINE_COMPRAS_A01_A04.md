# Línea base de Compras — tareas A01–A04

Fecha de preparación: 2026-10-29. Alcance: evidencia del repositorio local y preparación de consultas de solo lectura para Supabase. **No se ejecutaron consultas ni escrituras remotas en esta tarea.**

## Estado de la fase

| Tarea | Estado | Evidencia |
|---|---|---|
| A01 — Inventario de tablas | Parcial: inventario lógico local preparado; columnas/constraints remotos pendientes | Migraciones listadas abajo; consulta de catálogo en `supabase/diagnostics/compras_baseline_a01_a04.sql`. |
| A02 — RPC | Parcial: contratos definidos por migraciones locales; firmas, cuerpos y ACL remotos pendientes | SQL local y consulta `02. Funciones/RPC`. |
| A03 — RLS y grants | Parcial: políticas locales rastreadas; políticas/grants efectivos remotos pendientes | Migraciones locales y consultas `03–04`. |
| A04 — Estado de migraciones | Parcial: exportación remota actual recibida (23 versiones); equivalencia de efectos por objeto pendiente | Historial compartido por el usuario y consulta `A04` del script complementario. |

La CLI estaba reportada como no enlazada (`ProjectRefNotLinkedError`), Docker sin motor y el esquema remoto documentado corresponde al 26-10-2026. Por tanto, **no se atribuye estado remoto actual a ninguna migración posterior a ese corte**, ni se certifica hoy el estado de las anteriores.

## A01 — Inventario lógico local

El circuito de Compras involucra las tablas principales y dependencias siguientes. La consulta SQL adjunta exporta columnas, tipos, defaults, nulabilidad, constraints, índices y RLS reales para compararlos con esta referencia.

| Tabla | Rol en Compras | Relaciones/reglas locales relevantes | Migración de origen/evolución local |
|---|---|---|---|
| `proveedores` | Contraparte comercial | `compras.proveedor_id`; identidad/contacto ampliados con migraciones posteriores. | `20261009000000`, `20261015000000`, `20261018000000` |
| `proveedor_productos` | Catálogo de productos/costos por proveedor | Reemplaza el diseño inicial `productos.proveedor_id`; las líneas de compra apuntan a este catálogo. | `20261013000000_catalogo_proveedores.sql` |
| `productos` | Maestro de inventario | Stock global legado, unidad y relación con inventario por almacén. | `20261009000000`, `20261024200926` |
| `compras` | Cabecera de orden/documento | FK a proveedor; código único; estado y monto; recepción separada; clave/hash idempotente en RPC de alta. | `20261009000000`, `20261014000000`, `20261024200926`, `20261026182720` |
| `detalle_compras` | Líneas de orden | `compra_id`; hoy `proveedor_producto_id` tras migración desde `producto_id`; cantidades enteras y costo unitario. | `20261009000000`, `20261013000000` |
| `pagos` | Obligación CxP vinculada | `compra_id`; estado/fecha/medio y movimientos/aplicaciones en Tesorería. No confundir deuda con pago físico. | `20261009000000`, `20261021000000`, `20261024200926` |
| `recepciones_compra` | Evento de recepción por almacén | `compra_id`, almacén, clave/hash idempotente, usuario y fecha; FK restrictiva. | `20261024200926` |
| `detalle_recepciones_compra` | Cantidades efectivamente recibidas | FK a recepción, línea de compra y producto; cantidades enteras; único por recepción/línea. | `20261024200926` |
| `solicitudes_compra` | Solicitud interna | Código, solicitante, estado, moneda PEN, oferta seleccionada. No genera orden/stock/CxP. | `20261029120000` |
| `solicitud_compra_lineas` | Necesidad solicitada | Producto opcional, cantidad `numeric(14,3)`, unidad libre; incluye unicidad solicitud/id. | `20261029120000` |
| `ofertas_compra` | Oferta de proveedor | FK a solicitud/proveedor; una oferta por proveedor y solicitud; estado/vigencia. | `20261029120000` |
| `detalle_ofertas_compra` | Precios cotizados por línea | FK a oferta/línea solicitada; precio `numeric(14,4)`, único por par. | `20261029120000` |
| `devoluciones_compra` | Documento de devolución física | FK restrictiva a orden; motivo y clave/hash idempotente. No modifica CxP según comentario/regla local. | `20261029150000` |
| `detalle_devoluciones_compra` | Líneas físicas devueltas | Referencia detalle de recepción, producto y almacén; cantidad entera. | `20261029150000` |
| `inventarios` | Existencia por producto/almacén | Unicidad producto+almacén; se modifica mediante movimientos. | `20261009000000` y evolución operativa |
| `movimientos_inventario` / Kardex | Auditoría de cambios físicos | La devolución invoca `registrar_movimiento_inventario`; validar nombre/DDL exactos con catálogo. | `20261024200926`, migraciones operativas |
| `movimientos_tesoreria`, `aplicaciones_pago` | Pagos y aplicaciones de dinero | Separan la obligación de los abonos y sus aplicaciones. | `20261024200926` |
| `usuarios`, `permisos`, `rol_permisos`, `usuario_permisos` | Identidad y autorización | Los RPC comprueban permiso de Compras/Inventario/Tesorería; la implementación de autorización cambió en migraciones posteriores. | Base, permisos y migraciones de seguridad |

**Puntos de esquema a comprobar, no asumir:** el remoto puede no tener las tres migraciones del 29-10; cambios de catálogo históricos; exactitud de constraints/FK/índices; trigger que genera códigos; RLS y grants finales; y cualquier drift manual.

## A02 — RPC que forman parte del circuito

| Función local | Firma / resultado en SQL local | Efecto y objetos relacionados |
|---|---|---|
| `public.crear_orden_compra_operativa(uuid,text,date,numeric,jsonb,text)` | `returns uuid`; fachada `SECURITY INVOKER`, cuerpo privilegiado en helper privado. | Inserta cabecera, líneas y CxP en una transacción; controla clave idempotente. `20261026182720`. |
| `public.registrar_recepcion_compra(...)` | Firma completa se exporta de `20261024200926` y catálogo remoto. | Recepción de compra y movimiento de inventario. |
| `public.registrar_movimiento_inventario(...)` | Firma/cuerpo se exportan del catálogo y migraciones de operación. | Libro de stock por almacén/Kardex. |
| `public.registrar_devolucion_compra(uuid,text,jsonb,text)` | `returns uuid`, `SECURITY DEFINER`, `search_path=''`. | Documento, líneas y salidas de inventario; no modifica pagos. `20261029150000`. |
| `public.crear_solicitud_compra(text,date,jsonb)` | `returns uuid`, `SECURITY DEFINER`, `search_path=''`. | Inserta solicitud y líneas; sin orden ni efecto financiero. `20261029120000`. |
| `public.abrir_solicitud_compra(uuid)` | `returns void`, `SECURITY DEFINER`. | Cambia Borrador→Abierta. |
| `public.registrar_oferta_compra(uuid,uuid,date,integer,text,jsonb)` | `returns uuid`, `SECURITY DEFINER`. | Inserta oferta y sus precios, bloqueando solicitud durante el registro. |
| `public.seleccionar_oferta_compra(uuid,uuid)` | `returns void`, `SECURITY DEFINER`. | Cierra comparativo; expresamente no crea orden. |
| `public.obtener_saldos_cuentas(uuid[])` | Firma/cuerpo y permisos se exportan desde catálogo. | Consulta de saldos financieros relacionados. |
| `public.registrar_pago_parcial(...)` / `..._en_turno(...)` | Firma/cuerpo se exportan desde catálogo. | Registra abonos; dependencia de Tesorería. |
| `app_private._crear_orden_compra_operativa(...)` y helpers de autorización | Funciones internas relevantes; ACL/body se exportan para verificar `SECURITY DEFINER` y `search_path`. | Lógica de privilegios y transacción. |

El contrato y ACL local **no demuestran que estas firmas existan o coincidan en el proyecto remoto**. El RPC de ajuste de inventario queda fuera del circuito de Compras, pero la migración de transferencias usa `ec_registrar_ajuste_inventario`; no eliminar ni reemplazar la función remota antigua `registrar_ajuste_inventario`.

## A03 — Políticas/grants locales identificados

Las migraciones de Compras recientes habilitan RLS y conceden DML a `authenticated`, con filtros por `app_private._tiene_permiso(...)`. Eso significa que los RPC no son por sí solos el único camino de escritura cuando las políticas permiten DML directo.

| Tablas | Políticas locales declaradas | Observación para prueba remota |
|---|---|---|
| `solicitudes_compra` | SELECT `compras.ver`; INSERT `compras.crear` y autor/solicitante actual; UPDATE `compras.editar`; DELETE `compras.eliminar` solo borrador. | La policy de update valida permiso pero no limita transición/campos. |
| `solicitud_compra_lineas` | SELECT permiso ver; INSERT crear y solicitud abierta/borrador; UPDATE editar; DELETE editar. | RLS admite escrituras directas de líneas. |
| `ofertas_compra` | SELECT ver; INSERT crear y autor/solicitud abierta; UPDATE editar; DELETE eliminar solo retirada. | El límite único por proveedor/solicitud también es de constraint. |
| `detalle_ofertas_compra` | SELECT ver; INSERT crear y línea correspondiente a solicitud/oferta vigentes; UPDATE/DELETE editar. | Se puede insertar/editar DML directamente si grants y RLS lo permiten. |
| `devoluciones_compra` | SELECT ver; INSERT editar y autor actual; UPDATE/DELETE denegadas por policy. | DML INSERT directo sigue siendo distinto del RPC transaccional. |
| `detalle_devoluciones_compra` | SELECT ver; INSERT editar; UPDATE/DELETE denegadas. | La policy local no prueba vínculo de inserción con salida Kardex. |
| `recepciones_compra`, `detalle_recepciones_compra` | RLS habilitado; políticas de lectura `compras.ver` visibles en migración de fundamentos. | Consultar política de escritura/ACL efectiva y si la escritura solo está vía RPC. |
| `compras`, `detalle_compras`, `pagos` | Policies/grants evolucionan en la base inicial y migraciones de importación/seguridad. | Exportar todas las policies y privilegios efectivos; incluir `anon`, `authenticated`, `service_role`. |

Este cuadro es una lectura de SQL local, no el ACL remoto. La consulta adjunta muestra el texto de políticas, grants de tabla para roles de API y privilegios de ejecución de funciones.

## A04 — Registro de migraciones y limitación temporal

El inventario local contiene **51 archivos SQL** en `supabase/migrations/`. La reconciliación del repositorio documenta un corte remoto del 26-10-2026: 23 versiones registradas y coincidentes con archivos locales; otras 10 migraciones forward-only de ese corte se informaban aplicadas (incluidas versiones nuevas del 26-10). La misma documentación advierte que 25 archivos no coincidían entonces con el historial y que la ausencia de versión no prueba ausencia de efecto.

Desde el corte hay archivos locales adicionales que no se deben tratar como aplicados por inferencia:

- `20261027000000_vendedor_caja.sql`
- `20261029120000_compras_solicitudes_comparativo.sql`
- `20261029150000_devoluciones_proveedor.sql`
- `20261029170000_inventario_transferencias_ajustes.sql`
- `20261031000000_permisos_personalizados.sql`
- `20261031120000_importacion_ventas_compras.sql`
- `20261101000000_analizador_proyectos.sql`
- `20261102000000_seguridad_funciones.sql`
- `20261102010000_indices_y_empresa.sql`
- `20261102020000_politicas_rls_unificadas.sql`

El número de versiones locales sin coincidencia calculado contra el corte de 23 sería 28/51, pero **no equivale a 28 migraciones pendientes de ejecutar**: varias tienen efectos aparentes, pueden ser obsoletas o no seguras de repetir. Antes de cualquier reparación hay que consultar historial y comparar estructura, funciones, datos, RLS y ACL. La migración histórica `20261024000000_quitar_roles.sql` está identificada como destructiva/no segura: no ejecutarla.

## Cómo cerrar A01–A04

1. El usuario ejecuta el script adjunto en SQL Editor con permisos de lectura; todas las sentencias son `SELECT` sobre catálogos.
2. Guardar resultados completos de las secciones 01–05 (CSV o copiar resultados junto con fecha/proyecto). No compartir secretos ni datos de negocio innecesarios.
3. Si la consulta de `supabase_migrations.schema_migrations` falla por permisos, obtener la salida de `npx supabase migration list --linked` después de enlazar CLI; **no** ejecutar `db push`, `migration repair` ni migraciones.
4. Adjuntar resultados para actualizar esta línea base y clasificar cada objeto/version como equivalente, parcial, ausente, obsoleto o no seguro.

**Resultado actual:** entregables locales preparados; A01–A04 quedan pendientes de validación remota del usuario. No se marcó ninguna tarea completada.

### Evidencia remota aportada por el usuario — historial Supabase (A04)

La salida de `supabase_migrations.schema_migrations` contiene **23 versiones registradas**, desde `20261024200926` hasta `20261026203451`. Las 23 versiones tienen archivo local homónimo. De los 51 archivos locales, 28 no aparecen en el historial: se clasifican como **no registradas; efecto remoto pendiente de evidencia**, no como seguras de ejecutar. La ausencia del ledger no demuestra ausencia de efectos. El registro no incluye versiones posteriores a `20261026203451`; en particular, no registra las migraciones locales de solicitudes/comparativo (`20261029120000`) ni devoluciones (`20261029150000`), aunque esas tablas/RPC se observaron en el esquema.

Esto no demuestra que esos cambios no estén en el esquema: el usuario también consultó y confirmó que las tablas `solicitudes_compra` y `devoluciones_compra`, y el RPC `registrar_devolucion_compra(...)`, existen en remoto. Por tanto queda una **diferencia entre el historial y los objetos observados**. No ejecutar esas migraciones ni reparar el historial hasta comparar todas sus tablas, funciones, policies, grants, triggers y efectos.

La columna `statement_count = 1` refleja una entrada de la matriz `statements` guardada para la versión; no debe interpretarse como que el archivo SQL contiene literalmente una sola instrucción.

Versiones registradas reportadas (23):

```text
20261024200926 enterprise_v1_operational_foundations
20261024201951 marca_compras_legacy_recibidas
20261024202024 funcion_saldo_tesoreria
20261024202317 ventas_por_almacen_y_turno
20261024202647 restringir_rpc_pago_sin_turno
20261024203548 politicas_zonas_sin_duplicados
20261024203558 indices_fk_advisor
20261024203610 bloquear_cotizacion_vacia
20261024203814 aislar_rpc_operativos
20261024204307 inventario_apertura_distribuida
20261024204453 indexar_apertura_inventario
20261024210602 auditoria_operaciones_criticas
20261024210642 auditar_cambios_permisos
20261026182059 privilegios_api_minimos
20261026182706 un_solo_turno_abierto
20261026182720 orden_compra_atomica
20261026182728 venta_credito_permisos
20261026195955 cajas_multisucursal
20261026200116 cajas_indices_fk
20261026200340 unificar_lectura_sucursales
20261026200923 almacenes_por_sucursal
20261026202241 registrar_auto_rls
20261026203451 empresas_sin_borrado_api
```

Archivos locales no presentes en el ledger exportado (28; clasificación actual: **sin registro de migración, efecto remoto pendiente de evidencia**):

```text
20261009000000_erp_enterprisecloud.sql
20261010000000_producto_proveedor.sql
20261011000000_producto_precio.sql
20261012000000_cotizaciones.sql
20261013000000_catalogo_proveedores.sql
20261014000000_fases_compra.sql
20261015000000_proveedor_ruc.sql
20261016000000_perfil_avatar.sql
20261017000000_cliente_documento.sql
20261018000000_proveedor_contacto.sql
20261019000000_permisos_authenticated.sql
20261020000000_compra_recibida.sql
20261021000000_centro_mantenimiento.sql
20261022000000_monedas.sql
20261023000000_permisos_cuentas.sql
20261024000000_quitar_roles.sql
20261025000000_venta_medio_pago.sql
20261026000000_yape_qr.sql
20261027000000_vendedor_caja.sql
20261029120000_compras_solicitudes_comparativo.sql
20261029150000_devoluciones_proveedor.sql
20261029170000_inventario_transferencias_ajustes.sql
20261031000000_permisos_personalizados.sql
20261031120000_importacion_ventas_compras.sql
20261101000000_analizador_proyectos.sql
20261102000000_seguridad_funciones.sql
20261102010000_indices_y_empresa.sql
20261102020000_politicas_rls_unificadas.sql
```

`20261024000000_quitar_roles.sql` es además destructiva/no segura según la reconciliación existente: **no ejecutarla**. Las restantes tampoco se deben ejecutar a ciegas; “sin registro” no equivale a “ausente”.

Con esta salida se completa **la extracción del historial** de A04. La clasificación de equivalencia/efectos por objeto sigue pendiente; por tanto, A04 global queda parcial.

### Evidencia remota aportada por el usuario — funciones de ajuste (complemento A02)

Consulta de catálogo recibida en esta conversación; el usuario confirmó que corresponde a la base Supabase consultada:

| Función | Firma/retorno observados | Seguridad/configuración | ACL observada |
|---|---|---|---|
| `public.ec_registrar_ajuste_inventario` | `(p_producto_id uuid, p_almacen_id uuid, p_stock_nuevo integer, p_motivo text, p_idempotency_key text) returns uuid` | `SECURITY DEFINER`, `search_path=""`, owner `postgres` | `postgres=X/postgres`, `authenticated=X/postgres` |
| `public.registrar_ajuste_inventario` | `(p_producto_id uuid, p_almacen_id uuid, p_cantidad integer, p_motivo text, p_idempotency_key text) returns void` | Invoker (no `SECURITY DEFINER`), `search_path=""`, owner `postgres`; llama a `app_private._registrar_ajuste_inventario` | `postgres=X/postgres`, `authenticated=X/postgres` |

La función histórica `registrar_ajuste_inventario` **sí existe** con retorno `void` y firma distinta de la RPC nueva. Esto explica por qué no se debe cambiar su retorno con `CREATE OR REPLACE`, ni borrarla: la migración local usa el nombre `ec_registrar_ajuste_inventario`, que coincide con la firma/remoto reportados. El cuerpo de `ec_registrar_ajuste_inventario` recibido también concuerda funcionalmente con la versión local, aunque la equivalencia exacta completa todavía se valida comparando definiciones.

Esta evidencia solo cierra la comprobación de estas dos funciones; no completa A02 para los demás RPC ni A01/A03/A04.

### Evidencia remota aportada por el usuario — privilegios de schemas (A03)

Se recibió la salida de `has_schema_privilege` para `public` y `app_private`:

| Schema | Rol | USAGE | CREATE |
|---|---|---:|---:|
| `app_private` | `anon` | no | no |
| `app_private` | `authenticated` | sí | no |
| `app_private` | `service_role` | no | no |
| `app_private` | `postgres` | sí | sí |
| `public` | `anon` | sí | no |
| `public` | `authenticated` | sí | no |
| `public` | `service_role` | sí | no |
| `public` | `postgres` | sí | sí |

El permiso `USAGE` de `authenticated` sobre `app_private` permite resolver nombres del schema. Aún hacía falta confirmar EXECUTE sobre `_registrar_ajuste_inventario`; la evidencia recibida después se registra a continuación. `anon` y `service_role` no tienen `USAGE` reportado en ese schema.

### Evidencia remota aportada por el usuario — esquema, helper y políticas/grants (A01–A03)

El usuario compartió exportaciones de columnas, constraints, RLS, función auxiliar, policies y grants. En las tablas listadas, el propietario observado es `postgres`, RLS está habilitado y `FORCE ROW LEVEL SECURITY` está deshabilitado. La salida de columnas reporta, entre otras, cantidades enteras para líneas de compra/recepción/devolución, cantidades fraccionarias `numeric(14,3)` para solicitud, y ofertas con precio `numeric(14,4)`.

**Diferencia de esquema por conciliar:** `public.detalle_compras` remoto incluye `tratamiento_fiscal text not null default 'gravado'` y `tasa_igv numeric(5,2) not null default 18`. No se encuentran esos nombres en las migraciones locales revisadas. Confirmar origen, constraints, consumidores y cálculo antes de modificar o adoptar esas columnas; no inferir que ya cumplen el diseño fiscal de C.

El helper remoto `app_private._registrar_ajuste_inventario(uuid,uuid,integer,text,text)` devuelve `void`, es `SECURITY DEFINER`, tiene `search_path=""`, owner `postgres` y ACL `{postgres=X/postgres,authenticated=X/postgres}`. La definición compartida suma/resta un delta (`p_cantidad`) y exige `inventario.editar`. Es distinto del RPC público nuevo `ec_registrar_ajuste_inventario`, que recibe stock final (`p_stock_nuevo`), retorna UUID y permite `inventario.crear` o `inventario.editar`. No reemplazar ni borrar ninguno; son contratos distintos. El helper puede ser invocado por `authenticated` solo si conserva tanto `USAGE` en `app_private` como `EXECUTE` sobre la función.

**Privilegios efectivos reportados:** `authenticated` tiene SELECT/INSERT/UPDATE/DELETE en todas las tablas incluidas en la consulta; `anon` y `service_role` no tienen esos privilegios; `postgres` los tiene junto con privilegios administrativos. Esto describe grants efectivos, no autorización final: RLS restringe las filas/operaciones. La exportación de `role_table_grants` muestra los DML de `authenticated` como no concedibles (NO grant option) y grants de propietario/admin para `postgres`.

**Riesgos de escritura directa que muestran las policies observadas:**

- `solicitudes_compra`, sus líneas, `ofertas_compra` y `detalle_ofertas_compra` permiten operaciones Data API para `authenticated` cuando se satisface la policy; sus updates se autorizan por permiso de edición sin imponer por RLS todas las transiciones de estado.
- `devoluciones_compra` permite INSERT con permiso `compras.editar` y `created_by = auth.uid()`. `detalle_devoluciones_compra` permite INSERT con permiso de edición sin comprobar en esa policy que se haya contabilizado la salida Kardex. Esto permite intentar fabricar un documento sin el RPC; confirmar B08 con prueba autenticada antes de corregir.
- `compras` y `detalle_compras` permiten INSERT/UPDATE/DELETE según permisos de RLS, y `pagos` tiene políticas de DML financiero/importación. No asumir que toda escritura pasa actualmente por el RPC atómico.
- `recepciones_compra` y `detalle_recepciones_compra` solo muestran policies SELECT en esta exportación; pese a los grants DML reportados para `authenticated`, RLS no muestra una policy de escritura, por lo que el acceso directo debería quedar bloqueado (sujeto a validar con prueba de rol).

La salida pegada no incluye filas del listado de índices. El ACL incluido en la definición del helper sí muestra EXECUTE para `authenticated`; combinado con `USAGE` de schema previamente recibido, su permiso de ejecución está acreditado. A01 queda cubierta para columnas/constraints/propietario/RLS de las tablas enumeradas. A03 queda sustentada por las policies y grants compartidos para el conjunto consultado.

### Evidencia remota aportada por el usuario — RPC restantes (A02)

Se recibieron las definiciones/ACL de los RPC de órdenes, recepciones, solicitudes/ofertas, devoluciones, movimientos de inventario y tesorería. En la salida reportada, los wrappers públicos de orden, recepción, movimiento y saldos son `SECURITY INVOKER` con `search_path=""`; los cuerpos privilegiados correspondientes viven en `app_private` como `SECURITY DEFINER`, también con `search_path=""`. Los RPC de solicitud/oferta/devolución son funciones públicas `SECURITY DEFINER`. La ACL observada concede `EXECUTE` a `authenticated` y `postgres` para las funciones operativas listadas; `registrar_pago_parcial` público y las funciones de trigger mostraron ACL solo para `postgres`, y el wrapper de pago en turno se expone a `authenticated`.

El RPC remoto `_crear_orden_compra_operativa` calcula la obligación desde líneas con tratamiento/tasa fiscal almacenados. Sin embargo, el camino de orden manual sin líneas aplica 18% fijo. La regla contable correspondiente permanece sujeta a D04; no cambiarla en esta fase.

**Hallazgo confirmado de trigger/Kardex:** el usuario confirmó que `trg_kardex` está activo en `productos` para `AFTER INSERT OR UPDATE OF stock` y ejecuta `registrar_kardex()` como `SECURITY DEFINER`, con `search_path=""`. El helper histórico `app_private._registrar_ajuste_inventario` inserta explícitamente un movimiento en `movimientos_inventario` y luego actualiza `productos.stock`, pero no activa `app.ec_inventory_rpc`. El cuerpo remoto de `registrar_kardex()` sí omite su inserción automática únicamente cuando ese indicador está activo. Por tanto, invocar la ruta histórica produce **dos movimientos de Kardex por ajuste**: el explícito del helper y el automático del trigger. La RPC nueva `ec_registrar_ajuste_inventario` sí activa el indicador antes de actualizar el stock global. No ejecutar ni eliminar la función histórica como solución inmediata; corregirlo en una migración forward-only aprobada y probar ambos caminos antes de habilitarlos.

**Diferencia adicional de A02:** la definición remota de `_crear_orden_compra_operativa` persiste `tratamiento_fiscal` y `tasa_igv` en `detalle_compras`, mientras la migración local `20261026182720_orden_compra_atomica.sql` no contiene esos argumentos/campos de detalle fiscal. La salida de columnas confirma que esos campos existen remotamente, pero no hay migración local que explique su origen. Se clasifica como drift remoto no conciliado, no como migración aplicada.

### Corrección forward-only aplicada y validada

Por autorización del usuario se preparó `supabase/migrations/20261029200000_evitar_kardex_duplicado_ajuste_legacy.sql`. Conserva la firma/retorno/ACL del helper antiguo y agrega la bandera `app.ec_inventory_rpc` antes del `UPDATE productos`; incluye preflight y postflight. El usuario confirmó que la migración se ejecutó y que la consulta posterior mostró `SECURITY DEFINER`, `search_path=""`, `authenticated_can_execute=true`, `includes_kardex_guard=true` y `trg_kardex` habilitado (`O`).

La prueba transaccional con empresa/sucursal/almacén/inventario temporales terminó con `movimientos_explicitos=1`, `movimientos_duplicados_trigger=0`, y aumentos de stock global/almacén de 1. El resultado se obtuvo dentro de una transacción con `ROLLBACK`; las filas de prueba no se conservaron. Corrección del doble movimiento confirmada para esta ruta.

La línea base A01–A04 está documentada con las exportaciones remotas aportadas y las discrepancias explícitas: función histórica de ajuste no presente originalmente en archivos locales (ya preservada en una corrección forward-only), diferencia fiscal de la RPC de orden, y 28 versiones locales no registradas cuyo efecto remoto requiere conciliación antes de aplicar/reparar migraciones. **Esto completa el diagnóstico A, no certifica equivalencia total ni autoriza ejecución de las 28 migraciones.**

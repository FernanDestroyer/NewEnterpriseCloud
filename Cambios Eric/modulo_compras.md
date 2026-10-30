# Módulo de Compras — arquitectura y evolución técnica

> **Alcance y evidencia.** Reconstrucción a partir de `supabase/migrations/20261009*`–`20261118*`, `src/services/{records,purchaseSourcing,purchaseReceipts,purchaseContracts,importFolders,supplierEvaluations}.ts` y las vistas de Compras. Describe el código del repositorio, no certifica que las migraciones estén desplegadas en una instancia remota. Las severidades del apartado QA son una clasificación técnica de los riesgos y correcciones observables, no un acta histórica de incidencias cerradas.

## 1. Resumen ejecutivo y flujo operativo

El circuito nace en **Solicitudes de compra** (borrador → abierta → oferta adjudicada/cancelada); las **Ofertas** de proveedores se versionan, cubren todas las líneas, conservan moneda/tipo de cambio y se comparan con impuestos en PEN. La oferta seleccionada se convierte una sola vez en **Orden de compra** con vínculos de origen; esta conversión **no** recibe mercancía ni crea CxP. También pueden originarse órdenes directamente o desde una **liberación de contrato marco**. Las órdenes pueden editarse con comprobación de versión y snapshots fiscales, o cancelarse bajo las restricciones del flujo.

La **recepción parcial/completa** en almacén crea líneas de recepción, entrada en inventario/Kardex y CxP por lo efectivamente recibido. Una **devolución al proveedor** vincula las unidades a una recepción, genera salida de inventario y puede quedar como crédito o generar una reposición/compensación documentada. El **cierre de compra** consolida saldo físico, reposiciones y obligaciones financieras, sin confundir unidades brutas recibidas con netas. Las **carpetas de importación** agrupan órdenes USD y gastos, calculan costo puesto en almacén y, al nacionalizar, crean las recepciones/costos de inventario y reconcilian la CxP del proveedor. La **evaluación de proveedor** es una ficha por orden con recepción (calidad, plazos, servicio).

Flujo resumido:

```text
Solicitud → Ofertas versionadas → Selección → Orden ─┬→ Recepciones → Inventario/Kardex + CxP
                       Contrato/versiones → Liberación ┘         ├→ Devolución → crédito/reposición
Orden USD → Carpeta → Gastos/prorrateo → Nacionalización ────────┘
Orden recibida → Evaluación de proveedor; cierre → resumen físico/financiero
```

La pantalla heredada `/purchases` (`ModuloPage`) mantiene las órdenes y el ingreso a Kardex; las pantallas especializadas son `/solicitudes-compra`, `/devoluciones-proveedor`, `/contratos-compra`, `/importaciones` y `/evaluaciones-proveedores` (`src/routes/AppRouter.tsx`).

## 2. Arquitectura de base de datos (Backend SQL)

### Evolución y modelo relacional

| Capa / migraciones | Tablas y relaciones principales | Índices/garantías relevantes |
| --- | --- | --- |
| Base (`20261009000000`, `20261024200926`) | `proveedores`, `proveedor_productos`, `productos`, `compras` → `detalle_compras`; `recepciones_compra` → `detalle_recepciones_compra` → detalle de orden; `inventarios`, `movimientos_inventario`; `pagos` (CxP), `movimientos_tesoreria`, `aplicaciones_pago`. | `compras_proveedor_idx`, `compras_created_idx`, `detalle_compras_compra_idx`, `recepciones_compra_compra_fecha_idx`, `movimientos_inventario_idempotency_uidx`. |
| Abastecimiento (`20261029120000`, `20261104`–`20261109`) | `solicitudes_compra` → `solicitud_compra_lineas`; `ofertas_compra` → `detalle_ofertas_compra`; `solicitudes_compra_historial`; `compras.solicitud_compra_id`/`.oferta_compra_id` y vínculos de detalle; tablas privadas `purchase_transition_idempotency`, `purchase_sourcing_conversion`. | Índices de estado/fecha y FK; claves idempotentes parciales para solicitud/oferta; versión única por solicitud/proveedor, única versión actual, una orden por origen seleccionado; índices para paginación y búsqueda. |
| Fiscal/CxP (`20261106`–`20261107`) | `detalle_compras` suma tratamiento/tasa/base/impuesto/total de línea; `compras.moneda`/`exchange_rate`; `pagos.moneda`/`exchange_rate`. | `pagos_cxp_compra_unica_idx` evita dos CxP de tipo `pagar` por compra; tabla privada `purchase_create_v3_idempotency`. |
| Devoluciones (`20261029150000`, `20261110`–`20261111`) | `devoluciones_compra` → `detalle_devoluciones_compra` (referencia a recepción); `reversiones_devolucion_compra` → `detalle_reversiones_devolucion_compra`; seguimiento de crédito y reposición. | `idempotency_key unique`, índices por compra/recepción/origen y reglas de restitución neta. |
| Contratos (`20261112`–`20261114`) | `contratos_compra` → `versiones_contrato_compra` → `lineas_contrato_compra`; `contratos_compra_historial`; `liberaciones_contrato_compra` → líneas/historial → orden. Tablas privadas `contract_purchase_idempotency`, `purchase_contract_order_idempotency`. | FK compuestas proveedor–contrato–versión–producto, una versión activa y un borrador por contrato, índices de cupo/fecha; liberación y líneas protegidas por triggers de inmutabilidad. |
| Importaciones (`20261115`–`20261116`, corrección `20261118`) | `carpetas_importacion` → `ordenes_importacion` (compra única por carpeta/vínculo) y `gastos_importacion`; historial, `import_purchase_idempotency`; recepciones y movimientos se enlazan durante nacionalización. | Índices estado/fecha, carpeta/orden, gastos/historial y claves únicas; moneda/cambio por gasto y costo unitario real por movimiento. |
| Evaluación (`20261117000000`) | `evaluaciones_proveedor_orden`: FK a compra, proveedor y usuario; criterios 1–5; **una evaluación por orden** (`compra_id unique`). | `evaluaciones_proveedor_orden_proveedor_fecha_idx`. |

**RLS y privilegios.** Las tablas especializadas de contratos, importaciones, liberaciones y evaluaciones habilitan RLS, revocan escritura directa a `public`, `anon`, `authenticated`, conceden lectura a `authenticated` y filtran `SELECT` con `app_private._tiene_permiso('compras','ver')`. Las solicitudes/ofertas/recepciones/devoluciones anteriores tienen políticas propias por acción; **no asumir que todas las tablas antiguas son solo lectura**. Las tablas de idempotencia `app_private.*` revocan permisos del cliente. RPC `SECURITY DEFINER SET search_path = ''` verifican `auth.uid()` y permisos para cada transición; las funciones públicas restringen `EXECUTE` a `authenticated`. El frontend no sustituye RLS.

```sql
-- Extracto de 20261112000000_contratos_marco_esquema_activacion.sql
alter table public.contratos_compra enable row level security;
revoke all on public.contratos_compra,public.versiones_contrato_compra,public.lineas_contrato_compra,public.contratos_compra_historial from public,anon,authenticated;
grant select on public.contratos_compra,public.versiones_contrato_compra,public.lineas_contrato_compra,public.contratos_compra_historial to authenticated;
create policy contratos_compra_select on public.contratos_compra for select to authenticated
  using((select app_private._tiene_permiso('compras','ver')));
```

### RPC y transacciones principales

| Funciones públicas | Responsabilidad |
| --- | --- |
| `crear_solicitud_compra_v3`, `editar_solicitud_compra_v1`, `abrir_solicitud_compra_v2`, `cancelar_solicitud_compra_v1` | Validar JSON, estado, actor, `expected_version` y transiciones idempotentes. |
| `registrar_oferta_compra_v4`, `seleccionar_oferta_compra_v4`, `convertir_solicitud_a_orden_v1` | Oferta íntegra/versionada, comparativo fiscal normalizado a PEN y conversión trazable única. |
| `listar_solicitudes_compra_paginado_v1`, `obtener_detalle_solicitud_compra_v1`, `listar_proveedores_compra_paginado_v1`, `listar_monedas_compra_v1` | Listado filtrado con `limit/offset/total` y detalle bajo demanda. |
| `crear_orden_compra_operativa_v4`, `editar_orden_compra_operativa_v3`, `registrar_recepcion_compra_v2` | Orden fiscal/moneda, edición atómica con marca temporal esperada, recepción e ingreso de stock/CxP. |
| `registrar_devolucion_compra`, `compensar_devolucion_compra_v1`, `actualizar_seguimiento_credito_devolucion_v1`, RPC de resumen/historial/cierre | Salida por devolución, compensación/reposición y visibilidad física/financiera. |
| `crear_contrato_compra_v1`, `crear_version_contrato_compra_v1`, `activar_contrato_compra_v1`, `suspender_contrato_compra_v1`, `cerrar_contrato_compra_v1`, `crear_orden_compra_desde_contrato_v1`, `cancelar_orden_compra_v1` | Versionar, consumir/restaurar cupo y trazar órdenes liberadas. |
| `crear_carpeta_importacion_v1`, `vincular_orden_importacion_v1`, `registrar_gasto_importacion_v1`, `calcular_prorrateo_importacion_v1`, `actualizar_estado_carpeta_importacion_v1`, `nacionalizar_carpeta_importacion_v1` | Expediente USD, gastos convertidos, previsualización y nacionalización transaccional. |
| `registrar_evaluacion_proveedor_orden_v1`, `obtener_promedio_evaluacion_proveedor_v1` | Evaluación de una orden recibida y promedio por proveedor. |

Ejemplos **literales parciales** (consultar la migración indicada para la función completa y su firma):

```sql
-- 20261106000000: cálculo autoritativo; importe de compra = base + impuesto.
v_rate := case v_treatment when 'Gravado' then 18 else 0 end;
v_base := round(p_base,2);
v_tax := round(v_base * v_rate / 100,2);
return query select v_treatment,v_rate,v_base,v_tax,v_base+v_tax;
```

```sql
-- 20261109000000: una clave no puede identificar dos ofertas diferentes.
perform pg_advisory_xact_lock(hashtextextended('oferta-compra:'||p_idempotency_key,0));
select id,payload_hash into v_id,v_old_hash from public.ofertas_compra where idempotency_key=p_idempotency_key for update;
if found then
  if v_old_hash is distinct from v_hash then raise exception 'La clave ya se usó con otro contenido.' using errcode='23505'; end if;
  return v_id;
end if;
```

```sql
-- 20261116000000: la nacionalización pasa por recepción y conserva la CxP FOB.
v_receipt_id:=app_private._registrar_recepcion_compra_v2(
  v_order.compra_id,p_almacen_id,v_lines,
  'import-nationalize:'||substr(p_idempotency_key,1,70)||':'||v_order.compra_id::text,
  'Importación',null,trim(p_motivo));
```

**Concurrencia e idempotencia.** La clave única más `payload_hash` rechazan reutilizar la misma clave con otros datos y permiten devolver el resultado previo con el mismo contenido. `pg_advisory_xact_lock` serializa por clave/transición; el `FOR UPDATE` protege solicitud, orden, contrato, CxP o stock según el flujo. El bloqueo caduca con la transacción, no es un lock permanente del navegador. La creación y cancelación de liberaciones comprometen/restauran cupo con historial append-only; las operaciones de stock también usan movimientos con claves idempotentes. `app_private.*` almacena resultados de transiciones que no tienen una fila de operación directamente consultable por el cliente.

## 3. Arquitectura frontend (React, TypeScript, CSS)

- `PurchaseSourcingPage.tsx` coordina filtros, lista paginada, detalle diferido, comparativo, ofertas y conversión; `purchaseSourcing.ts` llama RPC `*_v*`, incluidos `limit/offset`. `PurchaseContractsPage.tsx`, `PurchaseReturnsPage.tsx`, `ImportFoldersPage.tsx` y `SupplierEvaluationsPage.tsx` aíslan los otros circuitos. `PurchaseOrderDetail.tsx` y `PurchaseReceiptModal.tsx` exponen avance e historial; `ModuloPage`/`RecordsContext` sostienen la orden convencional y el catálogo.
- `PurchaseSourcingPage` usa `loadRevision = useRef(0)` para descartar respuestas viejas al cambiar filtros/página; `PurchaseOrderDetail` también usa secuencia para líneas. Mantiene mapas de claves de transición y huellas de oferta: el mismo payload reintenta con la misma clave, los cambios generan otra. No equivale a garantizar reconciliación visual completa ante todos los fallos de red; el backend es autoritativo.
- Listas de solicitudes/proveedores: RPC con `total`, `p_limit`, `p_offset`; contratos/importaciones: `select(..., { count: 'exact' }).range(offset, offset + limit - 1)`; consultas que requieren barrido completo usan páginas consecutivas cuando procede. **No aplicar indiscriminadamente `.range(offset, offset + 499)` a cada endpoint**: ese patrón corresponde a cargas completas, no a la paginación de interfaz de 10/20 registros.
- Importes en moneda de origen; el comparativo convierte a PEN con el tipo de cambio snapshot (PEN por USD) y el cálculo fiscal se recalcula en SQL. Componentes usan `Intl.NumberFormat`, controlan `busy`, errores de lectura/guardado y permisos `can('purchases', acción)`.

```tsx
// src/components/PurchaseSourcingPage.tsx: respuesta más reciente gana.
const revision = ++loadRevision.current
const result = await fetchPurchaseSourcing({ estado: stateFilter, desde: fromDate, hasta: toDate, referencia: debouncedReference, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
if (revision !== loadRevision.current) return
setItems(result.requests)
setTotal(result.total)
```

**UI/UX.** Páginas de trabajo SaaS/ERP de alta densidad: cabeceras cortas, tablas compactas, formularios inline, controles de paginación próximos a los datos, sin márgenes excesivos. `src/workspace.css` y CSS específicos usan `--ws-surface`, `--ws-raised`, `--ws-border`, `--ws-text`, `--ws-muted`, `--ws-green(-soft)`, `--ws-amber(-soft)` y `--ws-primary(-soft)` para superficies, bordes y píldoras; nunca inferir semántica financiera solo por color. Los errores visibles acompañan el campo o la operación, en lugar de convertir silenciosamente un fallo de consulta en cero.

## 4. Auditoría QA y parches críticos

| Severidad técnica | Riesgo detectado | Corrección rastreable |
| --- | --- | --- |
| **Alta** | Doble solicitud/oferta/orden o dos liberaciones al reintentar; carreras sobre cupo/stock. | Índices únicos y huellas; `purchase_transition_idempotency`, `purchase_create_v3_idempotency`, tablas privadas de contrato/importación; advisory locks, `FOR UPDATE`, versión esperada e historial. |
| **Alta** | CxP repetida o separada de moneda/importe reales; nacionalización duplicada. | `pagos_cxp_compra_unica_idx`, trigger de moneda, total fiscal por línea y CxP sobre recepción; nacionalización comprueba estado, recepciones previas y reconcilia CxP FOB. |
| **Alta** | Devoluciones/restituciones sobre unidades no recibidas o más cupo del contrato. | Referencia a detalle de recepción, progreso bruto/neto, validación de pendientes, liberaciones inmutables y cancelación previa a recepción. |
| **Media** | Comparar USD y PEN sin FX o IGV; precios con precisión imposible; editar historia fiscal como si fuera nueva. | `registrar_oferta_compra_v4` valida tasa 18/0 y cuatro decimales, FX positivo y activo; snapshots fiscales; `editar_orden_compra_operativa_v3` conserva líneas históricas `NULL` según sus restricciones. |
| **Media** | Listas truncadas o respuestas asincrónicas antiguas sobrescriben filtros. | RPC `listar_*_paginado_v1`, `count: 'exact'` en listados directos, `useRef` de revisión y detalle diferido. |
| **Baja** | Día de negocio distinto por huso horario local; densidad inconsistente. | `businessDate` usa `Intl.DateTimeFormat(..., { timeZone: 'America/Lima' })`; formato compacto y variables `--ws-*`. |

**Verificación y límites.** En la sesión de parches frontend previa pasaron `npm run typecheck`, `npm test` (53 pruebas generales) y `npm run build`; ello no demuestra integración de Compras con Supabase remoto. Las migraciones históricas contienen firmas versionadas: al integrar, confirmar orden de aplicación, permisos, schema cache PostgREST y pruebas transaccionales de concurrencia/reintento en una base de ensayo. El catálogo de órdenes candidatas de importación usa `.limit(1000)` en `src/services/importFolders.ts`; no debe describirse como barrido ilimitado.

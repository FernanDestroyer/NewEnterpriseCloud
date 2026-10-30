# Inventario y Kardex — saldos, operaciones y trazabilidad

> **Límite de versionado indispensable.** El usuario informó que el backend SQL de la fase nueva fue parcheado en Supabase; **ese DDL no está presente** en `supabase/migrations/` de este repositorio. Sí están versionados el modelo heredado, la apertura distribuida y las transferencias/ajustes anteriores (`20261009*`, `20261024200926*`, `20261024204307*`, `20261029170000*`, `20261105000000*`). El frontend actual **no llama** a `transferir_stock_entre_almacenes`/`ec_registrar_ajuste_inventario` de esa migración, sino a contratos `ec_*` cuya definición remota debe incorporarse y auditarse. Se separa a continuación **SQL comprobable**, **contrato consumido por React** y **verificaciones pendientes**. Las severidades QA son clasificación de riesgos, no certificación de SQL remoto.

## 1. Resumen ejecutivo y flujo operativo

Las seis vistas son **Existencias por almacén** (físico, reservado, libre), **Kardex** (historial y valores PEPS/promedio cuando hay costo comprobable), **Transferencias**, **Ajustes**, **Inventario físico** y **Lotes/Series**. Las entradas por recepción de Compras y nacionalización, y las salidas por guía de Ventas, alimentan el mismo dominio físico; las reservas de pedidos afectan el stock libre sin consumir el físico. La transferencia registra salida en origen y entrada en destino como una operación; el ajuste registra sobrante/merma; el conteo abre una instantánea por almacén/producto y al cerrar concilia diferencias; la trazabilidad marca lotes/series de entradas pendientes y bloquea despacho no identificado/vencido según el contrato del backend desplegado (pendiente de verificar aquí).

```text
Recepción/Importación ──────┐
Guía/Devolución de Ventas ──┼→ stock físico + movimientos/Kardex → Existencias / PEPS / Promedio
Transferencia / Ajuste ─────┘                  ↑
Conteo abierto → instantánea → cierre/conciliación
Producto con stock cero → modo de trazabilidad → entrada pendiente → identificar lote/serie
Reserva de pedido → stock reservado → stock libre = físico - reservado
```

`src/routes/AppRouter.tsx` publica `/inventario/existencias`, `/inventario/kardex`, `/inventario/transferencias`, `/inventario/ajustes`, `/inventario/fisico`, `/inventario/lotes-series`; las rutas heredadas `/stock-productos`, `/movimiento-kardex` y `/operaciones-inventario` redirigen. `/ingreso-kardex` sigue siendo la vista de recepción de Compras; no debe confundirse con una segunda vía de escritura manual del Kardex nuevo.

## 2. Arquitectura de base de datos (Backend SQL)

### Objetos que sí constan en migraciones locales

| Objeto | Relaciones y garantías | Evidencia |
| --- | --- | --- |
| `productos`, `almacenes`, `inventarios` | `inventarios` enlaza producto y almacén, saldo físico con unicidad de combinación; `productos.stock` conserva historia de stock legado. | `20261009000000_erp_enterprisecloud.sql`, `20261024200926_enterprise_v1_operational_foundations.sql`. |
| `movimientos_inventario` | FK a producto y almacén, tipo, cantidad, saldo anterior/nuevo, referencia, usuario y origen; índice `mov_inv_producto_idx` `(producto_id,created_at desc)`, único `movimientos_inventario_idempotency_uidx`, índice `movimientos_inventario_origen_idx`. | Base y migración operativa. |
| `aperturas_inventario` | Apertura **inicial** del legado, clave idempotente única, hash, actor y totales; RLS de lectura `tiene_permiso('inventario','ver')`. No es la misma tabla que los nuevos conteos físicos. | `20261024204307_inventario_apertura_distribuida.sql`. |
| `transferencias_inventario` → `detalle_transferencias_inventario` | Dos almacenes distintos, producto único por transferencia, cantidades positivas; clave idempotente única + hash. Índices `transferencias_inventario_fecha_idx`, `detalle_transferencias_producto_idx`. | `20261029170000_inventario_transferencias_ajustes.sql`. |
| `ajustes_inventario` | FK producto/almacén/usuario, stock anterior/nuevo no negativos y diferentes, motivo, clave única + hash; índice `ajustes_inventario_producto_fecha_idx`. | Misma migración. |
| `ec_reservas`, `ec_pedidos` | Reserva pendiente por pedido y producto, utilizada en la disponibilidad y el trigger `ec_proteger_reservas` sobre `inventarios`. | `20261119000000_ventas_integrales.sql`. |

**RLS comprobable:** la migración de transferencias y ajustes habilita RLS, lectura de Inventario para autenticados, inserción con permiso operativo/actor, y políticas `UPDATE/DELETE` denegadas en las cabeceras/lineas. La apertura inicial permite lectura de Inventario. No hay que atribuir estas políticas a las tablas remotas `ec_*`: sus grants, RLS, índices y FK requieren el SQL de fase nueva. En rutas legacy los `GRANT` incluyen verbos de escritura, pero sus políticas y funciones limitan operaciones; comprobar además las migraciones posteriores de privilegios antes de cambiar un permiso.

```sql
-- 20261029170000_inventario_transferencias_ajustes.sql: ejemplo real del modelo legacy.
create index if not exists ajustes_inventario_producto_fecha_idx on public.ajustes_inventario(producto_id, almacen_id, created_at desc);
alter table public.ajustes_inventario enable row level security;
create policy ajustes_inventario_select on public.ajustes_inventario for select to authenticated
  using ((select app_private._tiene_permiso('inventario', 'ver')));
create policy ajustes_inventario_update on public.ajustes_inventario for update to authenticated using (false) with check (false);
```

```sql
-- 20261024204307_inventario_apertura_distribuida.sql: clave, hash y exclusión del stock legado.
perform pg_advisory_xact_lock(hashtextextended('apertura-inventario:'||v_key,0));
select * into v_existente from public.aperturas_inventario where idempotency_key=v_key for update;
if found then
  if v_existente.payload_hash <> v_hash then raise exception 'La clave ya se usó con otra distribución.' using errcode='23505'; end if;
  return v_existente.id;
end if;
perform pg_advisory_xact_lock(hashtextextended('enterprisecloud:stock-legacy-opening',0));
```

```sql
-- 20261029170000: un traslado legacy emite los dos movimientos en la misma RPC.
perform public.registrar_movimiento_inventario(
  v_producto, p_almacen_origen_id, 'salida', v_cantidad,
  'Transferencia ' || v_id::text || ' · salida', p_idempotency_key || ':' || v_producto::text || ':salida',
  'transferencia', v_id, trim(p_motivo)
);
perform public.registrar_movimiento_inventario(
  v_producto, p_almacen_destino_id, 'entrada', v_cantidad,
  'Transferencia ' || v_id::text || ' · entrada', p_idempotency_key || ':' || v_producto::text || ':entrada',
  'transferencia', v_id, trim(p_motivo)
);
```

La función legacy `app_private.registrar_movimiento_inventario` (`20261105000000`) serializa por clave idempotente y por producto (`'inventory-product:'||producto_id`), y registra saldo con auditoría; las funciones de la fase nueva **no pueden describirse como si heredasen automáticamente ese candado**. Para trazabilidad, la propiedad exigida es serializar toda escritura de stock físico y la activación del modo con el **mismo candado por producto**, leer bajo bloqueo la suma física de *todos* los almacenes y negar activación si es distinta de cero; sin DDL remoto no se puede certificar que se cumple. El frontend solo presenta un control previo orientativo.

### Contrato SQL que consume el frontend actual (DDL remoto no adjunto)

| RPC/tabla referenciada por React | Uso verificable en servicios | Verificación necesaria al versionar SQL |
| --- | --- | --- |
| `ec_consultar_existencias`, `ec_consultar_kardex` | `inventoryQueries.ts`: físico/reservado/libre; movimientos, costos y saldos PEPS/promedio paginados. | Firma, estabilidad de ordenación, NULL histórico, permisos, índices `(fecha,id)` y costo de paginación. |
| `ec_procesar_transferencia`, `ec_registrar_ajuste` | `inventoryOperations.ts`: origen/destino/líneas/motivo/clave; producto/almacén/delta/costo/clave. | Atomicidad y hash del payload, stock libre, serialización con ventas/trazabilidad, una entrada y salida sin duplicar. |
| `ec_abrir_conteo_fisico`, `ec_cerrar_inventario_fisico` | Apertura por almacén/instantánea; cierre con clave y ajustes de conciliación. | Estado, bloqueo de líneas, comparación de stock actual y reservas, clave única de apertura/cierre, índices. |
| `ec_configurar_trazabilidad`, `ec_identificar_lote`, `ec_identificar_serie` | Modo permanente con stock cero, identificación posterior con clave. | Verificar bloqueo compartido por producto, unicidad de códigos/series, vencimiento, contabilidad de unidades. |
| `ec_transferencias`, `ec_ajustes`, `ec_conteos_fisicos`, `ec_conteo_lineas`, `ec_producto_trazabilidad`, `ec_lotes`, `ec_series`, `ec_existencias_lote` | Consultas de reconciliación, listados y balance por lote. | **No hay `CREATE TABLE`/RLS/índices locales de estas tablas**; asegurar `SELECT` con permiso de Inventario y las columnas filtradas por clave. |

El código frontend busca `id` por `clave` de transferencia/ajuste, `clave_apertura` del conteo y `(id, clave_cierre, estado='cerrado')` en cierre. Son **suposiciones contractuales del cliente**, no prueba de las definiciones SQL. Una política RLS que oculte estas filas convierte `maybeSingle()` en “no existe” y anula la reconciliación: verificar permisos de lectura para el actor que escribió. La columna `ec_operaciones` de **Ventas** no sustituye automáticamente las claves del módulo de Inventario.

## 3. Arquitectura frontend (React, TypeScript, CSS)

| Archivo | Responsabilidad |
| --- | --- |
| `InventoryQueriesPage.tsx`, `inventoryQueries.ts`, `inventory-queries.css` | Existencias, filtros y Kardex (50 movimientos por página), nombres de productos/almacenes y etiquetas históricas. |
| `InventoryOperationsPage.tsx` | Formularios de traslado y ajuste, validación previa de stock libre, reintento/reconciliación por clave. |
| `PhysicalInventoryPage.tsx` | Borrador, apertura/cierre, líneas de instantánea, lista de conteos (50 por página). |
| `InventoryTracePage.tsx` | Modo lote/serie, identificación y páginas **independientes** de pendientes (100 por tabla). |
| `inventoryShared.tsx`, `inventory-operations.css` | `InventoryGate/Header/Message`, `useInventoryReference`, `useInventorySubmission`, mapa de saldos, controles visuales comunes. |
| `RecordsContext.tsx` | `records.inventory`, `errors.inventory`, recarga estricta opcional; usado para catálogo de productos. |

**Consultas seguras:** `loadInventoryWarehouses` y `loadInventoryStocks` iteran en bloques de 500, con orden secundario estable; `loadPhysicalCounts` usa `{ count: 'exact' }` y `.range(page*50, (page+1)*50-1)`; `loadPendingLots/Serials` reciben página/filtro, cuentan y usan `.range(page*100, (page+1)*100-1)`. `loadPhysicalCountLines` pagina de 500 y `loadLotBalances` consulta IDs por lotes; esto evita el corte silencioso de PostgREST. No confundir la iteración total de almacenes con la paginación de interfaz de conteos/pendientes.

```tsx
// src/services/inventoryQueries.ts: barrido total con orden estable.
for (let offset = 0; ; offset += PAGE_SIZE) {
  const { data, error } = await requireSupabase().from('almacenes').select('id,nombre,activo')
    .order('nombre').order('id').range(offset, offset + PAGE_SIZE - 1)
  if (error) throw error
  rows.push(...(data ?? []) as InventoryWarehouse[])
  if ((data ?? []).length < PAGE_SIZE) return rows
}
```

**Estado asíncrono e idempotencia:** `useInventoryReference` usa `loadSequence = useRef(0)` para descartar respuestas viejas y `Promise.allSettled` para conocer por separado error de referencias y error del catálogo (`reload({ throwOnError: true })`). `useInventorySubmission` consulta antes de enviar y repite la consulta ante error; si no puede consultar tras el error, conserva clave y payload, bloquea los campos (`fieldset`) y ofrece reintento. Tras confirmar la escritura, genera nueva clave, comunica éxito y recarga aparte: un fallo de recarga muestra **«Operación guardada, pero no se actualizaron los saldos: …»**, nunca instruye a duplicar a ciegas. El stock de selector se indexa con `useMemo(new Map(...))`; no hace `.find()` por cada línea renderizada.

```tsx
// src/components/inventoryShared.tsx: lookup O(1) promedio y error de catálogo visible.
const stocksByLocation = useMemo(() => new Map(stocks.map(row => [`${row.producto_id}:${row.almacen_id}`, row])), [stocks])
const stockAt = (productId: string, warehouseId: string) => stocksByLocation.get(`${productId}:${warehouseId}`)
const visibleError = error || (errors.inventory ? `No se pudo cargar el catálogo de productos: ${errors.inventory}` : '')
```

```tsx
// src/components/inventoryShared.tsx: misma clave antes de escribir y tras una respuesta incierta.
try {
  id = await input.find() ?? await input.write()
} catch (cause) {
  try {
    const existing = await input.find()
    if (!existing) {
      setUnresolved(false)
      setMessage(inventoryQueryError(cause))
      return
    }
    id = existing
  } catch {
    setUnresolved(true)
    setMessage('No se pudo verificar el resultado. No modifiques los datos; reintenta con la misma clave para reconciliar.')
    return
  }
}
```

**Kardex y fechas:** `movementDirection` compara `stock_anterior`/`stock_nuevo` cuando existen; para asientos históricos sin saldos usa `tipo === 'entrada'/'salida'`, sin clasificar por defecto un ajuste ambiguo como salida. Fechas de operación se formatean con `timeZone: 'America/Lima'`; valores `NULL` permanecen **«Sin valorizar»**, no se inventa costo 0.

**Diseño UI/UX:** estilo SaaS/ERP de alta densidad, cabeceras breves, tablas desplazables, fuente compacta, formularios ajustados y paginación bajo la tabla, sin márgenes excesivos. `inventory-operations.css` y `inventory-queries.css` usan `var(--ws-surface)`, `--ws-raised`, `--ws-border`, `--ws-text`, `--ws-muted`, `--ws-green(-soft)`, `--ws-amber(-soft)` y estados corporativos. Las reglas antiguas `.kardex-chip.in/.out` y su variante clara en `src/styles.css` ya sustituyen hex/rgba por `--ws-*`. Se preserva la estructura de seis vistas y la paleta del workspace.

## 4. Auditoría QA y parches críticos

| Severidad técnica | Hallazgo / corrección verificable |
| --- | --- |
| **Alta** | **Respuesta incierta y duplicación:** búsquedas `findTransferByKey`, `findAdjustmentByKey`, `findOpenCountByKey`, `findClosedCountByKey` antes de escribir y tras errores; payload bloqueado si no se puede verificar. Requiere comprobar unicidad/hash en el SQL remoto para que el extremo servidor sea seguro. |
| **Alta** | **Carrera entre stock físico y activación de trazabilidad:** interfaz obliga stock cero; el SQL versionado legacy muestra lock por producto, pero **el SQL `ec_configurar_trazabilidad` no está en este repositorio**. No declarar resuelto el candado compartido en Supabase hasta contrastar su migración y una prueba concurrente contra entradas/traslados/guías. |
| **Alta** | **Reserva vs. físico y cierre:** frontend usa stock libre y alerta si hay merma superior; la RPC de Ventas protege reservas con trigger; cierre de conteo debe validar saldo actual bajo lock. No hay prueba local de la implementación remota de conteos. |
| **Media** | **Truncación de almacenes, conteos y pendientes:** barrido `.range(offset, offset + 499)` para catálogos completos y paginación de servidor con `count: 'exact'`/Anterior/Siguiente para conteos/lotes/series. |
| **Media** | **Éxito guardado tratado como fallo de escritura; selector vacío:** separar `run.write` y `reloadReferences`, propagar fallos de recarga de `RecordsContext` y presentar `errors.inventory`. |
| **Baja** | **`stockAt` lineal y dirección de asientos históricos:** índice `useMemo Map` por producto/almacén; preferir `row.tipo` cuando faltan ambos saldos. |
| **Baja** | **Colores hardcoded y fechas:** `.kardex-chip.in/.out` usa variables `--ws-*`; fecha Lima en UI y sin valores PEPS/promedio inventados. |

**Verificación y deuda documental.** La ronda frontend terminó con `npm run typecheck`, `npm test` (53 pruebas generales) y `npm run build`; no se ejecutaron transacciones remotas, tests de concurrencia ni inspección visual. Para completar el documento backend end-to-end hay que versionar el parche SQL de fase nueva y comprobar DDL, índices, FKs, RLS/GRANT de lectura de claves, firmas RPC, lock común por producto y zona horaria del servidor. Hasta entonces, las tablas `ec_*` anteriores son **contratos consumidos**, no objetos SQL verificados por este repositorio.

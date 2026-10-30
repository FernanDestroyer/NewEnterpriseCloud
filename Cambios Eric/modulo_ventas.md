# Módulo de Ventas — cotización, reserva, facturación, guía y nota de crédito

> **Fuente de verdad local.** `supabase/migrations/20261119000000_ventas_integrales.sql` sobre el modelo base (`20261009000000_erp_enterprisecloud.sql`, `20261024200926_enterprise_v1_operational_foundations.sql`), `src/services/salesOperations.ts`, `src/components/{SalesOperationsPage,SalesReceiptPrint}.tsx`, `src/sales-operations.css` y `src/routes/AppRouter.tsx`. Se documenta el código versionado, no un despliegue SQL remoto. Las severidades de QA clasifican riesgos y mitigaciones visibles en el código, sin atribuirles una fecha/acta de auditoría no disponible.

## 1. Resumen ejecutivo y flujo operativo

Las **cotizaciones** se crean o versionan con líneas, afectación IGV, moneda PEN/USD, tipo de cambio y vencimiento; una cotización vigente puede convertirse en **pedido** (opcionalmente facturado en la misma transacción). También se crean pedidos directos. El pedido **reserva** por producto/almacén: disminuye el disponible lógico, pero **no** el físico. La **factura/boleta** crea la venta heredada (`ventas`, `detalle_ventas`), la **CxC** (`pagos` tipo `cobrar`) y el comprobante con snapshot; la **guía** posterior consume reserva y registra la **salida física** en Kardex. Un pedido reservado puede anularse; una **nota de crédito** de pedido despachado reduce la CxC no cobrada y, solo si se marca devolución real, registra la entrada física. Se conserva el tope de unidades vendidas/despachadas y de saldo financiero no cobrado.

```text
Cotización/versiones → Conversión ─┐
Pedido directo ─────────────────────┴→ Pedido reservado → Factura/boleta + CxC → Guía + salida Kardex
                                         └→ Anulación antes de facturar      └→ Nota de crédito (tras despacho)
                                                                           [entrada de stock solo si hubo retorno]
```

**SUNAT:** las tablas de códigos/afectaciones y el snapshot UBL 2.1 preparan información e impresión A4/ticket, **no** implementan envío electrónico, aceptación ni CDR. La pantalla `SUNAT` es informativa; imprimir un comprobante no acredita comunicación tributaria. Las ventas antiguas no pasan por este flujo de guía para evitar doble salida.

## 2. Arquitectura de base de datos (Backend SQL)

### DDL, relaciones, índices

| Tabla/estructura | Propósito y FK | Restricciones/índices |
| --- | --- | --- |
| `ec_sunat_documentos`, `ec_sunat_afectaciones` | Catálogos 01/03/07/09 y tasas 10/20/30; afectación 10 = 18%, 20/30 = 0%. | Código PK; el flujo `ec_comprobantes` admite factura 01 o boleta 03. |
| `ec_cotizaciones` → `ec_cotizacion_versiones` | Cliente (`clientes`), versión actual y snapshot histórico por `(cotizacion_id, version)`; líneas JSONB normalizadas, fecha, moneda/FX/total. | PK compuesta de versiones, estados y controles de valor/JSON. |
| `ec_pedidos` | FK cliente/almacén/cotización/venta; código secuencial `PV-*`; líneas y total snapshot; estados `reservado`, `facturado`, `despachado`, `anulado`. | `idempotency_key unique`, `payload_hash`; `venta_id unique`; índice parcial `ec_pedidos_cotizacion_unique` evita dos pedidos no anulados por cotización. |
| `ec_reservas` | PK `(pedido_id,producto_id)`, FK a pedido/producto; `cantidad`, `entregado` entre 0 y cantidad. | La reserva lógica se suma para calcular stock libre; no sustituye `inventarios.cantidad`. |
| `ec_comprobantes` | FK única a `ventas`; tipo/correlativo, base, IGV, total, moneda, FX, snapshot, estado SUNAT. | `unique(tipo,serie,numero)` y `venta_id unique`: un comprobante por venta. |
| `ec_guias` | FK única a pedido; origen/destino, líneas, código `GR-*`. | `pedido_id unique`, `idempotency_key unique`, `payload_hash`. |
| `ec_notas_credito` | FK a pedido y venta, motivo/líneas/total, código `NC-*`. | Clave idempotente única; varias notas parciales permitidas hasta el límite global. |
| `ec_operaciones` | Ledger interno de cotización, factura, anulación y conversión: `clave`, `tipo`, `hash`, `id`. | `clave` PK; permite devolver resultado previo o rechazar una clave reciclada. |
| Base compartida | `inventarios`, `productos`, `movimientos_inventario`, `ventas`, `detalle_ventas`, `pagos`, `aplicaciones_pago`, `movimientos_tesoreria`. | Índices y RLS previos permanecen en sus migraciones; las RPC de Ventas atraviesan esos límites. |

Se crean secuencias `seq_ec_pedidos`, `seq_ec_guias`, `seq_ec_nc`. Además de las claves anteriores, **no hay que atribuir índices secundarios específicos de las tablas `ec_*` que no aparezcan en la migración**.

**RLS.** `20261119000000` habilita RLS para las tablas `ec_*`; revoca escritura a los roles cliente, concede `SELECT` a `authenticated` y aplica políticas de lectura: `cotizaciones` para cotización/versiones y `ventas` para pedidos, reservas, comprobantes, guías, notas y catálogos SUNAT. `ec_operaciones` tiene RLS, pero se deja sin política de lectura cliente; la inspección de su clave corresponde a RPC autorizadas. Todas las funciones públicas de escritura se definen `SECURITY DEFINER SET search_path = ''`, comprueban `auth.uid()` y `tiene_permiso` antes de modificar, se revocan a `public,anon` y se concede `EXECUTE` a `authenticated`. La guía exige permiso de Ventas e Inventario; la nota de crédito, Ventas y Finanzas, más Inventario si retorna stock.

```sql
-- Extracto literal de 20261119000000_ventas_integrales.sql
revoke all on public.ec_cotizaciones,public.ec_cotizacion_versiones,public.ec_pedidos,public.ec_reservas,public.ec_comprobantes,public.ec_guias,public.ec_notas_credito from public,anon,authenticated;
grant select on public.ec_cotizaciones,public.ec_cotizacion_versiones,public.ec_pedidos,public.ec_reservas,public.ec_comprobantes,public.ec_guias,public.ec_notas_credito,public.ec_sunat_documentos,public.ec_sunat_afectaciones to authenticated;
create policy ec_orders_read on public.ec_pedidos for select to authenticated using (public.tiene_permiso('ventas','ver'));
```

### RPC y lógica de negocio

| RPC | Comportamiento transaccional |
| --- | --- |
| `ec_validar_lineas_venta` (auxiliar) | Rechaza duplicados, cantidades/precios inválidos; ordena productos y calcula total, base e IGV por línea en servidor. **El precio unitario incluye IGV**: base gravada `round(total / 1.18, 2)`. |
| `ec_guardar_cotizacion` | Crea/edita vigente/borrador, incrementa versión y guarda snapshot; clave + hash en `ec_operaciones`; valida vencimiento/moneda. |
| `ec_crear_pedido` | Ordena y bloquea productos, comprueba `stock físico - reservas vigentes >= cantidad`, inserta reserva y marca cotización convertida si corresponde. |
| `ec_convertir_cotizacion` | Bajo bloqueo, llama creación de pedido y, opcionalmente, facturación con subclaves derivadas; ledger de conversión evita repetición. |
| `ec_facturar_pedido` | Bloquea pedido, comprueba estado y RUC para factura, crea `ventas`/detalle/CxC/`ec_comprobantes`; estado `facturado`, sin salida física. |
| `ec_anular_pedido` | Solo pedido `reservado`; marca anulado, libera reserva al dejar de contarla y devuelve vigencia a cotización no vencida. |
| `ec_emitir_guia` | Solo pedido `facturado`, guía única, consume `ec_reservas.entregado` y registra salida de inventario por línea; estado `despachado`. |
| `ec_nota_credito` | Solo pedido despachado, comprueba cantidades previas, CxC y cobros no anulados; reduce CxC y registra entrada si `p_devolver_stock`. |
| `ec_proteger_reservas` (trigger) | Antes de reducir `inventarios.cantidad`, impide caer por debajo de la reserva pendiente de pedidos reservados/facturados, incluso en rutas heredadas. |

Fragmentos **exactos y parciales** de `20261119000000_ventas_integrales.sql` (las definiciones ejecutables completas están en esa migración):

```sql
v_total:=round(v_qty*v_price,2); v_base:=case when v_tax='10' then round(v_total/1.18,2) else v_total end; v_igv:=v_total-v_base;
```

```sql
-- Reserva: candado por almacén/producto y fila física antes de calcular libre.
perform pg_advisory_xact_lock(hashtextextended('ec:stock:'||p_almacen_id::text||':'||(v_line->>'producto_id'),0));
select cantidad into v_available from public.inventarios where almacen_id=p_almacen_id and producto_id=(v_line->>'producto_id')::uuid for update;
select coalesce(sum(r.cantidad-r.entregado),0) into v_reserved from public.ec_reservas r join public.ec_pedidos o on o.id=r.pedido_id where o.almacen_id=p_almacen_id and o.estado in ('reservado','facturado') and r.producto_id=(v_line->>'producto_id')::uuid;
if coalesce(v_available,0)-v_reserved<(v_line->>'cantidad')::integer then raise exception 'Stock disponible insuficiente para reservar %.',v_line->>'producto_id'; end if;
```

```sql
-- Guía: reserva propia consumida y movimiento físico único por producto.
update public.ec_reservas set entregado=cantidad where pedido_id=p_pedido_id and producto_id=(v_line->>'producto_id')::uuid;
perform public.registrar_movimiento_inventario((v_line->>'producto_id')::uuid,v_order.almacen_id,'salida',(v_line->>'cantidad')::integer,'Guía '||v_id::text,'ec:guia:'||v_id::text||':'||(v_line->>'producto_id'),'guia',v_id,'Salida oficial de venta');
```

**Concurrencia e idempotencia.** Cada acción usa `p_key`; `pg_advisory_xact_lock(hashtextextended('ec:<acción>:'||p_key,0))` serializa reintentos de esa acción y las claves únicas/`payload_hash` rechazan contenido distinto. Para stock se bloquea por almacén/producto en orden estable; `FOR UPDATE` protege pedido/CxC. El ledger `ec_operaciones` cubre transiciones sin fila idempotente propia; pedidos, guías y notas tienen su columna única. La comprobación de saldo/libre en React es orientativa: la RPC repite la validación en la transacción. Si intervienen otras rutas de stock, también debe comprobarse su coordinación con el trigger/bloqueos en una prueba de integración.

## 3. Arquitectura frontend (React, TypeScript, CSS)

- `src/routes/AppRouter.tsx`: `/sales` pedidos, `/quotes` cotizaciones, `/sales/receipts` comprobantes, `/sales/guides` guías, `/sales/credits` notas y `/sales/sunat` aviso de integración; todas son instancias `SalesOperationsPage` con pestaña inicial. `SalesReceiptPrint.tsx` resuelve A4/ticket. `ModuloPage` conserva las rutas legadas; `/facturacion` redirige a `/sales`.
- `src/services/salesOperations.ts` tipa entidades y delega en siete RPC públicas. `loadSalesOperations()` junta once catálogos/operaciones con `Promise.all` y **recorre** cada tabla en bloques de 500 con `.range(offset, offset + 499)` y orden estable (`id` o PK compuesta), en vez de asumir que una sola respuesta no está truncada.
- `SalesOperationsPage` guarda `loadSequence = useRef(0)` y acepta solo la respuesta más reciente. Mantiene `requestKey` durante un error de RPC (el backend protege reintentos por payload) y separa el `try/catch` de escritura del `try/catch` de `reload()`. En éxito de escritura y fallo de lectura indica explícitamente que la operación quedó guardada. `reloadWorkspace()` actualiza registros compartidos; este flujo **no** implementa preconsulta de clave en el frontend ni garantiza conocer el resultado de una respuesta de red ambigua.
- `fetchSalesCreditBalance()` consulta `pagos` y `obtener_saldos_cuentas` para mostrar el saldo orientativo; la nota recalcula el máximo en SQL. `businessDate()` (`src/data/workspace.ts`) fija la fecha de negocio con `America/Lima`; importes `Intl.NumberFormat('es-PE', { style: 'currency', currency })`.

```tsx
// src/services/salesOperations.ts: fragmento real de la carga completa.
for (let offset = 0; ; offset += 500) {
  let query = requireSupabase().from(table).select(columns)
  for (const column of sortColumns[table] ?? ['id']) query = query.order(column)
  const { data, error } = await query.range(offset, offset + 499)
  if (error) throw error
  result.push(...((data ?? []) as T[]))
  if ((data ?? []).length < 500) return result
}
```

```tsx
// src/components/SalesOperationsPage.tsx: la recarga nunca convierte un éxito de escritura en fracaso de escritura.
try { await operation() }
catch (cause) { setError(errorText(cause)); return }
try { await reload() }
catch (cause) {
  setError(`Operación guardada con éxito, pero hubo un problema al recargar la lista. ${errorText(cause)}`)
  resetAfterSave()
  void reloadWorkspace()
  return
}
```

**Diseño.** `src/sales-operations.css` implementa pantallas ERP/SaaS densas: `.ws-sales-page` con `gap: 10px`, fuentes compactas, pestañas horizontales desplazables, tablas de lectura rápida, formularios sin blancos excesivos y feedback visible. Paleta semántica mediante `--ws-text`, `--ws-surface`, `--ws-raised`, `--ws-border`, `--ws-primary`, `--ws-green(-soft)`, `--ws-amber(-soft)`, `--ws-red(-soft)`; no fijar colores hexadecimales para nuevas píldoras/estados. Impresión no depende del color para demostrar validez tributaria.

## 4. Auditoría QA y parches críticos

| Severidad técnica | Riesgo y resolución observable |
| --- | --- |
| **Alta** | **Sobreventa/doble salida:** reserva atómica con lock y `FOR UPDATE`; salida solo al emitir guía; trigger transversal `ec_proteger_reservas`; no mover stock al facturar. |
| **Alta** | **Reintentos, doble factura/guía/nota:** claves únicas y hash, ledger `ec_operaciones`, advisory locks, secuencia y pedido bloqueado; series/número únicos y una guía/comprobante por pedido/venta según FK. |
| **Alta** | **Notas por encima de unidades o cobros:** acumular notas previas, exigir despacho y `CxC - cobros vigentes`; stock vuelve solo si se recibió físicamente. |
| **Media** | **IGV y moneda incorrectos:** precio unitario incluye IGV; SQL calcula por línea y conserva `PEN/USD` y FX en pedido, CxC y comprobante. No aplicar tipo de cambio dos veces al presentar una cifra en moneda de origen. |
| **Media** | **Truncamiento/respuestas obsoletas/recarga ambigua:** iteración `.range(... + 499)`, `useRef` de secuencia, separación de errores de escritura/lectura; conservar clave al fallar la RPC. |
| **Baja** | **Fecha/estética:** UI usa `America/Lima` para vencimiento y presentación; CSS compacto y variables corporativas. |

**Límites de QA.** `current_date` en SQL sigue la zona horaria configurada en PostgreSQL; el cálculo frontend en Lima **no demuestra** por sí solo coincidencia del día de negocio de la base. El listado integral descarga todos los registros por páginas, no es paginación de interfaz para grandes volúmenes. No se ha verificado desde esta documentación un envío SUNAT, una transacción contra Supabase remoto ni una prueba específica de concurrencia en producción. La última verificación general disponible del repositorio fue `typecheck`, 53 pruebas y `build`; no sustituye ensayos end-to-end de Ventas.

# Implementación de Maestros, Tesorería bancaria y Comisiones

**Aplicado y validado:** 29 de octubre de 2026 · Proyecto Supabase `auxqjoxnsasnmtnakgmg`
**Migraciones registradas:** `maestros_tesoreria_comisiones_schema` (20261030034328) y `maestros_tesoreria_comisiones_funciones` (20261030034434) — archivos locales `supabase/migrations/20261103060000_..._schema.sql` y `20261103061000_..._funciones.sql`.

Integra los módulos pendientes del compañero (Maestros: transportistas/vendedores y catálogos de negocio; Tesorería: bancos, flujo y conciliación; Comisiones de vendedores) al proyecto canónico, adaptando su migración única a las convenciones vigentes de este repositorio. Todo es forward-only y no altera datos operativos existentes.

## 1. Esquema (14 tablas)

| Grupo | Tablas | Detalles clave |
|---|---|---|
| Maestros | `transportistas`, `vendedores`, `catalogos_negocio` | `vendedores.usuario_id` único parcial; `transportistas.ruc` único parcial; catálogos con `unique (categoria, codigo)` y 18 filas semilla (documentos de venta, identidad, régimen, operación, condición de pago, traslado, IGV18). |
| Tesorería | `cuentas_bancarias`, `movimientos_bancarios`, `conciliaciones_bancarias`, `lineas_extracto_bancario` | Solo números de cuenta enmascarados (4–30 caracteres); movimientos con `transferencia_id` para ligar salida/entrada; `unique` de conciliación por cuenta+período; línea de extracto con vínculo único a un movimiento. |
| Comisiones | `reglas_comision`, `escalas_comision`, `excepciones_comision`, `ventas_vendedor`, `liquidaciones_comision`, `ajustes_comision`, `pagos_comision` | Una única regla activa (índice parcial); impide períodos superpuestos vía `btree_gist` + exclusiones `liquidaciones_comision_periodo_exch` y `excepciones_comision_periodo_exch`; relación venta–vendedor explícita sin tocar los módulos operativos. |

**Controles transversales:**
- Idempotencia por clave+hash en `movimientos_bancarios`, `lineas_extracto_bancario`, `pagos_comision` y `ajustes_comision` con índice único parcial `*_idem_uidx` (activo solo cuando la clave existe).
- `trg_auditoria` en las 14 tablas; `trg_updated_at` en las 6 mutables.
- 16 columnas FK/clave indexadas.
- RLS habilitado en las 14, `revoke all` a `public, anon, authenticated` y grants mínimos explícitos:
  - `transportistas`, `vendedores`, `catalogos_negocio`: SELECT/INSERT/UPDATE.
  - `cuentas_bancarias`, `movimientos_bancarios`, `conciliaciones_bancarias`, `lineas_extracto_bancario`: SELECT/INSERT.
  - `reglas_comision`, `escalas_comision`, `excepciones_comision`: total con permiso de edición de ventas; `ventas_vendedor` incluye DELETE.
  - `liquidaciones_comision` y `pagos_comision`: **solo SELECT** (la escritura pasa por RPC autorizados).
  - `ajustes_comision`: SELECT/INSERT.
- 28 políticas RLS; `vendedores` es legible con `configuracion:ver` **o** `ventas:ver` (necesario para Comisiones).

## 2. Funciones/RPC (7, `security definer`, `search_path = ''`)

| RPC | Firma | Comportamiento |
|---|---|---|
| `actualizar_estado_cuenta_bancaria` | `(uuid, boolean) → void` | Único canal para activar/desactivar cuentas (la tabla no acepta UPDATE directo). Requiere `finanzas:editar`; `P0002` si no existe. |
| `registrar_transferencia_bancaria` | `(origen uuid, destino uuid, monto numeric, fecha date, referencia text, idempotencia text) → uuid` | Asientos 'transferencia_salida' + 'transferencia_entrada' atómicos. Con clave: repetición idéntica devuelve la transferencia original; contenido distinto → `23505` (hash guard + advisory lock). Exige ambas cuentas activas y misma moneda. La clave queda guardada en el asiento de salida. |
| `actualizar_estado_conciliacion` | `(uuid, text) → void` | Cierre exige: período ≥ `fecha_saldo` de la cuenta, cero líneas sin vincular y saldo extracto = saldo_inicial ± movimiento en ±0.01. Error `23514` con el libro calculado. |
| `conciliar_linea_extracto` | `(linea uuid, movimiento uuid) → void` | Vinculo/desvinculo atómico validado por cuenta, intervalo del período e importe firmado ±0.01. |
| `liquidar_comision` | `(uuid) → void` | 'calculada' → 'liquidada'; idempotente (repetición sobre 'liquidada' no falla); rechaza otros estados. |
| `calcular_comisiones` | `(desde date, hasta date) → int` | Venta base: `ventas.monto` de ventas `Completada` asignadas, con `timezone('America/Lima')`. Precedencia: excepción del vendedor > escala por rango > porcentaje base. El recálculo elimina liquidaciones 'calculada' que ya no aplican y solo refresca filas aún 'calculada'. |
| `registrar_pago_comision` | `(liquidacion uuid, monto numeric, fecha date, medio text, referencia text, cuenta uuid, idempotencia text) → uuid` | Requiere liquidada/pagada; respeta saldo (`comision + ajustes − pagado`); cuenta opcional activa en PEN que genera el asiento `'egreso' = Pago de comisión` y lo vincula; marca 'pagada' al cubrir el total. Idempotencia con mismo hash guard. |

Todas con `revoke ... from public, anon` + `grant execute` a `authenticated`; `anon=false/auth=true`.

## 3. Frontend

- Rutas nuevas en `AppRouter.tsx`: `/maestros` (MaestrosPage), `/tesoreria` (TreasuryPage), `/comisiones` (CommissionsPage).
- Servicios nuevos: `src/services/masters.ts`, `treasury.ts`, `commissions.ts`.
- Menú (`src/data/workspace.ts`): entradas 'Bancos y conciliación', 'Comisiones de vendedores' y 'Maestros'; submódulos de Maestros/Tesorería/Comisiones activos con anclas (`#personas`, `#catalogos`, `#reglas`, `#calculo`, `#liquidaciones`, `#historial`).
- Adaptaciones respecto a la versión del compañero:
  - `treasury.toggleBankAccount` llama al RPC `actualizar_estado_cuenta_bancaria` (la tabla no acepta UPDATE desde el cliente).
  - `treasury.transferBankFunds` y `commissions.payCommission` aceptan clave de idempotencia opcional que se envía como último parámetro del RPC.
  - `OrganizationSetup` re-consulta la organización al crear la primera sucursal (evita depender de datos viejos en memoria).
- `workspace.css` incorporado (superconjunto; solo clases `ec-*` nuevas); `package.json` con `npm run preview`.

## 4. Validación ejecutada

**Prueba funcional de Tesorería (rollback completo):** toggle vía RPC (activa false/true); transferencia 100 con clave repetida → misma transferencia, 2 asientos; clave con monto 150 → `La clave de transferencia ya fue usada con otro contenido.`; cierre con línea sin vincular → `Vincula todas las líneas del extracto antes de cerrar.`; vínculo + cierre OK; cálculo con escala (0–400 → 5 %, ≥400 → 12 %) sobre venta de 500 → liquidación 60.00 'calculada'; doble liquidación idempotente; pago 60 con cuenta → estado 'pagada', 1 asiento bancario, repetición devuelve el mismo pago; INSERT directo a `liquidaciones_comision` como `authenticated` → `permission denied` (esperado: escritura solo vía RPC).

**Exclusión de períodos:** liquidación 01–30 sep OK; 15 sep–15 oct superpuesta → `violates exclusion constraint liquidaciones_comision_periodo_exch`; período contiguo 01–31 oct OK.

**DDL/RLS verificado:** 14 tablas con RLS+auditoría, 28 políticas, grants exactos, 16/16 FK indexadas, `btree_gist` activo, 2 exclusiones, 7 RPC con la superficie correcta, `catalogos_negocio` = 18 filas.

**Frontend:** `npm run typecheck` limpio; `npm test` 48/48.

## 5. Limitaciones conocidas

- La recepción/stock sigue en cantidades enteras (`detalle_recepciones_compra`/`inventarios` INTEGER); las fracciones (2.500, 3.250) son válidas en requisición, oferta y orden, y la comparación recepcionada vs. pedida funciona por coerción numérica, pero el stock registrado se contabiliza por unidades.
- `compras.monto` sesga el total con IGV de las líneas fiscales y la CxP nace en 0.00 y se prorratea con lo recibido (comportamiento de `trg_cxp_monto_fiscal_desde_compra` / `_sincronizar_monto_compra_desde_lineas_v1`), no es un defecto de esta fase.
- Transferencias solo entre cuentas de la misma moneda (la conversión debe registrarse por separado).
- El cálculo usa el día completo del negocio peruano (`America/Lima`); cambiar de zona requiere revisar `calcular_comisiones`.

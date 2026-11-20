# Cierre de Notificaciones y Aprobaciones — prueba cruzada

Alcance: `/aprobaciones#reglas`, `/notificaciones`, migraciones `20261120000000_reglas_aprobacion_umbrales_v1.sql` y `20261120000100_alertas_predictivas_v1.sql`.

## 1. Qué se entregó

| Pedido | Resultado |
|---|---|
| Umbrales editables en Reglas y flujos | Tabla `ec_reglas_aprobacion` + RPC `ec_actualizar_regla_aprobacion_v1` (solo Gerente/Administrador, con auditoría) + panel editable en `/aprobaciones#reglas`. Dos reglas: monto mínimo de orden de compra (S/) y variación máxima de conteo físico (unidades). |
| Alertas predictivas en el Centro de Alertas | Fuente `predictive` en la bandeja persistente. Hoy la alimenta un **modelo estadístico** (suavizado exponencial del consumo de 28 días → días de cobertura). **No es una red neuronal**: no existe una en el repositorio. Hay un contrato (`PredictiveAlertProvider`) para enchufarla. |
| Prueba cruzada con 2 usuarios reales | Protocolo en la sección 4 (**pendiente de ejecutar por ustedes**). Se ejecutó una simulación local con 4 usuarios simulados (sección 3). |

### Comportamiento de los umbrales
- Ambas reglas nacen **desactivadas y en 0**: todo sigue exigiendo aprobación de otra persona, igual que antes.
- Orden de compra: si está activa y el total estimado con impuestos en PEN es **menor** que el umbral, la orden se emite sin esperar decisión. Igual al umbral → sigue pendiente.
- Conteo físico: variación absoluta **menor o igual** al umbral se aplica sin decisión.
- La emisión automática queda como solicitud `approved` con `decision_por` = solicitante y un evento `aprobada` con `auto_aprobada: true`, regla, umbral y medida. Si falla por cualquier motivo, la solicitud queda `pending` y sigue el flujo normal.
- Solo se activa dentro de la sesión de quien solicita y si tiene permiso para emitir (Compras: crear; Inventario: crear/editar).
- Cambiar un umbral rige solo para solicitudes nuevas; las pendientes siguen su curso.
- El total de una orden manual sin líneas usa `monto_manual`; con líneas, suma cantidad × precio × (1 + tasa si es Gravado) × tipo de cambio.

### Conectar una red neuronal después
1. Implementar `PredictiveAlertProvider` (`src/services/predictiveAlerts.ts`) y registrarlo con `registerPredictiveProvider`.
2. Devolver alertas `{ fuente: 'predictive', clave_fuente (estable), referencia, titulo ≤180, detalle ≤500, severidad }`.
3. Si es un servicio externo, llamarlo desde una Edge Function con JWT (la clave nunca va al navegador).
4. Si un proveedor falla, no se sincroniza: así no se resuelven por error las alertas vigentes.

## 2. Aplicar en Supabase
Las dos migraciones son aditivas, pero **dependen de tablas y funciones que el repositorio no puede crear desde cero**. El 18-11 se aplicaron los 109 archivos de `supabase/migrations/` en orden sobre un PostgreSQL vacío (con `auth` simulado): tras reintentos, 15 siguen fallando por objetos que existen solo en el historial remoto (por ejemplo `requisiciones_compra`, `crear_solicitud_compra`, `app_private.purchase_transition_idempotency`, `convertir_solicitud_a_orden_v1`) y por funciones definidas en archivos de fecha posterior. Es la deriva ya descrita en `supabase/README.md`.

Para un proyecto nuevo, el camino fiable es **restaurar un volcado del esquema** del proyecto existente y aplicar después solo estas dos migraciones, a mano y en orden:
`supabase db dump --schema public,app_private -f esquema.sql` (lo ejecuta quien tenga acceso al proyecto original), restaurarlo en el proyecto nuevo y luego `20261120000000` y `20261120000100`. No usar `db push`.

## 2b. Verificación contra el esquema real
Las dos migraciones se aplicaron sobre un volcado `--schema-only` del proyecto real (sin datos) sin errores, y una prueba con las funciones reales confirmó la auto-aprobación (S/ 500 con umbral S/ 1 000) y que S/ 1 000 y S/ 1 500 quedan pendientes. Falta la prueba con datos y usuarios reales (sección 4).

## 3. Evidencia de la simulación local (NO sustituye la prueba real)
`supabase/tests/aprobaciones_umbrales/run.sh` levanta un PostgreSQL 16 desechable con un esquema mínimo que imita Supabase (roles, `auth.uid()`, permisos) y aplica el SQL **real** del repositorio (tablas y `ec_decidir_aprobacion_v1` de aprobaciones, bandeja de notificaciones y las dos migraciones nuevas). Las funciones que emiten órdenes/conteos son stubs. Resultado: **16 escenarios, todos aprobados**, entre ellos:

- Solicitante (Operador) no puede decidir; Gerente tampoco decide lo que él mismo solicitó.
- Otro Operador no ve solicitudes ajenas; Gerente/Administrador sí.
- Rechazo exige motivo; aprobación emite la orden, deja historial `solicitada → aprobada` y avisos al solicitante.
- Solo Gerente/Administrador editan umbrales; valores inválidos se rechazan; queda auditoría.
- Umbral S/ 1 000: S/ 590 y USD 118×3,8 se emiten solos; exactamente S/ 1 000 y S/ 1 770 quedan pendientes.
- Conteo: variación 5 (≤ 5) se aplica solo; 6 queda pendiente.
- Sin permiso, sin sesión o si falla la emisión: queda pendiente.
- Alertas predictivas: sincronizar, conservar lectura, resolver las que desaparecen, aislamiento por usuario y por permiso, formato inválido, tope de 600, sin INSERT directo.

Verificación de que las pruebas detectan errores: al cambiar `<` por `<=` en el umbral, el caso límite falla.
Además: 17 pruebas unitarias nuevas en `tests/approvalRules.test.mjs` y `tests/predictiveAlerts.test.mjs`.

## 4. Protocolo de la prueba cruzada con usuarios reales

**Preparación**
- Proyecto de pruebas (o rama) con las dos migraciones aplicadas y datos de ejemplo: al menos un proveedor activo y 3 productos con salidas de los últimos días.
- Usuario A "Solicitante": rol con Compras (ver/crear), Inventario (ver/crear) y Aprobaciones (ver), **sin** permiso de aprobar.
- Usuario B "Aprobador": rol Gerente o Administrador, correo distinto.
- Dos navegadores o perfiles distintos (A y B simultáneamente).

| # | Usuario | Acción | Resultado esperado | OK | Evidencia |
|---|---|---|---|---|---|
| 1 | B | `/aprobaciones#reglas`: ver umbrales | Ambas reglas inactivas, valor 0 | ☐ | |
| 2 | A | Mismo lugar | Ve las reglas, sin campos editables ni botón Guardar | ☐ | |
| 3 | A | Crear orden manual de S/ 500 | Mensaje "enviada a la bandeja de aprobaciones"; estado Pendiente | ☐ | |
| 4 | A | Intentar aprobarla | No hay botones de decisión | ☐ | |
| 5 | B | Campana / `/notificaciones` | Aviso de solicitud nueva de A | ☐ | |
| 6 | B | Rechazar sin motivo | Se exige motivo | ☐ | |
| 7 | B | Rechazar con motivo | Estado Rechazada; no existe orden | ☐ | |
| 8 | A | `/notificaciones` | Aviso "Solicitud rechazada" con el flujo correcto | ☐ | |
| 9 | A | Crear otra orden S/ 500 | Pendiente | ☐ | |
| 10 | B | Aprobar | Orden creada; historial solicitada → aprobada; A recibe aviso | ☐ | |
| 11 | B | Activar regla de orden en S/ 1 000; guardar | Mensaje de guardado; fila de auditoría | ☐ | |
| 12 | A | Orden S/ 500 | Mensaje "Orden emitida sin aprobación manual"; historial con `auto_aprobada` | ☐ | |
| 13 | A | Orden S/ 1 500 | Pendiente | ☐ | |
| 14 | B | Desactivar la regla; A crea S/ 500 | Pendiente otra vez | ☐ | |
| 15 | B | Intentar poner umbral 0 con regla activa, `-5`, `abc` | Mensaje de error, no guarda | ☐ | |
| 16 | A | Conteo físico con diferencias (regla de conteo = 5) | Variación ≤ 5: se aplica sola; mayor: pendiente | ☐ | |
| 17 | A | `/notificaciones` → "Alertas predictivas" | Productos con < 14 días de cobertura, severidad según días | ☐ | |
| 18 | A | Marcar leída/archivar una predictiva; recalcular | La leída se conserva; las que ya no aplican pasan al historial | ☐ | |
| 19 | B | Ver `/notificaciones` | No ve las alertas personales de A | ☐ | |

Registrar para cada paso: fecha/hora, capturas, y el `id` de la solicitud. Cualquier desviación se anota con el paso, lo esperado y lo observado.

**Resultado de la ejecución real:** pendiente — ☐ aprobada ☐ con observaciones. Responsables: ______ Fecha: ______

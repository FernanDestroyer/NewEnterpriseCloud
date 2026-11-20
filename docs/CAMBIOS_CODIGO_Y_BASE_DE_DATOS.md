# Cierre de Notificaciones y Aprobaciones — cambios en código y base de datos

Comparación entre lo original (`NewEnterpriseCloud-main_3.zip` y el volcado `esquema.zip`, 121 tablas, 270 políticas, 446 funciones) y la versión actual.
Fecha: 19 nov. 2026.

## 0. Resumen

| | Original | Ahora |
|---|---|---|
| Umbrales de aprobación | Fijos: toda orden y todo conteo con diferencias exigen aprobación | **Editables** en `/aprobaciones#reglas` (solo Gerente/Administrador), con auditoría |
| Alertas en `/notificaciones` | Inventario, Tesorería, Compras, Aprobaciones | + **Alertas predictivas** (modelo estadístico) |
| Confirmación al aprobar | Aviso del navegador (`window.confirm`) | Diálogo propio de la app con resumen de la solicitud |
| Prueba cruzada | — | Probada con 2 usuarios (Solicitante/Operador y Gerente) en un proyecto de pruebas; protocolo de 19 pasos documentado |

**Importante:** las alertas predictivas usan un **modelo estadístico** (suavizado exponencial del consumo de 28 días), **no una red neuronal**: la Red Neuronal no existe en el repositorio. Quedó un contrato (`PredictiveAlertProvider`) para enchufarla después.

---

## 1. Cambios en el código

### 1.1 Archivos nuevos (6 de código + 2 pruebas)

| Archivo | Qué hace |
|---|---|
| `src/data/approvalRules.ts` | Lógica pura de las reglas: tipos, validación de lo que escribe la persona, detección de cambios, textos. |
| `src/components/ApprovalRulesPanel.tsx` | Tarjeta editable de umbrales en Reglas y flujos. Solo lectura si no eres Gerente/Administrador. |
| `src/data/predictiveAlerts.ts` | Modelo estadístico: EWMA (alfa 0,3) del consumo diario de 28 días, días de cobertura, severidad (crítica ≤ 7 días, atención ≤ 14), fecha estimada de quiebre, reposición sugerida y confianza. **La ventana termina ayer** (el día en curso, incompleto, no cuenta). |
| `src/services/predictiveAlerts.ts` | Contrato `PredictiveAlertProvider` + registro (`registerPredictiveProvider`) para conectar una red neuronal/servicio externo; lectura de salidas; sincronización con la base. Si un proveedor falla no se sincroniza (no se resuelven alertas vigentes por error). |
| `tests/approvalRules.test.mjs` | 6 pruebas. |
| `tests/predictiveAlerts.test.mjs` | 12 pruebas (incluye el caso del día en curso). |

### 1.2 Archivos modificados (10)

| Archivo | Cambio |
|---|---|
| `src/components/ApprovalsPage.tsx` | Inserta `<ApprovalRulesPanel>` en la pestaña Reglas y flujos; ajusta un texto; **reemplaza `window.confirm` por `ConfirmModal`** con resumen de la solicitud. |
| `src/services/approvals.ts` | `fetchApprovalRules`, `updateApprovalRule`, `fetchApprovalOutcome`; mensaje amigable si faltan las migraciones. |
| `src/components/NotificationsPage.tsx` | Nueva fuente **Alertas predictivas**: etiqueta, ícono, grupo, aviso con botón *Recalcular*, cálculo y sincronización al abrir, leer/archivar, ruta a existencias. |
| `src/components/layout/AppLayout.tsx` | La campana cuenta y enlaza las alertas `predictive`. |
| `src/data/operationalAlerts.ts` | El tipo `NotificationSource` admite `'predictive'`. |
| `src/context/RecordsContext.tsx` | El aviso al crear una orden indica si se emitió sin aprobación manual o quedó pendiente. |
| `src/components/PurchaseContractsPage.tsx` | Mismo aviso para órdenes desde contrato. |
| `src/components/PhysicalInventoryPage.tsx` | Mismo aviso para el cierre de conteo físico. |
| `src/workspace.css` | Estilos de la tarjeta de umbrales (`.ec-approval-thresholds`, `.ec-rule-*`) y del resumen del diálogo de confirmación. |
| `package.json` | El script `test` incluye las dos pruebas nuevas. |

No se borró nada del original.

---

## 2. Cambios en la base de datos

Todo es **aditivo**: no se modifica ni se borra ningún dato existente ni ninguna función existente (`ec_decidir_aprobacion_v1`, RPC de solicitud, etc. quedan intactas).

### 2.1 `20261120000000_reglas_aprobacion_umbrales_v1.sql`

| Objeto | Tipo | Qué hace |
|---|---|---|
| `public.ec_reglas_aprobacion` | Tabla nueva | Umbrales editables (`clave`, `titulo`, `descripcion`, `unidad` PEN/unidades, `valor` 0–1 000 000 000, `activa`, `actualizado_por`, `actualizado_en`). RLS: lectura con Aprobaciones: ver; escritura solo por RPC. |
| 2 filas iniciales | Datos | `orden_compra_monto_minimo_pen` y `conteo_fisico_variacion_maxima_unidades`, **inactivas y en 0** (todo sigue exigiendo aprobación, como antes). |
| `public.ec_actualizar_regla_aprobacion_v1(clave, valor, activa)` | RPC `security definer` | Solo Gerente/Administrador con permiso de aprobar. Valida valor, rango, enteros para unidades y que activar exija valor > 0. Escribe en `auditoria`. |
| `app_private._ec_total_estimado_pen_v1(tipo, snapshot)` | Función interna | Total estimado en soles con impuestos (cantidad × precio × (1 + IGV si Gravado) × tipo de cambio; o `monto_manual`; u `oferta.total_pen`). |
| `app_private._ec_autoaprobar_bajo_umbral_v1()` | Función de trigger | Emite la orden o aplica el conteo sin decisión manual cuando está bajo el umbral. |
| `ec_solicitudes_aprobacion_autoaprobar` | Constraint trigger diferido | Se dispara al confirmar la transacción, para que el historial quede `solicitada → aprobada`. |

Comportamiento de la auto-aprobación:
- Órdenes (`purchase_manual`, `purchase_sourcing`, `purchase_contract`): regla activa y total en PEN **menor** que el umbral. Igual al umbral queda pendiente.
- Conteo físico: hay diferencias y la variación absoluta es **menor o igual** al umbral.
- Solo dentro de la sesión del propio solicitante y con permiso para emitir (Compras: crear; Inventario: crear/editar).
- Queda como solicitud `approved`, con evento `aprobada` y `auto_aprobada: true`, regla, umbral y medida.
- Si la emisión falla, se revierte y la solicitud sigue `pending` para otro aprobador.

### 2.2 `20261120000100_alertas_predictivas_v1.sql`

| Objeto | Tipo | Qué hace |
|---|---|---|
| `notificaciones_fuente_check` | Restricción (reemplazada) | Acepta además la fuente `predictive`. |
| `notificaciones_select_propias`, `notificaciones_update_propias` | Políticas RLS (reemplazadas) | Igual que antes + caso `predictive` (requiere Inventario: ver). La política de INSERT no se tocó. |
| `public.ec_sincronizar_alertas_predictivas_v1(p_alertas jsonb)` | RPC `security definer` | Para el usuario actual con permiso de Inventario. Valida formato (máx. 600 alertas, claves únicas, longitudes, severidad), inserta/actualiza, conserva leído/archivado y **resuelve** las que ya no se predicen. |

### 2.3 Seguridad
- Sin `GRANT` a `anon`; las funciones nuevas solo las ejecuta `authenticated` o se usan internamente.
- Las funciones `security definer` fijan `search_path`.
- Las reglas solo se escriben por RPC.

### 2.4 Scripts de apoyo (solo proyectos de PRUEBAS) — `supabase/seed/`

| Archivo | Para qué |
|---|---|
| `datos_roles_permisos_prueba.sql` | Roles Administrador, Gerente (71 permisos) y Operador (8 permisos: ver/crear/editar en Compras e Inventario, ver en Proveedores y en Aprobaciones; **sin aprobar**). |
| `crear_usuarios_prueba.sql` | Vincula 2 usuarios de Authentication a la tabla `usuarios`. |
| `datos_prueba_alertas.sql` | Empresa, sucursal, almacén, proveedor, 4 productos y 14 días de salidas. |
| `catalogo_proveedor_prueba.sql` | Vincula los productos al proveedor para poder crear órdenes. |

---

## 3. Cómo se aplicó en un proyecto nuevo (copia del esquema)

1. Crear proyecto de pruebas y activar `btree_gist` (`create extension if not exists btree_gist with schema extensions;`).
2. Cargar el volcado **limpio** (sin `\restrict`, `\unrestrict` ni `CREATE SCHEMA public`).
3. `grant usage on schema app_private to authenticated, service_role;` (el volcado no trae permisos).
4. Aplicar las dos migraciones, en orden.
5. Cargar `datos_roles_permisos_prueba.sql`, crear los 2 usuarios, y cargar `datos_prueba_alertas.sql` y `catalogo_proveedor_prueba.sql`.
6. Apuntar `.env.local` a la URL y clave `anon` del proyecto nuevo.

No usar `db push`: las migraciones del repositorio no reconstruyen el esquema desde cero (deriva documentada en `supabase/README.md`).

---

## 4. Problemas encontrados al probar y su corrección

| Hallazgo | Corrección |
|---|---|
| `permission denied for schema app_private` en la tarjeta de umbrales (el volcado no traía los permisos) | `grant usage on schema app_private to authenticated, service_role;` |
| El Operador no veía proveedores (falta Proveedores: ver) | Permiso agregado al rol Operador en el script de roles. |
| El script de datos de ejemplo fallaba contra el esquema real (faltaba empresa/sucursal) | Reescrito y probado contra el esquema real. |
| Faltaba vincular productos al proveedor | Nuevo `catalogo_proveedor_prueba.sql`. |
| El modelo predictivo contaba el día en curso como 0 y bajaba el consumo estimado (~30 %), ocultando alertas | La ventana termina ayer; prueba nueva. |
| Aviso del navegador al aprobar | Reemplazado por `ConfirmModal`. |

---

## 5. Estado de verificación

**Verificado**
- Las 2 migraciones aplican sin errores sobre el esquema real (sin datos).
- Prueba de extremo a extremo con las funciones reales: orden de S/ 472 con umbral S/ 1 000 → emitida sola; S/ 1 000, S/ 1 180, S/ 1 298 y S/ 1 534 → pendientes.
- En un proyecto de pruebas con 2 usuarios: umbrales editables y guardados; el Operador los ve en solo lectura; el solicitante no puede aprobar lo suyo; el Gerente ve y decide las de otros; el solicitante recibe avisos de aprobada/rechazada; las alertas predictivas aparecen en `/notificaciones`.
- 12 pruebas del modelo predictivo y 6 de reglas pasan.

**Pendiente**
- Ejecutar `npm run typecheck`, `npm test` completo y `npm run build` en tu máquina (yo no tenía dependencias instaladas).
- Cerrar la prueba cruzada con el protocolo de `docs/PRUEBA_CRUZADA_APROBACIONES.md`: rechazo con motivo, conteo físico con la regla de variación, desactivar la regla, y registrar evidencias.
- **Red Neuronal real:** conectarla al contrato o aceptar el modelo estadístico como versión inicial.
- Aplicar a producción solo después de lo anterior, con la lógica de auto-aprobación validada por control interno (el solicitante figura como quien aprueba).

---

## 6. Subir el código a una rama (Git)

```bash
git checkout -b feature/cierre-notificaciones-aprobaciones
git add .
git status          # revisa que NO aparezcan .env, .env.local ni node_modules
git commit -m "feat: umbrales de aprobación editables y alertas predictivas"
git push -u origin feature/cierre-notificaciones-aprobaciones
```

Luego abre un Pull Request hacia la rama principal en GitHub. Las migraciones de `supabase/migrations/` se aplican a mano en Supabase, no con el push.

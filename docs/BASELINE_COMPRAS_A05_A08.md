# Diagnóstico de Compras — A05–A08

Fecha de revisión: 2026-10-29. Decisión arquitectónica del usuario: el proyecto Supabase remoto se tratará como entorno exclusivo de desarrollo/pruebas; no se requiere restauración local. El usuario ejecutará manualmente el script A06 en el SQL Editor remoto. Esta actualización distingue implementación, SQL preparado/aplicado y operación verificada.

## Estado

| Tarea | Estado | Evidencia / bloqueo |
|---|---|---|
| A05 — restauración local | Omitida por decisión del usuario | El entorno de trabajo remoto se considera desarrollo/pruebas; no se levantará Supabase local ni se restaurará un dump. Docker/WSL no son prerrequisitos para el flujo acordado. |
| A06 — fixtures de Compras | Completada | El usuario reportó 1 empresa, 1 sucursal, 2 almacenes, 2 proveedores, 1 producto y 1 orden histórica. La matriz de permisos confirmó un actor Básico con Compras ver/crear (sin editar) y un actor Administrador con ver/editar. El script también insertó las entradas de bien/servicio en catálogo; no creó Auth users ni modificó permisos. |
| A07 — solicitud→ofertas→selección | Completada funcionalmente como Administrador | Se ejecutó desde el frontend conectado al remoto. Solicitud `REQ-D739C175E5CB`: 2 líneas, 2 ofertas completas; Beta seleccionada y solicitud Cerrada. La prueba no ejercitó la separación de permisos con el usuario Básico. |
| A08 — diagnóstico actualizado | Completada | Se registra la decisión de omitir A05 y el uso deliberado del remoto para fixtures y pruebas, además de separar script preparado de operaciones ya ejecutadas/verificadas. |

## Código existente (repositorio)

- El repositorio incluye migraciones locales para solicitudes/comparativo (`20261029120000_compras_solicitudes_comparativo.sql`) y correcciones posteriores de inventario. La presencia de esos archivos no demuestra que todos sus efectos estén aplicados remotamente.
- La documentación de A01–A04 registra 23 versiones en el ledger exportado y 28 archivos locales sin registro en esa exportación; su efecto remoto quedó pendiente de evidencia. No ejecutar ni reparar esos archivos en bloque.
- La corrección de Kardex está en `supabase/migrations/20261029200000_evitar_kardex_duplicado_ajuste_legacy.sql`.

## SQL confirmado como aplicado

Según confirmación y resultados aportados por el usuario, la migración correctiva de Kardex fue aplicada manualmente en Supabase. La verificación posterior mostró `SECURITY DEFINER`, `search_path=""`, `authenticated_can_execute=true`, `includes_kardex_guard=true` y el trigger `trg_kardex` habilitado.

## Operaciones verificadas

- La prueba transaccional del ajuste produjo un movimiento explícito, cero movimientos duplicados y aumento temporal de una unidad en stock global y de almacén. El `ROLLBACK` revirtió los datos temporales.
- No se restauró una copia real/sanitizada local.
- No se construyeron fixtures de Compras ni se ejecutó el recorrido solicitud→ofertas→selección en una base local restaurada.
- Se preparó una prueba SQL transaccional que prueba dos actores con permisos distintos, dos líneas (bien/servicio), dos ofertas completas y la selección; termina en `ROLLBACK`. Requiere ejecutarse exclusivamente contra una copia local desechable y no sustituye los fixtures A06 de dos almacenes y orden histórica.
- En esta revisión no se ejecutaron migraciones, dumps, escrituras ni consultas nuevas contra Supabase.
- El repositorio ya tiene `supabase/config.toml`; `supabase init` no es necesario y podría afectar configuración existente. El proyecto local aún no está autenticado/enlazado. La URL y la clave `sb_publishable_…` que compartió el usuario no son un access token de Supabase CLI, contraseña de base de datos ni credencial administrativa; no se guardaron en este diagnóstico.

## A07 — flujo frontend que debe probarse

En la aplicación conectada al proyecto de desarrollo, inicia sesión como el usuario que el script reporta como **actor creador**:

1. Abre `/solicitudes-compra` (Compras → Solicitudes y comparativo). Como detalle usa `A07 QA flujo de validación`; crea dos líneas: `A06 QA BIEN - no contabilizar` (cantidad 2, unidad `unidad`) y `A06 QA Servicio de mantenimiento` (cantidad 1, unidad `servicio`). Comprueba que queda en Borrador.
2. Inicia sesión como el **actor revisor** indicado por el script y abre la solicitud para cotizar.
3. Vuelve a iniciar sesión como el **actor creador** (tiene permiso de crear, no de editar) y registra una oferta por `A06 QA Proveedor Alpha` y otra por `A06 QA Proveedor Beta`, con precio en ambas líneas.
4. Inicia sesión de nuevo como el **actor revisor** y selecciona una oferta. Confirma estado Cerrada, proveedor elegido y que la pantalla aclara que esto no crea una orden.
5. En SQL Editor, verifica que la solicitud tenga dos líneas, dos ofertas y cuatro líneas de oferta; y que la selección no haya agregado filas a `compras`, `pagos`, `recepciones_compra` ni `movimientos_inventario`.

### Resultado de ejecución A07

- Frontend: creación como borrador, apertura, dos ofertas y selección completadas sin errores de consola. Las llamadas de apertura y selección respondieron HTTP 204; el frontend recargó y mostró la solicitud cerrada con la oferta Beta seleccionada.
- Persistencia visible tras recargar: `REQ-D739C175E5CB`, 2 líneas (bien y servicio), 2 ofertas; Beta S/ 44.00 (menor total), Alpha S/ 45.00.
- Indicadores del panel antes/después: 6 órdenes y 40 unidades en ambos momentos. La selección no generó una orden ni cambió el stock visible. La CxP no se verificó con conteo SQL independiente; el contrato de `seleccionar_oferta_compra` solo actualiza la solicitud y la interfaz confirma que la orden se registra por separado.
- La sesión de prueba fue Administrador en todo el flujo. El chequeo A06 confirmó perfiles con permisos diferentes, pero el recorrido no probó los rechazos/autorizaciones de cada perfil.

No ejecutar recepción ni crear una orden real para estos fixtures. La selección solo cierra el comparativo.

## Límites y precauciones

El script A06 crea datos persistentes de prueba; está etiquetado, no borra ni modifica permisos y es re-ejecutable. Requiere dos perfiles activos distintos con los permisos necesarios; si no existen, aborta y no concede permisos. Antes de ejecutarlo, confirma visualmente que el SQL Editor está abierto en el proyecto de desarrollo correcto. La URL/clave publicable no se guardan en estos archivos. A05 se omite; A06 solo queda completada al ejecutar el script con éxito y A07 solo tras la prueba frontend y la verificación de persistencia.

# Diagnóstico y ruta de implementación de EnterpriseCloud

**Corte de verificación remota:** 26 de octubre de 2026. **Avances:** 26 de octubre de 2026.  
**Proyecto Supabase:** ERP EnterpriseCloud (ref: auxqjoxnsasnmtnakgmg), organización Free.  
**Protección de datos:** se verificaron 9 usuarios de Auth y sus 9 perfiles; no se eliminaron cuentas ni datos.

## 1. Resultado ejecutivo

EnterpriseCloud usa React, TypeScript, Vite y Supabase. El menú agrupa el producto en 12 módulos, pero varios son navegación/alcance futuro y no procesos completos.

La base remota contiene 40 tablas públicas con RLS habilitado en las 40 y 23 migraciones registradas. El repositorio tiene 48 archivos SQL: 23 coinciden con el historial y 25 siguen sin conciliar. De los no coincidentes, 18 tienen fecha hasta el corte y requieren conciliación individual; siete tienen fecha futura local. No se deben tratar automáticamente como pendientes de ejecución: el esquema ya contiene objetos de varias etapas. Cada SQL debe compararse antes de reconciliar.

Los flujos de compras, ventas, inventario y pagos tienen avances reales, pero la ficha de empresa, sucursales y almacenes siguen sin configurar. Por eso la apertura distribuida del stock está lista técnicamente, pero no ejecutada.

## 2. Evidencia de Supabase

### Esquema, acceso y alertas

- 40 tablas en public; RLS habilitado en las 40.
- 9 usuarios en Supabase Auth y 9 perfiles en public.usuarios.
- No se limpiaron datos ni se tocaron cuentas.
- Asesor de seguridad: una advertencia, protección contra contraseñas filtradas deshabilitada.
- Asesor de rendimiento: 0 claves foráneas sin índice y 51 avisos informativos de índices todavía no usados. No borrar índices por este aviso.
- No se descargó ni restauró un respaldo durante esta revisión. Hacerlo antes de futuras escrituras remotas.
- Se aplicó la migración de privilegios mínimos: `anon`, `authenticated` y `service_role` ya no tienen `TRUNCATE`, `TRIGGER`, `REFERENCES` ni `MAINTAIN` en las tablas públicas. `authenticated` conserva SELECT/INSERT/UPDATE/DELETE y RLS.
- Los `DEFAULT PRIVILEGES` de `postgres`, que es el rol que crea los objetos de las migraciones, ya no dan privilegios administrativos a roles de API. El rol `supabase_admin` tiene defaults distintos y la sesión de migración no puede cambiarlos; mantener las migraciones de la aplicación ejecutándose como `postgres`.
- Las cuatro migraciones operativas iniciales pasaron en PostgreSQL 17 desechable con un fixture mínimo. Se aplicaron diez migraciones forward-only; la más reciente revocó DELETE sobre `empresas` a `authenticated`, verificado remotamente. Las 47 migraciones anteriores se reprodujeron en orden en PostgreSQL 17 desechable: 40 tablas, 40 con RLS y el event trigger activo. Sigue pendiente probar en local la número 48, restaurar una exportación real y probar permisos por rol. La CLI reporta que aún no está enlazada; Docker Desktop no tiene motor Linux disponible.
- La validación de frontend pasó: `npm run build` correcto y `npm test` con 48 aprobadas y 0 fallidas.

Supabase documenta que la protección contra contraseñas filtradas requiere Pro o superior; queda como limitación aceptada del plan Free. No recomiendo pagar para continuar. Reforzar contraseñas y MFA administrativa: https://supabase.com/docs/guides/auth/password-security

### Conteos observados

| Entidad | Filas |
|---|---:|
| Empresas / sucursales / almacenes | 0 / 0 / 0 |
| Cajas / turnos abiertos | 0 / 1 (legado sin caja) |
| Categorías / unidades de medida | 0 / 0 |
| Productos / filas de inventario por almacén | 8 / 0 |
| Unidades del stock global legado | 41 |
| Movimientos históricos de inventario | 16 |
| Compras / recepciones | 4 / 0 |
| Ventas | 8 |
| Cuentas / movimientos de Tesorería | 12 / 0 |
| Turnos abiertos | 1 |
| Aperturas distribuidas | 0 |
| Eventos de auditoría / tablas auditadas | 283 / 39 |

Las cuatro compras históricas constan pagadas y marcadas como recepción completa para que no se vuelva a crear stock a partir de ellas. La marca no creó recepciones ni movimientos. No se asignó un almacén ficticio a los productos.

### Entidades que ya existen

- Organización y maestros: empresas, sucursales, almacenes, zonas y sus relaciones con clientes/sucursales, clientes, proveedores, productos, categorías, unidades, catálogo de proveedor-producto, monedas y métodos de pago.
- Compras y ventas: compras/líneas, recepciones/líneas, cotizaciones/líneas, ventas/líneas y documentos.
- Inventario/tesorería: inventarios, movimientos de inventario, aperturas de inventario, cajas por sucursal, turnos de caja, movimientos de tesorería, aplicaciones de pago y pagos.
- Seguridad/soporte: usuarios, roles, permisos, relaciones de permisos, auditoría, configuración, reportes y análisis de proyectos.

## 3. Mapa funcional y faltantes

| Módulo | Disponible o parcial | Falta principal |
|---|---|---|
| Maestros | Clientes, proveedores, productos; empresa, sucursales, almacenes y zonas parciales. Categorías y unidades enteras ya son administrables; clientes/sucursales se pueden asociar a zonas. | Cargar catálogos reales; dirección estructurada de clientes, transportistas y vendedores. Las cantidades fraccionarias siguen fuera de V1. |
| Compras | Órdenes nacionales, recepción por almacén y obligación por pagar. | Requisición, comparación de ofertas, selección auditable de proveedor y devolución. |
| Ventas | Cotizaciones, ventas por almacén, comprobantes imprimibles parciales. | Reservas/pedidos, devolución/notas de crédito, guía y emisión fiscal electrónica. |
| Inventario y Kardex | Existencias, movimientos y apertura distribuida preparada. | Configurar almacenes, conteo inicial, transferencias, ajustes y conteo físico. |
| Tesorería | Saldos por cobrar/pagar, caja/turnos y movimientos parciales. | Bancos, conciliación, cierre financiero y cobertura completa de reversos. |
| Logística y Transporte | Grupo de navegación. | Despachos, rutas, vehículos, conductores, entregas e incidencias. |
| Comisiones de Vendedores | Grupo de navegación. | Fórmula, ajustes, liquidación y pago. |
| Metas y Objetivos | Grupo de navegación. | Definición, asignación, avance y reglas frente a devoluciones/anulaciones. |
| Reportes e Inteligencia | Panel y reportes básicos. | Indicadores conciliados con fuentes y fórmulas documentadas. |
| Seguridad y Auditoría | Auth, perfiles y roles/permisos; visor de bitácora de solo lectura; triggers en las 39 tablas de negocio y configuración. | Probar actor/RLS por rol en flujos reales; definir membresías antes de aislar varias organizaciones. |
| Configuración e Integraciones | Empresa, medios de pago, monedas, QR/transferencia y respaldo parcial. | Parámetros/series, secretos servidor y API/webhooks confiables. |
| Notificaciones y Aprobaciones | Presentación de centro de alertas. | Persistencia, workflows, responsables, bandeja, reintentos y canales. |

Las cuentas por cobrar/pagar tienen una sola entrada principal en Tesorería. Compras origina la deuda; Tesorería muestra el saldo y gestiona el pago. El menú ya no duplica “Cuentas por pagar” bajo Compras.

## 4. Reconciliación de migraciones

- Remoto: 23 entradas aplicadas. A las 13 versiones originales se agregaron diez migraciones forward-only.
- Local actual: 48 archivos SQL; 23 tienen versiones coincidentes en el historial remoto. De las 25 restantes, 18 tienen fecha hasta el corte y requieren conciliación; siete están fechadas después del 26 de octubre y se consideran futuras locales, no migraciones remotas ausentes.
- Aplicadas: las diez migraciones forward-only detalladas en [RECONCILIACION_MIGRACIONES.md](RECONCILIACION_MIGRACIONES.md), incluida `20261026203451_empresas_sin_borrado_api.sql`.
- Los archivos fechados en noviembre no figuran como aplicados y son posteriores a la fecha actual del corte; se deben revisar antes de decidir si su fecha/nombre es correcto.
- La CLI local está instalada, pero `migration list --linked` devuelve `ProjectRefNotLinkedError`. La conexión MCP no crea el enlace local; falta enlazar el repo al proyecto para exportar/restaurar y operar el historial.
- Docker CLI está instalado, pero el motor Linux local no respondió. PostgreSQL 17 permitió reproducir 47 migraciones locales con stubs mínimos de Auth; la 48.ª se aplicó remotamente y pasó su verificación ACL. La reproducción local debe repetirse con la cadena de 48. No equivale a restaurar un dump remoto ni prueba roles/datos reales.
- No ejecutar db push, db reset --linked ni migration repair hasta comparar SQL y estado real, probar en local y verificar respaldo.

La documentación oficial aclara que migration repair solo cambia el historial, no aplica ni revierte SQL. Reparar sin comprobación puede dejar el estado desalineado: https://supabase.com/docs/guides/deployment/database-migrations

## 5. Límites técnicos y de negocio

- RLS habilitado no equivale a aislamiento de organizaciones cliente. No hay organización/membresía que delimite cada fila; no publicar V1 como SaaS multiempresa aislado.
- El esquema operativo utiliza cantidades enteras. Para unidades fraccionarias hay que migrar detalles, stock, Kardex y RPC conjuntamente.
- La apertura exige distribuir el stock legado de cada producto entre almacenes reales, y la suma debe coincidir exactamente. El sistema no adivina esa distribución.
- Cobro/pago por caja requiere turno abierto; convertir cotización a cuenta por cobrar no requiere cobrar ni abrir caja.
- `cajas` ya se relaciona con sucursales y turnos; el único turno abierto preexistente permanece sin asignar. No abrir otra caja hasta configurar las sucursales y cerrar/conciliar el turno legado. Cada turno nuevo se elige explícitamente al cobrar o pagar en efectivo.
- 51 avisos de índices sin uso son informativos con este volumen; no borrar índices por esa señal. El asesor registra 0 claves foráneas sin índice y ya no muestra políticas de lectura duplicadas en sucursales.
- La tabla de documentos contiene referencias/metadatos; no confirma un bucket privado funcional.

## 6. Progreso de los siete puntos

1. **Esquema e historial:** parcial. Hay 23 versiones remotas coincidentes, diez migraciones forward-only aplicadas y una matriz de 25 archivos sin conciliar. Las primeras 47 migraciones pasaron en orden en PostgreSQL 17 desechable; la número 48 se verificó en Supabase. Falta repetir la cadena completa local, conciliar los 18 archivos históricos, revisar los siete futuros y restaurar una exportación remota.
2. **Mapa y alcance V1:** definido en menú y documentos; se corrigió la duplicidad de cuentas por pagar.
3. **Reglas comunes:** parcial. RLS, funciones operativas restringidas, idempotencia y auditoría en las 39 tablas de negocio/configuración; privilegios administrativos retirados y defaults de `postgres` corregidos. Las cajas usan RLS y permisos de Tesorería; el asesor ya no marca políticas duplicadas. Falta restaurar el esquema y probar RLS/permisos con todos los roles reales.
4. **Inventario multi-almacén:** RPC y pantalla de apertura distribuida listos. Falta configurar ubicaciones y distribución física real.
5. **Compras nacionales:** orden idempotente y gasto sin recepción validados en fixture; recepción por almacén y saldo/pagos parciales existen en código/esquema. Falta probar el RPC de recepción sobre el esquema completo. El cálculo fiscal admite IGV estándar del 18%; antes de comprobantes reales se deben soportar tratamientos y tasas por línea. Faltan requisición, comparativo y devolución.
6. **Ventas y Tesorería:** venta a crédito sin turno, permiso financiero para cobro inmediato y rollback de efectivo sin turno validados en fixture. Falta probar stock, RPC, RLS y cada rol sobre esquema restaurado; también bancos, devoluciones/notas de crédito y documentos fiscales electrónicos.
7. **Módulos nuevos y BI:** alcance definido; implementación pendiente y dependiente de reglas y datos confiables.

Para criterios de salida y el procedimiento completo, consulta la [guía paso a paso](GUIA_PASO_A_PASO_ENTERPRISECLOUD.md) y la [arquitectura objetivo](ARQUITECTURA_OBJETIVO_ENTERPRISECLOUD.md).

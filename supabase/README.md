# Supabase de EnterpriseCloud

## Estado verificado — 13 de noviembre de 2026

Proyecto confirmado: `ERP EnterpriseCloud` (`auxqjoxnsasnmtnakgmg`), PostgreSQL 17.11, plan Free.

- El remoto registra 58 migraciones; la última es `20261113144509_seguridad_rls_y_indice_duplicado_v1`.
- El repositorio contiene 105 archivos SQL: 29 coinciden por versión y nombre, 76 no tienen una versión remota exacta y 29 versiones remotas no tienen un archivo local con la misma versión. La deriva histórica está documentada en [RECONCILIACION_MIGRACIONES.md](../docs/RECONCILIACION_MIGRACIONES.md); no es una lista de migraciones pendientes.
- Hay 121 tablas públicas con RLS, 270 políticas públicas y seis tablas privadas con RLS en `app_private`.
- `auth.users` y `public.usuarios` conservan 10 filas cada una. No se borraron cuentas.
- En la lectura del 13-11, `public.notificaciones`, `ec_solicitudes_aprobacion` y `ec_aprobacion_eventos` tenían 0 filas; dos triggers para solicitudes/decisiones estaban presentes. La migración de inbox ya está aplicada.
- Las Edge Functions `peru-document-lookup` y `project-analyzer` están activas en v1 con `verify_jwt=true`.
- La suite local pasó `npm run typecheck`, `npm test` (102 pruebas) y `npm run build` en este corte.

## Copia local de esquema

La CLI está autenticada y enlazada al proyecto. El 13-11 se exportó y restauró el esquema `public,app_private` en PostgreSQL local 17.5, en `.local-validation-postgres/restore-current-20261113`. El archivo ignorado por Git `.local-validation-postgres/remote-schema-20261113.sql` mide 899,527 bytes.

La restauración coincide con 121 tablas públicas, 121 con RLS, 270 políticas públicas y seis tablas privadas con RLS. `auth.users` tiene 0 filas en el entorno local simulado; el remoto mantiene 10 usuarios y 10 perfiles. No se exportaron filas de negocio, cuentas Auth, Storage, secretos ni configuración de Edge Functions. El servidor local se detuvo después de verificarlo. Esta copia es una base de validación de esquema, no una copia integral de recuperación del servicio.

## Reconciliación y cambios remotos

Las diferencias entre los 105 archivos locales y 58 versiones remotas provienen de deriva histórica de nombres y versiones. No ejecutar los archivos en lote, no usar `supabase db push` para reconciliarlos y no usar `migration repair` como sustituto de aplicar SQL. Las migraciones nuevas se prueban en la copia local y se aplican una por una después de comprobar dependencias, RLS, grants, efectos y conteos de Auth.

Las migraciones recientes de PEPS, notificaciones, aprobaciones, Caja/Tesorería multimoneda y saneamiento de políticas/índice ya aparecen en el historial remoto. `approval_notifications_inbox_v1` ya está aplicada; no volver a ejecutarla.

## Verificaciones de seguridad pendientes o informativas

- Asesores remotos: 73 funciones `SECURITY DEFINER` ejecutables por `authenticated` y ninguna por `anon`; 118 claves foráneas sin índice y 90 índices sin uso; extensión `btree_gist` en `public`; protección de contraseñas filtradas desactivada por las capacidades del plan actual. No eliminar índices ni cambiar extensiones en bloque.
- 11 tablas internas con RLS no tienen políticas y no otorgan acceso a los roles de API; se mantienen cerradas deliberadamente. No añadir políticas genéricas para silenciar el asesor.
- La prueba de interfaz con una sesión autenticada real de aprobación y notificaciones sigue pendiente. `peru-document-lookup` también necesita verificación desde una sesión autorizada y una credencial de proveedor válida; los secretos no se imprimieron ni se cambiaron.
- El motor de `project-analyzer` se invoca mediante una Edge Function propia de Supabase; queda por confirmar si el instructor exige además una API externa de IA.

## Uso local y protección de secretos

- Variables de cliente: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Mantener el `.env` existente privado, ignorado por Git y fuera de las respuestas. Nunca exponer `service_role` ni claves secretas al navegador.
- `npm install` instala dependencias; `npm run dev` inicia Vite.
- La copia local tiene Auth simulado y vacío; no es adecuada para probar identidad real. Las pruebas con cuenta autorizada deben hacerse mediante la aplicación y una sesión de usuario existente, sin borrar ni recrear cuentas.

## Documentos de trabajo

- [Estado actual de módulos pendientes](../docs/ESTADO_ACTUAL_MODULOS_PENDIENTES.md)
- [Plan de implementación](../docs/PLAN_IMPLEMENTACION_MODULOS_PENDIENTES.md)
- [Reconciliación de migraciones](../docs/RECONCILIACION_MIGRACIONES.md)
- [Guía paso a paso (antecedentes históricos)](../docs/GUIA_PASO_A_PASO_ENTERPRISECLOUD.md)
- [Arquitectura objetivo](../docs/ARQUITECTURA_OBJETIVO_ENTERPRISECLOUD.md)

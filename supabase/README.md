# Base de datos de ERP EnterpriseCloud en Supabase

## Estado remoto verificado al 26 de octubre de 2026

Proyecto: ERP EnterpriseCloud, ref auxqjoxnsasnmtnakgmg, organización Free. La base remota contiene 40 tablas públicas con RLS, 9 cuentas Auth y 9 perfiles.

Hay 23 migraciones registradas en remoto y 48 archivos locales: 23 versiones coincidentes y 25 archivos sin versión remota correspondiente. De esos 25, 18 tienen fecha hasta el 26 de octubre y requieren conciliación; siete tienen fechas posteriores y son migraciones futuras locales, no ausencias que deban repararse en remoto. Diez migraciones forward-only se aplicaron el 26 de octubre. La última retiró el permiso DELETE sobre `empresas` para `authenticated`; la política RLS ya impedía el borrado y se comprobó que las nueve cuentas siguen intactas. La matriz detalla por qué las 18 versiones históricas no se pueden ejecutar como bloque.

Documentos de trabajo:
- ../docs/DIAGNOSTICO_ACTUAL_Y_RUTA_DE_IMPLEMENTACION.md
- ../docs/GUIA_PASO_A_PASO_ENTERPRISECLOUD.md
- ../docs/ARQUITECTURA_OBJETIVO_ENTERPRISECLOUD.md
- ../docs/RECONCILIACION_MIGRACIONES.md

Las diez migraciones aplicadas y sus versiones son: `20261026182059_privilegios_api_minimos.sql`, `20261026182706_un_solo_turno_abierto.sql`, `20261026182720_orden_compra_atomica.sql`, `20261026182728_venta_credito_permisos.sql`, `20261026195955_cajas_multisucursal.sql`, `20261026200116_cajas_indices_fk.sql`, `20261026200340_unificar_lectura_sucursales.sql`, `20261026200923_almacenes_por_sucursal.sql`, `20261026202241_registrar_auto_rls.sql` y `20261026203451_empresas_sin_borrado_api.sql`. La última retira DELETE sobre el maestro de empresas; el resto de la aplicación conserva sus permisos sujetos a RLS. Se comprobó que `authenticated` ya no puede borrar filas de `empresas`. Los `DEFAULT PRIVILEGES` de `postgres` están corregidos. El rol `supabase_admin` mantiene defaults propios, así que las migraciones de aplicación deben seguir creándose como `postgres`.

Toda tabla pública futura requiere revisar deliberadamente sus grants y RLS; no confiar en concesiones implícitas. El esquema `app_private` debe quedar fuera de los esquemas expuestos. La función pública de compras es un wrapper `SECURITY INVOKER`; la lógica privilegiada vive en `app_private` y vuelve a validar usuario/permisos.

## CLI y protección de migraciones

La CLI oficial está fijada en dependencias de desarrollo y supabase/config.toml existe. La CLI local necesita inicio de sesión interactivo del usuario. En el terminal local:

1. Ejecuta npx supabase login.
2. Ejecuta npx supabase link --project-ref auxqjoxnsasnmtnakgmg.
3. Ejecuta npx supabase migration list --linked y guarda la salida.
4. Compara una por una las versiones locales con esquema, funciones, triggers y RLS remotos.
5. Reproduce en una base local desechable antes de reparar el historial.
6. Exporta y comprueba una restauración antes de cualquier escritura remota.
7. Registra como aplicada solo una migración cuyo SQL ya se demostró en remoto.

No ejecutes db push, db reset --linked ni migration repair antes de completar la comparación y reproducción. migration repair cambia el historial; no aplica ni revierte SQL. Nunca reiniciar el proyecto remoto ni borrar usuarios Auth como modo de limpieza.

No compartas tokens, contraseña de base de datos o clave service_role. Esa clave nunca debe estar en VITE ni en el navegador. Referencia: https://supabase.com/docs/guides/deployment/database-migrations

## Desarrollo local

- Variables de cliente: VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Mantener el .env existente privado, no mostrarlo ni subirlo.
- npm install instala dependencias; npm run dev inicia Vite.
- Docker Desktop no tiene motor activo. Las 47 migraciones anteriores se reprodujeron cronológicamente en PostgreSQL 17 desechable con stubs de Auth. La nueva migración de revocación se aplicó en Supabase y se confirmó `authenticated_can_delete=false`; falta repetir la reproducción local de las 48. Esto no es un dump ni una restauración del esquema/datos remotos. `migration list --linked` continúa indicando que la CLI no está enlazada al proyecto. No se ejecutaron compras/ventas de prueba en la base viva.
- Las nuevas modificaciones se crean en una migración pequeña y revisada, incluyendo RLS, grants y restricciones.

## Plan Free y límites

Protección contra contraseñas filtradas de Auth requiere Pro o superior según Supabase; no se cambió el plan. El asesor de seguridad solo reporta esa limitación del plan Free. Rendimiento presenta 51 INFO de índices todavía no usados, 0 claves foráneas sin índice y ya no reporta políticas de lectura duplicadas. No borrar índices automáticamente. Empresa, sucursales, almacenes, cajas e inventarios por almacén estaban vacíos al verificar; no crear ubicaciones ficticias ni abrir stock sin conteo. La auditoría registra cambios en las 39 tablas de negocio/configuración; la propia bitácora no tiene trigger. `caja_turnos.caja_id` separa los turnos nuevos por caja y conserva el turno abierto previo sin asignarle una ubicación inventada.

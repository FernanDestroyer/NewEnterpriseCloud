# Base de datos de ERP EnterpriseCloud en Supabase

## 1. Crear la base de datos
1. Entra a <https://supabase.com/dashboard> y crea un proyecto (o abre el que ya tengas).
2. Ve a **SQL Editor → New query**, pega el contenido de
   `migrations/20261009000000_erp_enterprisecloud.sql` y pulsa **Run**.
   Crea las 17 tablas del Documento Maestro (sección 13) más 3 de apoyo (`rol_permisos`, `reportes`
   y `configuracion`, que necesitan los módulos de la interfaz), con los roles/permisos, la
   auditoría y las políticas de seguridad (RLS).
3. Ejecuta las migraciones incrementales **una vez y en orden de nombre**: producto-proveedor, precio, cotizaciones, catálogo de proveedores, fases de compra, RUC, foto de perfil y documento del cliente. La aplicación actual utiliza sus tablas y columnas.
4. La instalación arranca sin datos de negocio: el panel muestra los módulos vacíos hasta que registres tus primeros clientes, proveedores, productos y operaciones. Solo `roles` y `permisos` traen datos del sistema (necesarios para el acceso).

La migración del catálogo cambia la estructura de `detalle_compras`; revisa cuáles ya están aplicadas antes de volver a ejecutar migraciones antiguas. La conexión de la aplicación no ejecuta SQL ni modifica el esquema automáticamente.

## 2. Conectar la aplicación
1. En Supabase: **Project Settings → API** (o el botón **Connect**) y copia la *Project URL* y la clave
   *anon / publishable*. **No uses la `service_role`.**
2. Copia `.env.example` como `.env` y pega los dos valores.
3. `npm install` y luego `npm run dev`.

## 3. Cómo funciona el registro de usuarios
- La pantalla **/registro** llama a `supabase.auth.signUp`. Al instante se crea la cuenta en
  `auth.users` y un trigger (`handle_new_user`) inserta su fila en `public.usuarios`.
  Compruébalo en **Table Editor → usuarios**.
- La **primera** cuenta registrada queda como *Administrador*; las siguientes como *Operador*.
  Un administrador puede cambiar roles en la tabla `usuarios` (columna `rol_id`).
- Por defecto Supabase exige **confirmar el correo** antes de iniciar sesión. Para pruebas puedes
  desactivarlo en **Authentication → Providers → Email → Confirm email**. La fila en `usuarios`
  aparece igual, con o sin confirmación.

## 4. Qué se guarda y dónde
| Módulo de la app | Tabla |
|---|---|
| Ventas | `ventas` (+ `detalle_ventas`) |
| Cotizaciones | `cotizaciones` (+ `detalle_cotizaciones`) |
| Compras | `compras` (+ `detalle_compras`) |
| Inventario | `productos` (+ `inventarios`, `movimientos_inventario` = kardex automático) |
| Clientes / Proveedores | `clientes` / `proveedores` |
| Finanzas (CxC / CxP) | `pagos` |
| Documentos | `documentos` |
| Reportes / Configuración | `reportes` / `configuracion` |
| Seguridad | `usuarios`, `roles`, `permisos`, `rol_permisos` |
| Auditoría | `auditoria` (se llena sola con cada alta, cambio o baja) |

## 5. Seguridad
- RLS activo en todas las tablas; el rol anónimo no puede leer nada.
- Cada acción (ver / crear / editar / eliminar) se autoriza según el rol del usuario (`tiene_permiso`).
- Nadie puede cambiarse el rol a sí mismo y el rol nunca se toma de lo que envía el navegador.
- La tabla `auditoria` solo la leen quienes tengan ese permiso (Administrador, Gerente, Auditor).

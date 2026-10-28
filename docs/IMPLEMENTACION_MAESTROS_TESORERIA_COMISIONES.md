# Implementación: Maestros, Tesorería y Comisiones

## Qué se agregó

- **Maestros (`/maestros`)**: transportistas, vendedores con vínculo opcional a usuario/sucursal y catálogos comerciales y tributarios. La ficha de empresa, productos/clasificación, sucursales, almacenes y zonas siguen usando las pantallas de mantenimiento e inventario que ya existían.
- **Tesorería (`/tesoreria`)**: cuentas bancarias con saldo inicial, libro de movimientos, transferencias atómicas dentro de una misma moneda y conciliaciones por período. El flujo muestra aparte los cobros/pagos ya guardados por CxC/CxP. Una conciliación solo puede cerrarse si las líneas están vinculadas y el saldo final coincide con el libro bancario.
- **Comisiones (`/comisiones`)**: asignación de ventas, reglas y escalas editables, excepciones por vendedor, cálculo sobre ventas completadas, liquidaciones, ajustes, pagos y exportación del historial CSV. Se toma la tasa individual vigente por encima de la escala y esta por encima de la tasa base.

Las rutas están sujetas a los permisos existentes de `configuracion`, `finanzas` y `ventas`, además de RLS y comprobaciones en funciones de Supabase. Las operaciones monetarias agregadas mantienen separadas PEN, USD y EUR; las transferencias entre monedas distintas no se convierten automáticamente. Los pagos de comisión se manejan en PEN, acorde con el importe operativo actual de las ventas.

## Base de datos

La nueva migración es `supabase/migrations/20261027160000_maestros_tesoreria_comisiones.sql`. Crea las tablas, índices, catálogos iniciales, políticas/grants y funciones transaccionales requeridas. La aplicación no escribe en la base hasta que el esquema esté preparado.

**La migración no se aplicó a la base remota como parte de esta entrega.** Antes de desplegar, sigue el flujo de conciliación y protección de migraciones descrito en `supabase/README.md`; no se alteró el historial ni se modificó ningún dato remoto. También revisa los permisos de los roles de ventas, configuración y finanzas que usarán las nuevas pantallas.

## Ejecutar y verificar

Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en un `.env` local (no subirlo al ZIP ni al repositorio), instala dependencias y ejecuta `npm run dev`. Para servir el build localmente, usa `npm run preview`. Los comandos comprobados en esta copia fueron:

```text
npm run build
npm test
```

La compilación de producción, las 48 pruebas existentes y las rutas SPA de los tres módulos finalizaron correctamente. Se analizaron las sentencias SQL y los cuerpos de las siete funciones PL/pgSQL. La ejecución contra PostgreSQL/Supabase requiere aplicar y probar primero el esquema dentro del proceso seguro de migraciones del proyecto.

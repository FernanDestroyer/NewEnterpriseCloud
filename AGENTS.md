# EnterpriseCloud / NewEnterprise

## Fuente de verdad

- Este repositorio es el proyecto principal que el usuario llama **NewEnterprise**; la interfaz y Supabase usan el nombre EnterpriseCloud. No mezclarlo con carpetas hermanas de colaboradores.
- Determina si un módulo está completo revisando sus rutas, componentes, servicios, datos, migraciones y pruebas. El campo `implemented` y las etiquetas «parcial» de la documentación son pistas de navegación, no evidencia suficiente de terminación.
- Contrasta siempre el código con `docs/ARQUITECTURA_OBJETIVO_ENTERPRISECLOUD.md`, `docs/RECONCILIACION_MIGRACIONES.md` y `README.md`; la documentación puede tener conteos o estados antiguos.

## Alcance pendiente confirmado por el usuario

1. Reportes e Inteligencia de Negocios.
2. Configuración e Integraciones.
3. Notificaciones y Aprobaciones.
4. Analizador de Proyectos: debe usar una API de análisis. Las APIs de GitHub/GitLab que solo descargan el código no satisfacen este requisito.

Antes de conectar una API al Analizador, verificar si el instructor exige un proveedor concreto, dónde se guardará su clave y el costo por uso. Las claves nunca van en variables `VITE_` ni en el navegador; el análisis remoto debe ejecutarse en servidor.

## Supabase y datos

- Preservar siempre las cuentas de Supabase Auth. El usuario permite limpiar datos de negocio de desarrollo, pero esa autorización no incluye eliminar cuentas.
- Antes de cambiar el esquema o limpiar datos remotos, confirmar el proyecto y contrastar migraciones, políticas RLS, permisos y dependencias; no ejecutar `db push`, `db reset --linked` ni reparaciones de historial a ciegas.
- No guardar claves, tokens, contraseñas, contenido de repositorios privados ni filas de negocio en memoria persistente.

## Uso eficiente del contexto

- Busca rutas y símbolos concretos antes de leer archivos grandes; resume los resultados de herramientas y evita repetir salidas completas.
- Conserva en Engram solo decisiones estables, restricciones y hechos verificados, con fecha y procedencia. Revisa el código y Supabase actuales antes de confiar en recuerdos previos.
- Usa compresión estructurada al cambiar de fase: objetivo, decisiones, archivos tocados, validaciones, estado actual y próximo paso.

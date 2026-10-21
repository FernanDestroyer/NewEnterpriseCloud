-- =============================================================================
-- ERP EnterpriseCloud · Permisos base del rol authenticated
-- Las políticas RLS autorizan por acción y rol, pero PostgREST además exige
-- privilegios a nivel de tabla. Sin estos GRANT, todo devuelve 403 aunque
-- las políticas sean correctas (pasa si "Exponer automáticamente nuevas
-- tablas" está desactivado, como se recomienda).
-- RLS sigue mandando: esto no abre nada que las políticas no permitan.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni romper nada.
-- =============================================================================

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Quita privilegios administrativos de los roles de API sin tocar datos,
-- cuentas, permisos DML ni políticas RLS.
-- Corrige también los defaults del rol postgres, que es el dueño de las tablas
-- actuales y el rol que ejecuta las migraciones conectadas.

begin;

revoke truncate, trigger, references
  on all tables in schema public
  from anon, authenticated, service_role;

do $migration$
begin
  -- MAINTAIN existe desde PostgreSQL 17. Ejecutarlo dinámicamente evita
  -- impedir la migración si la instancia local usa una versión anterior.
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated, service_role';
  end if;
end
$migration$;

alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from anon, authenticated, service_role;

do $migration$
begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'alter default privileges for role postgres in schema public revoke maintain on tables from anon, authenticated, service_role';
  end if;
end
$migration$;

commit;

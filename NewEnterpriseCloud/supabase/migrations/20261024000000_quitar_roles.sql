-- =============================================================================
-- ERP EnterpriseCloud · Retiro de roles sin uso
-- Se eliminan Almacenero, Auditor y Contador. Las cuentas que los tuvieran
-- pasan al rol Básico (o a Operador si Básico aún no existe).
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

do $$
declare v_destino uuid;
begin
  select id into v_destino from public.roles where nombre = 'Básico';
  if v_destino is null then
    select id into v_destino from public.roles where nombre = 'Operador';
  end if;
  if v_destino is not null then
    update public.usuarios
       set rol_id = v_destino, updated_at = now()
     where rol_id in (select id from public.roles where nombre in ('Almacenero', 'Auditor', 'Contador'));
  end if;
  delete from public.rol_permisos
   where rol_id in (select id from public.roles where nombre in ('Almacenero', 'Auditor', 'Contador'));
  delete from public.roles
   where nombre in ('Almacenero', 'Auditor', 'Contador');
end $$;

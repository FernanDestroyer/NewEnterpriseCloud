-- =============================================================================
-- ERP EnterpriseCloud · Bitácora de operaciones
--
-- Deja garantizado que la bitácora (tabla public.auditoria) guarda:
--   1) Las altas, ediciones y eliminaciones de Metas y de Logística (trigger fn_auditar).
--   2) Los intentos DENEGADOS (sin permiso) y las operaciones FALLIDAS, que la aplicación
--      informa con public.registrar_evento_auditoria.
-- Requiere: tabla auditoria, fn_auditar() y app_private._usuario_activo() (script base).
-- Es idempotente: se puede volver a ejecutar sin duplicar ni romper nada.
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- =============================================================================
begin;

-- 1) Resultado del evento: exitoso (triggers), denegado o fallido (aplicación).
alter table public.auditoria drop constraint if exists auditoria_resultado_check;
alter table public.auditoria add constraint auditoria_resultado_check
  check (resultado in ('exitoso','denegado','fallido'));
create index if not exists auditoria_resultado_idx
  on public.auditoria (resultado, created_at desc) where resultado <> 'exitoso';

-- 2) La bitácora no se modifica ni se borra desde la API.
revoke insert, update, delete, truncate on public.auditoria from anon, authenticated;

-- 3) Trigger de auditoría en cada tabla de Metas y Logística que exista (si ya lo tiene, no se duplica).
do $migration$
declare v_tabla text;
begin
  foreach v_tabla in array array[
    'metas', 'metas_asignaciones', 'metas_cortes',
    'vehiculos', 'conductores', 'asignaciones_vehiculo', 'despachos'
  ] loop
    if to_regclass(format('public.%I', v_tabla)) is not null
       and not exists (
         select 1 from pg_trigger t
         where t.tgrelid = to_regclass(format('public.%I', v_tabla))
           and t.tgfoid = 'public.fn_auditar()'::regprocedure
           and not t.tgisinternal
       ) then
      execute format(
        'create trigger trg_auditoria after insert or update or delete on public.%I for each row execute function public.fn_auditar()',
        v_tabla);
    end if;
  end loop;
end
$migration$;

-- 4) Registro de intentos denegados y operaciones fallidas.
-- La implementación privilegiada vive fuera del esquema REST (patrón de 20261102000000).
create or replace function app_private._registrar_evento_auditoria(
  p_accion text, p_modulo text, p_registro text, p_resultado text, p_detalle jsonb)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not app_private._usuario_activo() then
    raise exception 'Sesión no válida.' using errcode = '42501';
  end if;
  if p_resultado not in ('denegado','fallido') then
    raise exception 'Solo se registran eventos denegados o fallidos desde la aplicación.' using errcode = '22023';
  end if;
  -- Tope por usuario para que nadie llene la bitácora a propósito.
  if (select count(*) from public.auditoria
       where usuario_id = v_uid and resultado <> 'exitoso' and created_at > now() - interval '1 minute') >= 30 then
    return;
  end if;
  insert into public.auditoria (usuario_id, usuario_email, accion, modulo, registro_id, datos_despues, resultado)
  values (v_uid,
          (select u.email from public.usuarios u where u.id = v_uid),
          left(coalesce(nullif(btrim(p_accion), ''), 'DESCONOCIDA'), 40),
          left(coalesce(nullif(btrim(p_modulo), ''), 'desconocido'), 80),
          left(p_registro, 200),
          case when p_detalle is null then null else jsonb_build_object('detalle', left(p_detalle::text, 500)) end,
          p_resultado);
end
$function$;
revoke all on function app_private._registrar_evento_auditoria(text, text, text, text, jsonb) from public, anon;
grant execute on function app_private._registrar_evento_auditoria(text, text, text, text, jsonb) to authenticated;

create or replace function public.registrar_evento_auditoria(
  p_accion text, p_modulo text, p_registro text, p_resultado text, p_detalle jsonb default null)
returns void language sql security invoker set search_path = '' as $function$
  select app_private._registrar_evento_auditoria(p_accion, p_modulo, p_registro, p_resultado, p_detalle);
$function$;
revoke all on function public.registrar_evento_auditoria(text, text, text, text, jsonb) from public, anon;
grant execute on function public.registrar_evento_auditoria(text, text, text, text, jsonb) to authenticated;

commit;

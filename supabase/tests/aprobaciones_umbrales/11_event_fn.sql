create or replace function app_private._ec_insert_approval_event_v1(
  p_solicitud_id uuid, p_actor_id uuid, p_evento text, p_motivo text, p_detalle jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $function$
  insert into public.ec_aprobacion_eventos (solicitud_id, actor_id, evento, motivo, detalle)
  values (p_solicitud_id, p_actor_id, p_evento, p_motivo, coalesce(p_detalle, '{}'::jsonb));
$function$;
revoke all on function app_private._ec_insert_approval_event_v1(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

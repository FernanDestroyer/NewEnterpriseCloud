-- RPC faltante en la base remota: `abrir_solicitud_compra_v2`.
--
-- La migración `20261105000000_compras_concurrencia_idempotencia_ui.sql`
-- define esta función junto con el resto del flujo de abastecimiento. En la
-- instancia remota se aplicó el resto de la migración (tabla de idempotencia,
-- triggers, etc.), pero esta función quedó ausente, por lo que el botón
-- «Abrir para cotizar» devolvía 404. Se recrea de forma idempotente con la
-- definición versionada original y sus permisos.

create or replace function public.abrir_solicitud_compra_v2(
  p_solicitud_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_hash text;
  v_saved app_private.purchase_transition_idempotency%rowtype;
begin
  if (select auth.uid()) is null
     or not (select app_private._tiene_permiso('compras', 'editar')) then
    raise exception 'No tienes permiso para abrir solicitudes.'
      using errcode = '42501';
  end if;
  if p_solicitud_id is null
     or nullif(trim(p_idempotency_key), '') is null
     or length(p_idempotency_key) > 128 then
    raise exception 'Solicitud y clave de idempotencia son obligatorias.'
      using errcode = '22023';
  end if;

  v_hash := md5(jsonb_build_object('solicitud_id', p_solicitud_id)::text);
  perform pg_advisory_xact_lock(
    hashtextextended('purchase-transition:' || p_idempotency_key, 0)
  );
  select * into v_saved
  from app_private.purchase_transition_idempotency
  where idempotency_key = p_idempotency_key;
  if found then
    if v_saved.operation <> 'abrir_solicitud'
       or v_saved.payload_hash <> v_hash then
      raise exception 'La clave de idempotencia ya fue usada con otra operación o contenido.'
        using errcode = '23505';
    end if;
    return v_saved.result_id;
  end if;

  perform 1 from public.solicitudes_compra
  where id = p_solicitud_id for update;
  if not found then
    raise exception 'La solicitud no existe.' using errcode = '23503';
  end if;

  update public.solicitudes_compra s
  set estado = 'Abierta', updated_at = now()
  where s.id = p_solicitud_id
    and s.estado = 'Borrador'
    and exists (
      select 1 from public.solicitud_compra_lineas l
      where l.solicitud_id = s.id
    );
  if not found then
    raise exception 'La solicitud no tiene líneas o ya cambió de estado.'
      using errcode = '23514';
  end if;

  insert into app_private.purchase_transition_idempotency
    (idempotency_key, operation, payload_hash, result_id)
  values (p_idempotency_key, 'abrir_solicitud', v_hash, p_solicitud_id);
  return p_solicitud_id;
end
$function$;

revoke all on function public.abrir_solicitud_compra_v2(uuid, text) from public, anon;
grant execute on function public.abrir_solicitud_compra_v2(uuid, text) to authenticated;

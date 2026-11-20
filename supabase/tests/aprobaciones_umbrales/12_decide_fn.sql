create or replace function public.ec_decidir_aprobacion_v1(
  p_solicitud_id uuid, p_aprobar boolean, p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_approval public.ec_solicitudes_aprobacion%rowtype;
  v_role text;
  v_result uuid;
  v_current_snapshot jsonb;
  v_reason text := nullif(btrim(p_motivo), '');
  v_error text;
begin
  if v_actor is null or not public.tiene_permiso('aprobaciones', 'aprobar') then
    raise exception 'No tienes permiso para decidir aprobaciones.' using errcode = '42501';
  end if;
  select r.nombre into v_role
  from public.usuarios u join public.roles r on r.id = u.rol_id
  where u.id = v_actor and u.activo;
  if v_role is null or v_role not in ('Administrador', 'Gerente') then
    raise exception 'Solo Gerente o Administrador puede aprobar en esta versión.' using errcode = '42501';
  end if;
  if p_solicitud_id is null or p_aprobar is null then
    raise exception 'Solicitud y decisión son obligatorias.' using errcode = '22023';
  end if;
  if not p_aprobar and (v_reason is null or length(v_reason) not between 3 and 1000) then
    raise exception 'El rechazo requiere un motivo de 3 a 1000 caracteres.' using errcode = '22023';
  end if;

  select * into v_approval from public.ec_solicitudes_aprobacion
  where id = p_solicitud_id for update;
  if not found then raise exception 'La solicitud de aprobación no existe.' using errcode = '23503'; end if;
  if v_approval.estado = 'approved' and v_approval.decision_por = v_actor and v_approval.resultado_id is not null then
    return jsonb_build_object('id', v_approval.id, 'estado', v_approval.estado, 'resultado_id', v_approval.resultado_id);
  end if;
  if v_approval.estado <> 'pending' then
    raise exception 'La solicitud ya recibió una decisión o dejó de estar vigente.' using errcode = '23514';
  end if;
  if v_approval.solicitante_id = v_actor then
    raise exception 'La persona solicitante no puede aprobar su propia orden o conteo.' using errcode = '42501';
  end if;

  if not p_aprobar then
    update public.ec_solicitudes_aprobacion
    set estado = 'rejected', decision_por = v_actor, decision_en = clock_timestamp(),
        motivo_decision = v_reason, actualizado_en = clock_timestamp()
    where id = v_approval.id;
    if v_approval.tipo = 'purchase_sourcing' then
      update public.ofertas_compra
      set estado = 'Vigente', seleccionado_por = null, seleccionado_en = null, updated_at = clock_timestamp()
      where id = (v_approval.snapshot #>> '{oferta,id}')::uuid and estado = 'Seleccionada';
      update public.solicitudes_compra
      set estado = 'Abierta', seleccion_oferta_id = null, seleccion_motivo = null,
          seleccionado_por = null, seleccionado_en = null, updated_by = v_actor, updated_at = clock_timestamp()
      where id = v_approval.origen_id and estado = 'Cerrada'
        and not exists (select 1 from public.compras c where c.solicitud_compra_id = v_approval.origen_id);
    elsif v_approval.tipo = 'physical_count' then
      update public.ec_conteos_fisicos set estado = 'rechazado' where id = v_approval.origen_id and estado = 'pendiente_aprobacion';
    end if;
    perform app_private._ec_insert_approval_event_v1(v_approval.id, v_actor, 'rechazada', v_reason, v_approval.snapshot);
    return jsonb_build_object('id', v_approval.id, 'estado', 'rejected', 'resultado_id', null);
  end if;

  if v_approval.tipo in ('purchase_manual', 'purchase_sourcing', 'purchase_contract')
     and not public.tiene_permiso('compras', 'crear') then
    raise exception 'Para emitir la orden también se requiere permiso de Compras.' using errcode = '42501';
  end if;
  if v_approval.tipo = 'physical_count'
     and not (public.tiene_permiso('inventario', 'crear') or public.tiene_permiso('inventario', 'editar')) then
    raise exception 'Para aplicar el conteo también se requiere permiso de Inventario.' using errcode = '42501';
  end if;

  if v_approval.tipo = 'purchase_sourcing' then
    perform 1 from public.solicitudes_compra s where s.id = v_approval.origen_id for update;
    v_current_snapshot := app_private._ec_purchase_offer_snapshot_v1(v_approval.origen_id);
    if v_current_snapshot is null or md5(v_current_snapshot::text) <> v_approval.snapshot_hash
       or v_current_snapshot #>> '{solicitud,estado}' <> 'Cerrada'
       or v_current_snapshot #>> '{oferta,estado}' <> 'Seleccionada'
       or v_current_snapshot #>> '{oferta,es_version_actual}' <> 'true'
       or exists (select 1 from public.compras c where c.solicitud_compra_id = v_approval.origen_id) then
      update public.ec_solicitudes_aprobacion
      set estado = 'stale', decision_por = v_actor, decision_en = clock_timestamp(),
          motivo_decision = 'El documento cambió o dejó de ser convertible antes de la decisión.', actualizado_en = clock_timestamp()
      where id = v_approval.id;
      update public.ofertas_compra
      set estado = 'Vigente', seleccionado_por = null, seleccionado_en = null, updated_at = clock_timestamp()
      where id = (v_approval.snapshot #>> '{oferta,id}')::uuid and estado = 'Seleccionada';
      update public.solicitudes_compra
      set estado = 'Abierta', seleccion_oferta_id = null, seleccion_motivo = null,
          seleccionado_por = null, seleccionado_en = null, updated_by = v_actor, updated_at = clock_timestamp()
      where id = v_approval.origen_id and estado = 'Cerrada'
        and not exists (select 1 from public.compras c where c.solicitud_compra_id = v_approval.origen_id);
      perform app_private._ec_insert_approval_event_v1(v_approval.id, v_actor, 'obsoleta', 'El documento cambió antes de la decisión.', v_approval.snapshot);
      return jsonb_build_object('id', v_approval.id, 'estado', 'stale', 'resultado_id', null);
    end if;
  elsif v_approval.tipo = 'physical_count' then
    perform 1 from public.ec_conteos_fisicos c where c.id = v_approval.origen_id for update;
    v_current_snapshot := app_private._ec_physical_count_snapshot_v1(v_approval.origen_id);
    if v_current_snapshot is null or md5(v_current_snapshot::text) <> v_approval.snapshot_hash
       or v_current_snapshot #>> '{diferencias}' = '0' then
      update public.ec_solicitudes_aprobacion
      set estado = 'stale', decision_por = v_actor, decision_en = clock_timestamp(),
          motivo_decision = 'Las líneas del conteo cambiaron antes de la decisión.', actualizado_en = clock_timestamp()
      where id = v_approval.id;
      update public.ec_conteos_fisicos set estado = 'rechazado'
      where id = v_approval.origen_id and estado = 'pendiente_aprobacion';
      perform app_private._ec_insert_approval_event_v1(v_approval.id, v_actor, 'obsoleta', 'Las líneas del conteo cambiaron antes de la decisión.', v_approval.snapshot);
      return jsonb_build_object('id', v_approval.id, 'estado', 'stale', 'resultado_id', null);
    end if;
  end if;

  -- The domain write runs in a subtransaction. If business data became invalid
  -- while awaiting review, roll back that write and close the request as stale
  -- instead of leaving a permanently pending item. The table CHECK also
  -- requires resultado_id for approved rows, so finalize approval afterwards.
  begin
    if v_approval.tipo = 'purchase_manual' then
      v_result := public.crear_orden_compra_operativa_v4(
        (v_approval.snapshot->>'proveedor_id')::uuid,
        v_approval.snapshot->>'detalle',
        nullif(v_approval.snapshot->>'fecha_limite', '')::date,
        (v_approval.snapshot->>'monto_manual')::numeric,
        coalesce(v_approval.snapshot->'lineas', '[]'::jsonb),
        v_approval.idempotency_key,
        v_approval.snapshot->>'moneda',
        nullif(v_approval.snapshot->>'exchange_rate', '')::numeric
      );
    elsif v_approval.tipo = 'purchase_sourcing' then
      v_result := public.convertir_solicitud_a_orden_v1(v_approval.origen_id, v_approval.idempotency_key);
    elsif v_approval.tipo = 'purchase_contract' then
      v_result := public.crear_orden_compra_desde_contrato_v1(
        (v_approval.snapshot->>'contrato_id')::uuid,
        (v_approval.snapshot->>'version_id')::uuid,
        v_approval.snapshot->>'detalle',
        nullif(v_approval.snapshot->>'fecha_limite', '')::date,
        coalesce(v_approval.snapshot->'lineas', '[]'::jsonb),
        v_approval.idempotency_key,
        nullif(v_approval.snapshot->>'exchange_rate', '')::numeric
      );
    elsif v_approval.tipo = 'physical_count' then
      v_result := public.ec_cerrar_inventario_fisico(
        v_approval.origen_id, 'approval-count-' || v_approval.id::text
      );
    else
      raise exception 'Tipo de aprobación no reconocido.' using errcode = '22023';
    end if;
  exception
    when sqlstate '23503' or sqlstate '23514' or sqlstate '22023' or sqlstate '22003' then
      v_error := left(coalesce(nullif(SQLERRM, ''), 'Los datos del documento cambiaron y requieren una nueva solicitud.'), 1000);
      update public.ec_solicitudes_aprobacion
      set estado = 'stale', decision_por = v_actor, decision_en = clock_timestamp(),
          motivo_decision = v_error, actualizado_en = clock_timestamp()
      where id = v_approval.id;
      if v_approval.tipo = 'purchase_sourcing' then
        update public.ofertas_compra
        set estado = 'Vigente', seleccionado_por = null, seleccionado_en = null, updated_at = clock_timestamp()
        where id = (v_approval.snapshot #>> '{oferta,id}')::uuid and estado = 'Seleccionada';
        update public.solicitudes_compra
        set estado = 'Abierta', seleccion_oferta_id = null, seleccion_motivo = null,
            seleccionado_por = null, seleccionado_en = null, updated_by = v_actor, updated_at = clock_timestamp()
        where id = v_approval.origen_id and estado = 'Cerrada'
          and not exists (select 1 from public.compras c where c.solicitud_compra_id = v_approval.origen_id);
      elsif v_approval.tipo = 'physical_count' then
        update public.ec_conteos_fisicos set estado = 'rechazado'
        where id = v_approval.origen_id and estado = 'pendiente_aprobacion';
      end if;
      perform app_private._ec_insert_approval_event_v1(v_approval.id, v_actor, 'obsoleta', v_error, v_approval.snapshot);
      return jsonb_build_object('id', v_approval.id, 'estado', 'stale', 'resultado_id', null);
  end;

  update public.ec_solicitudes_aprobacion
  set estado = 'approved', decision_por = v_actor, decision_en = clock_timestamp(),
      motivo_decision = null, resultado_id = v_result, actualizado_en = clock_timestamp()
  where id = v_approval.id;
  perform app_private._ec_insert_approval_event_v1(v_approval.id, v_actor, 'aprobada', null, v_approval.snapshot);
  return jsonb_build_object('id', v_approval.id, 'estado', 'approved', 'resultado_id', v_result);
end
$function$;


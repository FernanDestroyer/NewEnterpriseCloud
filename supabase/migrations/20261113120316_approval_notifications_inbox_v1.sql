begin;

-- Approval messages use the existing persistent inbox. They are written in the
-- same transaction as the approval state, so there is no separate delivery job
-- or external channel in V1.
alter table public.notificaciones
  drop constraint notificaciones_fuente_check;
alter table public.notificaciones
  add constraint notificaciones_fuente_check
  check (fuente in ('inventory', 'finance', 'purchases', 'approvals'));

drop policy notificaciones_select_propias on public.notificaciones;
create policy notificaciones_select_propias
  on public.notificaciones for select to authenticated
  using (
    usuario_id = (select auth.uid())
    and case fuente
      when 'inventory' then (select public.tiene_permiso('inventario', 'ver'))
      when 'finance' then (select public.tiene_permiso('finanzas', 'ver'))
      when 'purchases' then (select public.tiene_permiso('compras', 'ver'))
      when 'approvals' then (select public.tiene_permiso('aprobaciones', 'ver'))
      else false
    end
  );

drop policy notificaciones_update_propias on public.notificaciones;
create policy notificaciones_update_propias
  on public.notificaciones for update to authenticated
  using (
    usuario_id = (select auth.uid())
    and case fuente
      when 'inventory' then (select public.tiene_permiso('inventario', 'ver'))
      when 'finance' then (select public.tiene_permiso('finanzas', 'ver'))
      when 'purchases' then (select public.tiene_permiso('compras', 'ver'))
      when 'approvals' then (select public.tiene_permiso('aprobaciones', 'ver'))
      else false
    end
  )
  with check (
    usuario_id = (select auth.uid())
    and case fuente
      when 'inventory' then (select public.tiene_permiso('inventario', 'ver'))
      when 'finance' then (select public.tiene_permiso('finanzas', 'ver'))
      when 'purchases' then (select public.tiene_permiso('compras', 'ver'))
      when 'approvals' then (select public.tiene_permiso('aprobaciones', 'ver'))
      else false
    end
  );

-- The trigger is intentionally the only writer for source=approvals. Its
-- stable keys make retries harmless; no snapshot or rejection text is copied
-- into the notification body.
create or replace function app_private._ec_publish_approval_notification_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_document text;
  v_title text;
  v_detail text;
  v_severity text;
begin
  v_document := case new.tipo
    when 'purchase_manual' then 'Orden manual'
    when 'purchase_sourcing' then 'Orden desde comparativo'
    when 'purchase_contract' then 'Liberación desde contrato'
    when 'physical_count' then 'Conteo físico'
    else 'Documento'
  end;

  if tg_op = 'INSERT' then
    if new.estado <> 'pending' then
      return new;
    end if;

    insert into public.notificaciones (
      usuario_id, fuente, clave_fuente, referencia, titulo, detalle, severidad
    )
    select distinct
      u.id,
      'approvals',
      'request:' || new.id::text,
      new.id::text,
      'Aprobación pendiente',
      v_document || ' requiere una decisión.',
      'info'
    from public.usuarios u
    join public.rol_permisos rp on rp.rol_id = u.rol_id
    join public.permisos p on p.id = rp.permiso_id
    where u.activo
      and u.id <> new.solicitante_id
      and p.modulo = 'aprobaciones'
      and p.accion = 'aprobar'
    on conflict (usuario_id, fuente, clave_fuente) do nothing;

    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.estado is distinct from new.estado
    and old.estado = 'pending'
    and new.estado in ('approved', 'rejected', 'stale') then

    update public.notificaciones
    set estado = 'resolved',
        resolved_at = coalesce(resolved_at, clock_timestamp()),
        updated_at = clock_timestamp()
    where fuente = 'approvals'
      and clave_fuente = 'request:' || new.id::text
      and estado = 'active';

    v_title := case new.estado
      when 'approved' then 'Solicitud aprobada'
      when 'rejected' then 'Solicitud rechazada'
      else 'Solicitud requiere una nueva revisión'
    end;
    v_detail := case new.estado
      when 'approved' then v_document || ' aprobada.'
      when 'rejected' then v_document || ' rechazada. Consulta el motivo en la bandeja.'
      else v_document || ' cambió antes de decidirse. Revisa la bandeja y crea otra solicitud.'
    end;
    v_severity := case when new.estado = 'rejected' then 'warning' else 'info' end;

    insert into public.notificaciones (
      usuario_id, fuente, clave_fuente, referencia, titulo, detalle, severidad
    ) values (
      new.solicitante_id,
      'approvals',
      'decision:' || new.id::text,
      new.id::text,
      v_title,
      v_detail,
      v_severity
    )
    on conflict (usuario_id, fuente, clave_fuente) do nothing;
  end if;

  return new;
end
$function$;

revoke all on function app_private._ec_publish_approval_notification_v1() from public, anon, authenticated;

create trigger ec_solicitudes_aprobacion_notify_insert
  after insert on public.ec_solicitudes_aprobacion
  for each row execute function app_private._ec_publish_approval_notification_v1();

create trigger ec_solicitudes_aprobacion_notify_decision
  after update of estado on public.ec_solicitudes_aprobacion
  for each row execute function app_private._ec_publish_approval_notification_v1();

comment on function app_private._ec_publish_approval_notification_v1() is
  'Publishes idempotent internal approval notifications in the same transaction as request and decision state changes.';

commit;

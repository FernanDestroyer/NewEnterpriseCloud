begin;

-- Alertas predictivas (V1): fuente adicional 'predictive' en la bandeja personal.
-- La predicción se calcula en la aplicación (hoy un modelo estadístico; el
-- contrato permite enchufar una red neuronal) y se persiste aquí con la misma
-- bandeja que el resto de alertas: leer, archivar y resolver funcionan igual.
-- Solo se escribe por la RPC de abajo, para el usuario actual y con permiso de
-- Inventario; no se amplía la política de INSERT.

alter table public.notificaciones drop constraint notificaciones_fuente_check;
alter table public.notificaciones add constraint notificaciones_fuente_check
  check (fuente in ('inventory', 'finance', 'purchases', 'approvals', 'predictive'));

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
      when 'predictive' then (select public.tiene_permiso('inventario', 'ver'))
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
      when 'predictive' then (select public.tiene_permiso('inventario', 'ver'))
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
      when 'predictive' then (select public.tiene_permiso('inventario', 'ver'))
      else false
    end
  );

create or replace function public.ec_sincronizar_alertas_predictivas_v1(p_alertas jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_usuario uuid := (select auth.uid());
  v_alerta jsonb;
  v_clave text;
  v_referencia text;
  v_titulo text;
  v_detalle text;
  v_severidad text;
  v_claves text[] := array[]::text[];
  v_total integer := 0;
begin
  if v_usuario is null
     or not exists (select 1 from public.usuarios u where u.id = v_usuario and u.activo)
     or not public.tiene_permiso('inventario', 'ver') then
    raise exception 'No tienes permiso para sincronizar alertas predictivas.' using errcode = '42501';
  end if;
  if p_alertas is null or jsonb_typeof(p_alertas) <> 'array' or jsonb_array_length(p_alertas) > 600 then
    raise exception 'La lista de alertas predictivas no es válida.' using errcode = '22023';
  end if;

  for v_alerta in select value from jsonb_array_elements(p_alertas) loop
    if jsonb_typeof(v_alerta) <> 'object'
       or jsonb_typeof(v_alerta->'clave_fuente') <> 'string'
       or jsonb_typeof(v_alerta->'referencia') <> 'string'
       or jsonb_typeof(v_alerta->'titulo') <> 'string'
       or jsonb_typeof(v_alerta->'severidad') <> 'string'
       or (v_alerta ? 'detalle' and jsonb_typeof(v_alerta->'detalle') <> 'string') then
      raise exception 'Una alerta no cumple el formato permitido.' using errcode = '22023';
    end if;
    v_clave := btrim(v_alerta->>'clave_fuente');
    v_referencia := btrim(v_alerta->>'referencia');
    v_titulo := btrim(v_alerta->>'titulo');
    v_detalle := coalesce(v_alerta->>'detalle', '');
    v_severidad := v_alerta->>'severidad';
    if length(v_clave) not between 1 and 180
       or length(v_referencia) not between 1 and 120
       or length(v_titulo) not between 1 and 180
       or length(v_detalle) > 500
       or v_severidad not in ('critical', 'warning', 'info')
       or v_clave = any(v_claves) then
      raise exception 'Una alerta no cumple el formato permitido.' using errcode = '22023';
    end if;
    v_claves := v_claves || v_clave;

    insert into public.notificaciones as existente (
      usuario_id, fuente, clave_fuente, referencia, titulo, detalle, severidad,
      estado, created_at, updated_at, last_seen_at
    ) values (
      v_usuario, 'predictive', v_clave, v_referencia, v_titulo, v_detalle, v_severidad,
      'active', clock_timestamp(), clock_timestamp(), clock_timestamp()
    )
    on conflict (usuario_id, fuente, clave_fuente) do update set
      referencia = excluded.referencia,
      titulo = excluded.titulo,
      detalle = excluded.detalle,
      severidad = excluded.severidad,
      estado = 'active',
      read_at = case when existente.estado = 'resolved' then null else existente.read_at end,
      archived_at = case when existente.estado = 'resolved' then null else existente.archived_at end,
      resolved_at = null,
      updated_at = clock_timestamp(),
      last_seen_at = clock_timestamp();
    v_total := v_total + 1;
  end loop;

  -- Lo que ya no se predice (stock repuesto, consumo menor) se resuelve solo.
  update public.notificaciones n
  set estado = 'resolved', resolved_at = clock_timestamp(), updated_at = clock_timestamp()
  where n.usuario_id = v_usuario and n.fuente = 'predictive' and n.estado = 'active'
    and not (n.clave_fuente = any(v_claves));

  return v_total;
end
$function$;

revoke all on function public.ec_sincronizar_alertas_predictivas_v1(jsonb) from public, anon;
grant execute on function public.ec_sincronizar_alertas_predictivas_v1(jsonb) to authenticated;

comment on function public.ec_sincronizar_alertas_predictivas_v1(jsonb) is
  'Sincroniza las alertas predictivas del usuario actual (fuente predictive). Requiere permiso de Inventario.';

commit;

begin;

-- Umbrales editables de aprobación (V1).
--
-- Comportamiento por defecto: ambas reglas nacen DESACTIVADAS y con valor 0,
-- de modo que todo sigue exigiendo aprobación de otra persona, igual que hoy.
-- Cuando un Gerente/Administrador activa una regla:
--   * orden_compra_monto_minimo_pen: las órdenes (manual, comparativo o
--     contrato) cuyo total estimado con impuestos en PEN sea MENOR que el
--     umbral se emiten sin esperar decisión.
--   * conteo_fisico_variacion_maxima_unidades: los conteos con diferencias cuya
--     variación absoluta total sea MENOR O IGUAL que el umbral se aplican sin
--     esperar decisión.
-- La emisión automática queda registrada como solicitud 'approved' con un
-- evento 'aprobada' cuyo detalle trae auto_aprobada = true, la regla y el
-- umbral. Si la emisión automática falla por cualquier motivo, la solicitud
-- permanece 'pending' y sigue el flujo normal con aprobador distinto.

create table public.ec_reglas_aprobacion (
  clave text primary key
    check (clave in ('orden_compra_monto_minimo_pen', 'conteo_fisico_variacion_maxima_unidades')),
  titulo text not null,
  descripcion text not null,
  unidad text not null check (unidad in ('PEN', 'unidades')),
  valor numeric(14, 2) not null default 0 check (valor >= 0 and valor <= 1000000000),
  activa boolean not null default false,
  actualizado_por uuid references public.usuarios(id) on delete set null,
  actualizado_en timestamptz not null default clock_timestamp()
);

create index ec_reglas_aprobacion_actualizado_por_idx
  on public.ec_reglas_aprobacion (actualizado_por);

insert into public.ec_reglas_aprobacion (clave, titulo, descripcion, unidad, valor, activa) values
  ('orden_compra_monto_minimo_pen',
   'Monto mínimo de orden de compra que exige aprobación',
   'Las órdenes con total estimado (con impuestos, en soles) menor que este monto se emiten sin aprobación. Con la regla inactiva o en 0, toda orden requiere aprobación.',
   'PEN', 0, false),
  ('conteo_fisico_variacion_maxima_unidades',
   'Variación máxima de un conteo físico sin aprobación',
   'Los conteos con diferencias cuya variación absoluta total sea menor o igual que este valor se aplican sin aprobación. Con la regla inactiva o en 0, todo conteo con diferencias requiere aprobación.',
   'unidades', 0, false);

alter table public.ec_reglas_aprobacion enable row level security;
revoke all on public.ec_reglas_aprobacion from public, anon, authenticated;
grant select on public.ec_reglas_aprobacion to authenticated;

create policy ec_reglas_aprobacion_select
  on public.ec_reglas_aprobacion for select to authenticated
  using (
    exists (select 1 from public.usuarios u where u.id = (select auth.uid()) and u.activo)
    and (select public.tiene_permiso('aprobaciones', 'ver'))
  );

create or replace function public.ec_actualizar_regla_aprobacion_v1(
  p_clave text, p_valor numeric, p_activa boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_role text;
  v_antes public.ec_reglas_aprobacion%rowtype;
  v_despues public.ec_reglas_aprobacion%rowtype;
begin
  if v_actor is null or not public.tiene_permiso('aprobaciones', 'aprobar') then
    raise exception 'No tienes permiso para modificar las reglas de aprobación.' using errcode = '42501';
  end if;
  select r.nombre into v_role
  from public.usuarios u join public.roles r on r.id = u.rol_id
  where u.id = v_actor and u.activo;
  if v_role is null or v_role not in ('Administrador', 'Gerente') then
    raise exception 'Solo Gerente o Administrador puede modificar las reglas de aprobación.' using errcode = '42501';
  end if;
  if p_clave is null or p_valor is null or p_activa is null
     or p_valor::text in ('NaN', 'Infinity', '-Infinity')
     or p_valor < 0 or p_valor > 1000000000 then
    raise exception 'El umbral debe ser un número entre 0 y 1 000 000 000.' using errcode = '22023';
  end if;
  if p_activa and p_valor = 0 then
    raise exception 'Para activar la regla indica un umbral mayor que 0.' using errcode = '22023';
  end if;

  select * into v_antes from public.ec_reglas_aprobacion where clave = p_clave for update;
  if not found then
    raise exception 'La regla de aprobación no existe.' using errcode = '23503';
  end if;
  if v_antes.unidad = 'unidades' and p_valor <> trunc(p_valor) then
    raise exception 'Este umbral se expresa en unidades enteras.' using errcode = '22023';
  end if;

  update public.ec_reglas_aprobacion
  set valor = round(p_valor, 2), activa = p_activa,
      actualizado_por = v_actor, actualizado_en = clock_timestamp()
  where clave = p_clave
  returning * into v_despues;

  insert into public.auditoria
    (usuario_id, usuario_email, accion, modulo, registro_id, datos_antes, datos_despues)
  values
    (v_actor, (select u.email from public.usuarios u where u.id = v_actor),
     'UPDATE', 'ec_reglas_aprobacion', p_clave, to_jsonb(v_antes), to_jsonb(v_despues));

  return jsonb_build_object(
    'clave', v_despues.clave, 'valor', v_despues.valor, 'activa', v_despues.activa,
    'actualizado_por', v_despues.actualizado_por, 'actualizado_en', v_despues.actualizado_en
  );
end
$function$;

revoke all on function public.ec_actualizar_regla_aprobacion_v1(text, numeric, boolean) from public, anon;
grant execute on function public.ec_actualizar_regla_aprobacion_v1(text, numeric, boolean) to authenticated;

-- Total estimado en PEN con impuestos, a partir del snapshot inmutable.
create or replace function app_private._ec_total_estimado_pen_v1(p_tipo text, p_snapshot jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_rate numeric := coalesce(nullif(p_snapshot->>'exchange_rate', '')::numeric, 1);
  v_total numeric;
begin
  if p_tipo = 'purchase_sourcing' then
    return round((p_snapshot #>> '{oferta,total_pen}')::numeric, 2);
  end if;
  if jsonb_typeof(p_snapshot->'lineas') = 'array' and jsonb_array_length(p_snapshot->'lineas') > 0 then
    select sum(
             (l->>'cantidad')::numeric * (l->>'precio')::numeric
             * (1 + case when coalesce(l->>'tratamiento_tributario', 'Gravado') = 'Gravado'
                         then coalesce(nullif(l->>'tasa_tributaria', '')::numeric, 18) / 100
                         else 0 end))
    into v_total
    from jsonb_array_elements(p_snapshot->'lineas') l;
  else
    v_total := (p_snapshot->>'monto_manual')::numeric;
  end if;
  return round(v_total * v_rate, 2);
end
$function$;
revoke all on function app_private._ec_total_estimado_pen_v1(text, jsonb) from public, anon, authenticated;

-- Emisión automática bajo umbral. Corre DIFERIDA (al confirmar la transacción)
-- para que el evento 'solicitada' ya exista y el historial quede en orden.
create or replace function app_private._ec_autoaprobar_bajo_umbral_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_req public.ec_solicitudes_aprobacion%rowtype;
  v_rule public.ec_reglas_aprobacion%rowtype;
  v_clave text;
  v_medida numeric;
  v_aplica boolean := false;
  v_result uuid;
begin
  select * into v_req from public.ec_solicitudes_aprobacion where id = new.id for update;
  if not found or v_req.estado <> 'pending' then return null; end if;
  -- Solo en la sesión de quien solicita: nunca en procesos de terceros.
  if v_req.solicitante_id is distinct from (select auth.uid()) then return null; end if;

  v_clave := case when v_req.tipo = 'physical_count'
                  then 'conteo_fisico_variacion_maxima_unidades'
                  else 'orden_compra_monto_minimo_pen' end;
  select * into v_rule from public.ec_reglas_aprobacion where clave = v_clave;
  if not found or not v_rule.activa or v_rule.valor <= 0 then return null; end if;

  begin
    if v_req.tipo = 'physical_count' then
      v_medida := (v_req.snapshot->>'variacion_unidades_absoluta')::numeric;
      v_aplica := coalesce((v_req.snapshot->>'diferencias')::int, 0) > 0
                  and v_medida <= v_rule.valor
                  and (public.tiene_permiso('inventario', 'crear') or public.tiene_permiso('inventario', 'editar'));
    else
      v_medida := app_private._ec_total_estimado_pen_v1(v_req.tipo, v_req.snapshot);
      v_aplica := v_medida is not null and v_medida < v_rule.valor
                  and public.tiene_permiso('compras', 'crear');
    end if;
  exception when others then
    return null;
  end;
  if not v_aplica then return null; end if;

  -- Misma emisión que ec_decidir_aprobacion_v1, en una subtransacción: si algo
  -- falla se revierte y la solicitud sigue pendiente para un aprobador.
  begin
    if v_req.tipo = 'purchase_manual' then
      v_result := public.crear_orden_compra_operativa_v4(
        (v_req.snapshot->>'proveedor_id')::uuid, v_req.snapshot->>'detalle',
        nullif(v_req.snapshot->>'fecha_limite', '')::date, (v_req.snapshot->>'monto_manual')::numeric,
        coalesce(v_req.snapshot->'lineas', '[]'::jsonb), v_req.idempotency_key,
        v_req.snapshot->>'moneda', nullif(v_req.snapshot->>'exchange_rate', '')::numeric);
    elsif v_req.tipo = 'purchase_sourcing' then
      v_result := public.convertir_solicitud_a_orden_v1(v_req.origen_id, v_req.idempotency_key);
    elsif v_req.tipo = 'purchase_contract' then
      v_result := public.crear_orden_compra_desde_contrato_v1(
        (v_req.snapshot->>'contrato_id')::uuid, (v_req.snapshot->>'version_id')::uuid,
        v_req.snapshot->>'detalle', nullif(v_req.snapshot->>'fecha_limite', '')::date,
        coalesce(v_req.snapshot->'lineas', '[]'::jsonb), v_req.idempotency_key,
        nullif(v_req.snapshot->>'exchange_rate', '')::numeric);
    elsif v_req.tipo = 'physical_count' then
      v_result := public.ec_cerrar_inventario_fisico(v_req.origen_id, 'approval-count-' || v_req.id::text);
    else
      return null;
    end if;
    if v_result is null then raise exception 'sin resultado'; end if;
  exception when others then
    return null;
  end;

  update public.ec_solicitudes_aprobacion
  set estado = 'approved', decision_por = v_req.solicitante_id, decision_en = clock_timestamp(),
      motivo_decision = null, resultado_id = v_result, actualizado_en = clock_timestamp()
  where id = v_req.id;
  perform app_private._ec_insert_approval_event_v1(
    v_req.id, v_req.solicitante_id, 'aprobada', null,
    v_req.snapshot || jsonb_build_object(
      'auto_aprobada', true, 'regla', v_rule.clave, 'umbral', v_rule.valor,
      'medida', v_medida, 'unidad', v_rule.unidad));
  return null;
end
$function$;
revoke all on function app_private._ec_autoaprobar_bajo_umbral_v1() from public, anon, authenticated;

create constraint trigger ec_solicitudes_aprobacion_autoaprobar
  after insert on public.ec_solicitudes_aprobacion
  deferrable initially deferred
  for each row execute function app_private._ec_autoaprobar_bajo_umbral_v1();

comment on table public.ec_reglas_aprobacion is
  'Umbrales editables que deciden cuándo una orden o un conteo exige aprobación. Cambios solo por RPC de Gerente/Administrador, con auditoría.';

commit;

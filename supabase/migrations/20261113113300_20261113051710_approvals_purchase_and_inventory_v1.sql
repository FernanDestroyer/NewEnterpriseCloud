begin;

-- One-step, segregated approvals for purchase-order creation and physical-count
-- adjustments. Requests are immutable snapshots; final business writes run in
-- the same transaction as the decision.

alter table public.permisos drop constraint if exists permisos_accion_check;
alter table public.permisos
  add constraint permisos_accion_check
  check (accion in ('ver', 'crear', 'editar', 'eliminar', 'importar', 'aprobar'));

insert into public.permisos (modulo, accion)
values ('aprobaciones', 'ver'), ('aprobaciones', 'aprobar')
on conflict (modulo, accion) do nothing;

-- Requesters may inspect their own requests. Only the two roles selected for
-- V1 receive the approval capability; the RPC also checks the role name.
insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
from public.roles r
join public.permisos p on p.modulo = 'aprobaciones' and p.accion = 'aprobar'
where r.nombre in ('Administrador', 'Gerente')
on conflict (rol_id, permiso_id) do nothing;

insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
from public.roles r
join public.permisos p on p.modulo = 'aprobaciones' and p.accion = 'ver'
where r.nombre in ('Administrador', 'Gerente')
on conflict (rol_id, permiso_id) do nothing;

insert into public.rol_permisos (rol_id, permiso_id)
select distinct rp.rol_id, approval_view.id
from public.rol_permisos rp
join public.permisos operational on operational.id = rp.permiso_id
join public.permisos approval_view on approval_view.modulo = 'aprobaciones' and approval_view.accion = 'ver'
where (operational.modulo = 'compras' and operational.accion = 'crear')
   or (operational.modulo = 'inventario' and operational.accion in ('crear', 'editar'))
on conflict (rol_id, permiso_id) do nothing;

create table public.ec_solicitudes_aprobacion (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('purchase_manual', 'purchase_sourcing', 'purchase_contract', 'physical_count')),
  origen_id uuid,
  solicitante_id uuid not null references public.usuarios(id) on delete restrict,
  estado text not null default 'pending' check (estado in ('pending', 'approved', 'rejected', 'stale')),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) between 8 and 128),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{32}$'),
  resultado_id uuid,
  decision_por uuid references public.usuarios(id) on delete restrict,
  decision_en timestamptz,
  motivo_decision text,
  creado_en timestamptz not null default clock_timestamp(),
  actualizado_en timestamptz not null default clock_timestamp(),
  check (
    (estado = 'pending' and decision_por is null and decision_en is null and motivo_decision is null and resultado_id is null)
    or (estado = 'approved' and decision_por is not null and decision_en is not null and motivo_decision is null and resultado_id is not null)
    or (estado = 'rejected' and decision_por is not null and decision_en is not null and length(btrim(coalesce(motivo_decision, ''))) between 3 and 1000 and resultado_id is null)
    or (estado = 'stale' and decision_por is not null and decision_en is not null and length(btrim(coalesce(motivo_decision, ''))) between 3 and 1000 and resultado_id is null)
  )
);

create unique index ec_solicitudes_aprobacion_origen_pendiente_idx
  on public.ec_solicitudes_aprobacion (tipo, origen_id)
  where origen_id is not null and estado = 'pending'
    and tipo in ('purchase_sourcing', 'purchase_contract', 'physical_count');
create index ec_solicitudes_aprobacion_bandeja_idx
  on public.ec_solicitudes_aprobacion (estado, creado_en desc, id desc);
create index ec_solicitudes_aprobacion_solicitante_idx
  on public.ec_solicitudes_aprobacion (solicitante_id, estado, creado_en desc, id desc);
create index ec_solicitudes_aprobacion_decision_por_idx
  on public.ec_solicitudes_aprobacion (decision_por);

create table public.ec_aprobacion_eventos (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.ec_solicitudes_aprobacion(id) on delete restrict,
  actor_id uuid not null references public.usuarios(id) on delete restrict,
  evento text not null check (evento in ('solicitada', 'aprobada', 'rechazada', 'obsoleta')),
  motivo text,
  detalle jsonb not null default '{}'::jsonb check (jsonb_typeof(detalle) = 'object'),
  creado_en timestamptz not null default clock_timestamp()
);
create index ec_aprobacion_eventos_solicitud_idx
  on public.ec_aprobacion_eventos (solicitud_id, creado_en, id);
create index ec_aprobacion_eventos_actor_idx
  on public.ec_aprobacion_eventos (actor_id);

alter table public.ec_solicitudes_aprobacion enable row level security;
alter table public.ec_aprobacion_eventos enable row level security;
revoke all on public.ec_solicitudes_aprobacion, public.ec_aprobacion_eventos from public, anon, authenticated;
grant select on public.ec_solicitudes_aprobacion, public.ec_aprobacion_eventos to authenticated;

create policy ec_aprobaciones_select_propias_o_aprobador
  on public.ec_solicitudes_aprobacion for select to authenticated
  using (
    exists (select 1 from public.usuarios active_user where active_user.id = (select auth.uid()) and active_user.activo)
    and (
      solicitante_id = (select auth.uid())
      or (
        (select public.tiene_permiso('aprobaciones', 'aprobar'))
        and exists (
          select 1 from public.usuarios u join public.roles r on r.id = u.rol_id
          where u.id = (select auth.uid()) and u.activo
            and r.nombre in ('Administrador', 'Gerente')
        )
      )
    )
  );

create policy ec_aprobacion_eventos_select_propios_o_aprobador
  on public.ec_aprobacion_eventos for select to authenticated
  using (
    exists (select 1 from public.usuarios active_user where active_user.id = (select auth.uid()) and active_user.activo)
    and
    exists (
      select 1 from public.ec_solicitudes_aprobacion a
      where a.id = solicitud_id
        and (
          a.solicitante_id = (select auth.uid())
          or (
            (select public.tiene_permiso('aprobaciones', 'aprobar'))
            and exists (
              select 1 from public.usuarios u join public.roles r on r.id = u.rol_id
              where u.id = (select auth.uid()) and u.activo
                and r.nombre in ('Administrador', 'Gerente')
            )
          )
        )
    )
  );

create or replace function app_private._ec_purchase_offer_snapshot_v1(p_solicitud_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_request record;
  v_offer record;
  v_lines jsonb;
  v_total numeric;
begin
  select s.id, s.codigo, s.solicitante_id, s.estado, s.version,
         s.seleccion_oferta_id, s.seleccion_motivo, s.fecha_necesidad, s.detalle
  into v_request
  from public.solicitudes_compra s
  where s.id = p_solicitud_id;
  if not found then return null; end if;

  select o.id, o.codigo, o.proveedor_id, p.razon_social as proveedor_nombre,
         o.estado, o.version, o.es_version_actual, o.moneda, o.exchange_rate
  into v_offer
  from public.ofertas_compra o
  join public.proveedores p on p.id = o.proveedor_id
  where o.id = v_request.seleccion_oferta_id
    and o.solicitud_id = p_solicitud_id;
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'solicitud_linea_id', l.id,
    'producto_id', l.producto_id,
    'descripcion', l.descripcion,
    'cantidad', l.cantidad,
    'unidad', l.unidad,
    'detalle_oferta_id', d.id,
    'precio_unitario', d.precio_unitario,
    'tratamiento_tributario', d.tratamiento_tributario,
    'tasa_tributaria', d.tasa_tributaria,
    'catalogos_proveedor', coalesce(pp.catalogos, '[]'::jsonb)
  ) order by l.id), '[]'::jsonb)
  into v_lines
  from public.solicitud_compra_lineas l
  left join public.detalle_ofertas_compra d
    on d.solicitud_linea_id = l.id and d.oferta_id = v_offer.id
  left join lateral (
    select jsonb_agg(pp.id order by pp.id) as catalogos
    from public.proveedor_productos pp
    where pp.proveedor_id = v_offer.proveedor_id and pp.producto_id = l.producto_id
  ) pp on true
  where l.solicitud_id = p_solicitud_id;

  select coalesce(sum(tax.total), 0)
  into v_total
  from public.solicitud_compra_lineas l
  join public.detalle_ofertas_compra d
    on d.solicitud_linea_id = l.id and d.oferta_id = v_offer.id
  cross join lateral app_private._calcular_impuestos_compra_v1(
    d.tratamiento_tributario,
    ceil(l.cantidad) * round(d.precio_unitario, 2),
    d.tasa_tributaria
  ) tax
  where l.solicitud_id = p_solicitud_id;

  return jsonb_build_object(
    'solicitud', jsonb_build_object(
      'id', v_request.id, 'codigo', v_request.codigo,
      'solicitante_id', v_request.solicitante_id,
      'estado', v_request.estado, 'version', v_request.version,
      'fecha_necesidad', v_request.fecha_necesidad, 'detalle', v_request.detalle,
      'seleccion_oferta_id', v_request.seleccion_oferta_id,
      'seleccion_motivo', v_request.seleccion_motivo
    ),
    'oferta', jsonb_build_object(
      'id', v_offer.id, 'codigo', v_offer.codigo,
      'proveedor_id', v_offer.proveedor_id, 'proveedor_nombre', v_offer.proveedor_nombre, 'estado', v_offer.estado,
      'version', v_offer.version, 'es_version_actual', v_offer.es_version_actual,
      'moneda', v_offer.moneda, 'exchange_rate', v_offer.exchange_rate,
      'total', round(v_total, 2),
      'total_pen', round(v_total * coalesce(v_offer.exchange_rate, 1), 2)
    ),
    'lineas', v_lines
  );
end
$function$;
revoke all on function app_private._ec_purchase_offer_snapshot_v1(uuid) from public, anon, authenticated;

create or replace function app_private._ec_physical_count_snapshot_v1(p_conteo_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select jsonb_build_object(
    'conteo_id', c.id,
    'almacen_id', c.almacen_id,
    'almacen', a.nombre,
    'motivo', c.motivo,
    'creado_por', c.creado_por,
    'cantidad_lineas', count(l.producto_id),
    'diferencias', count(l.producto_id) filter (where l.stock_contado <> l.stock_sistema),
    'variacion_unidades_neta', coalesce(sum(l.stock_contado - l.stock_sistema), 0),
    'variacion_unidades_absoluta', coalesce(sum(abs(l.stock_contado - l.stock_sistema)), 0),
    'lineas', coalesce(jsonb_agg(jsonb_build_object(
      'producto_id', l.producto_id,
      'producto', p.nombre,
      'stock_sistema', l.stock_sistema,
      'stock_contado', l.stock_contado,
      'diferencia', l.stock_contado - l.stock_sistema,
      'costo_entrada', l.costo_entrada
    ) order by l.producto_id) filter (where l.producto_id is not null), '[]'::jsonb),
    'huella_lineas', md5(coalesce(jsonb_agg(jsonb_build_object(
      'producto_id', l.producto_id,
      'stock_sistema', l.stock_sistema,
      'stock_contado', l.stock_contado,
      'costo_entrada', l.costo_entrada
    ) order by l.producto_id)::text, '[]'))
  )
  from public.ec_conteos_fisicos c
  left join public.ec_conteo_lineas l on l.conteo_id = c.id
  left join public.productos p on p.id = l.producto_id
  left join public.almacenes a on a.id = c.almacen_id
  where c.id = p_conteo_id
  group by c.id, a.nombre;
$function$;
revoke all on function app_private._ec_physical_count_snapshot_v1(uuid) from public, anon, authenticated;

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

create or replace function public.ec_solicitar_aprobacion_orden_manual_v1(
  p_proveedor_id uuid,
  p_detalle text,
  p_fecha_limite date,
  p_monto_manual numeric,
  p_lineas jsonb,
  p_idempotency_key text,
  p_moneda text,
  p_exchange_rate numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_supplier_name text;
  v_snapshot jsonb;
  v_lines jsonb;
  v_hash text;
  v_id uuid;
  v_existing public.ec_solicitudes_aprobacion%rowtype;
begin
  if v_actor is null or not public.tiene_permiso('compras', 'crear') then
    raise exception 'Se requiere permiso de Compras para solicitar una orden.' using errcode = '42501';
  end if;
  if p_proveedor_id is null or nullif(btrim(p_idempotency_key), '') is null
     or length(p_idempotency_key) not between 8 and 128
     or p_lineas is null or jsonb_typeof(p_lineas) is distinct from 'array'
     or p_moneda is null or p_moneda not in ('PEN', 'USD')
     or (p_moneda = 'PEN' and coalesce(p_exchange_rate, 1) <> 1)
     or (p_moneda = 'USD' and (p_exchange_rate is null or p_exchange_rate::text in ('NaN', 'Infinity', '-Infinity') or p_exchange_rate <= 0))
     or (p_exchange_rate is not null and (p_exchange_rate::text in ('NaN', 'Infinity', '-Infinity') or p_exchange_rate <= 0))
     or (p_monto_manual is not null and (p_monto_manual::text in ('NaN', 'Infinity', '-Infinity') or p_monto_manual < 0))
     or (jsonb_array_length(p_lineas) = 0 and coalesce(p_monto_manual, 0) <= 0) then
    raise exception 'Los datos de la orden no son válidos.' using errcode = '22023';
  end if;
  select p.razon_social into v_supplier_name
  from public.proveedores p where p.id = p_proveedor_id and p.estado::text = 'Activo';
  if not found then
    raise exception 'El proveedor no está activo.' using errcode = '23503';
  end if;
  perform app_private._validar_lineas_compra_v1(p_lineas, true);
  if exists (
    select 1
    from jsonb_array_elements(p_lineas) x
    left join public.proveedor_productos pp
      on pp.id = (x.value->>'producto_id')::uuid
     and pp.proveedor_id = p_proveedor_id
    where pp.id is null or pp.producto_id is null
  ) then
    raise exception 'Cada línea debe pertenecer al catálogo del proveedor y estar vinculada a un producto maestro.' using errcode = '23514';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'producto_id', pp.id,
    'producto', p.nombre,
    'cantidad', (x.value->>'cantidad')::numeric,
    'precio', (x.value->>'precio')::numeric,
    'tratamiento_tributario', coalesce(x.value->>'tratamiento_tributario', 'Gravado'),
    'tasa_tributaria', coalesce(nullif(x.value->>'tasa_tributaria', '')::numeric,
      case when coalesce(x.value->>'tratamiento_tributario', 'Gravado') = 'Gravado' then 18 else 0 end)
  ) order by p.nombre, p.id), '[]'::jsonb)
  into v_lines
  from jsonb_array_elements(p_lineas) x
  join public.proveedor_productos pp
    on pp.id = (x.value->>'producto_id')::uuid and pp.proveedor_id = p_proveedor_id
  join public.productos p on p.id = pp.producto_id;
  if jsonb_array_length(v_lines) <> jsonb_array_length(p_lineas) then
    raise exception 'Uno o más productos de la orden ya no existen.' using errcode = '23503';
  end if;
  v_snapshot := jsonb_build_object(
    'proveedor_id', p_proveedor_id,
    'proveedor_nombre', v_supplier_name,
    'detalle', coalesce(btrim(p_detalle), ''),
    'fecha_limite', p_fecha_limite,
    'monto_manual', coalesce(p_monto_manual, 0),
    'lineas', v_lines,
    'moneda', p_moneda,
    'exchange_rate', case when p_moneda = 'PEN' then 1 else p_exchange_rate end
  );
  v_hash := md5(v_snapshot::text);
  perform pg_advisory_xact_lock(hashtextextended('ec-aprobacion:' || p_idempotency_key, 0));
  select * into v_existing from public.ec_solicitudes_aprobacion where idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.tipo <> 'purchase_manual' or v_existing.snapshot_hash <> v_hash then
      raise exception 'La clave ya corresponde a otra solicitud de aprobación.' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  insert into public.ec_solicitudes_aprobacion
    (tipo, solicitante_id, idempotency_key, snapshot, snapshot_hash)
  values ('purchase_manual', v_actor, p_idempotency_key, v_snapshot, v_hash)
  returning id into v_id;
  perform app_private._ec_insert_approval_event_v1(v_id, v_actor, 'solicitada', null, v_snapshot);
  return v_id;
end
$function$;

create or replace function public.ec_solicitar_aprobacion_conversion_compra_v1(
  p_solicitud_id uuid, p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_snapshot jsonb;
  v_hash text;
  v_id uuid;
  v_existing public.ec_solicitudes_aprobacion%rowtype;
begin
  if v_actor is null or not public.tiene_permiso('compras', 'crear') then
    raise exception 'Se requiere permiso de Compras para solicitar la conversión.' using errcode = '42501';
  end if;
  if p_solicitud_id is null or nullif(btrim(p_idempotency_key), '') is null
     or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Solicitud y clave de idempotencia válidas son obligatorias.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ec-aprobacion:' || p_idempotency_key, 0));
  select * into v_existing from public.ec_solicitudes_aprobacion where idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.tipo <> 'purchase_sourcing' or v_existing.origen_id <> p_solicitud_id then
      raise exception 'La clave ya corresponde a otra solicitud de aprobación.' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  perform 1 from public.solicitudes_compra s where s.id = p_solicitud_id for update;
  v_snapshot := app_private._ec_purchase_offer_snapshot_v1(p_solicitud_id);
  if v_snapshot is null
     or v_snapshot #>> '{solicitud,estado}' <> 'Cerrada'
     or v_snapshot #>> '{oferta,estado}' <> 'Seleccionada'
     or v_snapshot #>> '{oferta,es_version_actual}' <> 'true'
     or jsonb_array_length(v_snapshot->'lineas') = 0
     or exists (select 1 from public.compras c where c.solicitud_compra_id = p_solicitud_id) then
    raise exception 'La solicitud no tiene una oferta seleccionada vigente y convertible.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.solicitud_compra_lineas l
    left join public.detalle_ofertas_compra d
      on d.solicitud_linea_id = l.id and d.oferta_id = (v_snapshot #>> '{oferta,id}')::uuid
    where l.solicitud_id = p_solicitud_id and (l.producto_id is null or d.id is null
      or jsonb_array_length(v_snapshot #> '{lineas}') = 0)
  ) then
    raise exception 'La oferta necesita productos maestros y precios para cada línea.' using errcode = '23514';
  end if;
  v_hash := md5(v_snapshot::text);
  insert into public.ec_solicitudes_aprobacion
    (tipo, origen_id, solicitante_id, idempotency_key, snapshot, snapshot_hash)
  values ('purchase_sourcing', p_solicitud_id, v_actor, p_idempotency_key, v_snapshot, v_hash)
  returning id into v_id;
  perform app_private._ec_insert_approval_event_v1(v_id, v_actor, 'solicitada', null, v_snapshot);
  return v_id;
end
$function$;

create or replace function public.ec_solicitar_aprobacion_orden_contrato_v1(
  p_contrato_id uuid,
  p_version_id uuid,
  p_detalle text,
  p_fecha_limite date,
  p_lineas jsonb,
  p_idempotency_key text,
  p_exchange_rate numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_snapshot jsonb;
  v_hash text;
  v_id uuid;
  v_existing public.ec_solicitudes_aprobacion%rowtype;
  v_currency text;
  v_supplier_name text;
  v_lines jsonb;
begin
  if v_actor is null or not public.tiene_permiso('compras', 'crear') then
    raise exception 'Se requiere permiso de Compras para solicitar una liberación.' using errcode = '42501';
  end if;
  if p_contrato_id is null or p_version_id is null or p_lineas is null
     or jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas) = 0
     or nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Contrato, versión, líneas y clave idempotente son obligatorios.' using errcode = '22023';
  end if;
  perform app_private._validar_lineas_compra_v1(p_lineas, false);
  if exists (
       select 1 from jsonb_array_elements(p_lineas) x
       where jsonb_typeof(x.value) is distinct from 'object'
          or jsonb_typeof(x.value->'producto_id') is distinct from 'string'
     ) or (select count(distinct value->>'producto_id') from jsonb_array_elements(p_lineas)) <> jsonb_array_length(p_lineas) then
    raise exception 'Las líneas del contrato deben tener productos válidos y no repetidos.' using errcode = '22023';
  end if;
  select v.moneda::text, p.razon_social into v_currency, v_supplier_name
  from public.contratos_compra c
  join public.versiones_contrato_compra v on v.id = p_version_id and v.contrato_id = c.id
  join public.proveedores p on p.id = c.proveedor_id and p.estado::text = 'Activo'
  where c.id = p_contrato_id and c.estado = 'Activo' and c.version_actual_id = p_version_id
    and v.estado = 'Activa' and current_date between v.fecha_inicio and v.fecha_fin;
  if not found then raise exception 'El contrato o su versión no está activa.' using errcode = '23514'; end if;
  if p_exchange_rate is not null and (p_exchange_rate::text in ('NaN', 'Infinity', '-Infinity') or p_exchange_rate <= 0) then
    raise exception 'El tipo de cambio debe ser positivo y finito.' using errcode = '22023';
  end if;
  if v_currency = 'USD' and p_exchange_rate is null then
    raise exception 'Un contrato USD requiere tipo de cambio positivo.' using errcode = '22023';
  end if;
  if v_currency = 'PEN' and coalesce(p_exchange_rate, 1) <> 1 then
    raise exception 'Un contrato PEN requiere tipo de cambio 1.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'producto_id', l.proveedor_producto_id,
    'producto', l.descripcion,
    'unidad', l.unidad,
    'condiciones', l.condiciones,
    'cantidad', (x.value->>'cantidad')::numeric,
    'precio', (x.value->>'precio')::numeric,
    'tratamiento_tributario', x.value->>'tratamiento_tributario',
    'tasa_tributaria', (x.value->>'tasa_tributaria')::numeric
  ) order by l.id), '[]'::jsonb)
  into v_lines
  from jsonb_array_elements(p_lineas) x
  join public.lineas_contrato_compra l
    on l.version_id = p_version_id and l.proveedor_producto_id = (x.value->>'producto_id')::uuid;
  if jsonb_array_length(v_lines) <> jsonb_array_length(p_lineas) then
    raise exception 'Uno o más artículos ya no pertenecen a la versión del contrato.' using errcode = '23514';
  end if;
  v_snapshot := jsonb_build_object(
    'contrato_id', p_contrato_id, 'version_id', p_version_id,
    'proveedor_nombre', v_supplier_name,
    'detalle', coalesce(btrim(p_detalle), ''), 'fecha_limite', p_fecha_limite,
    'lineas', v_lines, 'exchange_rate', case when v_currency = 'PEN' then 1 else p_exchange_rate end,
    'moneda', v_currency
  );
  v_hash := md5(v_snapshot::text);
  perform pg_advisory_xact_lock(hashtextextended('ec-aprobacion:' || p_idempotency_key, 0));
  select * into v_existing from public.ec_solicitudes_aprobacion where idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.tipo <> 'purchase_contract' or v_existing.snapshot_hash <> v_hash then
      raise exception 'La clave ya corresponde a otra solicitud de aprobación.' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  insert into public.ec_solicitudes_aprobacion
    (tipo, origen_id, solicitante_id, idempotency_key, snapshot, snapshot_hash)
  values ('purchase_contract', p_contrato_id, v_actor, p_idempotency_key, v_snapshot, v_hash)
  returning id into v_id;
  perform app_private._ec_insert_approval_event_v1(v_id, v_actor, 'solicitada', null, v_snapshot);
  return v_id;
end
$function$;

create or replace function public.ec_solicitar_aprobacion_conteo_fisico_v1(
  p_conteo_id uuid, p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_count public.ec_conteos_fisicos%rowtype;
  v_snapshot jsonb;
  v_hash text;
  v_id uuid;
  v_existing public.ec_solicitudes_aprobacion%rowtype;
begin
  if v_actor is null or not (public.tiene_permiso('inventario', 'crear') or public.tiene_permiso('inventario', 'editar')) then
    raise exception 'Se requiere permiso de Inventario para solicitar una revisión.' using errcode = '42501';
  end if;
  if p_conteo_id is null or nullif(btrim(p_idempotency_key), '') is null
     or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Conteo y clave de idempotencia válidos son obligatorios.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ec-aprobacion:' || p_idempotency_key, 0));
  select * into v_existing from public.ec_solicitudes_aprobacion where idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.tipo <> 'physical_count' or v_existing.origen_id <> p_conteo_id then
      raise exception 'La clave ya corresponde a otra solicitud de aprobación.' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  select * into v_count from public.ec_conteos_fisicos where id = p_conteo_id for update;
  if not found or v_count.estado <> 'abierto' then
    raise exception 'El conteo no está abierto para solicitar revisión.' using errcode = '23514';
  end if;
  v_snapshot := app_private._ec_physical_count_snapshot_v1(p_conteo_id);
  if coalesce((v_snapshot->>'diferencias')::integer, 0) = 0 then
    raise exception 'Los conteos sin diferencias se cierran directamente.' using errcode = '23514';
  end if;
  v_hash := md5(v_snapshot::text);
  insert into public.ec_solicitudes_aprobacion
    (tipo, origen_id, solicitante_id, idempotency_key, snapshot, snapshot_hash)
  values ('physical_count', p_conteo_id, v_actor, p_idempotency_key, v_snapshot, v_hash)
  returning id into v_id;
  update public.ec_conteos_fisicos set estado = 'pendiente_aprobacion' where id = p_conteo_id;
  perform app_private._ec_insert_approval_event_v1(v_id, v_actor, 'solicitada', null, v_snapshot);
  return v_id;
end
$function$;

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

create or replace function public.ec_cerrar_conteo_sin_diferencias_v1(
  p_conteo_id uuid, p_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null
     or not (public.tiene_permiso('inventario', 'crear') or public.tiene_permiso('inventario', 'editar')) then
    raise exception 'Sin permiso para cerrar inventario físico.' using errcode = '42501';
  end if;
  if exists (select 1 from public.ec_conteo_lineas l where l.conteo_id = p_conteo_id and l.stock_contado <> l.stock_sistema) then
    raise exception 'Este conteo tiene diferencias y requiere aprobación de otra persona.' using errcode = '42501';
  end if;
  return public.ec_cerrar_inventario_fisico(p_conteo_id, p_key);
end
$function$;

-- Extend the physical-count lifecycle without changing any existing rows.
alter table public.ec_conteos_fisicos drop constraint if exists ec_conteos_fisicos_estado_check;
alter table public.ec_conteos_fisicos
  add constraint ec_conteos_fisicos_estado_check
  check (estado in ('abierto', 'pendiente_aprobacion', 'cerrado', 'rechazado'));

-- The privileged business writers stay callable only from the approval RPC.
-- Historical CSV imports use their own import permission and transaction.
revoke all on function public.crear_orden_compra_operativa_v4(uuid, text, date, numeric, jsonb, text, text, numeric) from public, anon, authenticated;
revoke all on function public.convertir_solicitud_a_orden_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.crear_orden_compra_desde_contrato_v1(uuid, uuid, text, date, jsonb, text, numeric) from public, anon, authenticated;
revoke all on function public.ec_cerrar_inventario_fisico(uuid, text) from public, anon, authenticated;

do $revoke_legacy$
declare v_proc regprocedure;
begin
  foreach v_proc in array array[
    to_regprocedure('public.crear_orden_compra_operativa(uuid,text,date,numeric,jsonb,text)'),
    to_regprocedure('public.crear_orden_compra_operativa_v2(uuid,text,date,numeric,jsonb,text)'),
    to_regprocedure('public.crear_orden_compra_operativa_v3(uuid,text,date,numeric,jsonb,text,text,numeric)')
  ] loop
    if v_proc is not null then
      execute format('revoke all on function %s from public, anon, authenticated', v_proc);
    end if;
  end loop;
end
$revoke_legacy$;

revoke all on function public.ec_solicitar_aprobacion_orden_manual_v1(uuid, text, date, numeric, jsonb, text, text, numeric) from public, anon;
revoke all on function public.ec_solicitar_aprobacion_conversion_compra_v1(uuid, text) from public, anon;
revoke all on function public.ec_solicitar_aprobacion_orden_contrato_v1(uuid, uuid, text, date, jsonb, text, numeric) from public, anon;
revoke all on function public.ec_solicitar_aprobacion_conteo_fisico_v1(uuid, text) from public, anon;
revoke all on function public.ec_decidir_aprobacion_v1(uuid, boolean, text) from public, anon;
revoke all on function public.ec_cerrar_conteo_sin_diferencias_v1(uuid, text) from public, anon;
revoke all on function app_private._crear_orden_compra_operativa(uuid, text, date, numeric, jsonb, text) from public, anon, authenticated;
revoke all on function app_private._crear_orden_compra_operativa_v2(uuid, text, date, numeric, jsonb, text) from public, anon, authenticated;
grant execute on function public.ec_solicitar_aprobacion_orden_manual_v1(uuid, text, date, numeric, jsonb, text, text, numeric) to authenticated;
grant execute on function public.ec_solicitar_aprobacion_conversion_compra_v1(uuid, text) to authenticated;
grant execute on function public.ec_solicitar_aprobacion_orden_contrato_v1(uuid, uuid, text, date, jsonb, text, numeric) to authenticated;
grant execute on function public.ec_solicitar_aprobacion_conteo_fisico_v1(uuid, text) to authenticated;
grant execute on function public.ec_decidir_aprobacion_v1(uuid, boolean, text) to authenticated;
grant execute on function public.ec_cerrar_conteo_sin_diferencias_v1(uuid, text) to authenticated;

-- Keep the legacy CSV path for backfilling history, but do not let the ordinary
-- order-creation permission call it as an alternate live-order writer.
create or replace function app_private._importar_compras_historicas_v1(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid := (select auth.uid());
  v_row jsonb;
  v_line integer;
  v_code text;
  v_ref text;
  v_supplier_code text;
  v_supplier_id uuid;
  v_supplier_name text;
  v_detail text;
  v_amount numeric(14,2);
  v_status text;
  v_date date;
  v_due date;
  v_comprobante_tipo text;
  v_comprobante_numero text;
  v_skipped jsonb := '[]'::jsonb;
  v_created integer := 0;
begin
  if v_uid is null or not (select public.tiene_permiso('compras','importar')) then
    raise exception 'Se requiere permiso de importación histórica de Compras.' using errcode='42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then
    raise exception 'El archivo debe contener una lista de hasta 500 compras.' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_to_recordset(p_rows) as x(codigo text)
    group by lower(trim(coalesce(x.codigo,''))) having count(*)>1
  ) then raise exception 'El lote contiene códigos de compra duplicados.' using errcode='22023'; end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_line := nullif(v_row->>'line','')::integer;
    v_code := nullif(trim(v_row->>'codigo'),'');
    v_ref := 'IMP-' || coalesce(v_code,'');
    v_supplier_code := nullif(trim(v_row->>'proveedor_codigo'),'');
    v_supplier_name := nullif(trim(v_row->>'proveedor_nombre'),'');
    v_detail := coalesce(v_row->>'detalle','');
    v_amount := nullif(v_row->>'monto','')::numeric;
    v_status := coalesce(nullif(v_row->>'estado',''),'Solicitud');
    v_date := nullif(v_row->>'fecha','')::date;
    v_due := nullif(v_row->>'fecha_limite','')::date;
    v_comprobante_tipo := nullif(trim(v_row->>'comprobante_tipo'),'');
    v_comprobante_numero := nullif(trim(v_row->>'comprobante_numero'),'');

    if v_line is null or v_code is null or length(v_code)<2 or length(v_code)>100
       or v_supplier_name is null or length(v_supplier_name)<2
       or v_amount is null or v_amount<0 or v_amount::text in ('NaN','Infinity','-Infinity')
       or v_status not in ('Pendiente','Solicitud','Orden','Recibida','Recepción','Factura','Pagada') then
      raise exception 'Línea %: hay campos obligatorios o valores inválidos.',coalesce(v_line,0) using errcode='22023';
    end if;
    if exists(select 1 from public.compras where codigo=v_ref) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('line',v_line,'reference',v_code,'reason','El código ya fue importado.'));
      continue;
    end if;
    v_supplier_id := null;
    if v_supplier_code is not null then
      select id into v_supplier_id from public.proveedores where codigo=v_supplier_code;
      if not found then raise exception 'Línea %: no existe el proveedor %.',v_line,v_supplier_code using errcode='23503'; end if;
    end if;
    insert into public.compras(
      codigo,proveedor_id,proveedor_nombre,detalle,monto,estado,created_at,fecha_limite,
      comprobante_tipo,comprobante_numero,estado_recepcion,requiere_recepcion,created_by
    ) values (
      v_ref,v_supplier_id,v_supplier_name,v_detail,round(v_amount,2),v_status::public.estado_registro,
      case when v_date is null then now() else v_date::timestamp at time zone 'UTC' end,
      v_due,v_comprobante_tipo,v_comprobante_numero,'completa',false,v_uid
    );
    v_created := v_created+1;
  end loop;
  return jsonb_build_object('created',v_created,'skipped',v_skipped);
end
$function$;

-- Purchase writers are exposed only through the approval RPCs above. Keep
-- browser roles read-only on headers and lines so a permissive legacy policy
-- or future default grant cannot create an order around the approval queue.
-- The historical CSV import remains available through its transaction-safe
-- RPC, which performs its own permission checks and runs as SECURITY DEFINER.
do $purchase_write_lockdown$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array['compras', 'detalle_compras'] loop
    execute format('alter table public.%I enable row level security', v_table);
    for v_policy in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = v_table and cmd <> 'SELECT'
    loop
      execute format('drop policy %I on public.%I', v_policy.policyname, v_table);
    end loop;
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select on table public.%I to authenticated', v_table);
  end loop;
end
$purchase_write_lockdown$;

comment on table public.ec_solicitudes_aprobacion is
  'Bandeja de aprobación V1: órdenes manuales, desde comparativo, desde contrato y conteos físicos con diferencias. Una persona distinta debe aprobar.';
comment on table public.ec_aprobacion_eventos is
  'Registro inmutable de solicitud y decisión de aprobaciones; las escrituras solo se realizan desde RPC autorizadas.';
comment on function public.ec_decidir_aprobacion_v1(uuid, boolean, text) is
  'Decide una solicitud con segregación de solicitante/aprobador y ejecuta la transición de negocio en la misma transacción.';

commit;

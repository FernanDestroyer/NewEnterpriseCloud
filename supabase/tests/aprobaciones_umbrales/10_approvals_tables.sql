-- Esquema mínimo que imita Supabase. 10_ y 12_ son extractos literales de 20261113113300_..._approvals_purchase_and_inventory_v1.sql.
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


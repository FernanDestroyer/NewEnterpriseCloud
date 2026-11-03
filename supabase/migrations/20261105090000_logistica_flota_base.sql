-- =============================================================================
-- ERP EnterpriseCloud · Módulo 06 Logística y Transporte · 6.2 Vehículos y conductores
--
-- Crea las tablas de flota que el frontend de Logística necesita antes de la
-- migración 20261104010000_despachos.sql:
--   · vehiculos              (placa única normalizada, SOAT y revisión técnica)
--   · conductores            (DNI único, licencia y categoría)
--   · asignaciones_vehiculo  (ventana de uso; sin cruces por vehículo/conductor)
--
-- Reglas de negocio replicadas en el servidor (ver src/modules/logistica/rules.ts):
--   · placa única, DNI único;
--   · un vehículo o conductor no puede tener dos asignaciones «programada» que se crucen;
--   · SOAT, revisión técnica y licencia vigentes al fin de la asignación;
--   · vehículo y conductor activos;
--   · categoría de licencia compatible con el tipo de vehículo.
--
-- Permisos: logistica:ver / crear / editar (mismas filas que exigen las políticas RLS).
-- Auditoría: trigger fn_auditar y set_updated_at, igual que el resto de tablas de negocio.
-- Es idempotente.
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1) Catálogo de vehículos
-- ---------------------------------------------------------------------------
create table if not exists public.vehiculos (
  id                 uuid primary key default gen_random_uuid(),
  placa              text not null check (length(btrim(placa)) between 6 and 8),
  tipo               text not null default 'furgoneta'
                       check (tipo in ('moto', 'furgoneta', 'camion', 'otro')),
  marca              text not null default '',
  modelo             text not null default '',
  capacidad_kg       numeric(10,2) not null default 0
                       check (capacidad_kg > 0 and capacidad_kg <= 100000),
  propiedad          text not null default 'propio'
                       check (propiedad in ('propio', 'tercero')),
  transportista      text not null default '',
  soat_vence         date,
  revision_vence     date,
  estado             text not null default 'activo'
                       check (estado in ('activo', 'mantenimiento', 'inactivo')),
  observaciones      text not null default '',
  created_by         uuid references public.usuarios(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- La aplicación normaliza la placa a ABC-123; la unicidad se valida sin guiones.
create unique index if not exists vehiculos_placa_uk
  on public.vehiculos (upper(replace(placa, '-', '')));
create index if not exists vehiculos_estado_idx on public.vehiculos (estado);

-- ---------------------------------------------------------------------------
-- 2) Catálogo de conductores
-- ---------------------------------------------------------------------------
create table if not exists public.conductores (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null check (length(btrim(nombre)) >= 3),
  documento          text not null check (documento ~ '^[0-9]{8}$'),
  telefono           text not null default '',
  licencia_numero    text not null check (length(btrim(licencia_numero)) >= 4),
  licencia_categoria text not null
                       check (licencia_categoria in ('A-I','A-IIa','A-IIb','A-IIIa','A-IIIb','A-IIIc','B-I','B-IIa','B-IIb','B-IIc')),
  licencia_vence     date not null,
  estado             text not null default 'activo'
                       check (estado in ('activo', 'inactivo')),
  observaciones      text not null default '',
  created_by         uuid references public.usuarios(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists conductores_documento_uk
  on public.conductores (documento);
create index if not exists conductores_estado_idx on public.conductores (estado);

-- ---------------------------------------------------------------------------
-- 3) Asignaciones de vehículo y conductor
-- ---------------------------------------------------------------------------
create table if not exists public.asignaciones_vehiculo (
  id                 uuid primary key default gen_random_uuid(),
  vehiculo_id        uuid not null references public.vehiculos(id) on delete restrict,
  conductor_id       uuid not null references public.conductores(id) on delete restrict,
  -- Hora local de Lima (YYYY-MM-DDTHH:mm), igual que despachos.desde/hasta.
  desde              timestamp without time zone not null,
  hasta              timestamp without time zone not null,
  referencia         text not null default '',
  -- Se enlaza al despacho cuando la planificación lo crea (sin FK para no bloquear el orden de guardado).
  despacho_id        uuid,
  estado             text not null default 'programada'
                       check (estado in ('programada', 'completada', 'cancelada')),
  motivo_cancelacion text not null default '',
  created_by         uuid references public.usuarios(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint asignaciones_vehiculo_rango check (hasta > desde),
  constraint asignaciones_vehiculo_cancelada_motivo
    check (estado <> 'cancelada' or length(btrim(motivo_cancelacion)) > 0)
);

create index if not exists asignaciones_vehiculo_idx
  on public.asignaciones_vehiculo (vehiculo_id, desde desc);
create index if not exists asignaciones_conductor_idx
  on public.asignaciones_vehiculo (conductor_id, desde desc);
create index if not exists asignaciones_estado_idx
  on public.asignaciones_vehiculo (estado);

-- Sin cruces: solo las asignaciones «programada» reservan el vehículo/conductor.
do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.asignaciones_vehiculo'::regclass
      and conname = 'vehiculo_sin_cruce'
  ) then
    alter table public.asignaciones_vehiculo
      add constraint vehiculo_sin_cruce exclude using gist (
        vehiculo_id with =,
        tsrange(desde, hasta) with &&
      ) where (estado = 'programada');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.asignaciones_vehiculo'::regclass
      and conname = 'conductor_sin_cruce'
  ) then
    alter table public.asignaciones_vehiculo
      add constraint conductor_sin_cruce exclude using gist (
        conductor_id with =,
        tsrange(desde, hasta) with &&
      ) where (estado = 'programada');
  end if;
end
$migration$;

-- ---------------------------------------------------------------------------
-- 4) Reglas de vigencia y compatibilidad (replicadas en el servidor)
-- ---------------------------------------------------------------------------
create or replace function app_private._validar_asignacion_vehiculo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_vehiculo public.vehiculos%rowtype;
  v_conductor public.conductores%rowtype;
  v_fin date;
  v_categorias_camion constant text[] := array['A-IIb','A-IIIa','A-IIIb','A-IIIc'];
begin
  if new.estado <> 'programada' then
    return new;
  end if;

  select * into v_vehiculo from public.vehiculos where id = new.vehiculo_id;
  if not found then
    raise exception 'El vehículo seleccionado no existe.' using errcode = '23514';
  end if;
  select * into v_conductor from public.conductores where id = new.conductor_id;
  if not found then
    raise exception 'El conductor seleccionado no existe.' using errcode = '23514';
  end if;

  if v_vehiculo.estado <> 'activo' then
    raise exception 'El vehículo % está en estado «%».', v_vehiculo.placa, v_vehiculo.estado using errcode = '23514';
  end if;
  if v_conductor.estado <> 'activo' then
    raise exception '% está inactivo.', v_conductor.nombre using errcode = '23514';
  end if;

  v_fin := new.hasta::date;
  if v_vehiculo.soat_vence is not null and v_vehiculo.soat_vence < v_fin then
    raise exception 'El SOAT del vehículo % vence el %, antes del fin de la asignación.',
      v_vehiculo.placa, to_char(v_vehiculo.soat_vence, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  if v_vehiculo.revision_vence is not null and v_vehiculo.revision_vence < v_fin then
    raise exception 'La revisión técnica del vehículo % vence el %, antes del fin de la asignación.',
      v_vehiculo.placa, to_char(v_vehiculo.revision_vence, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  if v_conductor.licencia_vence < v_fin then
    raise exception 'La licencia de % vence el %, antes del fin de la asignación.',
      v_conductor.nombre, to_char(v_conductor.licencia_vence, 'DD/MM/YYYY') using errcode = '23514';
  end if;

  if not (
    case v_vehiculo.tipo
      when 'moto' then left(v_conductor.licencia_categoria, 1) = 'B'
      when 'furgoneta' then left(v_conductor.licencia_categoria, 1) = 'A'
      when 'camion' then v_conductor.licencia_categoria = any (v_categorias_camion)
      else true
    end
  ) then
    raise exception 'La licencia % de % no habilita conducir un vehículo tipo %.',
      v_conductor.licencia_categoria, v_conductor.nombre, v_vehiculo.tipo using errcode = '23514';
  end if;

  return new;
end
$function$;
revoke all on function app_private._validar_asignacion_vehiculo() from public, anon;

drop trigger if exists trg_validar_asignacion_vehiculo on public.asignaciones_vehiculo;
create trigger trg_validar_asignacion_vehiculo
  before insert or update of vehiculo_id, conductor_id, desde, hasta, estado
  on public.asignaciones_vehiculo
  for each row execute function app_private._validar_asignacion_vehiculo();

-- ---------------------------------------------------------------------------
-- 5) updated_at + auditoría
-- ---------------------------------------------------------------------------
drop trigger if exists trg_updated_at on public.vehiculos;
create trigger trg_updated_at before update on public.vehiculos
  for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.conductores;
create trigger trg_updated_at before update on public.conductores
  for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.asignaciones_vehiculo;
create trigger trg_updated_at before update on public.asignaciones_vehiculo
  for each row execute function public.set_updated_at();

drop trigger if exists trg_auditoria on public.vehiculos;
create trigger trg_auditoria after insert or update or delete on public.vehiculos
  for each row execute function public.fn_auditar();
drop trigger if exists trg_auditoria on public.conductores;
create trigger trg_auditoria after insert or update or delete on public.conductores
  for each row execute function public.fn_auditar();
drop trigger if exists trg_auditoria on public.asignaciones_vehiculo;
create trigger trg_auditoria after insert or update or delete on public.asignaciones_vehiculo
  for each row execute function public.fn_auditar();

-- ---------------------------------------------------------------------------
-- 6) Permisos del módulo
-- ---------------------------------------------------------------------------
insert into public.permisos (modulo, accion) values
  ('logistica', 'ver'), ('logistica', 'crear'), ('logistica', 'editar')
on conflict (modulo, accion) do nothing;

-- ---------------------------------------------------------------------------
-- 7) RLS y privilegios de API
-- ---------------------------------------------------------------------------
alter table public.vehiculos enable row level security;
alter table public.conductores enable row level security;
alter table public.asignaciones_vehiculo enable row level security;

drop policy if exists vehiculos_select on public.vehiculos;
drop policy if exists vehiculos_insert on public.vehiculos;
drop policy if exists vehiculos_update on public.vehiculos;
create policy vehiculos_select on public.vehiculos for select to authenticated
  using ((select app_private._tiene_permiso('logistica', 'ver')));
create policy vehiculos_insert on public.vehiculos for insert to authenticated
  with check ((select app_private._tiene_permiso('logistica', 'crear')));
create policy vehiculos_update on public.vehiculos for update to authenticated
  using ((select app_private._tiene_permiso('logistica', 'editar')))
  with check ((select app_private._tiene_permiso('logistica', 'editar')));

drop policy if exists conductores_select on public.conductores;
drop policy if exists conductores_insert on public.conductores;
drop policy if exists conductores_update on public.conductores;
create policy conductores_select on public.conductores for select to authenticated
  using ((select app_private._tiene_permiso('logistica', 'ver')));
create policy conductores_insert on public.conductores for insert to authenticated
  with check ((select app_private._tiene_permiso('logistica', 'crear')));
create policy conductores_update on public.conductores for update to authenticated
  using ((select app_private._tiene_permiso('logistica', 'editar')))
  with check ((select app_private._tiene_permiso('logistica', 'editar')));

drop policy if exists asignaciones_vehiculo_select on public.asignaciones_vehiculo;
drop policy if exists asignaciones_vehiculo_insert on public.asignaciones_vehiculo;
drop policy if exists asignaciones_vehiculo_update on public.asignaciones_vehiculo;
create policy asignaciones_vehiculo_select on public.asignaciones_vehiculo for select to authenticated
  using ((select app_private._tiene_permiso('logistica', 'ver')));
create policy asignaciones_vehiculo_insert on public.asignaciones_vehiculo for insert to authenticated
  with check ((select app_private._tiene_permiso('logistica', 'crear')));
create policy asignaciones_vehiculo_update on public.asignaciones_vehiculo for update to authenticated
  using ((select app_private._tiene_permiso('logistica', 'editar')))
  with check ((select app_private._tiene_permiso('logistica', 'editar')));

revoke all on public.vehiculos, public.conductores, public.asignaciones_vehiculo from anon;
revoke delete, truncate on public.vehiculos, public.conductores, public.asignaciones_vehiculo from authenticated;
grant select, insert, update on public.vehiculos, public.conductores, public.asignaciones_vehiculo to authenticated;

commit;

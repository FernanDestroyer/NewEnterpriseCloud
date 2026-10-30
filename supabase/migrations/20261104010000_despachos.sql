-- =============================================================================
-- ERP EnterpriseCloud · Módulo 06 Logística y Transporte · 6.1 Despachos y rutas
--
-- Guarda los despachos en la base de datos (antes vivían solo en el navegador).
-- Requiere haber aplicado antes las tablas de logística (vehiculos, conductores,
-- asignaciones_vehiculo) y la bitácora (fn_auditar).
-- Es idempotente: se puede volver a ejecutar sin duplicar ni romper nada.
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- =============================================================================
begin;

create table if not exists public.despachos (
  id                 uuid primary key default gen_random_uuid(),
  -- DSP-AAAAMMDD-NN: lo calcula la aplicación; la unicidad la garantiza la base.
  numero             text not null check (length(btrim(numero)) > 0),
  fecha              date not null,
  prioridad          text not null default 'normal' check (prioridad in ('normal','alta','urgente')),
  almacen_id         uuid references public.almacenes(id) on delete set null,
  almacen_nombre     text not null default '',
  peso_estimado_kg   numeric(12,2) check (peso_estimado_kg is null or peso_estimado_kg >= 0),
  observaciones      text not null default '',
  -- Las paradas ordenadas son la ruta; cada una guarda una copia de los datos de la venta al planificar.
  paradas            jsonb not null default '[]'::jsonb check (jsonb_typeof(paradas) = 'array'),
  vehiculo_id        uuid references public.vehiculos(id) on delete restrict,
  conductor_id       uuid references public.conductores(id) on delete restrict,
  -- Hora local de Lima (YYYY-MM-DDTHH:mm), igual que asignaciones_vehiculo.
  desde              timestamp without time zone,
  hasta              timestamp without time zone,
  -- Asignación creada en Vehículos y conductores al programar. Sin FK: la asignación se crea
  -- antes que el despacho y se enlazan por id (el trigger de validación ya protege la reserva).
  asignacion_id      uuid,
  estado             text not null default 'borrador'
                       check (estado in ('borrador','programado','en_ruta','completado','cancelado')),
  motivo_cancelacion text not null default '',
  created_by         uuid references public.usuarios(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint despachos_rango_check check (desde is null or hasta is null or hasta > desde),
  constraint despachos_cancelado_motivo
    check (estado <> 'cancelado' or length(btrim(motivo_cancelacion)) > 0)
);

create unique index if not exists despachos_numero_uk on public.despachos (numero);
create index if not exists despachos_fecha_idx on public.despachos (fecha desc);
create index if not exists despachos_estado_idx on public.despachos (estado);
create index if not exists despachos_vehiculo_idx on public.despachos (vehiculo_id);
create index if not exists despachos_conductor_idx on public.despachos (conductor_id);
create index if not exists despachos_almacen_idx on public.despachos (almacen_id);

drop trigger if exists trg_updated_at on public.despachos;
create trigger trg_updated_at before update on public.despachos
  for each row execute function public.set_updated_at();

-- RLS con el mismo permiso que vehículos y conductores (módulo «logistica»).
-- No hay borrado: los despachos se cancelan.
alter table public.despachos enable row level security;

drop policy if exists despachos_select on public.despachos;
drop policy if exists despachos_insert on public.despachos;
drop policy if exists despachos_update on public.despachos;
create policy despachos_select on public.despachos for select to authenticated
  using ((select app_private._tiene_permiso('logistica', 'ver')));
create policy despachos_insert on public.despachos for insert to authenticated
  with check ((select app_private._tiene_permiso('logistica', 'crear')));
create policy despachos_update on public.despachos for update to authenticated
  using ((select app_private._tiene_permiso('logistica', 'editar')))
  with check ((select app_private._tiene_permiso('logistica', 'editar')));

revoke all on public.despachos from anon;
revoke delete on public.despachos from authenticated;
grant select, insert, update on public.despachos to authenticated;

-- Bitácora: mismo trigger que el resto de tablas de negocio.
drop trigger if exists trg_auditoria on public.despachos;
create trigger trg_auditoria after insert or update or delete on public.despachos
  for each row execute function public.fn_auditar();

commit;

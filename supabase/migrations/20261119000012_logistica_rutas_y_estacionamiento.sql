-- 20261119000012_logistica_rutas_y_estacionamiento.sql
-- ERP EnterpriseCloud · Módulo 06 Logística y Transporte · Mapa, estacionamiento y repertorio de rutas

create table if not exists public.logistica_estacionamientos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (length(btrim(nombre)) > 0),
  direccion  text not null default '',
  distrito   text not null default '',
  referencia text not null default '',
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  activo     boolean not null default true,
  created_by uuid references public.usuarios(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists logistica_estacionamientos_activo_idx
  on public.logistica_estacionamientos (activo desc, updated_at desc);

drop trigger if exists trg_updated_at on public.logistica_estacionamientos;
create trigger trg_updated_at before update on public.logistica_estacionamientos
  for each row execute function public.set_updated_at();

drop trigger if exists trg_auditoria on public.logistica_estacionamientos;
create trigger trg_auditoria after insert or update or delete on public.logistica_estacionamientos
  for each row execute function public.fn_auditar();

alter table public.logistica_estacionamientos enable row level security;

drop policy if exists logistica_estacionamientos_select on public.logistica_estacionamientos;
drop policy if exists logistica_estacionamientos_insert on public.logistica_estacionamientos;
drop policy if exists logistica_estacionamientos_update on public.logistica_estacionamientos;
drop policy if exists logistica_estacionamientos_delete on public.logistica_estacionamientos;

create policy logistica_estacionamientos_select on public.logistica_estacionamientos
  for select to authenticated
  using ((select app_private._tiene_permiso('logistica', 'ver')));

create policy logistica_estacionamientos_insert on public.logistica_estacionamientos
  for insert to authenticated
  with check ((select app_private._tiene_permiso('logistica', 'crear')));

create policy logistica_estacionamientos_update on public.logistica_estacionamientos
  for update to authenticated
  using ((select app_private._tiene_permiso('logistica', 'editar')))
  with check ((select app_private._tiene_permiso('logistica', 'editar')));

create policy logistica_estacionamientos_delete on public.logistica_estacionamientos
  for delete to authenticated
  using ((select app_private._tiene_permiso('logistica', 'editar')));

revoke all on public.logistica_estacionamientos from anon;
grant select, insert, update, delete on public.logistica_estacionamientos to authenticated;

insert into public.logistica_estacionamientos (
  nombre,
  direccion,
  distrito,
  referencia,
  lat,
  lng,
  activo,
  created_by
)
select
  'Estacionamiento Base · Flota Lima',
  'Av. Antúnez de Mayolo 850, Los Olivos',
  'Los Olivos',
  'Base operativa principal de salida y retorno de unidades',
  -11.991800,
  -77.071400,
  true,
  null
where not exists (
  select 1 from public.logistica_estacionamientos where activo = true
);

create table if not exists public.logistica_rutas (
  id                     uuid primary key default gen_random_uuid(),
  nombre                 text not null check (length(btrim(nombre)) > 0),
  fecha                  date not null default current_date,
  almacen_id             uuid references public.almacenes(id) on delete set null,
  almacen_nombre         text not null default '',
  estacionamiento_id     uuid references public.logistica_estacionamientos(id) on delete set null,
  estacionamiento_nombre text not null default '',
  estacionamiento_lat    double precision not null check (estacionamiento_lat between -90 and 90),
  estacionamiento_lng    double precision not null check (estacionamiento_lng between -180 and 180),
  conductor_id           uuid references public.conductores(id) on delete set null,
  conductor_nombre       text not null default '',
  vehiculo_id            uuid references public.vehiculos(id) on delete set null,
  vehiculo_placa         text not null default '',
  despacho_id            uuid references public.despachos(id) on delete set null,
  paradas                jsonb not null default '[]'::jsonb check (jsonb_typeof(paradas) = 'array'),
  retornar_base          boolean not null default false,
  distancia_total_km     numeric(10,2) not null default 0 check (distancia_total_km >= 0),
  tiempo_estimado_min    integer not null default 0 check (tiempo_estimado_min >= 0),
  observaciones          text not null default '',
  created_by             uuid references public.usuarios(id) on delete set null default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists logistica_rutas_fecha_idx
  on public.logistica_rutas (fecha desc, created_at desc);

create index if not exists logistica_rutas_conductor_idx
  on public.logistica_rutas (conductor_id);

create index if not exists logistica_rutas_vehiculo_idx
  on public.logistica_rutas (vehiculo_id);

create index if not exists logistica_rutas_despacho_idx
  on public.logistica_rutas (despacho_id);

create index if not exists logistica_rutas_estacionamiento_idx
  on public.logistica_rutas (estacionamiento_id);

drop trigger if exists trg_updated_at on public.logistica_rutas;
create trigger trg_updated_at before update on public.logistica_rutas
  for each row execute function public.set_updated_at();

drop trigger if exists trg_auditoria on public.logistica_rutas;
create trigger trg_auditoria after insert or update or delete on public.logistica_rutas
  for each row execute function public.fn_auditar();

alter table public.logistica_rutas enable row level security;

drop policy if exists logistica_rutas_select on public.logistica_rutas;
drop policy if exists logistica_rutas_insert on public.logistica_rutas;
drop policy if exists logistica_rutas_update on public.logistica_rutas;
drop policy if exists logistica_rutas_delete on public.logistica_rutas;

create policy logistica_rutas_select on public.logistica_rutas
  for select to authenticated
  using ((select app_private._tiene_permiso('logistica', 'ver')));

create policy logistica_rutas_insert on public.logistica_rutas
  for insert to authenticated
  with check ((select app_private._tiene_permiso('logistica', 'crear')));

create policy logistica_rutas_update on public.logistica_rutas
  for update to authenticated
  using ((select app_private._tiene_permiso('logistica', 'editar')))
  with check ((select app_private._tiene_permiso('logistica', 'editar')));

create policy logistica_rutas_delete on public.logistica_rutas
  for delete to authenticated
  using ((select app_private._tiene_permiso('logistica', 'editar')));

revoke all on public.logistica_rutas from anon;
grant select, insert, update, delete on public.logistica_rutas to authenticated;

-- Módulo 08: Metas y Objetivos (Arquitectura funcional AlvaPlast, submódulos 8.1–8.7).
-- Tablas: metas (definición), metas_asignaciones (por vendedor/sucursal/producto),
-- metas_cortes (avance con fecha de corte y fuente del dato).
begin;

create table if not exists public.metas (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  nombre         text not null,
  indicador      text not null default 'importe' check (indicador in ('importe','unidades')),
  valor_objetivo numeric(14,2) not null check (valor_objetivo > 0),
  fecha_inicio   date not null,
  fecha_fin      date not null check (fecha_fin > fecha_inicio),
  responsable    text,
  estado         text not null default 'vigente' check (estado in ('vigente','cerrada','inactiva')),
  created_by     uuid references public.usuarios(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.metas_asignaciones (
  id             uuid primary key default gen_random_uuid(),
  meta_id        uuid not null references public.metas(id) on delete cascade,
  alcance        text not null check (alcance in ('vendedor','sucursal','producto')),
  objetivo       text not null,
  valor_objetivo numeric(14,2) not null check (valor_objetivo > 0),
  estado         text not null default 'activa' check (estado in ('activa','inactiva')),
  created_by     uuid references public.usuarios(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.metas_cortes (
  id              uuid primary key default gen_random_uuid(),
  asignacion_id   uuid not null references public.metas_asignaciones(id) on delete cascade,
  fecha           date not null,
  valor_acumulado numeric(14,2) not null check (valor_acumulado >= 0),
  fuente          text,
  created_by      uuid references public.usuarios(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists metas_asignaciones_meta_idx on public.metas_asignaciones (meta_id);
create index if not exists metas_cortes_asignacion_idx on public.metas_cortes (asignacion_id);

-- Evitar asignaciones duplicadas del mismo objetivo dentro de la misma meta.
create unique index if not exists metas_asignaciones_unicas_idx
  on public.metas_asignaciones (meta_id, alcance, lower(objetivo));

drop trigger if exists trg_updated_at on public.metas;
create trigger trg_updated_at before update on public.metas
  for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.metas_asignaciones;
create trigger trg_updated_at before update on public.metas_asignaciones
  for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.metas_cortes;
create trigger trg_updated_at before update on public.metas_cortes
  for each row execute function public.set_updated_at();

-- Permisos del módulo (el frontend usa PERMISO_METAS = 'metas').
insert into public.permisos (modulo, accion) values
  ('metas','ver'), ('metas','crear'), ('metas','editar'), ('metas','eliminar')
on conflict (modulo, accion) do nothing;

alter table public.metas enable row level security;
alter table public.metas_asignaciones enable row level security;
alter table public.metas_cortes enable row level security;

drop policy if exists metas_select on public.metas;
drop policy if exists metas_insert on public.metas;
drop policy if exists metas_update on public.metas;
drop policy if exists metas_delete on public.metas;
create policy metas_select on public.metas for select to authenticated
  using ((select app_private._tiene_permiso('metas', 'ver')));
create policy metas_insert on public.metas for insert to authenticated
  with check ((select app_private._tiene_permiso('metas', 'crear')));
create policy metas_update on public.metas for update to authenticated
  using ((select app_private._tiene_permiso('metas', 'editar'))) with check (true);
create policy metas_delete on public.metas for delete to authenticated
  using ((select app_private._es_admin()));

drop policy if exists metas_asignaciones_select on public.metas_asignaciones;
drop policy if exists metas_asignaciones_insert on public.metas_asignaciones;
drop policy if exists metas_asignaciones_update on public.metas_asignaciones;
drop policy if exists metas_asignaciones_delete on public.metas_asignaciones;
create policy metas_asignaciones_select on public.metas_asignaciones for select to authenticated
  using ((select app_private._tiene_permiso('metas', 'ver')));
create policy metas_asignaciones_insert on public.metas_asignaciones for insert to authenticated
  with check ((select app_private._tiene_permiso('metas', 'crear')));
create policy metas_asignaciones_update on public.metas_asignaciones for update to authenticated
  using ((select app_private._tiene_permiso('metas', 'editar'))) with check (true);
create policy metas_asignaciones_delete on public.metas_asignaciones for delete to authenticated
  using ((select app_private._tiene_permiso('metas', 'eliminar')));

drop policy if exists metas_cortes_select on public.metas_cortes;
drop policy if exists metas_cortes_insert on public.metas_cortes;
drop policy if exists metas_cortes_delete on public.metas_cortes;
create policy metas_cortes_select on public.metas_cortes for select to authenticated
  using ((select app_private._tiene_permiso('metas', 'ver')));
create policy metas_cortes_insert on public.metas_cortes for insert to authenticated
  with check ((select app_private._tiene_permiso('metas', 'editar')));
create policy metas_cortes_delete on public.metas_cortes for delete to authenticated
  using ((select app_private._tiene_permiso('metas', 'eliminar')));

-- Los rol_permisos se asignan desde la pantalla de Permisos; el módulo queda disponible
-- para cualquier rol al que se le conceda metas:ver/crear/editar/eliminar.
commit;

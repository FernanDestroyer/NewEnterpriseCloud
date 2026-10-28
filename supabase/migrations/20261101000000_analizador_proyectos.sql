-- =============================================================================
-- ERP EnterpriseCloud · Analizador de proyectos
-- 1. Tabla analisis_proyectos para guardar los informes de los ZIP o
--    repositorios analizados (puntuaciones, hallazgos y servicios AWS).
-- 2. Permisos del módulo 'analizador' y matriz por rol.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

-- 1. Historial de análisis.
create table if not exists public.analisis_proyectos (
  id                      uuid primary key default gen_random_uuid(),
  nombre                  text not null,
  fuente                  text not null check (fuente in ('zip', 'enlace')),
  origen                  text not null default '',
  archivos                integer not null default 0 check (archivos >= 0),
  puntuacion_seguridad    integer not null default 0 check (puntuacion_seguridad between 0 and 100),
  puntuacion_escalabilidad integer not null default 0 check (puntuacion_escalabilidad between 0 and 100),
  puntuacion_cloud        integer not null default 0 check (puntuacion_cloud between 0 and 100),
  hallazgos               jsonb not null default '[]'::jsonb,
  servicios               jsonb not null default '[]'::jsonb,
  detalle                 jsonb not null default '{}'::jsonb,
  creado_por              text,
  created_at              timestamptz not null default now()
);
create index if not exists analisis_proyectos_created_at_idx
  on public.analisis_proyectos (created_at desc);

alter table public.analisis_proyectos enable row level security;
drop policy if exists analisis_proyectos_select on public.analisis_proyectos;
create policy analisis_proyectos_select on public.analisis_proyectos for select to authenticated
  using ((select public.tiene_permiso('analizador', 'ver')));
drop policy if exists analisis_proyectos_insert on public.analisis_proyectos;
create policy analisis_proyectos_insert on public.analisis_proyectos for insert to authenticated
  with check ((select public.tiene_permiso('analizador', 'crear')));
drop policy if exists analisis_proyectos_update on public.analisis_proyectos;
create policy analisis_proyectos_update on public.analisis_proyectos for update to authenticated
  using ((select public.tiene_permiso('analizador', 'editar')))
  with check ((select public.tiene_permiso('analizador', 'editar')));
drop policy if exists analisis_proyectos_delete on public.analisis_proyectos;
create policy analisis_proyectos_delete on public.analisis_proyectos for delete to authenticated
  using ((select public.tiene_permiso('analizador', 'eliminar')));

-- El rol anónimo (visitante sin sesión) no toca esta tabla.
revoke all on public.analisis_proyectos from anon;

-- 2. Permisos del módulo y matriz por rol.
insert into public.permisos (modulo, accion)
select 'analizador', a from unnest(array['ver','crear','editar','eliminar']) as a
on conflict (modulo, accion) do nothing;

with matriz(rol, modulo, acciones) as (values
  ('Administrador','analizador', array['ver','crear','editar','eliminar']),
  ('Gerente',      'analizador', array['ver','crear','editar','eliminar']),
  ('Operador',     'analizador', array['ver','crear']),
  ('Vendedor',     'analizador', array['ver']),
  ('Básico',       'analizador', array['ver'])
)
insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
from matriz m
join public.roles r on r.nombre = m.rol
join public.permisos p on p.modulo = m.modulo and p.accion = any (m.acciones)
on conflict do nothing;

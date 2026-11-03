-- =============================================================================
-- ERP EnterpriseCloud · Permisos de los módulos Metas y Logística
--
-- Las tablas de Metas (metas, metas_asignaciones, metas_cortes) y de Logística
-- (vehiculos, conductores, asignaciones_vehiculo, despachos) protegen sus datos
-- con RLS por los permisos metas:* y logistica:*. Sin filas en rol_permisos el
-- sidebar oculta los módulos y las políticas rechazan toda operación.
--
-- Asignación acordada (idempotente):
--   · Administrador: metas ver/crear/editar/eliminar + logistica ver/crear/editar
--   · Gerente:       metas ver/crear/editar + logistica ver/crear/editar
--   · Supervisor:    metas ver/crear/editar + logistica ver/crear/editar
--   · Operador:      logistica ver/crear/editar
--   · Vendedor:      metas ver
--   · Básico:        sin acceso
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- =============================================================================
begin;

insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
from public.roles r
join public.permisos p
  on ((p.modulo = 'metas' and p.accion in ('ver', 'crear', 'editar', 'eliminar'))
   or (p.modulo = 'logistica' and p.accion in ('ver', 'crear', 'editar')))
where r.nombre = 'Administrador'
on conflict do nothing;

insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
from public.roles r
join public.permisos p
  on ((p.modulo = 'metas' and p.accion in ('ver', 'crear', 'editar'))
   or (p.modulo = 'logistica' and p.accion in ('ver', 'crear', 'editar')))
where r.nombre in ('Gerente', 'Supervisor')
on conflict do nothing;

insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
from public.roles r
join public.permisos p
  on p.modulo = 'logistica' and p.accion in ('ver', 'crear', 'editar')
where r.nombre = 'Operador'
on conflict do nothing;

insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
from public.roles r
join public.permisos p
  on p.modulo = 'metas' and p.accion = 'ver'
where r.nombre = 'Vendedor'
on conflict do nothing;

commit;

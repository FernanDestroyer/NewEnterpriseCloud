-- Permitir una acción específica de importación, independiente de crear clientes.
alter table public.permisos drop constraint if exists permisos_accion_check;
alter table public.permisos
  add constraint permisos_accion_check
  check (accion in ('ver', 'crear', 'editar', 'eliminar', 'importar'));

insert into public.roles (nombre, descripcion)
values ('Supervisor', 'Supervisa la operación y puede importar clientes mediante archivos CSV')
on conflict (nombre) do update
  set descripcion = excluded.descripcion;

-- Registrar el permiso específico de importación.
insert into public.permisos (modulo, accion)
values ('clientes', 'importar')
on conflict (modulo, accion) do nothing;

-- Supervisor puede consultar y gestionar clientes, además de importar CSV.
insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
from public.roles r
cross join public.permisos p
where r.nombre = 'Supervisor'
  and p.modulo = 'clientes'
  and p.accion in ('ver', 'crear', 'editar', 'eliminar', 'importar')
on conflict do nothing;

-- Los roles existentes distintos de Vendedor también pueden importar.
-- El Vendedor queda explícitamente excluido aunque conserve permisos de creación.
insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
from public.roles r
join public.permisos p on p.modulo = 'clientes' and p.accion = 'importar'
where r.nombre <> 'Vendedor'
on conflict do nothing;

-- Elimina el permiso si accidentalmente se hubiera asignado al Vendedor.
delete from public.rol_permisos rp
using public.roles r, public.permisos p
where rp.rol_id = r.id
  and rp.permiso_id = p.id
  and r.nombre = 'Vendedor'
  and p.modulo = 'clientes'
  and p.accion = 'importar';

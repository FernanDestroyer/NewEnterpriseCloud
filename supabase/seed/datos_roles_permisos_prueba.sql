-- Roles y permisos MÍNIMOS para el proyecto de PRUEBAS (la copia del esquema no trae datos).
-- Idempotente: se puede ejecutar más de una vez. No usar en el proyecto original.
begin;

-- 1) Permisos: todos los módulos que usa la aplicación
insert into public.permisos (modulo, accion)
select m.modulo, a.accion
from (values ('compras'),('inventario'),('ventas'),('finanzas'),('configuracion'),('logistica'),
             ('metas'),('cotizaciones'),('proveedores'),('clientes'),('analizador'),('usuarios'),
             ('auditoria'),('aprobaciones')) as m(modulo)
cross join (values ('ver'),('crear'),('editar'),('eliminar'),('importar')) as a(accion)
on conflict (modulo, accion) do nothing;
insert into public.permisos (modulo, accion) values ('aprobaciones', 'aprobar')
on conflict (modulo, accion) do nothing;

-- 2) Roles
insert into public.roles (nombre, descripcion)
select v.nombre, v.descripcion
from (values
  ('Administrador', 'Acceso total (pruebas)'),
  ('Gerente', 'Acceso total, aprueba solicitudes (pruebas)'),
  ('Operador', 'Solicitante: compras e inventario, sin aprobar (pruebas)')
) as v(nombre, descripcion)
where not exists (select 1 from public.roles r where r.nombre = v.nombre);

-- 3) Permisos por rol
insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id from public.roles r cross join public.permisos p
where r.nombre in ('Administrador', 'Gerente')
  and not exists (select 1 from public.rol_permisos x where x.rol_id = r.id and x.permiso_id = p.id);

insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id from public.roles r join public.permisos p on
  (p.modulo in ('compras', 'inventario') and p.accion in ('ver', 'crear', 'editar'))
  or (p.modulo in ('aprobaciones', 'proveedores') and p.accion = 'ver')
where r.nombre = 'Operador'
  and not exists (select 1 from public.rol_permisos x where x.rol_id = r.id and x.permiso_id = p.id);

commit;

-- 4) Verificación: Operador 8 permisos, Gerente y Administrador 71 cada uno
select r.nombre, count(*) as permisos
from public.roles r join public.rol_permisos rp on rp.rol_id = r.id
group by r.nombre order by r.nombre;

-- =============================================================================
-- ERP EnterpriseCloud · Vendedor con acceso a Caja
-- Sin caja abierta no se pueden registrar ventas ni compras, así que el Vendedor
-- necesita operar turnos y generar sus CxC/CxP vinculadas.
--
-- Otorga al rol Vendedor (idempotente):
-- 1. finanzas ver/crear/editar -> ver Tesorería y Caja, abrir turno (crear),
--    cerrar turno (editar) y guardar ventas/compras con su cuenta vinculada.
-- 2. inventario editar -> mover stock al vender (el ver ya lo tenía).
-- 3. compras ver/crear/editar -> registrar órdenes de compra.
-- No otorga eliminar en ningún módulo (sigue restringido).
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- =============================================================================

insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
from public.roles r
join public.permisos p
  on ((p.modulo = 'finanzas' and p.accion in ('ver', 'crear', 'editar'))
   or (p.modulo = 'inventario' and p.accion = 'editar')
   or (p.modulo = 'compras' and p.accion in ('ver', 'crear', 'editar')))
where r.nombre = 'Vendedor'
on conflict do nothing;

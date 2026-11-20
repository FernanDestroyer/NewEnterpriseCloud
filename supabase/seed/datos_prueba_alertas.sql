-- Datos de ejemplo SOLO para un proyecto de PRUEBAS (nunca producción).
-- Crea (si no existen) 1 empresa, 1 sucursal, 1 almacén, 1 proveedor, 4 productos
-- y 14 días de salidas para que:
--   * puedas crear órdenes de compra (hay proveedor), y
--   * /notificaciones muestre alertas predictivas.
-- Es repetible: se puede ejecutar varias veces. Para quitar todo, ver el final.
-- Pegar en Supabase → SQL Editor → Run.
begin;

insert into public.empresas (codigo, razon_social, estado)
select 'SEED-EMP', 'Empresa de Prueba S.A.C.', 'Activo'
where not exists (select 1 from public.empresas where codigo = 'SEED-EMP');

insert into public.sucursales (empresa_id, codigo, nombre, estado)
select (select id from public.empresas where codigo = 'SEED-EMP'), 'SEED-SUC', 'Sucursal de Prueba', 'Activo'
where not exists (select 1 from public.sucursales where codigo = 'SEED-SUC');

insert into public.almacenes (nombre, ubicacion, responsable, sucursal_id)
select 'Almacén de Prueba', 'Lima', 'Pruebas', (select id from public.sucursales where codigo = 'SEED-SUC')
where not exists (select 1 from public.almacenes where nombre = 'Almacén de Prueba');

insert into public.proveedores (codigo, razon_social, detalle)
values ('SEED-PRV-001', 'Proveedor de Prueba S.A.C.', 'Datos de prueba')
on conflict (codigo) do nothing;

insert into public.productos (codigo, nombre, detalle, stock) values
  ('SEED-001', 'Cable UTP Cat6 (prueba)',  'Debe salir CRÍTICA (~4 días)',          40),
  ('SEED-002', 'Tuerca 1/2" (prueba)',     'Debe salir ATENCIÓN (~12 días)',        120),
  ('SEED-003', 'Guantes de seguridad (prueba)', 'Sin alerta (~50 días)',            500),
  ('SEED-004', 'Cinta aislante (prueba)',  'CRÍTICA: sin stock con demanda activa', 0)
on conflict (codigo) do update set stock = excluded.stock;

insert into public.inventarios (producto_id, almacen_id, cantidad)
select p.id, (select id from public.almacenes where nombre = 'Almacén de Prueba'), p.stock
from public.productos p where p.codigo like 'SEED-0%'
on conflict (producto_id, almacen_id) do update set cantidad = excluded.cantidad;

-- Salidas de los últimos 14 días (~10 u./día; la cinta ~3 u./día).
delete from public.movimientos_inventario where referencia = 'seed-predictivas';
insert into public.movimientos_inventario (producto_id, almacen_id, tipo, cantidad, referencia, created_at)
select p.id,
       (select id from public.almacenes where nombre = 'Almacén de Prueba'),
       'salida',
       case when p.codigo = 'SEED-004' then 3 else 9 + (d % 3) end,
       'seed-predictivas',
       now() - make_interval(days => d, hours => 2)
from public.productos p
cross join generate_series(0, 13) as d
where p.codigo like 'SEED-0%';

commit;

-- Para limpiar (opcional):
--   delete from public.movimientos_inventario where referencia = 'seed-predictivas';
--   delete from public.inventarios where almacen_id in (select id from public.almacenes where nombre = 'Almacén de Prueba');
--   delete from public.productos where codigo like 'SEED-0%';
--   delete from public.almacenes where nombre = 'Almacén de Prueba';
--   delete from public.sucursales where codigo = 'SEED-SUC';
--   delete from public.empresas where codigo = 'SEED-EMP';
--   delete from public.proveedores where codigo = 'SEED-PRV-001';

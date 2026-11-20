-- Vincula los productos de ejemplo (SEED-001..004) al proveedor de prueba para poder crear órdenes de compra.
-- Ejecutar DESPUÉS de datos_prueba_alertas.sql. Repetible.
insert into public.proveedor_productos (codigo, proveedor_id, nombre, detalle, costo, producto_id)
select 'SEED-CAT-' || right(p.codigo, 3),
       (select id from public.proveedores where codigo = 'SEED-PRV-001'),
       p.nombre, 'Catálogo de prueba',
       case p.codigo when 'SEED-001' then 100 when 'SEED-002' then 50 when 'SEED-003' then 20 else 10 end,
       p.id
from public.productos p
where p.codigo like 'SEED-0%'
on conflict (codigo) do nothing;

select pp.codigo, pp.nombre, pp.costo from public.proveedor_productos pp
where pp.codigo like 'SEED-CAT-%' order by pp.codigo;

-- Índices de cobertura para las claves foráneas recién señaladas por Advisor.
begin;
create index if not exists detalle_recepciones_compra_producto_idx on public.detalle_recepciones_compra(producto_id);
create index if not exists movimientos_tesoreria_anulado_por_idx on public.movimientos_tesoreria(anulado_por) where anulado_por is not null;
create index if not exists movimientos_tesoreria_created_by_idx on public.movimientos_tesoreria(created_by) where created_by is not null;
create index if not exists recepciones_compra_almacen_idx on public.recepciones_compra(almacen_id);
create index if not exists recepciones_compra_recibido_por_idx on public.recepciones_compra(recibido_por) where recibido_por is not null;
create index if not exists sucursales_created_by_idx on public.sucursales(created_by) where created_by is not null;
create index if not exists zonas_created_by_idx on public.zonas(created_by) where created_by is not null;
create index if not exists zonas_clientes_cliente_idx on public.zonas_clientes(cliente_id);
create index if not exists zonas_sucursales_sucursal_idx on public.zonas_sucursales(sucursal_id);
commit;
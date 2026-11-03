-- Fix import SQL to resolve inventory products through the supplier catalog.
-- detalle_compras stores proveedor_producto_id; it has no producto_id column.
begin;

do $fix_import_link_product_lookup$
declare
  v_definition text;
  v_old text := 'from public.detalle_compras d where d.compra_id=p_compra_id and d.producto_id is not null and d.cantidad>0';
  v_new text := 'from public.detalle_compras d join public.proveedor_productos pp on pp.id=d.proveedor_producto_id where d.compra_id=p_compra_id and pp.producto_id is not null and d.cantidad>0';
begin
  select pg_get_functiondef('public.vincular_orden_importacion_v1(uuid,uuid,text)'::regprocedure)
    into v_definition;
  if position('pp.producto_id is not null' in v_definition)>0 then return; end if;
  if position(v_old in v_definition)=0 then
    raise exception 'No se reconoció la validación de producto del RPC de vinculación; migración abortada.';
  end if;
  execute replace(v_definition,v_old,v_new);
end
$fix_import_link_product_lookup$;

do $fix_import_landed_preview_product_lookup$
declare
  v_definition text;
  v_old_join text := 'join public.detalle_compras d on d.compra_id=oi.compra_id';
begin
  select pg_get_functiondef('public.calcular_prorrateo_importacion_v1(uuid)'::regprocedure)
    into v_definition;
  if position('pp.producto_id' in v_definition)>0 then return; end if;
  if position(v_old_join in v_definition)=0 or position('d.producto_id' in v_definition)=0 then
    raise exception 'No se reconoció la consulta de líneas del preview de importación; migración abortada.';
  end if;
  v_definition:=replace(v_definition,'d.producto_id','pp.producto_id');
  v_definition:=replace(v_definition,v_old_join,
    v_old_join||' join public.proveedor_productos pp on pp.id=d.proveedor_producto_id');
  execute v_definition;
end
$fix_import_landed_preview_product_lookup$;

do $fix_import_nationalization_product_lookup$
declare
  v_definition text;
  v_old_join text := 'join public.detalle_compras d on d.compra_id=oi.compra_id';
  v_old_predicate text := 'where oi.carpeta_id=p_carpeta_id and d.producto_id is null';
  v_new_predicate text := 'where oi.carpeta_id=p_carpeta_id and pp.producto_id is null';
begin
  select pg_get_functiondef('public.nacionalizar_carpeta_importacion_v1(uuid,uuid,text,text)'::regprocedure)
    into v_definition;
  if position('left join public.proveedor_productos pp on pp.id=d.proveedor_producto_id' in v_definition)>0 then return; end if;
  if position(v_old_join in v_definition)=0 or position(v_old_predicate in v_definition)=0 then
    raise exception 'No se reconoció la validación de productos del RPC de nacionalización; migración abortada.';
  end if;
  v_definition:=replace(v_definition,v_old_join,
    v_old_join||' left join public.proveedor_productos pp on pp.id=d.proveedor_producto_id');
  v_definition:=replace(v_definition,v_old_predicate,v_new_predicate);
  execute v_definition;
end
$fix_import_nationalization_product_lookup$;

notify pgrst, 'reload schema';
commit;

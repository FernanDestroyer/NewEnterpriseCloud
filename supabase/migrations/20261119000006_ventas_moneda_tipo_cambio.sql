-- La facturación de pedidos en USD debe conservar la moneda y el tipo de cambio
-- del pedido en la venta. Antes, ventas.moneda/tipo_cambio usaban sus valores
-- por defecto (PEN/1) aunque el comprobante y la CxC sí eran USD.

create or replace function public.ec_facturar_pedido(p_pedido_id uuid,p_tipo text,p_serie text,p_numero integer,p_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_order public.ec_pedidos%rowtype; v_sale uuid; v_name text; v_base numeric; v_igv numeric; v_line jsonb; v_old public.ec_operaciones%rowtype; v_hash text;
begin
 if auth.uid() is null or not public.tiene_permiso('ventas','crear') then raise exception 'Sin permiso de ventas.' using errcode='42501'; end if;
 if nullif(trim(p_key),'') is null or p_tipo not in ('01','03') or p_serie !~ '^[A-Z0-9]{4}$' or p_numero is null or p_numero<=0 then raise exception 'Comprobante o clave inválidos.'; end if;
 v_hash:=md5(jsonb_build_object('pedido',p_pedido_id,'tipo',p_tipo,'serie',p_serie,'numero',p_numero)::text);
 perform pg_advisory_xact_lock(hashtextextended('ec:invoice:'||p_key,0));
 select * into v_old from public.ec_operaciones where clave=p_key;
 if found then if v_old.tipo<>'factura' or v_old.hash<>v_hash then raise exception 'Clave reutilizada.' using errcode='23505'; end if; return v_old.id; end if;
 select * into v_order from public.ec_pedidos where id=p_pedido_id for update;
 if not found or v_order.estado<>'reservado' then raise exception 'El pedido ya fue facturado o no existe.'; end if;
 select razon_social into v_name from public.clientes where id=v_order.cliente_id;
 if p_tipo='01' and not exists(select 1 from public.clientes where id=v_order.cliente_id and tipo_doc='RUC' and length(documento)=11) then raise exception 'Factura requiere cliente con RUC.'; end if;
 select sum((x->>'base')::numeric),sum((x->>'igv')::numeric) into v_base,v_igv from jsonb_array_elements(v_order.lineas) x;
 insert into public.ventas(cliente_id,cliente_nombre,detalle,monto,estado,almacen_id,idempotency_key,payload_hash,moneda,tipo_cambio)
 values(v_order.cliente_id,v_name,p_serie||'-'||p_numero,v_order.total,'Pendiente',v_order.almacen_id,'ec:'||p_key,v_hash,v_order.moneda,v_order.tipo_cambio) returning id into v_sale;
 for v_line in select value from jsonb_array_elements(v_order.lineas) loop
  insert into public.detalle_ventas(venta_id,producto_id,cantidad,precio_unitario) values(v_sale,(v_line->>'producto_id')::uuid,(v_line->>'cantidad')::integer,(v_line->>'precio')::numeric);
 end loop;
 insert into public.pagos(tipo,contraparte,detalle,monto,estado,venta_id,moneda,exchange_rate)
 values('cobrar',v_name,'CxC '||p_serie||'-'||p_numero,v_order.total,'Pendiente',v_sale,v_order.moneda,v_order.tipo_cambio);
 insert into public.ec_comprobantes(venta_id,tipo,serie,numero,moneda,tipo_cambio,base,igv,total,snapshot)
 values(v_sale,p_tipo,p_serie,p_numero,v_order.moneda,v_order.tipo_cambio,v_base,v_igv,v_order.total,jsonb_build_object('cliente',v_name,'lineas',v_order.lineas));
 update public.ec_pedidos set estado='facturado',venta_id=v_sale where id=p_pedido_id;
 insert into public.ec_operaciones(clave,tipo,hash,id) values(p_key,'factura',v_hash,v_sale);
 return v_sale;
end $$;

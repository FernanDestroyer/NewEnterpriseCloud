-- Ventas v1. Ejecutar entero, una vez aplicadas las migraciones anteriores.
-- Precios unitarios incluyen IGV. No envía documentos a SUNAT.
begin;
create sequence if not exists public.seq_ec_pedidos;
create sequence if not exists public.seq_ec_guias;
create sequence if not exists public.seq_ec_nc;

create table if not exists public.ec_sunat_documentos (codigo text primary key, nombre text not null);
insert into public.ec_sunat_documentos values ('01','Factura'),('03','Boleta'),('07','Nota de crédito'),('09','Guía de remisión remitente') on conflict do nothing;
create table if not exists public.ec_sunat_afectaciones (codigo text primary key, nombre text not null, tasa numeric(5,2) not null);
insert into public.ec_sunat_afectaciones values ('10','Gravado - operación onerosa',18),('20','Exonerado - operación onerosa',0),('30','Inafecto - operación onerosa',0) on conflict do nothing;

create table if not exists public.ec_cotizaciones (
 id uuid primary key default gen_random_uuid(), cliente_id uuid not null references public.clientes(id),
 version integer not null default 1 check(version>0), estado text not null default 'borrador' check(estado in ('borrador','vigente','convertida','anulada')),
 vence_el date not null, moneda text not null check(moneda in ('PEN','USD')), tipo_cambio numeric(14,6) not null check(tipo_cambio>0),
 lineas jsonb not null, total numeric(14,2) not null default 0, created_by uuid not null default auth.uid(), created_at timestamptz not null default now(),
 check(jsonb_typeof(lineas)='array')
);
create table if not exists public.ec_cotizacion_versiones (
 cotizacion_id uuid not null references public.ec_cotizaciones(id), version integer not null,
 cliente_id uuid not null references public.clientes(id), moneda text not null, tipo_cambio numeric(14,6) not null,
 lineas jsonb not null, total numeric(14,2) not null, vence_el date not null,
 created_at timestamptz not null default now(), primary key(cotizacion_id,version)
);
create table if not exists public.ec_pedidos (
 id uuid primary key default gen_random_uuid(), codigo text not null unique default ('PV-'||lpad(nextval('public.seq_ec_pedidos')::text,6,'0')),
 cotizacion_id uuid references public.ec_cotizaciones(id), cliente_id uuid not null references public.clientes(id),
 almacen_id uuid not null references public.almacenes(id), estado text not null default 'reservado' check(estado in ('reservado','facturado','despachado','anulado')),
 moneda text not null check(moneda in ('PEN','USD')), tipo_cambio numeric(14,6) not null check(tipo_cambio>0),
 lineas jsonb not null, total numeric(14,2) not null check(total>0), venta_id uuid unique references public.ventas(id),
 idempotency_key text not null unique, payload_hash text not null, created_by uuid not null default auth.uid(), created_at timestamptz not null default now()
);
create unique index if not exists ec_pedidos_cotizacion_unique on public.ec_pedidos(cotizacion_id) where cotizacion_id is not null and estado<>'anulado';
create table if not exists public.ec_reservas (
 pedido_id uuid not null references public.ec_pedidos(id), producto_id uuid not null references public.productos(id),
 cantidad integer not null check(cantidad>0), entregado integer not null default 0 check(entregado>=0 and entregado<=cantidad),
 primary key(pedido_id,producto_id)
);
create table if not exists public.ec_comprobantes (
 id uuid primary key default gen_random_uuid(), venta_id uuid not null unique references public.ventas(id),
 tipo text not null references public.ec_sunat_documentos(codigo) check(tipo in ('01','03')),
 serie text not null, numero integer not null check(numero>0), moneda text not null, tipo_cambio numeric(14,6) not null,
 base numeric(14,2) not null, igv numeric(14,2) not null, total numeric(14,2) not null,
 snapshot jsonb not null, ubl_version text not null default '2.1', estado_sunat text not null default 'pendiente' check(estado_sunat in ('pendiente','enviado','aceptado','rechazado')),
 created_at timestamptz not null default now(), unique(tipo,serie,numero)
);
create table if not exists public.ec_guias (
 id uuid primary key default gen_random_uuid(), codigo text not null unique default ('GR-'||lpad(nextval('public.seq_ec_guias')::text,6,'0')),
 pedido_id uuid not null unique references public.ec_pedidos(id), origen text not null, destino text not null,
 motivo_traslado text not null default '01', lineas jsonb not null, idempotency_key text not null unique, payload_hash text not null,
 created_by uuid not null default auth.uid(), created_at timestamptz not null default now()
);
create table if not exists public.ec_notas_credito (
 id uuid primary key default gen_random_uuid(), codigo text not null unique default ('NC-'||lpad(nextval('public.seq_ec_nc')::text,6,'0')),
 pedido_id uuid not null references public.ec_pedidos(id), venta_id uuid not null references public.ventas(id),
 motivo text not null, motivo_sunat text not null default '07', lineas jsonb not null,
 total numeric(14,2) not null check(total>0), idempotency_key text not null unique, payload_hash text not null,
 created_by uuid not null default auth.uid(), created_at timestamptz not null default now()
);
create table if not exists public.ec_operaciones (clave text primary key, tipo text not null, hash text not null, id uuid not null);

-- Protección transversal: incluso las salidas de inventario heredadas respetan reservas.
create or replace function public.ec_proteger_reservas() returns trigger language plpgsql security definer set search_path='' as $$
declare v_reserved integer;
begin
 select coalesce(sum(r.cantidad-r.entregado),0) into v_reserved from public.ec_reservas r
 join public.ec_pedidos o on o.id=r.pedido_id where o.almacen_id=new.almacen_id
 and o.estado in ('reservado','facturado') and r.producto_id=new.producto_id;
 if new.cantidad<v_reserved then raise exception 'Salida excede stock libre: % unidades reservadas.',v_reserved using errcode='23514'; end if;
 return new;
end $$;
drop trigger if exists ec_proteger_reservas on public.inventarios;
create trigger ec_proteger_reservas before update of cantidad on public.inventarios
for each row execute function public.ec_proteger_reservas();

-- Todos los cambios se ejecutan desde RPC; no se expone escritura directa a clientes.
grant usage on sequence public.seq_ec_pedidos,public.seq_ec_guias,public.seq_ec_nc to postgres;
revoke all on public.ec_cotizaciones,public.ec_cotizacion_versiones,public.ec_pedidos,public.ec_reservas,public.ec_comprobantes,public.ec_guias,public.ec_notas_credito from public,anon,authenticated;
revoke all on public.ec_sunat_documentos,public.ec_sunat_afectaciones from public,anon;
grant select on public.ec_cotizaciones,public.ec_cotizacion_versiones,public.ec_pedidos,public.ec_reservas,public.ec_comprobantes,public.ec_guias,public.ec_notas_credito,public.ec_sunat_documentos,public.ec_sunat_afectaciones to authenticated;
alter table public.ec_cotizaciones enable row level security;
alter table public.ec_cotizacion_versiones enable row level security;
alter table public.ec_pedidos enable row level security;
alter table public.ec_reservas enable row level security;
alter table public.ec_comprobantes enable row level security;
alter table public.ec_guias enable row level security;
alter table public.ec_notas_credito enable row level security;
alter table public.ec_sunat_documentos enable row level security;
alter table public.ec_sunat_afectaciones enable row level security;
create policy ec_quotes_read on public.ec_cotizaciones for select to authenticated using (public.tiene_permiso('cotizaciones','ver'));
create policy ec_versions_read on public.ec_cotizacion_versiones for select to authenticated using (public.tiene_permiso('cotizaciones','ver'));
create policy ec_orders_read on public.ec_pedidos for select to authenticated using (public.tiene_permiso('ventas','ver'));
create policy ec_reserved_read on public.ec_reservas for select to authenticated using (public.tiene_permiso('ventas','ver'));
create policy ec_receipts_read on public.ec_comprobantes for select to authenticated using (public.tiene_permiso('ventas','ver'));
create policy ec_guides_read on public.ec_guias for select to authenticated using (public.tiene_permiso('ventas','ver'));
create policy ec_credits_read on public.ec_notas_credito for select to authenticated using (public.tiene_permiso('ventas','ver'));
create policy ec_doc_codes_read on public.ec_sunat_documentos for select to authenticated using (public.tiene_permiso('ventas','ver'));
create policy ec_tax_codes_read on public.ec_sunat_afectaciones for select to authenticated using (public.tiene_permiso('ventas','ver'));

-- Normaliza y calcula exclusivamente en el servidor: importe unitario incluye IGV.
create or replace function public.ec_validar_lineas_venta(p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_line jsonb; v_result jsonb:='[]'::jsonb; v_id uuid; v_qty integer; v_price numeric; v_tax text; v_total numeric; v_base numeric; v_igv numeric;
begin
 if jsonb_typeof(p_lineas)<>'array' or jsonb_array_length(p_lineas)=0 then raise exception 'Indica al menos un producto.'; end if;
 if exists(select 1 from jsonb_array_elements(p_lineas) x group by x->>'producto_id' having count(*)>1) then raise exception 'No repitas productos.'; end if;
 for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'producto_id' loop
   v_id:=(v_line->>'producto_id')::uuid; v_qty:=(v_line->>'cantidad')::integer;
   v_price:=(v_line->>'precio')::numeric; v_tax:=coalesce(v_line->>'afectacion','10');
   if v_qty is null or v_qty<=0 or v_price is null or v_price<=0 or round(v_price,2)<>v_price or not exists(select 1 from public.productos where id=v_id) or not exists(select 1 from public.ec_sunat_afectaciones where codigo=v_tax) then
      raise exception 'Producto, cantidad, precio o afectación IGV inválidos.';
   end if;
   v_total:=round(v_qty*v_price,2); v_base:=case when v_tax='10' then round(v_total/1.18,2) else v_total end; v_igv:=v_total-v_base;
   v_result:=v_result||jsonb_build_array(jsonb_build_object('producto_id',v_id,'cantidad',v_qty,'precio',v_price,'afectacion',v_tax,'base',v_base,'igv',v_igv,'total',v_total));
 end loop;
 return v_result;
end $$;

create or replace function public.ec_guardar_cotizacion(p_id uuid,p_cliente_id uuid,p_vence_el date,p_moneda text,p_tipo_cambio numeric,p_lineas jsonb,p_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_old public.ec_cotizaciones%rowtype; v_lines jsonb; v_total numeric; v_key text:=nullif(trim(p_key),''); v_id uuid; v_hash text;
begin
 if auth.uid() is null or not public.tiene_permiso('cotizaciones',case when p_id is null then 'crear' else 'editar' end) then raise exception 'Sin permiso de cotizaciones.' using errcode='42501'; end if;
 if v_key is null then raise exception 'Clave de idempotencia obligatoria.'; end if;
 v_lines:=public.ec_validar_lineas_venta(p_lineas);
 select sum((x->>'total')::numeric) into v_total from jsonb_array_elements(v_lines) x;
 v_hash:=md5(jsonb_build_object('id',p_id,'cliente',p_cliente_id,'vence',p_vence_el,'moneda',p_moneda,'tc',p_tipo_cambio,'lineas',v_lines)::text);
 perform pg_advisory_xact_lock(hashtextextended('ec:quote:'||v_key,0));
 select id into v_id from public.ec_operaciones where clave=v_key and tipo='cotizacion' and hash=v_hash;
 if found then return v_id; end if;
 if exists(select 1 from public.ec_operaciones where clave=v_key) then raise exception 'Clave reutilizada con otro contenido.' using errcode='23505'; end if;
 if p_vence_el<current_date or p_vence_el is null or p_moneda not in ('PEN','USD') or p_tipo_cambio is null or p_tipo_cambio<=0 or (p_moneda='PEN' and p_tipo_cambio<>1) then raise exception 'Vencimiento, moneda o tipo de cambio inválidos.'; end if;
 if not exists(select 1 from public.clientes where id=p_cliente_id) then raise exception 'Cliente no existe.'; end if;
 if p_id is null then
   insert into public.ec_cotizaciones(cliente_id,vence_el,moneda,tipo_cambio,lineas,total,estado) values(p_cliente_id,p_vence_el,p_moneda,p_tipo_cambio,v_lines,v_total,'vigente') returning id into v_id;
 else
   select * into v_old from public.ec_cotizaciones where id=p_id for update;
   if not found or v_old.estado not in ('vigente','borrador') then raise exception 'Cotización no editable.'; end if;
   update public.ec_cotizaciones set cliente_id=p_cliente_id,vence_el=p_vence_el,moneda=p_moneda,tipo_cambio=p_tipo_cambio,lineas=v_lines,total=v_total,version=v_old.version+1,estado='vigente' where id=p_id;
   v_id:=p_id;
 end if;
 insert into public.ec_cotizacion_versiones(cotizacion_id,version,cliente_id,moneda,tipo_cambio,lineas,total,vence_el)
 select id,version,cliente_id,moneda,tipo_cambio,lineas,total,vence_el from public.ec_cotizaciones where id=v_id;
 insert into public.ec_operaciones(clave,tipo,hash,id) values(v_key,'cotizacion',v_hash,v_id);
 return v_id;
end $$;

revoke all on public.ec_operaciones from public,anon,authenticated;
alter table public.ec_operaciones enable row level security;

create or replace function public.ec_crear_pedido(p_cliente_id uuid,p_almacen_id uuid,p_moneda text,p_tipo_cambio numeric,p_lineas jsonb,p_key text,p_cotizacion_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_quote public.ec_cotizaciones%rowtype; v_lines jsonb; v_total numeric; v_hash text; v_old public.ec_pedidos%rowtype; v_id uuid; v_line jsonb; v_available integer; v_reserved integer;
begin
 if auth.uid() is null or not public.tiene_permiso('ventas','crear') then raise exception 'Sin permiso de ventas.' using errcode='42501'; end if;
 if nullif(trim(p_key),'') is null then raise exception 'Clave obligatoria.'; end if;
 if p_moneda not in ('PEN','USD') or p_tipo_cambio is null or p_tipo_cambio<=0 or (p_moneda='PEN' and p_tipo_cambio<>1) then raise exception 'Moneda o cambio inválidos.'; end if;
 if p_cotizacion_id is not null then
  if not public.tiene_permiso('cotizaciones','editar') then raise exception 'Sin permiso de cotizaciones.' using errcode='42501'; end if;
  select * into v_quote from public.ec_cotizaciones where id=p_cotizacion_id for update;
  if not found then raise exception 'Cotización inexistente.'; end if;
  p_cliente_id:=v_quote.cliente_id; p_moneda:=v_quote.moneda; p_tipo_cambio:=v_quote.tipo_cambio; p_lineas:=v_quote.lineas;
 end if;
 v_lines:=public.ec_validar_lineas_venta(p_lineas);
 select sum((x->>'total')::numeric) into v_total from jsonb_array_elements(v_lines) x;
 v_hash:=md5(jsonb_build_object('cliente',p_cliente_id,'almacen',p_almacen_id,'moneda',p_moneda,'tc',p_tipo_cambio,'lineas',v_lines,'quote',p_cotizacion_id)::text);
 perform pg_advisory_xact_lock(hashtextextended('ec:order:'||p_key,0));
 select * into v_old from public.ec_pedidos where idempotency_key=p_key;
 if found then if v_old.payload_hash<>v_hash then raise exception 'Clave reutilizada.' using errcode='23505'; end if; return v_old.id; end if;
 if p_cotizacion_id is not null and (v_quote.estado<>'vigente' or v_quote.vence_el<current_date) then raise exception 'Cotización vencida o convertida.'; end if;
 if not exists(select 1 from public.clientes where id=p_cliente_id) or not exists(select 1 from public.almacenes where id=p_almacen_id and activo) then raise exception 'Cliente o almacén inválido.'; end if;
 -- Bloquea por producto en orden global para evitar carreras entre reservas y guías.
 for v_line in select value from jsonb_array_elements(v_lines) order by value->>'producto_id' loop
   perform pg_advisory_xact_lock(hashtextextended('ec:stock:'||p_almacen_id::text||':'||(v_line->>'producto_id'),0));
   select cantidad into v_available from public.inventarios where almacen_id=p_almacen_id and producto_id=(v_line->>'producto_id')::uuid for update;
   select coalesce(sum(r.cantidad-r.entregado),0) into v_reserved from public.ec_reservas r join public.ec_pedidos o on o.id=r.pedido_id where o.almacen_id=p_almacen_id and o.estado in ('reservado','facturado') and r.producto_id=(v_line->>'producto_id')::uuid;
   if coalesce(v_available,0)-v_reserved<(v_line->>'cantidad')::integer then raise exception 'Stock disponible insuficiente para reservar %.',v_line->>'producto_id'; end if;
 end loop;
 insert into public.ec_pedidos(cotizacion_id,cliente_id,almacen_id,moneda,tipo_cambio,lineas,total,idempotency_key,payload_hash)
 values(p_cotizacion_id,p_cliente_id,p_almacen_id,p_moneda,p_tipo_cambio,v_lines,v_total,p_key,v_hash) returning id into v_id;
 for v_line in select value from jsonb_array_elements(v_lines) loop insert into public.ec_reservas(pedido_id,producto_id,cantidad) values(v_id,(v_line->>'producto_id')::uuid,(v_line->>'cantidad')::integer); end loop;
 if p_cotizacion_id is not null then update public.ec_cotizaciones set estado='convertida' where id=p_cotizacion_id; end if;
 return v_id;
end $$;

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
 insert into public.ventas(cliente_id,cliente_nombre,detalle,monto,estado,almacen_id,idempotency_key,payload_hash)
 values(v_order.cliente_id,v_name,p_serie||'-'||p_numero,v_order.total,'Pendiente',v_order.almacen_id,'ec:'||p_key,v_hash) returning id into v_sale;
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

create or replace function public.ec_anular_pedido(p_pedido_id uuid,p_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_order public.ec_pedidos%rowtype; v_old public.ec_operaciones%rowtype; v_hash text;
begin
 if auth.uid() is null or not public.tiene_permiso('ventas','editar') then raise exception 'Sin permiso de ventas.' using errcode='42501'; end if;
 if nullif(trim(p_key),'') is null then raise exception 'Clave obligatoria.'; end if;
 v_hash:=md5(p_pedido_id::text);
 perform pg_advisory_xact_lock(hashtextextended('ec:cancel:'||p_key,0));
 select * into v_old from public.ec_operaciones where clave=p_key;
 if found then if v_old.tipo<>'anulacion' or v_old.hash<>v_hash then raise exception 'Clave reutilizada.' using errcode='23505'; end if; return v_old.id; end if;
 select * into v_order from public.ec_pedidos where id=p_pedido_id for update;
 if not found or v_order.estado<>'reservado' then raise exception 'Solo se puede anular un pedido sin facturar.'; end if;
 update public.ec_pedidos set estado='anulado' where id=p_pedido_id;
 if v_order.cotizacion_id is not null then update public.ec_cotizaciones set estado='vigente' where id=v_order.cotizacion_id and vence_el>=current_date; end if;
 insert into public.ec_operaciones(clave,tipo,hash,id) values(p_key,'anulacion',v_hash,p_pedido_id);
 return p_pedido_id;
end $$;

create or replace function public.ec_emitir_guia(p_pedido_id uuid,p_origen text,p_destino text,p_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_order public.ec_pedidos%rowtype; v_old public.ec_guias%rowtype; v_id uuid; v_line jsonb; v_hash text;
begin
 if auth.uid() is null or not public.tiene_permiso('ventas','editar') or not (public.tiene_permiso('inventario','crear') or public.tiene_permiso('inventario','editar')) then raise exception 'Se requieren permisos de ventas e inventario.' using errcode='42501'; end if;
 if nullif(trim(p_key),'') is null or length(trim(coalesce(p_origen,'')))<4 or length(trim(coalesce(p_destino,'')))<4 then raise exception 'Clave, origen y destino obligatorios.'; end if;
 v_hash:=md5(jsonb_build_object('pedido',p_pedido_id,'origen',trim(p_origen),'destino',trim(p_destino))::text);
 perform pg_advisory_xact_lock(hashtextextended('ec:guide:'||p_key,0));
 select * into v_old from public.ec_guias where idempotency_key=p_key;
 if found then if v_old.payload_hash<>v_hash then raise exception 'Clave reutilizada.' using errcode='23505'; end if; return v_old.id; end if;
 select * into v_order from public.ec_pedidos where id=p_pedido_id for update;
 if not found or v_order.estado<>'facturado' then raise exception 'Primero factura el pedido; solo puede tener una guía.'; end if;
 for v_line in select value from jsonb_array_elements(v_order.lineas) order by value->>'producto_id' loop
  perform pg_advisory_xact_lock(hashtextextended('ec:stock:'||v_order.almacen_id::text||':'||(v_line->>'producto_id'),0));
 end loop;
 insert into public.ec_guias(pedido_id,origen,destino,lineas,idempotency_key,payload_hash) values(p_pedido_id,trim(p_origen),trim(p_destino),v_order.lineas,p_key,v_hash) returning id into v_id;
 for v_line in select value from jsonb_array_elements(v_order.lineas) order by value->>'producto_id' loop
   -- La reserva propia se consume sin liberar stock a terceros entre operaciones.
   update public.ec_reservas set entregado=cantidad where pedido_id=p_pedido_id and producto_id=(v_line->>'producto_id')::uuid;
   perform public.registrar_movimiento_inventario((v_line->>'producto_id')::uuid,v_order.almacen_id,'salida',(v_line->>'cantidad')::integer,'Guía '||v_id::text,'ec:guia:'||v_id::text||':'||(v_line->>'producto_id'),'guia',v_id,'Salida oficial de venta');
 end loop;
 update public.ec_pedidos set estado='despachado' where id=p_pedido_id;
 return v_id;
end $$;

create or replace function public.ec_nota_credito(p_pedido_id uuid,p_lineas jsonb,p_motivo text,p_devolver_stock boolean,p_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_order public.ec_pedidos%rowtype; v_old public.ec_notas_credito%rowtype; v_line jsonb; v_original jsonb; v_qty integer; v_prior integer; v_delivered integer; v_total numeric:=0; v_paid numeric; v_account public.pagos%rowtype; v_id uuid; v_hash text;
begin
 if auth.uid() is null or not public.tiene_permiso('ventas','editar') or not public.tiene_permiso('finanzas','editar') then raise exception 'Se requieren permisos de Ventas y Finanzas.' using errcode='42501'; end if;
 if p_devolver_stock and not (public.tiene_permiso('inventario','crear') or public.tiene_permiso('inventario','editar')) then raise exception 'Se requiere permiso de inventario.' using errcode='42501'; end if;
 if nullif(trim(p_key),'') is null or length(trim(coalesce(p_motivo,'')))<5 or jsonb_typeof(p_lineas)<>'array' or jsonb_array_length(p_lineas)=0 then raise exception 'Motivo, líneas y clave obligatorios.'; end if;
 if exists(select 1 from jsonb_array_elements(p_lineas) x group by x->>'producto_id' having count(*)>1) then raise exception 'Producto duplicado.'; end if;
 v_hash:=md5(jsonb_build_object('pedido',p_pedido_id,'lineas',p_lineas,'motivo',trim(p_motivo),'stock',p_devolver_stock)::text);
 perform pg_advisory_xact_lock(hashtextextended('ec:credit:'||p_key,0));
 select * into v_old from public.ec_notas_credito where idempotency_key=p_key;
 if found then if v_old.payload_hash<>v_hash then raise exception 'Clave reutilizada.' using errcode='23505'; end if; return v_old.id; end if;
 select * into v_order from public.ec_pedidos where id=p_pedido_id for update;
 if not found or v_order.venta_id is null or v_order.estado<>'despachado' then raise exception 'La nota requiere pedido facturado y despachado; no se acreditan reservas pendientes de envío.'; end if;
 if p_devolver_stock and v_order.estado<>'despachado' then raise exception 'No se devuelve stock sin salida oficial por guía.'; end if;
 select * into v_account from public.pagos where venta_id=v_order.venta_id and tipo='cobrar' for update;
 if not found then raise exception 'CxC no encontrada.'; end if;
 for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'producto_id' loop
   v_qty:=(v_line->>'cantidad')::integer;
   select value into v_original from jsonb_array_elements(v_order.lineas) where value->>'producto_id'=v_line->>'producto_id';
   if v_original is null or v_qty is null or v_qty<=0 then raise exception 'Línea o cantidad inválida.'; end if;
   select coalesce(sum((x->>'cantidad')::integer),0) into v_prior from public.ec_notas_credito n cross join lateral jsonb_array_elements(n.lineas) x where n.pedido_id=p_pedido_id and x->>'producto_id'=v_line->>'producto_id';
   if v_prior+v_qty>(v_original->>'cantidad')::integer then raise exception 'Nota de crédito supera lo vendido.'; end if;
   if p_devolver_stock then
     select entregado into v_delivered from public.ec_reservas where pedido_id=p_pedido_id and producto_id=(v_line->>'producto_id')::uuid;
     if v_prior+v_qty>v_delivered then raise exception 'Devolución supera lo despachado.'; end if;
     perform pg_advisory_xact_lock(hashtextextended('ec:stock:'||v_order.almacen_id::text||':'||(v_line->>'producto_id'),0));
   end if;
   -- Importe proporcional de línea, con ajuste de céntimos en la última devolución.
   v_total:=v_total+case when v_prior+v_qty=(v_original->>'cantidad')::integer then (v_original->>'total')::numeric - coalesce((select sum(round((x->>'cantidad')::integer*(v_original->>'precio')::numeric,2)) from public.ec_notas_credito n cross join lateral jsonb_array_elements(n.lineas) x where n.pedido_id=p_pedido_id and x->>'producto_id'=v_line->>'producto_id'),0) else round(v_qty*(v_original->>'precio')::numeric,2) end;
 end loop;
 select coalesce(sum(a.monto),0) into v_paid from public.aplicaciones_pago a join public.movimientos_tesoreria m on m.id=a.movimiento_id where a.cuenta_id=v_account.id and m.anulado_en is null;
 if v_total<=0 or v_total>v_account.monto-v_paid then raise exception 'La nota excede la CxC no cobrada. Registra primero el reembolso de los cobros existentes.'; end if;
 insert into public.ec_notas_credito(pedido_id,venta_id,motivo,lineas,total,idempotency_key,payload_hash)
 values(p_pedido_id,v_order.venta_id,trim(p_motivo),p_lineas,v_total,p_key,v_hash) returning id into v_id;
 update public.pagos set monto=monto-v_total,estado=case when monto-v_total=v_paid then 'Completada' else 'Pendiente' end,
 estado_cobro=case when monto-v_total=v_paid then 'completa' when v_paid>0 then 'parcial' else 'pendiente' end where id=v_account.id;
 if p_devolver_stock then
   for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'producto_id' loop
     perform public.registrar_movimiento_inventario((v_line->>'producto_id')::uuid,v_order.almacen_id,'entrada',(v_line->>'cantidad')::integer,'Devolución NC '||v_id::text,'ec:nc:'||v_id::text||':'||(v_line->>'producto_id'),'nota_credito',v_id,trim(p_motivo));
   end loop;
 end if;
 return v_id;
end $$;

create or replace function public.ec_convertir_cotizacion(p_cotizacion_id uuid,p_almacen_id uuid,p_tipo text,p_serie text,p_numero integer,p_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_q public.ec_cotizaciones%rowtype; v_id uuid; v_hash text; v_old public.ec_operaciones%rowtype;
begin
 if nullif(trim(p_key),'') is null then raise exception 'Clave obligatoria.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ec:convert:'||p_key,0));
 v_hash:=md5(jsonb_build_object('quote',p_cotizacion_id,'almacen',p_almacen_id,'tipo',p_tipo,'serie',p_serie,'numero',p_numero)::text);
 select * into v_old from public.ec_operaciones where clave=p_key;
 if found then if v_old.tipo<>'conversion' or v_old.hash<>v_hash then raise exception 'Clave reutilizada.' using errcode='23505'; end if; return v_old.id; end if;
 select * into v_q from public.ec_cotizaciones where id=p_cotizacion_id for update;
 if not found then raise exception 'Cotización inexistente.'; end if;
 v_id:=public.ec_crear_pedido(v_q.cliente_id,p_almacen_id,v_q.moneda,v_q.tipo_cambio,v_q.lineas,'ec:convert:order:'||p_key,p_cotizacion_id);
 if p_tipo is not null then
   perform public.ec_facturar_pedido(v_id,p_tipo,p_serie,p_numero,'ec:convert:invoice:'||p_key);
 end if;
  insert into public.ec_operaciones(clave,tipo,hash,id) values(p_key,'conversion',v_hash,v_id);
 return v_id;
end $$;

revoke all on function public.ec_validar_lineas_venta(jsonb),public.ec_guardar_cotizacion(uuid,uuid,date,text,numeric,jsonb,text),public.ec_crear_pedido(uuid,uuid,text,numeric,jsonb,text,uuid),public.ec_facturar_pedido(uuid,text,text,integer,text),public.ec_anular_pedido(uuid,text),public.ec_emitir_guia(uuid,text,text,text),public.ec_nota_credito(uuid,jsonb,text,boolean,text),public.ec_convertir_cotizacion(uuid,uuid,text,text,integer,text) from public,anon;
grant execute on function public.ec_guardar_cotizacion(uuid,uuid,date,text,numeric,jsonb,text),public.ec_crear_pedido(uuid,uuid,text,numeric,jsonb,text,uuid),public.ec_facturar_pedido(uuid,text,text,integer,text),public.ec_anular_pedido(uuid,text),public.ec_emitir_guia(uuid,text,text,text),public.ec_nota_credito(uuid,jsonb,text,boolean,text),public.ec_convertir_cotizacion(uuid,uuid,text,text,integer,text) to authenticated;
notify pgrst, 'reload schema';
commit;
